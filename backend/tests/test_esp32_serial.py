import asyncio
import sys
import threading
import time
import unittest
from queue import Empty, Queue
from pathlib import Path
from typing import Callable
from unittest.mock import patch

import serial

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import app
from app import Esp32CommandRequest
from esp32_serial import Esp32CommandError, Esp32SerialListener


class Esp32SerialListenerTests(unittest.TestCase):
    def test_duplicate_messages_only_create_one_event_per_state_change(self) -> None:
        listener = Esp32SerialListener()

        listener._process_line("SYSTEM SAFE")
        self.assertEqual(listener.snapshot()["event_id"], 0)

        listener._process_line("EMERGENCY ACTIVATED")
        listener._process_line("EMERGENCY ACTIVATED")
        self.assertTrue(listener.snapshot()["emergency_active"])
        self.assertEqual(listener.snapshot()["event_id"], 1)

        listener._process_line("SYSTEM RESET")
        listener._process_line("SYSTEM RESET")
        self.assertFalse(listener.snapshot()["emergency_active"])
        self.assertEqual(listener.snapshot()["event_id"], 2)
        self.assertEqual(listener.snapshot()["last_event"], "reset")

    def test_system_safe_clears_an_active_emergency(self) -> None:
        listener = Esp32SerialListener()

        listener._process_line("EMERGENCY ACTIVATED")
        listener._process_line("SYSTEM SAFE")

        status = listener.snapshot()
        self.assertFalse(status["emergency_active"])
        self.assertEqual(status["event_id"], 2)
        self.assertEqual(status["last_event"], "safe")

    def test_status_endpoint_returns_listener_snapshot(self) -> None:
        listener = Esp32SerialListener()
        listener._process_line("EMERGENCY ACTIVATED")

        with patch.object(app, "esp32_listener", listener):
            status = app.esp32_status()

        self.assertFalse(status["connected"])
        self.assertTrue(status["state_known"])
        self.assertTrue(status["emergency_active"])
        self.assertEqual(status["event_id"], 1)

    def test_api_command_endpoint_returns_only_acknowledged_result(self) -> None:
        expected = {
            "request_id": "api-1",
            "target": "emergency",
            "state": "EMERGENCY",
            "acknowledged": True,
            "event_id": 1,
            "last_event": "emergency",
        }
        with patch.object(app.esp32_listener, "send_command", return_value=expected):
            result = asyncio.run(app.send_esp32_command(Esp32CommandRequest(
                request_id="api-1",
                target="emergency",
            )))
        self.assertEqual(result, expected)

    def test_api_command_endpoint_preserves_serial_failure_status(self) -> None:
        error = Esp32CommandError(
            "ESP32 did not acknowledge reset.",
            504,
            {"request_id": "api-2", "acknowledged": False},
        )
        with patch.object(app.esp32_listener, "send_command", side_effect=error):
            with self.assertRaises(app.HTTPException) as caught:
                asyncio.run(app.send_esp32_command(Esp32CommandRequest(
                    request_id="api-2",
                    target="reset",
                )))
        self.assertEqual(caught.exception.status_code, 504)
        self.assertEqual(caught.exception.detail, error.result)

    def test_unavailable_port_remains_disconnected_and_can_stop(self) -> None:
        attempted_connection = threading.Event()

        def fail_to_open(*args: object, **kwargs: object) -> None:
            attempted_connection.set()
            raise serial.SerialException("port unavailable")

        listener = Esp32SerialListener(reconnect_interval=60)
        with patch("esp32_serial.serial.Serial", side_effect=fail_to_open):
            listener.start()
            self.assertTrue(attempted_connection.wait(timeout=1))
            self.assertFalse(listener.snapshot()["connected"])
            listener.stop()

    def test_command_on_disconnected_port_reports_failure_in_status(self) -> None:
        listener = Esp32SerialListener()

        with self.assertRaises(Esp32CommandError) as caught:
            listener.send_command("offline-1", "emergency")

        self.assertEqual(caught.exception.status_code, 503)
        self.assertEqual(listener.snapshot()["last_command"]["status"], "failed")
        self.assertFalse(listener.snapshot()["last_command"]["acknowledged"])

    def test_serial_disconnect_clears_connection_status(self) -> None:
        retry_attempted = threading.Event()
        connection_count = 0

        class DroppedConnection:
            def readline(self) -> bytes:
                raise serial.SerialException("device disconnected")

            def close(self) -> None:
                pass

        def open_then_disconnect(*args: object, **kwargs: object) -> DroppedConnection | None:
            nonlocal connection_count
            connection_count += 1
            if connection_count == 1:
                return DroppedConnection()
            retry_attempted.set()
            raise serial.SerialException("port unavailable")

        listener = Esp32SerialListener(reconnect_interval=0.01)
        with patch("esp32_serial.serial.Serial", side_effect=open_then_disconnect):
            listener.start()
            self.assertTrue(retry_attempted.wait(timeout=1))
            self.assertFalse(listener.snapshot()["connected"])
            listener.stop()

    def test_command_reuses_single_connection_and_deduplicates_request_id(self) -> None:
        fake_serial = FakeSerial()
        listener = Esp32SerialListener(command_timeout=0.5)
        with patch("esp32_serial.serial.Serial", return_value=fake_serial) as open_serial:
            listener.start()
            self.assertTrue(wait_until(lambda: listener.snapshot()["connected"]))

            result = listener.send_command("req-1", "emergency")
            repeated = listener.send_command("req-1", "emergency")

            self.assertTrue(result["acknowledged"])
            self.assertEqual(result["state"], "EMERGENCY")
            self.assertEqual(repeated, result)
            self.assertEqual(fake_serial.writes, [b"CMD,req-1,EMERGENCY\n"])
            open_serial.assert_called_once()
            with self.assertRaises(Esp32CommandError) as caught:
                listener.send_command("req-1", "reset")
            self.assertEqual(caught.exception.status_code, 409)
            listener.stop()

    def test_acknowledgement_is_required_and_nack_is_reported(self) -> None:
        fake_serial = FakeSerial(acknowledge=False)
        listener = Esp32SerialListener(command_timeout=0.5)
        with patch("esp32_serial.serial.Serial", return_value=fake_serial):
            listener.start()
            self.assertTrue(wait_until(lambda: listener.snapshot()["connected"]))
            with self.assertRaises(Esp32CommandError) as caught:
                listener.send_command("req-2", "reset")
            self.assertEqual(caught.exception.status_code, 502)
            self.assertFalse(listener.snapshot()["last_command"]["acknowledged"])
            listener.stop()

    def test_reset_uses_reset_command_and_safe_acknowledgement(self) -> None:
        fake_serial = FakeSerial()
        listener = Esp32SerialListener(command_timeout=0.5)
        with patch("esp32_serial.serial.Serial", return_value=fake_serial):
            listener.start()
            self.assertTrue(wait_until(lambda: listener.snapshot()["connected"]))
            result = listener.send_command("req-reset", "reset")

            self.assertTrue(result["acknowledged"])
            self.assertEqual(result["state"], "SAFE")
            self.assertEqual(fake_serial.writes, [b"CMD,req-reset,RESET\n"])
            listener.stop()

    def test_timeout_does_not_report_success(self) -> None:
        fake_serial = FakeSerial(acknowledge=False, send_nack=False)
        listener = Esp32SerialListener(command_timeout=0.01)
        with patch("esp32_serial.serial.Serial", return_value=fake_serial):
            listener.start()
            self.assertTrue(wait_until(lambda: listener.snapshot()["connected"]))
            with self.assertRaises(Esp32CommandError) as caught:
                listener.send_command("req-3", "emergency")
            self.assertEqual(caught.exception.status_code, 504)
            self.assertFalse(listener.snapshot()["last_command"]["acknowledged"])
            listener.stop()

    def test_physical_state_change_invalidates_reused_acknowledgement(self) -> None:
        fake_serial = FakeSerial()
        listener = Esp32SerialListener(command_timeout=0.5)
        with patch("esp32_serial.serial.Serial", return_value=fake_serial):
            listener.start()
            self.assertTrue(wait_until(lambda: listener.snapshot()["connected"]))
            listener.send_command("req-4", "emergency")
            listener._process_line("SYSTEM RESET")
            listener.send_command("req-5", "emergency")

            self.assertEqual(
                fake_serial.writes,
                [b"CMD,req-4,EMERGENCY\n", b"CMD,req-5,EMERGENCY\n"],
            )
            listener.stop()


def wait_until(predicate: Callable[[], bool], timeout: float = 1.0) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(0.005)
    return False


class FakeSerial:
    def __init__(
        self,
        acknowledge: bool = True,
        send_nack: bool = True,
    ) -> None:
        self.is_open = True
        self.acknowledge = acknowledge
        self.send_nack = send_nack
        self.incoming: Queue[bytes] = Queue()
        self.writes: list[bytes] = []

    def write(self, command: bytes) -> int:
        self.writes.append(command)
        _, request_id, target = command.decode("ascii").strip().split(",")
        if self.acknowledge:
            state = "EMERGENCY" if target == "EMERGENCY" else "SAFE"
            self.incoming.put(f"ACK,{request_id},{state}\n".encode("ascii"))
        elif self.send_nack:
            self.incoming.put(f"NACK,{request_id},TEST_REJECTED\n".encode("ascii"))
        return len(command)

    def flush(self) -> None:
        pass

    def readline(self) -> bytes:
        try:
            return self.incoming.get(timeout=0.01)
        except Empty:
            return b""

    def close(self) -> None:
        self.is_open = False


if __name__ == "__main__":
    unittest.main()
