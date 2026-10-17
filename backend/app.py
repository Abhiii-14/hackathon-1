from __future__ import annotations

import logging
import os
import threading
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware

BACKEND_DIR = Path(__file__).resolve().parent
load_dotenv(BACKEND_DIR / ".env")

MAX_FRAME_BYTES = 2 * 1024 * 1024
logger = logging.getLogger("safeguard.fire_detection")
net: cv2.dnn.Net | None = None
pt_model: Any | None = None
class_names: list[str] = []
fire_class_id: int | None = None
smoke_class_id: int | None = None
detector_kind: str | None = None
model_load_error = "AI Model Not Loaded: configure genuine fire-trained model weights."
model_path: Path | None = None
input_size = 640
confidence_threshold = 0.35
nms_threshold = 0.45
inference_lock = threading.Lock()


def _resolve_path(env_name: str, default: str) -> Path:
    configured = os.getenv(env_name, default)
    path = Path(configured)
    return path if path.is_absolute() else (BACKEND_DIR / path).resolve()


def load_detector(
    weights_path: Path | None = None,
    names_path: Path | None = None
) -> None:
    global net, pt_model, class_names, fire_class_id, smoke_class_id
    global detector_kind, model_load_error
    global model_path, input_size, confidence_threshold, nms_threshold

    net = None
    pt_model = None
    class_names = []
    fire_class_id = None
    smoke_class_id = None
    detector_kind = None
    model_path = weights_path or _resolve_path("FIRE_MODEL_PATH", "models/fire.pt")

    if not model_path.is_file():
        model_load_error = (
            f"AI Model Not Loaded: fire detector weights were not found at {model_path}."
        )
        logger.warning(model_load_error)
        return

    try:
        configured_size = int(os.getenv("FIRE_MODEL_INPUT_SIZE", "640"))
        configured_confidence = float(os.getenv("FIRE_CONFIDENCE_THRESHOLD", "0.35"))
        configured_nms = float(os.getenv("FIRE_NMS_THRESHOLD", "0.45"))
        if configured_size < 32 or configured_size % 32 != 0:
            raise ValueError("FIRE_MODEL_INPUT_SIZE must be a positive multiple of 32.")
        if not 0 < configured_confidence < 1 or not 0 < configured_nms < 1:
            raise ValueError("Detection thresholds must be greater than 0 and less than 1.")

        if model_path.suffix.casefold() == ".pt":
            from ultralytics import YOLO

            loaded_model = YOLO(str(model_path))
            raw_names = loaded_model.names
            names = [
                raw_names[index]
                for index in range(len(raw_names))
            ] if isinstance(raw_names, dict) else list(raw_names)
            fire_id = next(
                (index for index, name in enumerate(names) if str(name).casefold() == "fire"),
                None
            )
            smoke_id = next(
                (index for index, name in enumerate(names) if str(name).casefold() == "smoke"),
                None
            )
            if fire_id is None or smoke_id is None:
                raise ValueError(
                    "The configured YOLO .pt model must include both 'fire' and 'smoke' classes."
                )
            warmup_results = loaded_model.predict(
                source=np.zeros(
                    (configured_size, configured_size, 3),
                    dtype=np.uint8
                ),
                imgsz=configured_size,
                conf=configured_confidence,
                iou=configured_nms,
                verbose=False,
                device="cpu"
            )
            if not warmup_results or warmup_results[0].boxes is None:
                raise ValueError("The YOLO .pt model did not return valid detection results.")

            pt_model = loaded_model
            class_names = [str(name) for name in names]
            fire_class_id = fire_id
            smoke_class_id = smoke_id
            detector_kind = "ultralytics_pt"
            input_size = configured_size
            confidence_threshold = configured_confidence
            nms_threshold = configured_nms
            model_load_error = ""
            logger.info("Loaded fire detector model %s", model_path.name)
            return

        if model_path.suffix.casefold() != ".onnx":
            raise ValueError("FIRE_MODEL_PATH must point to a YOLO .pt or .onnx model.")

        names_file = names_path or _resolve_path(
            "FIRE_CLASS_NAMES_PATH",
            f"{model_path.name}.names"
        )
        if not names_file.is_file():
            model_load_error = (
                f"AI Model Not Loaded: class names file was not found at {names_file}."
            )
            logger.warning(model_load_error)
            return

        names = [
            line.strip()
            for line in names_file.read_text(encoding="utf-8").splitlines()
            if line.strip() and not line.lstrip().startswith("#")
        ]
        if not names:
            raise ValueError("The class names file must list the model classes in order.")
        fire_id = next(
            (index for index, name in enumerate(names) if name.casefold() == "fire"),
            None
        )
        smoke_id = next(
            (index for index, name in enumerate(names) if name.casefold() == "smoke"),
            None
        )
        if fire_id is None or smoke_id is None:
            raise ValueError(
                "The configured detector classes must include both 'fire' and 'smoke'."
            )
        expected_values = 4 + len(names)

        loaded_net = cv2.dnn.readNetFromONNX(str(model_path))
        loaded_net.setPreferableBackend(cv2.dnn.DNN_BACKEND_OPENCV)
        loaded_net.setPreferableTarget(cv2.dnn.DNN_TARGET_CPU)
        loaded_net.setInput(np.zeros(
            (1, 3, configured_size, configured_size),
            dtype=np.float32
        ))
        probe_outputs = loaded_net.forward(loaded_net.getUnconnectedOutLayersNames())
        if len(probe_outputs) != 1:
            raise ValueError("The ONNX detector must produce one raw detection tensor.")
        probe = np.asarray(probe_outputs[0]).squeeze()
        if probe.ndim != 2 or expected_values not in probe.shape:
            raise ValueError(
                "YOLO output class count does not match the configured class-name file."
            )

        net = loaded_net
        class_names = names
        fire_class_id = fire_id
        smoke_class_id = smoke_id
        detector_kind = "opencv_onnx"
        input_size = configured_size
        confidence_threshold = configured_confidence
        nms_threshold = configured_nms
        model_load_error = ""
        logger.info("Loaded fire detector model %s", model_path.name)
    except (OSError, ValueError, cv2.error, ImportError, RuntimeError) as error:
        model_load_error = f"AI Model Not Loaded: {error}"
        logger.exception("Could not load the configured fire detector model.")


