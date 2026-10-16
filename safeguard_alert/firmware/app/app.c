/* Application startup for the SafeGuard emergency alert system. */
#include "app.h"

#include "logger.h"
#include "safeguard_service.h"

static const char *TAG = "app";

void app_start(void)
{
    if (!safeguard_service_start())
    {
        ESP_LOGE(TAG, "SafeGuard startup failed; outputs may not be monitored");
    }
}
