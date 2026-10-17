import asyncio
import io
import sys
import tempfile
import unittest
from pathlib import Path

from fastapi import HTTPException, UploadFile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import app


class ModelUnavailableTests(unittest.TestCase):
    def setUp(self) -> None:
        self.previous_state = (
            app.net,
            app.pt_model,
            app.class_names,
            app.fire_class_id,
            app.smoke_class_id,
            app.detector_kind,
            app.model_load_error,
            app.model_path
        )
        app.net = None
        app.pt_model = None
        app.class_names = []
        app.fire_class_id = None
        app.smoke_class_id = None
        app.detector_kind = None

    def tearDown(self) -> None:
        (
            app.net,
            app.pt_model,
            app.class_names,
            app.fire_class_id,
            app.smoke_class_id,
            app.detector_kind,
            app.model_load_error,
            app.model_path
        ) = self.previous_state

    def test_missing_weights_report_model_not_loaded(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            app.load_detector(base / "missing.onnx", base / "missing.onnx.names")

        self.assertEqual(app.health()["status"], "model_not_loaded")
        self.assertIn("AI Model Not Loaded", app.health()["detail"])

    def test_detection_is_rejected_when_weights_are_missing(self) -> None:
        upload = UploadFile(file=io.BytesIO(b"not an image"), filename="frame.jpg")

        with self.assertRaises(HTTPException) as caught:
            asyncio.run(app.detect(upload))

        self.assertEqual(caught.exception.status_code, 503)
        self.assertEqual(caught.exception.detail["status"], "model_not_loaded")

    def test_root_lists_actual_api_routes(self) -> None:
        response = app.root()

        self.assertEqual(response["health_endpoint"], "/api/health")
        self.assertEqual(response["detection_endpoint"], "POST /api/detect")

    def test_health_reports_api_up_even_when_model_is_missing(self) -> None:
        response = app.health()

        self.assertEqual(response["api_status"], "connected")
        self.assertEqual(response["status"], "model_not_loaded")


if __name__ == "__main__":
    unittest.main()
