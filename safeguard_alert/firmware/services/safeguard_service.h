/* SafeGuard application service for latched emergency indication. */
#ifndef SAFEGUARD_SERVICE_H
#define SAFEGUARD_SERVICE_H

#include <stdbool.h>

/**
 * @brief Initializes SAFE indication and starts periodic input monitoring.
 *
 * Sets both LEDs to SAFE, logs the startup state, and requests a periodic
 * platform callback. The configured callbacks continue for the firmware lifetime.
 *
 * @return true if GPIO and monitoring startup succeed; otherwise false.
 * @note Call once from app_start() after the ESP-IDF console is available.
 */
bool safeguard_service_start(void);

#endif /* SAFEGUARD_SERVICE_H */
