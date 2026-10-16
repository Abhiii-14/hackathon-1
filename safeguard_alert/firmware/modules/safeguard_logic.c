/* Portable button debounce and latched SafeGuard state machine. */
#include "safeguard_logic.h"

#include <stddef.h>

void safeguard_button_init(safeguard_button_t *button)
{
    if (button != NULL)
    {
        *button = (safeguard_button_t){0};
    }
}

bool safeguard_button_sample(safeguard_button_t *button, bool is_pressed,
                             uint32_t sample_period_ms, uint32_t debounce_period_ms)
{
    bool press_edge = false;

    if ((button == NULL) || (sample_period_ms == 0U) || (debounce_period_ms == 0U))
    {
        return false;
    }

    if (!button->initialized)
    {
        button->candidate_pressed = is_pressed;
        button->stable_pressed = false;
        button->candidate_elapsed_ms = 0U;
        button->initialized = true;
        return false;
    }

    if (is_pressed != button->candidate_pressed)
    {
        button->candidate_pressed = is_pressed;
        button->candidate_elapsed_ms = 0U;
    }
    else if (button->candidate_elapsed_ms < debounce_period_ms)
    {
        uint32_t remaining_ms = debounce_period_ms - button->candidate_elapsed_ms;
        button->candidate_elapsed_ms += (sample_period_ms < remaining_ms)
                                            ? sample_period_ms
                                            : remaining_ms;

        if ((button->candidate_elapsed_ms >= debounce_period_ms) &&
            (button->stable_pressed != button->candidate_pressed))
        {
            button->stable_pressed = button->candidate_pressed;
            press_edge = button->stable_pressed;
        }
    }

    return press_edge;
}

bool safeguard_logic_init(safeguard_logic_t *logic, uint32_t debounce_period_ms)
{
    bool is_valid = (logic != NULL) && (debounce_period_ms > 0U);

    if (is_valid)
    {
        *logic = (safeguard_logic_t){0};
        safeguard_button_init(&logic->emergency_button);
        safeguard_button_init(&logic->reset_button);
        logic->state = SAFEGUARD_STATE_SAFE;
        logic->debounce_period_ms = debounce_period_ms;
    }

    return is_valid;
}

bool safeguard_logic_sample(safeguard_logic_t *logic, bool emergency_pressed,
                            bool reset_pressed, uint32_t sample_period_ms)
{
    bool emergency_edge;
    bool reset_edge;
    safeguard_state_t previous_state;

    if ((logic == NULL) || (logic->debounce_period_ms == 0U) || (sample_period_ms == 0U))
    {
        return false;
    }

    emergency_edge = safeguard_button_sample(&logic->emergency_button, emergency_pressed,
                                              sample_period_ms, logic->debounce_period_ms);
    reset_edge = safeguard_button_sample(&logic->reset_button, reset_pressed,
                                         sample_period_ms, logic->debounce_period_ms);
    previous_state = logic->state;

    if (emergency_edge)
    {
        logic->state = SAFEGUARD_STATE_EMERGENCY;
    }
    else if ((logic->state == SAFEGUARD_STATE_EMERGENCY) && reset_edge)
    {
        logic->state = SAFEGUARD_STATE_SAFE;
    }

    return previous_state != logic->state;
}

safeguard_state_t safeguard_logic_get_state(const safeguard_logic_t *logic)
{
    if (logic == NULL)
    {
        return SAFEGUARD_STATE_SAFE;
    }

    return logic->state;
}
