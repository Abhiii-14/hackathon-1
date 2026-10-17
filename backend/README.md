# SafeGuard AI fire-detection backend

The backend accepts occasional JPEG frames captured from the existing React
`<video>` stream. It never opens a webcam. It supports a fire-trained Ultralytics
YOLO `.pt` model or an OpenCV DNN YOLOv8/YOLO11 ONNX model.

## API endpoints

- `GET /` describes the service and links the supported routes.
- `GET /api/health` confirms the API connection separately from model readiness.
- `POST /api/detect` accepts a multipart image field named `frame`.
- `GET /docs` opens FastAPI's interactive API documentation.

Opening the server root in a browser no longer returns an unexplained 404. Use
`/api/health` to check model readiness; a `model_not_loaded` response means the
API is reachable but has not loaded weights.

## Model requirements

The configured workspace contains `backend\models\fire.pt`. Its class map was
runtime-verified as `{0: smoke, 1: fire}`. The API reports `ready` only after
Ultralytics loads the checkpoint and completes a warm-up inference. A standard
COCO YOLO model is not a fire detector and must not be substituted here.

Obtain or train a fire-specific YOLOv8/YOLO11 detector from a reputable source.
Check its training dataset, class ordering, model architecture, and license.
The ONNX export must have one raw output tensor with YOLOv8/v11 layout
`[1, 4 + class_count, candidate_count]` (or its transposed equivalent), and it
must use the configured input size.

For a `.pt` fire detector, export it with a compatible Ultralytics installation
in an environment where that framework is supported:

```powershell
yolo export model="C:\path\to\fire-trained.pt" format=onnx imgsz=640 nms=False
```

Do not export the standard `yolo11n.pt`/`yolov8n.pt` COCO model and assume it
recognizes fire. If training your own detector, use a fire-labeled dataset and
keep the label order from its dataset YAML. The model training/validation and
license are the operator's responsibility.

For example, with a licensed fire-detection dataset whose YAML lists a `fire`
class, fine-tune and export it using a compatible Ultralytics environment:

```powershell
yolo detect train model=yolo11n.pt data="C:\path\to\fire-data.yaml" imgsz=640 epochs=100
yolo export model="runs\detect\train\weights\best.pt" format=onnx imgsz=640 nms=False
Copy-Item runs\detect\train\weights\best.onnx backend\models\fire.onnx
```

The COCO checkpoint here is only an initialization; the trained `best.pt` must
be validated on fire examples and have the actual fire class in its dataset.
If the run directory or ONNX output filename differs, copy that actual export
to the configured path instead.

### Load a fire-trained `.pt` model directly

Install the optional Ultralytics dependency set in the backend virtual
environment:

```powershell
.\backend\.venv\Scripts\python.exe -m pip install -r backend\requirements-yolo.txt
```

Place the validated fire-trained checkpoint at `backend\models\fire.pt`, then
set this in `backend\.env`:

```text
FIRE_MODEL_PATH=models/fire.pt
```

For `.pt`, Ultralytics supplies class names from the checkpoint, so a separate
names file is not required. The backend verifies that the checkpoint includes
both `fire` and `smoke`. If PyTorch has no compatible wheel for the installed
Python, create the backend environment with a Python version supported by the
installed Ultralytics/PyTorch versions; do not try to load a COCO-only model as
fire detection.

For the ONNX mode only, copy the resulting ONNX file to
`backend\models\fire.onnx`. Create
`backend\models\fire.onnx.names` with one model class name per line in the
exact class-index order from the dataset YAML. For example, a one-class fire
model has:

```text
fire
```

The backend refuses to load if the weights, `fire`, or `smoke` class is missing.
ONNX weights also require a names file. It cannot independently prove how
third-party weights were trained; verify provenance and class order before
configuration.

## Windows PowerShell setup

Python 3.14.7 is installed in the checked workspace. The OpenCV/ONNX backend
dependencies are listed for that interpreter. The optional
Ultralytics/PyTorch `.pt` backend may need a different Python version supported
by the relevant PyTorch wheel.

From the project root:

```powershell
& "C:\Users\Abhi\AppData\Local\Python\pythoncore-3.14-64\python.exe" -m venv backend\.venv
.\backend\.venv\Scripts\python.exe -m pip install --upgrade pip
.\backend\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
.\backend\.venv\Scripts\python.exe -m pip install -r backend\requirements-yolo.txt
```

The `.pt` checkpoint is already present at `backend\models\fire.pt`; the `.env`
example configures it as the default.

Run the backend in one PowerShell terminal:

```powershell
.\backend\.venv\Scripts\python.exe -m uvicorn app:app --app-dir backend --host 127.0.0.1 --port 8000 --reload
```

Run the frontend in a second terminal:

```powershell
npm.cmd run dev -- --host 127.0.0.1
```

Open the Vite URL, start the laptop camera, and allow camera access. The React
client captures selected frames from the displayed webcam stream and posts each
as the `frame` field to `http://127.0.0.1:8000/api/detect`; the backend does not
open another camera or request camera permission.

Automatic alerts require fire predictions in at least 3 of the last 5 sampled
frames. A 60-second cooldown suppresses repeat automatic alerts. Predictions
are displayed with class, confidence, and model bounding boxes. The existing
manual emergency and resolve controls continue to use the same dashboard
state. AI events are recorded as source `camera`; this integration does not
send SMS or issue ESP32 commands.

## Validation

Run backend checks:

```powershell
.\backend\.venv\Scripts\python.exe -m unittest discover -s backend\tests
```

Run inference against a safe, prerecorded image or video (no real fire):

```powershell
.\backend\.venv\Scripts\python.exe backend\test_media.py "C:\path\to\licensed-safe-fire-sample.mp4" --sample-every 10
```

Use only media you are allowed to use. The startup warm-up uses a blank frame
only to verify inference runs; it does not count as fire/smoke validation.
Verify predictions using safe prerecorded fire/smoke media before relying on
them.
