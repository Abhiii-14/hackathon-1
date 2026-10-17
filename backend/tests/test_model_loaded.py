import sys
import unittest
from unittest.mock import patch
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

try:
    import app
    from fastapi.testclient import TestClient
except ImportError as error:
    raise unittest.SkipTest(f"Backend test dependencies are not installed: {error}") from error


MODEL_PATH = Path(__file__).resolve().parents[1] / "models" / "fire.pt"


@unittest.skipUnless(MODEL_PATH.is_file(), "Fire-trained YOLO weights are not present.")
class LoadedYoloApiTests(unittest.TestCase):
    def test_health_and_detection_endpoint_with_loaded_checkpoint(self) -> None:
        with TestClient(app.app) as client:
            health = client.get("/api/health")
            self.assertEqual(health.status_code, 200)
            self.assertEqual(health.json()["status"], "ready")
            self.assertEqual(health.json()["classes"], ["smoke", "fire"])
            self.assertEqual(health.json()["detector"], "ultralytics_pt")

            encoded_ok, encoded_frame = cv2.imencode(
                ".jpg",
                np.zeros((480, 640, 3), dtype=np.uint8)
            )
            self.assertTrue(encoded_ok)
            response = client.post(
                "/api/detect",
                files={
                    "frame": (
                        "blank.jpg",
                        encoded_frame.tobytes(),
                        "image/jpeg"
                    )
                }
            )

        self.assertEqual(response.status_code, 200, response.text)
        result = response.json()
        self.assertFalse(result["fire_detected"])
        self.assertFalse(result["smoke_detected"])
        self.assertEqual(result["detections"], [])

if __name__ == "__main__":
    unittest.main()
