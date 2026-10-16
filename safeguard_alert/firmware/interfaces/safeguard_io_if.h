/* Vendor-neutral hardware contract for the SafeGuard state service. */
#ifndef SAFEGUARD_IO_IF_H
#define SAFEGUARD_IO_IF_H

#include <stdbool.h>
#include "safeguard_logic.h"

typedef enum
{
    SAFEGUARD_IO_OK = 0,
    SAFEGUARD_IO_ERROR
} safeguard_io_status_t;

/**
 * @brief Initializes SafeGuard GPIO and places the LEDs in SAFE indication.
 * @return SAFEGUARD_IO_OK on success; SAFEGUARD_IO_ERROR if GPIO setup fails.
 */
safeguard_io_status_t safeguard_io_init(void);

/**
 * @brief Reads current logical button states.
 * @param[out] emergency_pressed True when the emergency button is pressed.
 * @param[out] reset_pressed True when the reset button is pressed.
 * @return SAFEGUARD_IO_OK if both levels were read; SAFEGUARD_IO_ERROR for invalid output pointers.
 */
safeguard_io_status_t safeguard_io_read_buttons(bool *emergency_pressed, bool *reset_pressed);

/**
 * @brief Applies the SAFE or EMERGENCY LED indication.
 * @param[in] state Latched safety state to display.
 * @return SAFEGUARD_IO_OK on success; SAFEGUARD_IO_ERROR if an LED write fails.
 */
safeguard_io_status_t safeguard_io_set_state(safeguard_state_t state);

#endif /* SAFEGUARD_IO_IF_H */
