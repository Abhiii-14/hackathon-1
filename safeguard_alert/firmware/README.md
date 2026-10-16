# SafeGuard ESP32 Emergency Alert

ESP-IDF v5.5 firmware for an ESP32 DevKitC demo. Startup initializes SAFE, turns on the green indicator, and writes `SYSTEM SAFE` to the UART console. A debounced emergency press latches EMERGENCY, turns on the red indicator, and writes `EMERGENCY ACTIVATED`; a fresh debounced reset press clears the latch and writes `SYSTEM RESET`.

## Wiring and configuration

| Signal | GPIO | Wiring / active level |
|---|---:|---|
| Emergency button | 18 | Momentary switch to GND; internal pull-up enabled |
| Reset button | 19 | Momentary switch to GND; internal pull-up enabled |
| SAFE green LED | 25 | Active-high, with a suitable series current-limiting resistor |
| EMERGENCY red LED | 26 | Active-high, with a suitable series current-limiting resistor |

Pin and timing values are in `firmware/configs/app_config.h`; board signal meanings and the user-confirmed active-high LED levels are in `firmware/bsp/board.h`. Buttons are sampled every 10 ms and require a stable 50 ms candidate level. Emergency activation wins if both press edges qualify on the same sample. A reset already held before an emergency cannot clear the latch; release and press reset again.

## Architecture

- `firmware/modules/safeguard_logic.[ch]` owns vendor-free debounce and latched state logic.
- `firmware/interfaces/` declares hardware and periodic-runtime contracts.
- `firmware/platforms/esp32/` implements GPIO access and the FreeRTOS sampling task.
- `firmware/services/safeguard_service.[ch]` integrates logic, outputs, and UART state-transition logs.
- `firmware/app/app.c` starts the service from `app_start()`.
- `main/entry.c` owns the sole `app_main()` entry point; generated `main/` glue is not hand-edited.

## Build and verification

Build with ESP-IDF v5.5 for target `esp32` using the project build workflow. Host-testable logic is covered through Artifacts → Unit Tests; acceptance procedures are in `firmware/docs/acceptance-tests.md`. Physical GPIO, LED polarity, and UART behavior require bench verification. Requirements and code/test mapping are in `firmware/docs/requirements-traceability.md`.

This documentation describes intended implementation behavior. No hardware test is claimed until a board run is observed.

The ESP-IDF entry point `app_main()` lives once in `../main/entry.c` and calls `app_start()`. Keep application changes under `firmware/`.
