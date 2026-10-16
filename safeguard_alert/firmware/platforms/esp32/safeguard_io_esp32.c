/* ESP-IDF GPIO implementation of the SafeGuard hardware contract. */
#include "safeguard_io_if.h"

#include <stddef.h>

#include "app_config.h"
#include "board.h"
#include "driver/gpio.h"

/* Configure a single output at a defined inactive/SAFE startup level. */
static esp_err_t safeguard_configure_output(gpio_num_t gpio_num, uint32_t initial_level)
{
    gpio_config_t config = {
        .pin_bit_mask = (1ULL << (uint32_t)gpio_num),
        .mode = GPIO_MODE_OUTPUT,
        .pull_up_en = GPIO_PULLUP_DISABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE
    };
    esp_err_t result = gpio_config(&config);

    if (result == ESP_OK)
    {
        result = gpio_set_level(gpio_num, (uint32_t)initial_level);
    }

    return result;
}

safeguard_io_status_t safeguard_io_init(void)
{
    gpio_config_t input_config = {
        .pin_bit_mask = (1ULL << APP_EMERGENCY_BUTTON_GPIO) |
                        (1ULL << APP_RESET_BUTTON_GPIO),
        .mode = GPIO_MODE_INPUT,
        .pull_up_en = GPIO_PULLUP_ENABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE
    };
    esp_err_t result = gpio_config(&input_config);

    if (result == ESP_OK)
    {
        result = safeguard_configure_output((gpio_num_t)BOARD_SAFE_LED_GPIO,
                                            board_safe_led_level(true));
    }

    if (result == ESP_OK)
    {
        result = safeguard_configure_output((gpio_num_t)BOARD_EMERGENCY_LED_GPIO,
                                            board_emergency_led_level(false));
    }

    return (result == ESP_OK) ? SAFEGUARD_IO_OK : SAFEGUARD_IO_ERROR;
}

safeguard_io_status_t safeguard_io_read_buttons(bool *emergency_pressed, bool *reset_pressed)
{
    if ((emergency_pressed == NULL) || (reset_pressed == NULL))
    {
        return SAFEGUARD_IO_ERROR;
    }

    *emergency_pressed = (gpio_get_level((gpio_num_t)BOARD_EMERGENCY_BUTTON_GPIO) ==
                          (int)BOARD_BUTTON_PRESSED_LEVEL);
    *reset_pressed = (gpio_get_level((gpio_num_t)BOARD_RESET_BUTTON_GPIO) ==
                      (int)BOARD_BUTTON_PRESSED_LEVEL);
    return SAFEGUARD_IO_OK;
}

safeguard_io_status_t safeguard_io_set_state(safeguard_state_t state)
{
    uint32_t safe_led_on;
    uint32_t emergency_led_on;
    esp_err_t result;

    if ((state != SAFEGUARD_STATE_SAFE) && (state != SAFEGUARD_STATE_EMERGENCY))
    {
        return SAFEGUARD_IO_ERROR;
    }

    safe_led_on = (state == SAFEGUARD_STATE_SAFE) ? 1U : 0U;
    emergency_led_on = (state == SAFEGUARD_STATE_EMERGENCY) ? 1U : 0U;
    result = gpio_set_level((gpio_num_t)BOARD_SAFE_LED_GPIO,
                            board_safe_led_level(safe_led_on != 0U));

    if (result == ESP_OK)
    {
        result = gpio_set_level((gpio_num_t)BOARD_EMERGENCY_LED_GPIO,
                                board_emergency_led_level(emergency_led_on != 0U));
    }

    return (result == ESP_OK) ? SAFEGUARD_IO_OK : SAFEGUARD_IO_ERROR;
}
