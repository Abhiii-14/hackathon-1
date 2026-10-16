/* Portable SafeGuard debounce and emergency-latch logic. */
#ifndef SAFEGUARD_LOGIC_H
#define SAFEGUARD_LOGIC_H

#include <stdbool.h>
#include <stdint.h>

typedef enum
{
    SAFEGUARD_STATE_SAFE = 0,
    SAFEGUARD_STATE_EMERGENCY
} safeguard_state_t;

typedef struct
{
    bool stable_pressed;
    bool candidate_pressed;
    uint32_t candidate_elapsed_ms;
    bool initialized;
} safeguard_button_t;

typedef struct
{
    safeguard_button_t emergency_button;
    safeguard_button_t reset_button;
    safeguard_state_t state;
    uint32_t debounce_period_ms;
} safeguard_logic_t;

/**
 * @brief Initializes one debounced button input.
 * @param[out] button Button state to initialize.
 */
void safeguard_button_init(safeguard_button_t *button);

/**
 * @brief Debounces a raw button input and reports a newly qualified press.
 * @param[in,out] button Button state initialized by safeguard_button_init().
 * @param[in] is_pressed Current logical pressed state.
 * @param[in] sample_period_ms Time represented by this sample, in milliseconds.
 * @param[in] debounce_period_ms Required stable duration, in milliseconds.
 * @return true only when a debounced pressed transition occurs.
 */
bool safeguard_button_sample(safeguard_button_t *button, bool is_pressed,
                             uint32_t sample_period_ms, uint32_t debounce_period_ms);

/**
 * @brief Initializes SafeGuard logic in SAFE state.
 *
 * The button inputs are initialized released; subsequent samples must remain
 * stable for the configured debounce period before a press is accepted.
 *
 * @param[out] logic Logic state to initialize.
 * @param[in] debounce_period_ms Required stable duration in milliseconds; must be nonzero.
 * @return true when initialized, or false for a null pointer or zero duration.
 */
bool safeguard_logic_init(safeguard_logic_t *logic, uint32_t debounce_period_ms);

/**
 * @brief Samples both buttons and applies any debounced state transition.
 *
 * Emergency activation wins if both buttons generate a press edge in the same
 * sample. Emergency remains latched until a later debounced reset press.
 *
 * @param[in,out] logic Initialized logic state.
 * @param[in] emergency_pressed True while the active-low emergency input is low.
 * @param[in] reset_pressed True while the active-low reset input is low.
 * @param[in] sample_period_ms Time represented by this sample in milliseconds.
 * @return true if the safety state changed.
 * @pre safeguard_logic_init() succeeded; sample_period_ms is nonzero.
 */
bool safeguard_logic_sample(safeguard_logic_t *logic, bool emergency_pressed,
                            bool reset_pressed, uint32_t sample_period_ms);

/**
 * @brief Returns the current latched safety state.
 * @param[in] logic Initialized logic context.
 * @return SAFE for a valid SAFE context; EMERGENCY for a valid emergency context.
 */
safeguard_state_t safeguard_logic_get_state(const safeguard_logic_t *logic);

#endif /* SAFEGUARD_LOGIC_H */
