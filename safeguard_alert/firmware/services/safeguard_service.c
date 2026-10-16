/* SafeGuard service coordinates debounced inputs, latched state, outputs, and UART events. */
#include "safeguard_service.h"

#include "app_config.h"
#include "logger.h"
#include "safeguard_io_if.h"
#include "safeguard_logic.h"
#include "safeguard_runtime_if.h"

static const char *TAG = "safeguard";
static safeguard_logic_t service_logic;

/* Samples GPIO, updates the latch, and emits UART logs only on real transitions. */
static void safeguard_service_process_sample(void)
{
    bool emergency_pressed = false;
    bool reset_pressed = false;
    safeguard_state_t old_state = safeguard_logic_get_state(&service_logic);

    if (safeguard_io_read_buttons(&emergency_pressed, &reset_pressed) != SAFEGUARD_IO_OK)
    {
        ESP_LOGE(TAG, "GPIO input read failed");
        return;
    }

    (void)safeguard_logic_sample(&service_logic, emergency_pressed, reset_pressed,
                                 APP_INPUT_SAMPLE_PERIOD_MS);

    if (safeguard_logic_get_state(&service_logic) != old_state)
    {
        safeguard_state_t new_state = safeguard_logic_get_state(&service_logic);
        if (safeguard_io_set_state(new_state) != SAFEGUARD_IO_OK)
        {
            ESP_LOGE(TAG, "GPIO state output failed");
            return;
        }

        if (new_state == SAFEGUARD_STATE_EMERGENCY)
        {
            ESP_LOGE(TAG, "EMERGENCY ACTIVATED");
        }
        else
        {
            ESP_LOGI(TAG, "SYSTEM RESET");
        }
    }
}

bool safeguard_service_start(void)
{
    if (!safeguard_logic_init(&service_logic, APP_BUTTON_DEBOUNCE_MS))
    {
        ESP_LOGE(TAG, "Safety logic initialization failed");
        return false;
    }

    if (safeguard_io_init() != SAFEGUARD_IO_OK)
    {
        ESP_LOGE(TAG, "GPIO initialization failed");
        return false;
    }

    if (!safeguard_runtime_start(safeguard_service_process_sample))
    {
        ESP_LOGE(TAG, "Monitoring task creation failed");
        return false;
    }

    ESP_LOGI(TAG, "SYSTEM SAFE");
    return true;
}