def model_health() -> dict[str, Any]:
    if net is None and pt_model is None:
        return {
            "api_status": "connected",
            "status": "model_not_loaded",
            "detail": model_load_error,
            "model": None
        }
    return {
        "api_status": "connected",
        "status": "ready",
        "detail": "Fire detection model loaded.",
        "model": model_path.name if model_path else None,
        "classes": class_names,
        "detector": detector_kind,
        "confidence_threshold": confidence_threshold
    }


def predict_frame(frame: np.ndarray) -> dict[str, Any]:
    if fire_class_id is None or (net is None and pt_model is None):
        raise RuntimeError("AI Model Not Loaded.")

    height, width = frame.shape[:2]
    if pt_model is not None:
        results = pt_model.predict(
            source=frame,
            imgsz=input_size,
            conf=confidence_threshold,
            iou=nms_threshold,
            verbose=False,
            device="cpu"
        )
        detections: list[dict[str, Any]] = []
        for result in results:
            if result.boxes is None:
                continue
            for box in result.boxes:
                class_id = int(box.cls.item())
                x1, y1, x2, y2 = (
                    float(coordinate) for coordinate in box.xyxy[0].tolist()
                )
                left = max(0.0, min(float(width), x1))
                top = max(0.0, min(float(height), y1))
                right = max(0.0, min(float(width), x2))
                bottom = max(0.0, min(float(height), y2))
                if right <= left or bottom <= top or class_id >= len(class_names):
                    continue
                detections.append({
                    "label": class_names[class_id],
                    "confidence": round(float(box.conf.item()), 4),
                    "is_fire": class_id == fire_class_id,
                    "is_smoke": class_id == smoke_class_id,
                    "bbox": {
                        "x": left / width,
                        "y": top / height,
                        "width": (right - left) / width,
                        "height": (bottom - top) / height
                    }
                })
        detections.sort(key=lambda detection: detection["confidence"], reverse=True)
        return {
            "model": model_path.name if model_path else None,
            "frame_width": width,
            "frame_height": height,
            "fire_detected": any(detection["is_fire"] for detection in detections),
            "smoke_detected": any(detection["is_smoke"] for detection in detections),
            "detections": detections
        }

    blob = cv2.dnn.blobFromImage(
        frame,
        scalefactor=1 / 255.0,
        size=(input_size, input_size),
        swapRB=True,
        crop=False
    )
    with inference_lock:
        net.setInput(blob)
        outputs = net.forward(net.getUnconnectedOutLayersNames())

    if len(outputs) != 1:
        raise ValueError("The ONNX detector must produce one YOLOv8/v11 raw detection tensor.")
    prediction = np.asarray(outputs[0]).squeeze()
    expected_values = 4 + len(class_names)
    if prediction.ndim != 2:
        raise ValueError("Unsupported YOLO output shape; expected a 2D raw detection tensor.")
    if prediction.shape[0] == expected_values:
        prediction = prediction.T
    elif prediction.shape[1] != expected_values:
        raise ValueError(
            "YOLO output class count does not match the configured class-name file."
        )

    scale_x = width / input_size
    scale_y = height / input_size
    boxes_by_class: dict[int, list[list[int]]] = {}
    scores_by_class: dict[int, list[float]] = {}
    candidates_by_class: dict[int, list[dict[str, Any]]] = {}

    for values in prediction:
        scores = values[4:]
        class_id = int(np.argmax(scores))
        score = float(scores[class_id])
        if score < confidence_threshold:
            continue

        center_x, center_y, box_width, box_height = (
            float(value) for value in values[:4]
        )
        x1 = max(0, min(width, int((center_x - box_width / 2) * scale_x)))
        y1 = max(0, min(height, int((center_y - box_height / 2) * scale_y)))
        x2 = max(0, min(width, int((center_x + box_width / 2) * scale_x)))
        y2 = max(0, min(height, int((center_y + box_height / 2) * scale_y)))
        if x2 <= x1 or y2 <= y1:
            continue

        boxes_by_class.setdefault(class_id, []).append([x1, y1, x2 - x1, y2 - y1])
        scores_by_class.setdefault(class_id, []).append(score)
        candidates_by_class.setdefault(class_id, []).append({
            "label": class_names[class_id],
            "confidence": round(score, 4),
            "is_fire": class_id == fire_class_id,
            "is_smoke": class_id == smoke_class_id,
            "bbox": {
                "x": x1 / width,
                "y": y1 / height,
                "width": (x2 - x1) / width,
                "height": (y2 - y1) / height
            }
        })

    detections: list[dict[str, Any]] = []
    for class_id, boxes in boxes_by_class.items():
        kept = cv2.dnn.NMSBoxes(
            boxes,
            scores_by_class[class_id],
            confidence_threshold,
            nms_threshold
        )
        for index in np.asarray(kept).reshape(-1):
            detections.append(candidates_by_class[class_id][int(index)])
    detections.sort(key=lambda detection: detection["confidence"], reverse=True)

    return {
        "model": model_path.name if model_path else None,
        "frame_width": width,
        "frame_height": height,
        "fire_detected": any(detection["is_fire"] for detection in detections),
        "smoke_detected": any(detection["is_smoke"] for detection in detections),
        "detections": detections
    }


