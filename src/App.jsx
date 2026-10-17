import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import {
  ShieldCheck, Flame, Camera, Bell, Cpu,
  MessageSquare, Activity, RotateCcw, Wifi
} from "lucide-react";
import CameraFeed from "./CameraFeed";
import {
  createEmergencyEvent,
  getEmergencyEvents,
  initializeAnonymousSession,
  resolveEmergencyEvent,
  saveEmergencyLocation,
  saveLocationStatus,
  saveEmergencyTimezone,
  subscribeToEmergencyEvents
} from "./lib/emergencyRepository";
import { isSupabaseConfigured } from "./lib/supabase";
import { formatTimestamp, resolveTimezoneForCoordinates } from "./lib/locationTime";
import "./App.css";

const LocationMap = lazy(() => import("./LocationMap"));
const TARGET_LOCATION_ACCURACY_METERS = 20;
const LOCATION_ACQUISITION_TIMEOUT_MS = 30000;

export default function App() {
  const [emergency, setEmergency] = useState(false);
  const [events, setEvents] = useState([]);
  const [emergencyTimestamp, setEmergencyTimestamp] = useState(null);
  const [locationTimezone, setLocationTimezone] = useState(null);
  const [activeEventId, setActiveEventId] = useState(null);
  const [userId, setUserId] = useState(null);
  const [emergencyLocation, setEmergencyLocation] = useState(null);
  const [cameraStatus, setCameraStatus] = useState("idle");
  const [locationStatus, setLocationStatus] = useState("idle");
  const [locationError, setLocationError] = useState("");
  const [backendStatus, setBackendStatus] = useState(
    isSupabaseConfigured ? "connecting" : "configuration_error"
  );
  const [backendError, setBackendError] = useState(
    isSupabaseConfigured ? "" : "Add your Supabase project URL and anon key in src/lib/supabase.js."
  );
  const [actionBusy, setActionBusy] = useState(false);
  const actionBusyRef = useRef(false);
  const locationRequestId = useRef(0);
  const locationWatchId = useRef(null);
  const locationTimeoutId = useRef(null);
  const bestLocation = useRef(null);
  function stopLocationAcquisition() {
    if (locationWatchId.current !== null && navigator.geolocation) {
      navigator.geolocation.clearWatch(locationWatchId.current);
      locationWatchId.current = null;
    }
    if (locationTimeoutId.current !== null) {
      window.clearTimeout(locationTimeoutId.current);
      locationTimeoutId.current = null;
    }
  }

  function applyEmergencyEvents(records) {
    setEvents(records);
    const activeEvent = records.find(event => event.status === "active");
    const displayedEvent = activeEvent || records[0];
    setActiveEventId(activeEvent?.id || null);
    setEmergency(Boolean(activeEvent));
    setEmergencyTimestamp(displayedEvent?.triggered_at || null);
    setLocationTimezone(displayedEvent?.location_timezone || null);
    setEmergencyLocation(displayedEvent?.latitude == null ? null : {
      latitude: displayedEvent.latitude,
      longitude: displayedEvent.longitude,
      accuracy: displayedEvent.accuracy_m,
      timezone: displayedEvent.location_timezone
    });
    setLocationStatus(displayedEvent?.location_status === "available"
      ? "success"
      : activeEvent?.location_status === "requesting" ? "loading"
        : displayedEvent?.location_status === "not_requested" || !displayedEvent ? "idle" : "error");
    setLocationError(displayedEvent?.location_error || "");
  }

  useEffect(() => {
    if (!isSupabaseConfigured) {
      return undefined;
    }

    let cancelled = false;
    let unsubscribe = () => {};

    async function connect() {
      try {
        const sessionUserId = await initializeAnonymousSession();
        if (cancelled) return;
        setUserId(sessionUserId);

        let records = await getEmergencyEvents();
        const interruptedEvent = records.find(event =>
          event.status === "active" && event.location_status === "requesting"
        );
        if (interruptedEvent) {
          await saveLocationStatus(
            interruptedEvent.id,
            "unavailable",
            "Location request stopped because the dashboard was reloaded. Resolve and activate again to request a fresh location."
          );
          records = await getEmergencyEvents();
        }
        if (cancelled) return;

        applyEmergencyEvents(records);
        setBackendStatus("ready");
        setBackendError("");
        unsubscribe = subscribeToEmergencyEvents(
          sessionUserId,
          async () => {
            try {
              const updatedRecords = await getEmergencyEvents();
              applyEmergencyEvents(updatedRecords);
              setBackendError("");
            } catch (error) {
              setBackendError(`Realtime refresh failed: ${error.message}`);
            }
          },
          error => setBackendError(error.message)
        );
      } catch (error) {
        if (cancelled) return;
        setBackendStatus("connection_error");
        setBackendError(error.message.includes("Anonymous sign-ins are disabled")
          ? "Supabase URL and publishable key are valid, but anonymous sign-ins are disabled. In Supabase, open Authentication → Sign In / Providers and enable Anonymous Sign-Ins, then reload this page."
          : `Supabase connection failed: ${error.message}`);
      }
    }

    connect();
    return () => {
      cancelled = true;
      unsubscribe();
      if (locationWatchId.current !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(locationWatchId.current);
      }
      if (locationTimeoutId.current !== null) {
        window.clearTimeout(locationTimeoutId.current);
      }
    };
  }, []);

  async function persistLocationStatus(eventId, status, message = null) {
    try {
      await saveLocationStatus(eventId, status, message);
      setBackendError("");
    } catch (error) {
      setBackendError(`Location status could not be saved to Supabase: ${error.message}`);
    }
  }

  async function persistLocation(eventId, location, requestId) {
    try {
      const record = await saveEmergencyLocation(eventId, location);
      if (record && requestId === locationRequestId.current) {
        setEvents(previous => previous.map(event => event.id === eventId
          ? { ...event, ...record }
          : event));
      }
      setBackendError("");
      return record;
    } catch (error) {
      const message = `GPS coordinates could not be saved to Supabase: ${error.message}`;
      setBackendError(message);
      if (requestId === locationRequestId.current) {
        setLocationStatus("error");
        setLocationError(message);
      }
      return null;
    }
  }

  async function persistTimezone(eventId, location, timezone, requestId) {
    try {
      const record = await saveEmergencyTimezone(eventId, location.accuracy, timezone);
      if (record && requestId === locationRequestId.current &&
          bestLocation.current?.accuracy === location.accuracy) {
        setLocationTimezone(timezone);
        setEmergencyLocation(currentLocation => currentLocation?.accuracy === location.accuracy
          ? { ...currentLocation, timezone }
          : currentLocation);
        setEvents(previous => previous.map(event => event.id === eventId
          ? { ...event, location_timezone: timezone }
          : event));
      }
      setBackendError("");
    } catch (error) {
      setBackendError(`GPS timezone could not be saved to Supabase: ${error.message}`);
    }
  }

  function finishLocationAcquisition(requestId, eventId) {
    if (requestId !== locationRequestId.current) return;
    stopLocationAcquisition();
    if (bestLocation.current) {
      setEmergencyLocation(bestLocation.current);
      setLocationStatus("success");
      return;
    }
    setLocationStatus("error");
    const message = "The browser did not return a location fix before the 30-second timeout.";
    setLocationError(message);
    void persistLocationStatus(eventId, "timeout", message);
  }

  function requestEmergencyLocation(eventId) {
    setEmergencyLocation(null);
    bestLocation.current = null;
    setLocationError("");
    if (!navigator.geolocation) {
      setLocationStatus("error");
      const message = "This browser does not support geolocation.";
      setLocationError(message);
      void persistLocationStatus(eventId, "unsupported", message);
      return;
    }

    const requestId = ++locationRequestId.current;
    setLocationStatus("loading");
    locationWatchId.current = navigator.geolocation.watchPosition(
      ({ coords }) => {
        if (requestId !== locationRequestId.current) return;
        const nextLocation = {
          latitude: coords.latitude,
          longitude: coords.longitude,
          accuracy: coords.accuracy
        };
        if (!bestLocation.current || nextLocation.accuracy < bestLocation.current.accuracy) {
          bestLocation.current = nextLocation;
          setEmergencyLocation(nextLocation);
          void (async () => {
            const savedLocation = await persistLocation(eventId, nextLocation, requestId);
            if (!savedLocation) return;

            try {
              const timezone = await resolveTimezoneForCoordinates(
                nextLocation.latitude,
                nextLocation.longitude
              );
              await persistTimezone(eventId, nextLocation, timezone, requestId);
            } catch {
              if (requestId === locationRequestId.current &&
                  bestLocation.current?.accuracy === nextLocation.accuracy) {
                setLocationTimezone(null);
              }
            }
          })();
        }
        if (nextLocation.accuracy <= TARGET_LOCATION_ACCURACY_METERS) {
          finishLocationAcquisition(requestId, eventId);
        }
      },
      error => {
        if (requestId !== locationRequestId.current) return;
        stopLocationAcquisition();
        const errors = {
          1: ["denied", "Location permission was denied."],
          2: ["unavailable", "The device could not determine a location."],
          3: ["timeout", "The browser timed out while locating the device."]
        };
        const [status, message] = errors[error.code] || ["error", error.message];
        if (bestLocation.current) {
          setEmergencyLocation(bestLocation.current);
          setLocationStatus("success");
          const updateMessage = `GPS updates stopped: ${message}`;
          setLocationError(updateMessage);
          void persistLocationStatus(eventId, "available", updateMessage);
        } else {
          setLocationError(message);
          setLocationStatus("error");
          void persistLocationStatus(eventId, status, message);
        }
      },
      { enableHighAccuracy: true, maximumAge: 0 }
    );
    locationTimeoutId.current = window.setTimeout(
      () => finishLocationAcquisition(requestId, eventId),
      LOCATION_ACQUISITION_TIMEOUT_MS
    );
  }

  async function triggerAlert(source = "manual") {
    if (backendStatus !== "ready" || !userId || actionBusyRef.current || emergency) return false;
    actionBusyRef.current = true;
    setActionBusy(true);
    setBackendError("");
    try {
      const triggeredAt = new Date().toISOString();
      const record = await createEmergencyEvent(userId, triggeredAt, source);
      setActiveEventId(record.id);
      setEmergency(true);
      setEmergencyTimestamp(triggeredAt);
      setLocationTimezone(null);
      setEvents(previous => [record, ...previous.filter(event => event.id !== record.id)]);
      setLocationStatus("loading");
      requestEmergencyLocation(record.id);
      return true;
    } catch (error) {
      setBackendError(`Emergency could not be saved to Supabase: ${error.message}`);
      return false;
    } finally {
      actionBusyRef.current = false;
      setActionBusy(false);
    }
  }

  async function resetAlert() {
    if (!activeEventId || actionBusyRef.current) return;
    actionBusyRef.current = true;
    setActionBusy(true);
    setBackendError("");
    try {
      const resolvedAt = new Date().toISOString();
      const resolvedEvent = await resolveEmergencyEvent(activeEventId, resolvedAt);
      stopLocationAcquisition();
      locationRequestId.current += 1;
      bestLocation.current = null;
      setEvents(previous => previous.map(event => event.id === resolvedEvent.id ? resolvedEvent : event));
      setActiveEventId(null);
      setEmergency(false);
      setEmergencyTimestamp(resolvedEvent.triggered_at);
      setEmergencyLocation(resolvedEvent.latitude == null ? null : {
        latitude: resolvedEvent.latitude,
        longitude: resolvedEvent.longitude,
        accuracy: resolvedEvent.accuracy_m,
        timezone: resolvedEvent.location_timezone
      });
      setLocationTimezone(resolvedEvent.location_timezone || null);
      setLocationStatus(resolvedEvent.location_status === "available" ? "success" : "idle");
      setLocationError(resolvedEvent.location_error || "");
    } catch (error) {
      setBackendError(`Emergency could not be resolved in Supabase: ${error.message}`);
    } finally {
      actionBusyRef.current = false;
      setActionBusy(false);
    }
  }

  const dashboardConnectionLabel = {
    connecting: "Connecting to Supabase...",
    configuration_error: "Supabase setup required",
    connection_error: "Supabase unavailable",
    ready: "Supabase Connected"
  }[backendStatus];

  return (
    <div className="dashboard">
      <aside className="sidebar">
        <div className="brand">
          <ShieldCheck size={30} />
          <span>SafeGuard <b>AI</b></span>
        </div>

        <p className="side-label">MONITORING SYSTEM</p>
        <nav>
          <div className="nav-active"><Activity size={19}/> Dashboard</div>
          <div><Camera size={19}/> Camera Monitoring</div>
          <div><Bell size={19}/> Alert History</div>
          <div><Cpu size={19}/> ESP32 Device</div>
          <div><MessageSquare size={19}/> SMS Alerts</div>
        </nav>

        <div className="sidebar-bottom">
          <span className={`online-dot ${backendStatus === "ready" ? "" : "offline"}`}></span>
          {dashboardConnectionLabel}
        </div>
      </aside>

      <main className="main">
        <header className="header">
          <div>
            <p className="eyebrow">INDUSTRIAL SAFETY PLATFORM</p>
            <h1>Safety Overview</h1>
            <p className="muted">Real-time emergency monitoring dashboard</p>
          </div>
          <div className="header-pill">
            <Wifi size={17}/> {dashboardConnectionLabel}
          </div>
        </header>

        {backendError && (
          <div className="backend-alert" role="alert">
            <strong>Data service issue</strong>
            <span>{backendError}</span>
          </div>
        )}

        <motion.section
          className={`hero ${emergency ? "danger" : "safe"}`}
          animate={{ scale: [0.99, 1] }}
          transition={{ duration: 0.4 }}
        >
          <div className="hero-icon">
            {emergency ? <Flame size={34}/> : <ShieldCheck size={34}/>}
          </div>
          <div className="hero-content">
            <p>SYSTEM STATUS</p>
            <h2>{emergency ? "EMERGENCY DETECTED" : "SYSTEM SAFE"}</h2>
            <span>
              {emergency
                ? "Emergency is active and recorded in Supabase"
                : "No active emergency"}
            </span>
          </div>
          <span className="status-pill">
            <span className="pulse-dot"></span>
            {emergency ? "EMERGENCY" : "SAFE"}
          </span>
        </motion.section>

        <section className="stats">
          <motion.div className="stat-card" whileHover={{ y: -5 }}>
            <Camera size={23}/>
            <p>Camera Status</p>
            <h3>{cameraStatus === "live" ? "Camera Online" : cameraStatus === "requesting" ? "Camera Connecting" : cameraStatus === "error" ? "Camera Unavailable" : "Camera Offline"}</h3>
            <small>
              {cameraStatus === "live" ? "Browser feed active" : cameraStatus === "error"
                ? "Check permissions or camera connection"
                : cameraStatus === "requesting" ? "Waiting for camera permission" : "Start to preview browser camera"}
            </small>
          </motion.div>

          <motion.div className="stat-card" whileHover={{ y: -5 }}>
            <Cpu size={23}/>
            <p>ESP32 Device</p>
            <h3>Not Connected</h3>
            <small>Hardware integration pending</small>
          </motion.div>

          <motion.div className="stat-card" whileHover={{ y: -5 }}>
            <MessageSquare size={23}/>
            <p>SMS Service</p>
            <h3>Not Configured</h3>
            <small>Twilio integration pending</small>
          </motion.div>

          <motion.div className="stat-card" whileHover={{ y: -5 }}>
            <Bell size={23}/>
            <p>Stored Emergencies</p>
            <h3>{events.length}</h3>
            <small>Recent Supabase records</small>
          </motion.div>
        </section>

        <section className="content-grid">
          <CameraFeed
            onStatusChange={setCameraStatus}
            onFireDetected={() => triggerAlert("camera")}
          />

          <div className="panel">
            <div className="panel-heading">
              <h3><Bell size={20}/> Emergency Control</h3>
              <span className="tag">SUPABASE LOGGED</span>
            </div>
            <p className="muted control-text">
              Create a persistent emergency record, request this browser's location, and save the result to Supabase.
            </p>
            <button
              className="emergency-btn"
              onClick={() => triggerAlert("manual")}
              disabled={backendStatus !== "ready" || actionBusy || emergency}
            >
              <Flame size={19}/>
              {backendStatus === "connecting"
                ? "Connecting to Supabase..."
                : actionBusy && !emergency ? "Saving Emergency..."
                  : emergency ? "Emergency Active" : "Activate Emergency"}
            </button>
            <button className="reset-btn" onClick={resetAlert} disabled={!emergency || actionBusy}>
              <RotateCcw size={18}/> Resolve Emergency
            </button>
            <div className="notice">
              This records manual or AI camera alerts and device GPS. ESP32 and SMS integrations are not connected; AI detections are advisory and must be verified.
            </div>
          </div>
        </section>

        <Suspense fallback={<section className="panel map-loading">Loading interactive location map...</section>}>
          <LocationMap
            emergency={emergency}
            emergencyTimestamp={emergencyTimestamp}
            locationTimezone={locationTimezone}
            emergencyLocation={emergencyLocation}
            locationStatus={locationStatus}
            locationError={locationError}
          />
        </Suspense>

        <section className="panel history">
          <div className="panel-heading">
            <h3><Activity size={20}/> Recent Activity</h3>
            <span className="tag">SUPABASE</span>
          </div>
          {events.length === 0 ? (
            <p className="muted">No emergency records have been stored yet.</p>
          ) : (
            events.map(event => (
              <div className={`event ${event.status === "resolved" ? "resolved" : ""}`} key={event.id}>
                <Flame size={18}/>
                <span>
                  {event.status === "active"
                    ? (event.source === "camera" ? "Possible fire alert (AI camera)" : "Emergency activated")
                    : "Emergency resolved"}
                  {event.latitude != null && ` · ${Number(event.latitude).toFixed(5)}, ${Number(event.longitude).toFixed(5)}`}
                </span>
                <time>{formatTimestamp(event.triggered_at, event.location_timezone)}</time>
              </div>
            ))
          )}
        </section>

        <footer>
          SafeGuard AI • Industrial Emergency Event System • Supabase
          <center>Abhinav P S • Niranjan S • Ricky Jack Immanuvel R G • Jerin Marshal D</center>
        </footer>
      </main>
    </div>
  );
}