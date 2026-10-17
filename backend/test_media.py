import argparse
import json
import sys
from pathlib import Path

import cv2

from app import load_detector, model_health, predict_frame


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Run the configured fire detector on a safe local image or video."
    )
    parser.add_argument("media", type=Path, help="Path to a prerecorded image or video.")
    parser.add_argument(
        "--sample-every",
        type=int,
        default=10,
        help="For video, analyze every Nth decoded frame (default: 10)."
    )
    args = parser.parse_args()

    load_detector()
    status = model_health()
    if status["status"] != "ready":
        print(status["detail"], file=sys.stderr)
        return 2
    if not args.media.is_file():
        parser.error(f"Media file not found: {args.media}")
    if args.sample_every < 1:
        parser.error("--sample-every must be at least 1.")

    image = cv2.imread(str(args.media))
    if image is not None:
        print(json.dumps(predict_frame(image), indent=2))
        return 0

    video = cv2.VideoCapture(str(args.media))
    if not video.isOpened():
        parser.error(f"Could not decode media file: {args.media}")

    frame_index = 0
    analyzed = 0
    try:
        while True:
            ok, frame = video.read()
            if not ok:
                break
            if frame_index % args.sample_every == 0:
                result = predict_frame(frame)
                result["frame_index"] = frame_index
                print(json.dumps(result))
                analyzed += 1
            frame_index += 1
    finally:
        video.release()

    if analyzed == 0:
        print("No video frames could be decoded.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