@asynccontextmanager
async def lifespan(_: FastAPI):
    load_detector()
    yield


app = FastAPI(title="SafeGuard AI Fire Detection", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173"
    ],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"]
)


@app.get("/")
def root() -> dict[str, Any]:
    return {
        "service": "SafeGuard AI Fire Detection API",
        "api_status": "connected",
        "health_endpoint": "/api/health",
        "detection_endpoint": "POST /api/detect",
        "docs_endpoint": "/docs"
    }


@app.get("/api/health")
def health() -> dict[str, Any]:
    return model_health()


@app.post("/api/detect")
async def detect(frame: UploadFile = File(...)) -> dict[str, Any]:
    if net is None and pt_model is None:
        raise HTTPException(
            status_code=503,
            detail=model_health()
        )

    image_bytes = await frame.read(MAX_FRAME_BYTES + 1)
    await frame.close()
    if len(image_bytes) > MAX_FRAME_BYTES:
        raise HTTPException(status_code=413, detail="Frame exceeds the 2 MB limit.")
    if not image_bytes:
        raise HTTPException(status_code=400, detail="No image frame was provided.")

    image = cv2.imdecode(np.frombuffer(image_bytes, dtype=np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise HTTPException(status_code=400, detail="Frame must be a valid JPEG or PNG image.")

    try:
        return await run_in_threadpool(predict_frame, image)
    except (ValueError, cv2.error) as error:
        logger.exception("Fire model inference failed.")
        raise HTTPException(status_code=500, detail=f"Fire model inference failed: {error}") from error
