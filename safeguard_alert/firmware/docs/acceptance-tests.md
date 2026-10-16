# SafeGuard Acceptance Tests

These tests describe acceptance evidence for the SafeGuard requirements. Portable state-logic tests can be run through Artifacts → Unit Tests. GPIO levels and LEDs require the ESP32 DevKitC wired to the external buttons and LEDs. A serial capture has observed the startup `SYSTEM SAFE` message; the remaining transitions and physical LED indications are not yet confirmed.

## Bench setup

- ESP32 DevKitC running the ESP-IDF v5.5 build.
- Momentary emergency button from GPIO18 to GND.
- Momentary reset button from GPIO19 to GND.
- Green LED on GPIO25 and red LED on GPIO26, both active-high. Use suitable series current-limiting resistors.
- Serial monitor connected to the board's USB-UART console at the project baud rate (typically 115200).

## Acceptance cases

| Test | Procedure | Expected result |
|---|---|---|
| AT-01 Startup SAFE | Reset or power-cycle the board with both buttons released. | UART contains `SYSTEM SAFE`; GPIO25 is high/green LED on; GPIO26 is low/red LED off. |
| AT-02 Debounced emergency | Tap GPIO18 to GND for less than 50 ms, release, then press and hold for at least 60 ms. | Short pulse does not change state. Stable press changes to EMERGENCY once; UART contains `EMERGENCY ACTIVATED`; green off and red on. |
| AT-03 Emergency latch | Release GPIO18 after AT-02. | EMERGENCY remains latched, red remains on, and no second activation message appears. |
| AT-04 Debounced reset | While emergency is latched, tap GPIO19 briefly, then press and hold for at least 60 ms. | Short pulse is ignored. Stable reset clears the latch; UART contains `SYSTEM RESET`; green on and red off. |
| AT-05 Reset while SAFE | Press and release reset while in SAFE. | State remains SAFE; there is no reset-transition message. |
| AT-06 Independent debounce | Exercise each button with contact bounce lasting less than 50 ms, followed by stable release. | No state transition until the pressed level is stable for the configured 50 ms. |
| AT-07 Simultaneous presses | Press both buttons and hold for at least 60 ms from SAFE. | Emergency wins simultaneous press edges; state is EMERGENCY and activation is logged. A later new reset press is required to clear it. |
| AT-08 Held reset before emergency | Hold reset before pressing emergency; later release and press reset again. | The pre-existing reset hold does not clear the emergency; a new debounced reset press after release clears it. |
| AT-09 Output/message transition count | Trigger emergency, hold it, release, reset, and keep SAFE. | Exactly one `EMERGENCY ACTIVATED` per entry into EMERGENCY and one `SYSTEM RESET` per clearing transition. |

## Portable logic coverage

Host tests should cover null/invalid initialization, stable press and release qualification, a pulse shorter than the debounce interval, repeated held samples, independent buttons, emergency latching, reset only after a fresh press edge, emergency priority when both edges occur together, and exact SAFE/EMERGENCY transition reporting. Host tests do not prove GPIO mapping, LED polarity, or UART electrical behavior.
