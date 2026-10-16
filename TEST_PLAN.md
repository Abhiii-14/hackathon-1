SafeGuard ESP32 — Hardware Acceptance Test Plan

Objective

Verify that the SafeGuard ESP32 emergency alert prototype behaves according to the requirements defined in "PRD.md".

Test Environment

- Board: ESP32 development board
- Firmware: Generated and built through CraftifAI FirmGen
- Toolchain: ESP-IDF v5.5
- Inputs: Emergency button and reset button
- Outputs: Red LED, green LED, optional buzzer, UART serial monitor

Test Cases

Test ID| Requirement| Action| Expected Result| Actual Result
TEST-001| REQ-001, REQ-002| Power on ESP32| NORMAL state, green LED ON, red LED OFF| Pending
TEST-002| REQ-003, REQ-004, REQ-007| Press emergency button| EMERGENCY state, red LED ON, green LED OFF, UART message| Pending
TEST-003| REQ-005| Release emergency button| Alert remains active| Pending
TEST-004| REQ-006, REQ-007| Press reset button| NORMAL state restored, UART message| Pending
TEST-005| REQ-003 to REQ-007| Repeat emergency/reset cycle 3 times| Consistent behavior on every cycle| Pending

Evidence Checklist

- [ ] FirmGen requirements reviewed and frozen
- [ ] FirmGen traceability report exported
- [ ] Firmware build successful
- [ ] Firmware flashed to physical ESP32
- [ ] UART serial monitor output captured
- [ ] Hardware demonstration video recorded
- [ ] Actual test results entered above

Current Status

All tests are pending physical hardware verification. No test is marked passed until it has been performed on the ESP32 board.

Safety

This is a demonstration prototype only and must not be used as a certified industrial safety device.