# SafeGuard Requirements Traceability

Status: implementation-to-acceptance mapping. Host acceptance tests have not yet been executed, and no physical board observation is claimed.

| Requirement | Implementation | Acceptance evidence |
|---|---|---|
| R1 Startup enters SAFE and logs `SYSTEM SAFE` | `firmware/services/safeguard_service.c`: `safeguard_service_start`; `firmware/modules/safeguard_logic.c`: `safeguard_logic_init` | AT-01; host test of initial state |
| R2 Emergency button on GPIO18, switch to GND with internal pull-up | `firmware/configs/app_config.h`: `APP_EMERGENCY_BUTTON_GPIO`; `firmware/bsp/board.h`; `firmware/platforms/esp32/safeguard_io_esp32.c`: `safeguard_io_init` | AT-02, AT-06 hardware wiring/behavior |
| R3 Reset button on GPIO19, switch to GND with internal pull-up | `firmware/configs/app_config.h`: `APP_RESET_BUTTON_GPIO`; `firmware/bsp/board.h`; `firmware/platforms/esp32/safeguard_io_esp32.c`: `safeguard_io_init` | AT-04, AT-05, AT-08 hardware wiring/behavior |
| R4 Green LED on GPIO25 indicates SAFE | `firmware/configs/app_config.h`; `firmware/bsp/board.h`; `firmware/platforms/esp32/safeguard_io_esp32.c`: `safeguard_io_set_state` | AT-01, AT-04 visual bench check |
| R5 Red LED on GPIO26 indicates EMERGENCY | `firmware/configs/app_config.h`; `firmware/bsp/board.h`; `firmware/platforms/esp32/safeguard_io_esp32.c`: `safeguard_io_set_state` | AT-02, AT-03 visual bench check |
| R6 Debounced emergency latches state, changes LEDs, logs exact activation message | `firmware/modules/safeguard_logic.c`: `safeguard_logic_sample`; `firmware/services/safeguard_service.c`: `safeguard_service_process_sample` | AT-02, AT-03, AT-09; host transition/latch tests |
| R7 Emergency persists after button release | `firmware/modules/safeguard_logic.c`: latched `state` transition logic | AT-03; host latch test |
| R8 Debounced reset clears emergency and logs `SYSTEM RESET` | `firmware/modules/safeguard_logic.c`: reset press edge; `firmware/services/safeguard_service.c`: transition logger | AT-04, AT-05, AT-08, AT-09; host reset-edge tests |
| R9 Both buttons debounce for 50 ms | `firmware/configs/app_config.h`: `APP_BUTTON_DEBOUNCE_MS`; `firmware/modules/safeguard_logic.c`: stable-time qualification | AT-02, AT-04, AT-06; host boundary tests (49 ms rejected, 50 ms accepted) |
| R10 Acceptance tests and traceability report | `firmware/docs/acceptance-tests.md`; this report | AT-01 through AT-09 and code/test mapping above |

## Timing and state policy

The service polls every 10 ms. A button input must remain at the candidate value for 50 ms before a transition is accepted. Emergency press has priority if both button edges mature in the same sample. A reset held before an emergency does not clear the subsequent emergency: reset must have a newly qualified press edge after the button has been released. These choices are implemented in `safeguard_logic.c`.

## Evidence gaps

- Host acceptance logic still requires test execution via Artifacts → Unit Tests.
- GPIO input configuration and physical LED behavior require board testing; firmware logs alone cannot prove which LEDs physically illuminated.
- Startup UART evidence was observed: `I (294) safeguard: SYSTEM SAFE` on the connected ESP32-D0WD-V3, ESP-IDF v5.5. Physical LED states and button transition behavior have not been observed or tested.
