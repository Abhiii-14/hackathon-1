
SafeGuard ESP32 — Smart Industrial Emergency Alert System

Project Overview

SafeGuard ESP32 is a Physical AI hackathon prototype for industrial emergency alert monitoring, built using an ESP32 development board and CraftifAI FirmGen.

Problem

In industrial environments, workers need a simple way to trigger a visible and audible emergency alert that remains active until manually reset.

Our Solution

The system uses an emergency push button, reset button, red LED, green LED, and optional active buzzer.

- Normal state: Green LED ON.
- Emergency button pressed: Red LED ON, optional buzzer ON.
- Emergency button released: Emergency alert remains active.
- Reset button pressed: System returns to normal.
- UART monitor: Reports state changes.

Technology

- ESP32 development board
- CraftifAI FirmGen v0.4.1
- ESP-IDF v5.5
- GitHub

Requirements

See "PRD.md" (PRD.md) for REQ-001 to REQ-007 and acceptance tests.

Planned Verification

1. Flash firmware onto physical ESP32.
2. Verify normal state.
3. Press emergency button and verify alert.
4. Release emergency button and verify alert stays active.
5. Press reset and verify normal state.
6. Capture UART output, physical demo, and FirmGen traceability report.

Project Status

Everything done

Safety Note

This is a hackathon prototype, not a certified industrial emergency-stop system.

Final Reference Images are named as EmergencyModePhoto.jpeg and NormalModePhoto.jpeg
Video is named as ProjectDemoVideo.mp4
