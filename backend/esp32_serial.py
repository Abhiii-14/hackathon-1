from __future__ import annotations

import logging
import threading
import uuid
from collections import OrderedDict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

import serial

logger = logging.getLogger("safeguard.esp32")


class Esp32CommandError(Exception):
    def __init__(self, message: str, status_code: int, result: dict[str, Any]) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.result = result


@dataclass
class _PendingCommand:
    request_id: str
    target: str
    completed: threading.Event = field(default_factory=threading.Event)
    result: dict[str, Any] | None = None
    error: str | None = None
    error_status: int = 502


class Esp32SerialListener:
    def __init__(
        self,
        port: str = "COM3",
        baudrate: int = 115200,
        reconnect_interval: float = 2.0,
        command_timeout: float = 5.0,
    ) -> None:
        if baudrate <= 0:
            raise ValueError("ESP32 baud rate must be a positive integer.")

        self.port = port
        self.baudrate = baudrate
        self.instance_id = str(uuid.uuid4())
        self.reconnect_interval = reconnect_interval
        self.command_timeout = command_timeout
        self._lock = threading.Lock()
        self._write_lock = threading.Lock()
        self._command_lock = threading.Lock()
        self._stop_event = threading.Event()
        self._thread: threading.Thread | None = None
        self._connection: serial.Serial | None = None
        self._connected = False
        self._emergency_active = False
        self._state_known = False
        self._event_id = 0
        self._last_event: str | None = None
        self._last_event_at: str | None = None
        self._pending_command: _PendingCommand | None = None
        self._last_command: dict[str, Any] | None = None
        self._last_acknowledged_state: str | None = None
        self._command_results: OrderedDict[str, dict[str, Any]] = OrderedDict()

    def start(self) -> None:
        with self._lock:
            if self._thread is not None and self._thread.is_alive():
                return
            self._stop_event.clear()
            self._thread = threading.Thread(
                target=self._listen,
                name="esp32-serial-listener",
                daemon=True,
            )
            self._thread.start()

    def stop(self) -> None:
        self._stop_event.set()
        self._fail_pending_command("ESP32 listener is stopping.")
        thread = self._thread
        if thread is not None:
            thread.join(timeout=3)
            if thread.is_alive():
                logger.error("ESP32 serial listener did not stop within 3 seconds.")

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            return {
                "connected": self._connected,
                "instance_id": self.instance_id,
                "port": self.port,
                "baud_rate": self.baudrate,
                "state_known": self._state_known,
                "emergency_active": self._emergency_active,
                "event_id": self._event_id,
                "last_event": self._last_event,
                "last_event_at": self._last_event_at,
                "last_command": dict(self._last_command) if self._last_command else None,
            }

    def send_command(self, request_id: str, target: str) -> dict[str, Any]:
        if target not in {"emergency", "reset"}:
            raise ValueError("ESP32 target must be 'emergency' or 'reset'.")

        with self._command_lock:
            with self._lock:
                cached = self._command_results.get(request_id)
                if cached is not None:
                    self._command_results.move_to_end(request_id)
                    if cached["target"] != target:
                        raise Esp32CommandError(
                            "ESP32 request_id was already used for a different target.",
                            409,
                            {
                                "request_id": request_id,
                                "target": target,
                                "acknowledged": False,
                                "error": "ESP32 request_id was already used for a different target.",
                            },
                        )
                    if cached["acknowledged"]:
                        return dict(cached)
                    raise Esp32CommandError(
                        cached["error"],
                        int(cached["status_code"]),
                        dict(cached),
                    )

                connection = self._connection
                if not self._connected or connection is None or not connection.is_open:
                    message = f"ESP32 is not connected on {self.port}."
                    result = {
                        "request_id": request_id,
                        "target": target,
                        "acknowledged": False,
                        "error": message,
                        "status_code": 503,
                    }
                    self._last_command = {
                        **result,
                        "status": "failed",
                        "updated_at": datetime.now(timezone.utc).isoformat(),
                    }
                    self._cache_command_result(request_id, result)
                    raise Esp32CommandError(
                        message,
                        503,
                        result,
                    )

                command_name = "EMERGENCY" if target == "emergency" else "RESET"
                desired_state = "EMERGENCY" if target == "emergency" else "SAFE"
                if self._last_acknowledged_state == desired_state:
                    result = {
                        "request_id": request_id,
                        "target": target,
                        "state": desired_state,
                        "acknowledged": True,
                        "reused_acknowledgement": True,
                        "event_id": self._event_id,
                        "last_event": self._last_event,
                        "last_event_at": self._last_event_at,
                    }
                    self._cache_command_result(request_id, result)
                    self._last_command = {
                        **result,
                        "status": "acknowledged",
                        "updated_at": datetime.now(timezone.utc).isoformat(),
                    }
                    return result

                pending = _PendingCommand(request_id=request_id, target=target)
                self._pending_command = pending
                self._last_command = {
                    "request_id": request_id,
                    "target": target,
                    "state": desired_state,
                    "status": "pending",
                    "acknowledged": False,
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                }

            command = f"CMD,{request_id},{command_name}\n".encode("ascii")
            try:
                with self._write_lock:
                    if not connection.is_open:
                        raise serial.SerialException("Serial connection closed before command write.")
                    written = connection.write(command)
                    if written != len(command):
                        raise serial.SerialException("Serial command was only partially written.")
                    connection.flush()
            except (serial.SerialException, OSError) as error:
                self._finish_command_error(pending, str(error), 503)

            if not pending.completed.wait(self.command_timeout):
                self._finish_command_error(
                    pending,
                    f"ESP32 did not acknowledge {target} within {self.command_timeout:g} seconds.",
                    504,
                )

            with self._lock:
                if self._pending_command is pending:
                    self._pending_command = None
                result = dict(pending.result) if pending.result else {
                    "request_id": request_id,
                    "target": target,
                    "acknowledged": False,
                    "error": pending.error or "ESP32 command failed.",
                    "status_code": pending.error_status,
                }
                self._cache_command_result(request_id, result)
                if not result["acknowledged"]:
                    self._last_command = {
                        **result,
                        "status": "failed",
                        "updated_at": datetime.now(timezone.utc).isoformat(),
                    }

            if not result["acknowledged"]:
                raise Esp32CommandError(
                    result["error"],
                    int(result["status_code"]),
                    result,
                )
            return result

    def _cache_command_result(self, request_id: str, result: dict[str, Any]) -> None:
        self._command_results[request_id] = dict(result)
        self._command_results.move_to_end(request_id)
        while len(self._command_results) > 100:
            self._command_results.popitem(last=False)

    def _finish_command_error(
        self,
        pending: _PendingCommand,
        message: str,
        status_code: int,
    ) -> None:
        with self._lock:
            if pending.completed.is_set():
                return
            if status_code in {503, 504}:
                self._state_known = False
            pending.error = message
            pending.error_status = status_code
            pending.completed.set()

    def _set_emergency_state(
        self,
        active: bool,
        event: str,
        acknowledged: bool = False,
    ) -> None:
        with self._lock:
            self._state_known = True
            if self._emergency_active == active:
                if self._last_event is None:
                    self._last_event = event
                    self._last_event_at = datetime.now(timezone.utc).isoformat()
                return
            self._emergency_active = active
            self._event_id += 1
            self._last_event = event
            self._last_event_at = datetime.now(timezone.utc).isoformat()
            if not acknowledged:
                self._last_acknowledged_state = None
        logger.info("ESP32 reported system state: %s", event)

    def _process_line(self, line: str) -> None:
        message = line.strip()
        fields = message.split(",")
        if len(fields) == 3 and fields[0] == "ACK":
            self._process_ack(fields[1], fields[2])
            return
        if len(fields) == 3 and fields[0] == "NACK":
            self._process_nack(fields[1], fields[2])
            return

        legacy_message = message.upper()
        if "EMERGENCY ACTIVATED" in legacy_message:
            self._set_emergency_state(True, "emergency")
        elif "SYSTEM RESET" in legacy_message:
            self._set_emergency_state(False, "reset")
        elif "SYSTEM SAFE" in legacy_message:
            self._set_emergency_state(False, "safe")

    def _process_ack(self, request_id: str, acknowledged_state: str) -> None:
        with self._lock:
            pending = self._pending_command
            if pending is None or pending.request_id != request_id:
                logger.warning("Ignoring unmatched ESP32 acknowledgement %s.", request_id)
                return
            if pending.completed.is_set():
                return
            expected_state = "EMERGENCY" if pending.target == "emergency" else "SAFE"
            if acknowledged_state != expected_state:
                active = acknowledged_state == "EMERGENCY"
                event = "emergency" if active else "reset"
                if self._emergency_active != active:
                    self._emergency_active = active
                    self._event_id += 1
                    self._last_event = event
                    self._last_event_at = datetime.now(timezone.utc).isoformat()
                self._state_known = True
                pending.error = (
                    f"ESP32 acknowledged {acknowledged_state}, expected {expected_state}."
                )
                pending.error_status = 502
                pending.completed.set()
                return

            active = acknowledged_state == "EMERGENCY"
            event = "emergency" if active else "reset"
            if self._emergency_active != active:
                self._emergency_active = active
                self._event_id += 1
                self._last_event = event
                self._last_event_at = datetime.now(timezone.utc).isoformat()
            self._last_acknowledged_state = acknowledged_state
            self._state_known = True
            pending.result = {
                "request_id": request_id,
                "target": pending.target,
                "state": acknowledged_state,
                "acknowledged": True,
                "event_id": self._event_id,
                "last_event": self._last_event,
                "last_event_at": self._last_event_at,
            }
            self._last_command = {
                **pending.result,
                "status": "acknowledged",
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
            pending.completed.set()
        logger.info("ESP32 acknowledged system state: %s", event)

    def _process_nack(self, request_id: str, reason: str) -> None:
        with self._lock:
            pending = self._pending_command
            if pending is None or pending.request_id != request_id:
                logger.warning("Ignoring unmatched ESP32 negative acknowledgement %s.", request_id)
                return
        self._finish_command_error(pending, f"ESP32 rejected command: {reason}", 502)

    def _fail_pending_command(self, message: str) -> None:
        with self._lock:
            pending = self._pending_command
        if pending is not None:
            self._finish_command_error(pending, message, 503)

    def _listen(self) -> None:
        while not self._stop_event.is_set():
            try:
                connection = serial.Serial(
                    self.port,
                    self.baudrate,
                    timeout=1,
                )
            except (serial.SerialException, OSError) as error:
                with self._lock:
                    self._connected = False
                logger.warning(
                    "Could not open ESP32 serial port %s: %s; retrying.",
                    self.port,
                    error,
                )
                self._stop_event.wait(self.reconnect_interval)
                continue

            with self._lock:
                self._connection = connection
                self._connected = True
                self._state_known = False
                self._last_acknowledged_state = None
            logger.info(
                "Connected to ESP32 on %s at %s baud.",
                self.port,
                self.baudrate,
            )

            try:
                while not self._stop_event.is_set():
                    line = connection.readline()
                    if line:
                        self._process_line(line.decode("utf-8", errors="replace"))
            except (serial.SerialException, OSError) as error:
                if not self._stop_event.is_set():
                    logger.warning(
                        "Lost ESP32 serial connection on %s: %s; reconnecting.",
                        self.port,
                        error,
                    )
                    self._fail_pending_command(
                        f"ESP32 serial connection lost: {error}"
                    )
            finally:
                with self._lock:
                    if self._connection is connection:
                        self._connection = None
                    self._connected = False
                    self._state_known = False
                    self._last_acknowledged_state = None
                try:
                    connection.close()
                except (serial.SerialException, OSError) as error:
                    if not self._stop_event.is_set():
                        logger.warning(
                            "Could not close ESP32 serial connection on %s: %s.",
                            self.port,
                            error,
                        )

            self._stop_event.wait(self.reconnect_interval)
