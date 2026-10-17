const TIMEZONE_LOOKUP_TIMEOUT_MS = 8000;

export async function resolveTimezoneForCoordinates(latitude, longitude) {
  const query = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    current: "temperature_2m",
    timezone: "auto",
    forecast_days: "1"
  });
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), TIMEZONE_LOOKUP_TIMEOUT_MS);

  try {
    const response = await fetch(`https://api.open-meteo.com/v1/forecast?${query}`, {
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(`Timezone service returned HTTP ${response.status}.`);
    }
    const data = await response.json();
    if (typeof data.timezone !== "string" || !data.timezone) {
      throw new Error("Timezone service did not return a timezone for these coordinates.");
    }
    new Intl.DateTimeFormat("en", { timeZone: data.timezone });
    return data.timezone;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export function formatTimestamp(timestamp, timeZone) {
  if (!timestamp) return "Time unavailable";

  const options = {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short"
  };

  try {
    return new Intl.DateTimeFormat(undefined, {
      ...options,
      ...(timeZone ? { timeZone } : {})
    }).format(new Date(timestamp));
  } catch {
    return new Intl.DateTimeFormat(undefined, options).format(new Date(timestamp));
  }
}

export function getBrowserTimezone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}
