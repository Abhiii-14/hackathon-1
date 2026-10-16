# SafeGuard ESP32 Emergency Alert Firmware

SafeGuard is an ESP-IDF v5.5 demonstration firmware for an ESP32 DevKitC. It starts in SAFE, indicates SAFE on the green GPIO25 LED, and logs `SYSTEM SAFE` to the UART console. The emergency input on GPIO18 latches EMERGENCY after a stable 50 ms press; the red GPIO26 LED turns on, green turns off, and UART logs `EMERGENCY ACTIVATED`. Releasing the emergency button does not clear the latch. A newly debounced reset press on GPIO19 restores SAFE and logs `SYSTEM RESET`.

## Signal map

- Emergency button: GPIO18 to GND, active-low, internal pull-up.
- Reset button: GPIO19 to GND, active-low, internal pull-up.
- SAFE green LED: GPIO25, active-high (user-confirmed).
- EMERGENCY red LED: GPIO26, active-high (user-confirmed).

Use suitable current-limiting resistors with externally wired LEDs. The board GPIO assignments and timing are held in `configs/app_config.h`; named board facts are in `bsp/board.h`.

## Module responsibilities

- `modules/safeguard_logic.c` performs independent stable-time debounce and maintains SAFE/EMERGENCY latch state without platform dependencies.
- `platforms/esp32/safeguard_io_esp32.c` configures pulled-up inputs and writes LED outputs using ESP-IDF GPIO APIs.
- `platforms/esp32/safeguard_runtime_esp32.c` runs periodic sampling in a FreeRTOS task at 10 ms intervals.
- `services/safeguard_service.c` integrates the state logic and hardware contracts and logs state transitions.
- `app/app.c` starts the SafeGuard service through `app_start()`.

## Build and checks

Build the project for target `esp32` with ESP-IDF v5.5. Run vendor-free logic tests through Artifacts → Unit Tests. Use `docs/acceptance-tests.md` for GPIO/UART bench testing and `docs/requirements-traceability.md` for the requirement-to-code/evidence matrix.

## Runtime evidence

After flashing, the serial monitor reported `I (294) safeguard: SYSTEM SAFE` on the connected ESP32-D0WD-V3 at ESP-IDF v5.5. This confirms the application startup path reached SAFE and emitted the UART startup marker. It does not verify that the LEDs physically illuminated or that button activation, debounce, latching, and reset behavior worked; those checks remain in `acceptance-tests.md`.
