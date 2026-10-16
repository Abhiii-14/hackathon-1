SafeGuard ESP32 — FirmGen Project Prompt

Project Name

SafeGuard ESP32 — Smart Industrial Emergency Alert System

Target

- Track B: CraftifAI FirmGen
- Hardware: Physical ESP32 development board
- Toolchain: ESP-IDF v5.5

Project Request

Create an ESP32 firmware project for a two-state industrial emergency alert demonstration.

The system has two states:

NORMAL

- Green LED ON
- Red LED OFF
- Buzzer OFF, if installed

EMERGENCY

- Green LED OFF
- Red LED ON
- Buzzer ON, if installed

When the emergency button is pressed, enter EMERGENCY state. Keep this state latched even after the button is released.

When the reset button is pressed, return to NORMAL state.

Print clear UART serial messages whenever the state changes.

Use safe GPIO configuration, internal pull-ups for buttons connected to GND where appropriate, and button debouncing.

Confirm GPIO pin assignments against the actual ESP32 board and wiring before generating final firmware.

Requirements

Implement and trace REQ-001 through REQ-007 from PRD.md.

Acceptance Testing

Create test cases corresponding to TEST-001 through TEST-005 from TEST_PLAN.md.

FirmGen Deliverables

- Reviewed and frozen requirements
- Firmware source code
- Successful build and physical ESP32 flash
- UART monitor output
- Requirements-to-code-and-tests traceability report

Current Status

Prompt prepared. FirmGen generation, firmware flashing, and hardware tests are pending.

Safety

This is a hackathon prototype, not a certified industrial emergency-stop system.