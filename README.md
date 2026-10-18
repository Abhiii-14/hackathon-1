
SafeGuard ESP32 — Smart Industrial Emergency Alert System

Project Overview

SafeGuard ESP32 is a Physical AI hackathon prototype designed for industrial emergency monitoring and fire and smoke detection. It integrates an ESP32 development board for hardware-based emergency alerts, PyTorch for AI-powered fire and smoke detection, React for the web-based monitoring dashboard, and CraftifAI FirmGen for firmware development and verification.

Problem

In industrial environments, workers need a simple way to trigger a visible and audible emergency alert that remains active until manually reset.

Our Solution

SOFTWARE:
An AI-powered Fire and Smoke Detection and Emergency Monitoring System continuously monitors the surrounding environment using a camera. An AI-based computer vision model detects fire and smoke in real time to identify potential fire hazards. When fire or smoke is detected, the system automatically triggers an emergency alert and activates a buzzer and a red LED light to provide immediate audible and visual warnings. The emergency event is recorded in the system, including the detection timestamp and current emergency status, allowing users to monitor and manage the incident through a dedicated web interface. The buzzer and red LED remain activated until the emergency is marked as resolved through the monitoring interface. Once the incident is resolved, the system updates the emergency status, deactivates the buzzer and red LED, and continues monitoring the environment for new fire or smoke incidents. This system aims to enable early hazard detection, prompt emergency notification, and efficient incident management to improve fire safety.

HARDWARE:
The hardware system uses an ESP32, camera, buzzer, red LED, and manual emergency push button. The AI model detects fire and smoke through the camera and sends an alert signal to the ESP32, which activates the buzzer and red LED. The manual button also allows users to trigger emergencies instantly. Both alerts remain active until the emergency is marked as resolved through the web interface or the hardware button, after which the system deactivates them and resumes normal monitoring.


Technology

- ESP32 development board
- CraftifAI FirmGen v0.4.1
- ESP-IDF v5.5
- GitHub
- React.js
- PyTorch
- Supabase

Requirements

See "PRD.md" (PRD.md) for REQ-001 to REQ-007 and acceptance tests.

Planned Verification

1. Flash the firmware onto the physical ESP32.
2. Verify the normal state with the buzzer and red LED turned off.
3. Test AI-based fire and smoke detection and verify automatic emergency activation.
4. Press the manual emergency button and verify that the buzzer and red LED activate.
5. Verify that the dashboard displays the emergency status and detection timestamp correctly.
6. Test dashboard updates to ensure emergency events and status changes are reflected correctly.
7. Mark the emergency as resolved through the dashboard and verify that the buzzer and red LED turn off.
8. Verify that the system resumes normal monitoring after resolution.
9. Test dashboard functionality, responsiveness, and communication with the hardware.
10. Capture UART logs, hardware demonstration, dashboard screenshots, and system verification evidence.

Project Status

Everything done

Safety Note

This is a hackathon prototype, not a certified industrial emergency-stop system.

Final Reference Images are named as EmergencyModePhoto.jpeg and NormalModePhoto.jpeg
Video is named as ProjectDemoVideo.mp4
