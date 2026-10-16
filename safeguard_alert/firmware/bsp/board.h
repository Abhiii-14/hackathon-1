#ifndef BOARD_H
#define BOARD_H

/* Board support — the ONE place that records what is physically wired to what.
 *
 * This header is DECLARATIVE. It records board facts (which pin, which active level, which
 * bus) and pure helpers over them. It performs no I/O and includes no vendor SDK header:
 * the code that actually drives a pin lives in platforms/<vendor>/.
 *
 * Raw pin numbers stay in configs/app_config.h, because the Firmware Topology editor reads
 * and writes the APP_* macros there. This header turns them into named board facts so that
 * app/ and services/ never handle a GPIO number and never guess a polarity.
 */

#include <stdbool.h>
#include <stdint.h>

#include "app_config.h"

#ifndef BOARD_NAME
#define BOARD_NAME "esp32"
#endif

/* Board identity, for logs and diagnostics. */
const char *board_name(void);

/* SafeGuard external LEDs were specified active-high by the user. */
#define BOARD_SAFE_LED_ACTIVE_LEVEL 1U
#define BOARD_EMERGENCY_LED_ACTIVE_LEVEL 1U

/* Button switches connect their input to GND when pressed. */
#define BOARD_BUTTON_PRESSED_LEVEL 0U

/* Compile-time board facts map named signals to configured raw GPIO values. */
#define BOARD_EMERGENCY_BUTTON_GPIO APP_EMERGENCY_BUTTON_GPIO
#define BOARD_RESET_BUTTON_GPIO APP_RESET_BUTTON_GPIO
#define BOARD_SAFE_LED_GPIO APP_SAFE_LED_GPIO
#define BOARD_EMERGENCY_LED_GPIO APP_EMERGENCY_LED_GPIO

/* Convert a logical LED state into the raw pin level using the confirmed polarity. */
static inline uint32_t board_safe_led_level(bool is_on)
{
    return is_on ? BOARD_SAFE_LED_ACTIVE_LEVEL : !BOARD_SAFE_LED_ACTIVE_LEVEL;
}

/* Convert a logical LED state into the raw pin level using the confirmed polarity. */
static inline uint32_t board_emergency_led_level(bool is_on)
{
    return is_on ? BOARD_EMERGENCY_LED_ACTIVE_LEVEL : !BOARD_EMERGENCY_LED_ACTIVE_LEVEL;
}

/* Add further board facts the same way — bus pins, address straps, button polarity, e.g.:
 *
 *   #define BOARD_I2C_SDA_GPIO   APP_I2C_SDA_GPIO
 *   #define BOARD_I2C_SCL_GPIO   APP_I2C_SCL_GPIO
 *   #define BOARD_I2C_FREQ_HZ    APP_I2C_FREQ_HZ
 */

#endif /* BOARD_H */
