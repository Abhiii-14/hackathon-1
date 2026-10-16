/* FreeRTOS periodic sampling task for SafeGuard ESP32 GPIO inputs. */
#include "safeguard_runtime_esp32.h"

#include <stddef.h>

#include "app_config.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

#define SAFEGUARD_TASK_STACK_BYTES 3072U
#define SAFEGUARD_TASK_PRIORITY 5U

static safeguard_runtime_callback_t runtime_callback;
static bool runtime_task_started;

/* Calls the service at a fixed cadence without busy-waiting. */
static void safeguard_runtime_task(void *argument)
{
    (void)argument;
    const TickType_t period_ticks = pdMS_TO_TICKS(APP_INPUT_SAMPLE_PERIOD_MS);
    TickType_t wake_tick = xTaskGetTickCount();

    for (;;)
    {
        runtime_callback();
        vTaskDelayUntil(&wake_tick, period_ticks);
    }
}

bool safeguard_runtime_start(safeguard_runtime_callback_t callback)
{
    BaseType_t result;

    if ((callback == NULL) || runtime_task_started)
    {
        return false;
    }

    runtime_callback = callback;
    result = xTaskCreate(safeguard_runtime_task, "safeguard", SAFEGUARD_TASK_STACK_BYTES,
                         NULL, SAFEGUARD_TASK_PRIORITY, NULL);
    if (result == pdPASS)
    {
        runtime_task_started = true;
    }

    return result == pdPASS;
}
