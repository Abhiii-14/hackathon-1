# SafeGuard ESP32 — Product Requirements Document

## Problem Statement
Industrial workplaces need a simple, reliable way for workers to raise an emergency alert and keep it active until manually reset.

## Proposed Solution
SafeGuard ESP32 is a physical emergency alert prototype using an ESP32 board, emergency push button, reset push button, red LED, green LED, and optional active buzzer. Pressing the emergency button activates and latches the alert. Only the reset button clears it.

## Functional Requirements
- REQ-001: On startup, the system enters NORMAL state.
- REQ-002: In NORMAL state, green LED is ON and red LED is OFF.
- REQ-003: Pressing the emergency button changes the system to EMERGENCY state.
- REQ-004: In EMERGENCY state, red LED is ON, green LED is OFF, and the buzzer sounds if fitted.
- REQ-005: The EMERGENCY state remains latched after the emergency button is released.
- REQ-006: Pressing the reset button returns the system to NORMAL state.
- REQ-007: Every state change prints a clear message to the UART serial monitor.

## Hardware
- ESP32 development board
- Two push buttons
- Red LED and green LED with current-limiting resistors
- Breadboard and jumper wires
- Optional 3.3V-compatible active buzzer module
- USB data cable

## Software and Tooling
- CraftifAI FirmGen v0.4.1
- ESP-IDF v5.5 toolchain for ESP32
- GitHub for version control

## Acceptance Tests
- TEST-001: Power on board; verify NORMAL indication and UART message.
- TEST-002: Press emergency; verify EMERGENCY indication and UART message.
- TEST-003: Release emergency; verify alert stays active.
- TEST-004: Press reset; verify NORMAL indication and UART message.
- TEST-005: Repeat emergency/reset cycle three times; verify consistent behavior.

## Evidence Required
- FirmGen reviewed/frozen requirements
- FirmGen traceability report linking requirements, implementation, and tests
- Successful firmware build and physical ESP32 flash
- UART monitor log and photos/video of real hardware behavior

## Scope and Safety
This is a hackathon demonstration prototype, not a certified industrial safety device. Do not connect it to real emergency-stop machinery or hazardous equipment.

## Status
Draft PRD. Implementation and acceptance tests are not yet verified.
