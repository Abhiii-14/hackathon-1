import { isSupabaseConfigured, supabase } from "./supabase";

function requireSupabase() {
  if (!supabase || !isSupabaseConfigured) {
    throw new Error("Add your Supabase project URL and anon key in src/lib/supabase.js.");
  }
  return supabase;
}

export async function initializeAnonymousSession() {
  const client = requireSupabase();
  const { data: sessionData, error: sessionError } = await client.auth.getSession();
  if (sessionError) throw sessionError;

  let user = sessionData.session?.user;
  if (!user) {
    const { data, error } = await client.auth.signInAnonymously();
    if (error) throw error;
    user = data.user;
  }
  if (!user) throw new Error("Supabase did not return an authenticated user.");

  return user.id;
}

export async function getEmergencyEvents() {
  const client = requireSupabase();
  const { data, error } = await client
    .from("emergency_events")
    .select("*")
    .order("triggered_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  return data;
}

export async function createEmergencyEvent(userId, triggeredAt, source = "manual") {
  if (source !== "manual" && source !== "camera") {
    throw new TypeError("Emergency event source must be 'manual' or 'camera'.");
  }
  const client = requireSupabase();
  const { data, error } = await client
    .from("emergency_events")
    .insert({
      user_id: userId,
      source,
      status: "active",
      triggered_at: triggeredAt,
      location_status: "requesting"
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function saveEmergencyLocation(eventId, location) {
  const client = requireSupabase();
  const { data, error } = await client
    .from("emergency_events")
    .update({
      latitude: location.latitude,
      longitude: location.longitude,
      accuracy_m: location.accuracy,
      location_status: "available",
      location_error: null
    })
    .eq("id", eventId)
    .eq("status", "active")
    .or(`accuracy_m.is.null,accuracy_m.gt.${location.accuracy}`)
    .select()
    .maybeSingle();
  if (error) throw error;
  if (data) return data;

  const { data: currentEvent, error: readError } = await client
    .from("emergency_events")
    .select("id,status,latitude,longitude,accuracy_m")
    .eq("id", eventId)
    .maybeSingle();
  if (readError) throw readError;
  if (currentEvent?.status === "active" &&
      currentEvent.latitude != null &&
      currentEvent.longitude != null &&
      currentEvent.accuracy_m != null &&
      currentEvent.accuracy_m <= location.accuracy) {
    return currentEvent;
  }

  throw new Error(
    "Supabase did not update the active emergency with this GPS fix. Check that the latitude, longitude, and accuracy_m columns exist and that the signed-in user can update this row."
  );
}

export async function saveEmergencyTimezone(eventId, accuracy, timezone) {
  const client = requireSupabase();
  const { data, error } = await client
    .from("emergency_events")
    .update({ location_timezone: timezone })
    .eq("id", eventId)
    .eq("status", "active")
    .eq("accuracy_m", accuracy)
    .select()
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function saveLocationStatus(eventId, status, errorMessage = null) {
  const client = requireSupabase();
  const { data, error } = await client
    .from("emergency_events")
    .update({ location_status: status, location_error: errorMessage })
    .eq("id", eventId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function resolveEmergencyEvent(eventId, resolvedAt) {
  const client = requireSupabase();
  const { data, error } = await client
    .from("emergency_events")
    .update({ status: "resolved", resolved_at: resolvedAt })
    .eq("id", eventId)
    .eq("status", "active")
    .select()
    .single();
  if (error) throw error;
  return data;
}

export function subscribeToEmergencyEvents(userId, onChange, onError) {
  const client = requireSupabase();
  const channel = client
    .channel(`emergency-events:${userId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "emergency_events",
        filter: `user_id=eq.${userId}`
      },
      onChange
    )
    .subscribe(status => {
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        onError(new Error(`Supabase realtime connection ${status.toLowerCase()}.`));
      }
    });

  return () => client.removeChannel(channel);
}
