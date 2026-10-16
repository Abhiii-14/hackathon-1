/* Vendor-neutral contract for a periodic application callback runtime. */
#ifndef SAFEGUARD_RUNTIME_IF_H
#define SAFEGUARD_RUNTIME_IF_H

#include <stdbool.h>

typedef void (*safeguard_runtime_callback_t)(void);

/**
 * @brief Starts periodic execution of a SafeGuard sampling callback.
 * @param[in] callback Non-null function called at the configured sample period.
 * @return true if the runtime starts; otherwise false.
 */
bool safeguard_runtime_start(safeguard_runtime_callback_t callback);

#endif /* SAFEGUARD_RUNTIME_IF_H */
