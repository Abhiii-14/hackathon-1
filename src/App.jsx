import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import {
  ShieldCheck, Flame, Camera, Bell, Cpu,
  Activity, RotateCcw, Wifi, Menu, X
} from "lucide-react";
import CameraFeed from "./CameraFeed";
import boardImage from "./assets/esp32-devkit.png";
import dashboardHeroImage from "./assets/dashboard-hero.png";
import statusChipImage from "./assets/status-chip.png";
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
import { FIRE_API_URL } from "./lib/fireApi";
import "./App.css";

const LocationMap = lazy(() => import("./LocationMap"));
const TARGET_LOCATION_ACCURACY_METERS = 20;
const LOCATION_ACQUISITION_TIMEOUT_MS = 30000;

export default function App() {
  const [emergency, setEmergency] = useState(false);
  const [websiteEmergencyOverride, setWebsiteEmergencyOverride] = useState(null);
  const [esp32Status, setEsp32Status] = useState({
    connected: false,
    apiConnected: false,
    instance_id: null,
    port: "COM3",
    baud_rate: 115200,
    emergency_active: false,
    state_known: false,
    event_id: 0
  });
  const [esp32CommandStatus, setEsp32CommandStatus] = useState({
    state: "idle",
    message: "No ESP32 command has been sent."
  });
  const [events, setEvents] = useState([]);
  const [esp32Events, setEsp32Events] = useState([]);
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
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const actionBusyRef = useRef(false);
  const locationRequestId = useRef(0);
  const locationWatchId = useRef(null);
  const locationTimeoutId = useRef(null);
  const bestLocation = useRef(null);
  const emergencyRef = useRef(emergency);
  const websiteEmergencyOverrideRef = useRef(null);
  const lastEsp32EventId = useRef(null);
  const esp32InstanceId = useRef(null);
  const esp32StatusRef = useRef(esp32Status);
  const activeEventIdRef = useRef(null);
  const userIdRef = useRef(null);
  const backendStatusRef = useRef(backendStatus);
  const esp32ResetSyncPending = useRef(false);
  const esp32ResetSyncPromise = useRef(null);
  const applyDeviceSafeStateRef = useRef(() => {});
  const resolveActiveSupabaseEmergencyRef = useRef(() => {});
  esp32StatusRef.current = esp32Status;
  emergencyRef.current = emergency;
  userIdRef.current = userId;
  backendStatusRef.current = backendStatus;

  useEffect(() => {
    let active = true;
    let timeoutId;

    async function pollEsp32Status() {
      try {
        const response = await fetch(`${FIRE_API_URL}/api/esp32/status`);
        if (!response.ok) {
          throw new Error(`Backend returned HTTP ${response.status}.`);
        }
        const status = await response.json();
        if (typeof status.connected !== "boolean" ||
            typeof status.emergency_active !== "boolean" ||
            typeof status.state_known !== "boolean" ||
            !Number.isSafeInteger(Number(status.event_id)) ||
            typeof status.instance_id !== "string") {
          throw new Error("ESP32 status endpoint returned an invalid response.");
        }
        if (active) {
          const eventId = Number(status.event_id);
          const firstBackendConnection = esp32InstanceId.current === null;
          const newBackendInstance = esp32InstanceId.current !== status.instance_id;
          if (newBackendInstance) {
            esp32InstanceId.current = status.instance_id;
            lastEsp32EventId.current = firstBackendConnection ? null : eventId;
            if (status.state_known && status.emergency_active) {
              updateWebsiteEmergencyOverride(null);
            }
          }
          if ((!newBackendInstance || firstBackendConnection) &&
              Number.isSafeInteger(eventId) && eventId >= 0 &&
              eventId !== lastEsp32EventId.current) {
            const previousEventId = lastEsp32EventId.current;
            lastEsp32EventId.current = eventId;
            const eventType = String(status.last_event || "").toLowerCase();
            if ((previousEventId !== null || eventId > 0) &&
                ["emergency", "reset", "safe"].includes(eventType)) {
              const resolved = eventType !== "emergency";
              const timestamp = status.last_event_at || new Date().toISOString();
              if (!resolved && websiteEmergencyOverrideRef.current !== true) {
                updateWebsiteEmergencyOverride(null);
              }
              setEsp32Events(previous => [{
                id: `esp32-${status.instance_id}-${eventId}`,
                source: "esp32",
                status: resolved ? "resolved" : "active",
                activityLabel: resolved
                  ? "ESP32 Emergency Resolved"
                  : "ESP32 Emergency Activated",
                triggered_at: timestamp
              }, ...previous.filter(event =>
                event.id !== `esp32-${status.instance_id}-${eventId}`
              )].slice(0, 100));
              if (resolved) {
                applyDeviceSafeStateRef.current();
                esp32ResetSyncPending.current = true;
                void resolveActiveSupabaseEmergencyRef.current();
              }
            }
          }
          if (newBackendInstance ||
              eventId >= Number(esp32StatusRef.current.event_id || 0)) {
            setEsp32Status({ ...status, apiConnected: true });
          }
        }
      } catch (error) {
        if (active) {
          setEsp32Status(previous => ({
            ...previous,
            connected: false,
            apiConnected: false,
            statusError: error.message
          }));
        }
      } finally {
        if (active) {
          timeoutId = window.setTimeout(pollEsp32Status, 1000);
        }
      }
    }

    void pollEsp32Status();
    return () => {
      active = false;
      window.clearTimeout(timeoutId);
    };
  }, []);
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

  function updateEmergencyState(active) {
    emergencyRef.current = active;
    setEmergency(active);
  }

  function updateWebsiteEmergencyOverride(active) {
    websiteEmergencyOverrideRef.current = active;
    setWebsiteEmergencyOverride(active);
  }

  function applyDeviceSafeState() {
    stopLocationAcquisition();
    locationRequestId.current += 1;
    bestLocation.current = null;
    updateEmergencyState(false);
    updateWebsiteEmergencyOverride(false);
    setEmergencyTimestamp(new Date().toISOString());
    setEmergencyLocation(null);
    setLocationTimezone(null);
    setLocationStatus("idle");
    setLocationError("");
  }

  async function resolveActiveSupabaseEmergency() {
    if (!isSupabaseConfigured) {
      esp32ResetSyncPending.current = false;
      return true;
    }
    if (backendStatusRef.current !== "ready" || !userIdRef.current) {
      setBackendError("Website emergency is clear, but Supabase is not ready to resolve the incident.");
      esp32ResetSyncPending.current = true;
      return false;
    }
    if (esp32ResetSyncPromise.current) return esp32ResetSyncPromise.current;

    const operation = (async () => {
      try {
        const records = await getEmergencyEvents();
        const activeRecord = records.find(event => event.status === "active");
        setEvents(records);
        const activeId = activeRecord?.id || null;
        activeEventIdRef.current = activeId;
        setActiveEventId(activeId);
        if (!activeId) {
          updateEmergencyState(false);
          setBackendError("");
          esp32ResetSyncPending.current = false;
          return true;
        }

        const resolvedEvent = await resolveEmergencyEvent(activeId, new Date().toISOString());
        activeEventIdRef.current = null;
        setActiveEventId(null);
        setEvents(previous => previous.map(event =>
          event.id === resolvedEvent.id ? resolvedEvent : event
        ));
        updateEmergencyState(false);
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
        setBackendError("");
        esp32ResetSyncPending.current = false;
        return true;
      } catch (error) {
        setBackendError(`Website emergency is clear, but the active Supabase incident could not be resolved: ${error.message}`);
        esp32ResetSyncPending.current = true;
        return false;
      }
    })();
    esp32ResetSyncPromise.current = operation;
    try {
      await operation;
    } finally {
      if (esp32ResetSyncPromise.current === operation) {
        esp32ResetSyncPromise.current = null;
      }
    }
  }

  applyDeviceSafeStateRef.current = applyDeviceSafeState;
  resolveActiveSupabaseEmergencyRef.current = resolveActiveSupabaseEmergency;

  const applyEmergencyEvents = useCallback(records => {
    setEvents(records);
    const activeEvent = records.find(event => event.status === "active");
    const displayedEvent = activeEvent || records[0];
    activeEventIdRef.current = activeEvent?.id || null;
    setActiveEventId(activeEvent?.id || null);
    if (websiteEmergencyOverrideRef.current === null) {
      emergencyRef.current = Boolean(activeEvent);
      setEmergency(Boolean(activeEvent));
    }
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
  }, []);

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
        userIdRef.current = sessionUserId;

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
        backendStatusRef.current = "ready";
        setBackendError("");
        if (esp32StatusRef.current.apiConnected &&
            esp32StatusRef.current.connected &&
            !esp32StatusRef.current.emergency_active &&
            records.some(event => event.status === "active")) {
          esp32ResetSyncPending.current = true;
        }
        if (esp32ResetSyncPending.current) {
          void resolveActiveSupabaseEmergencyRef.current();
        }
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
  }, [applyEmergencyEvents]);

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

  async function synchronizeEsp32(target) {
    setEsp32CommandStatus({
      state: "pending",
      target,
      message: `Sending ${target.toUpperCase()} command; waiting for ESP32 acknowledgement...`
    });
    try {
      const response = await fetch(`${FIRE_API_URL}/api/esp32/command`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          request_id: crypto.randomUUID(),
          target
        })
      });
      const result = await response.json();
      if (!response.ok) {
        const detail = typeof result.detail === "string"
          ? result.detail
          : result.detail?.error || `Backend returned HTTP ${response.status}.`;
        throw new Error(detail);
      }
      if (result.acknowledged !== true) {
        throw new Error("The ESP32 did not acknowledge the requested state.");
      }

      const emergencyActive = result.state === "EMERGENCY";
      setEsp32Status(previous => ({
        ...previous,
        connected: true,
        apiConnected: true,
        emergency_active: emergencyActive,
        state_known: true,
        event_id: Math.max(Number(previous.event_id) || 0, Number(result.event_id) || 0),
        last_event: result.last_event || previous.last_event,
        last_event_at: result.last_event_at || previous.last_event_at
      }));
      setEsp32CommandStatus({
        state: "acknowledged",
        target,
        message: `ESP32 acknowledged ${result.state}${result.reused_acknowledgement ? " (existing acknowledged state)" : ""}.`
      });
      return true;
    } catch (error) {
      setEsp32CommandStatus({
        state: "failed",
        target,
        message: `Website state updated, but ESP32 ${target} was not acknowledged; physical LED state is unconfirmed: ${error.message}`
      });
      return false;
    }
  }

  async function triggerAlert(source = "manual") {
    if (actionBusyRef.current) {
      return false;
    }
    if (activeEventIdRef.current || emergencyRef.current ||
        websiteEmergencyOverrideRef.current === true) {
      return true;
    }
    const currentDeviceStatus = esp32StatusRef.current;
    if (websiteEmergencyOverrideRef.current !== false &&
        currentDeviceStatus.apiConnected && currentDeviceStatus.connected &&
        currentDeviceStatus.state_known && currentDeviceStatus.emergency_active) {
      return true;
    }
    actionBusyRef.current = true;
    setActionBusy(true);
    setBackendError("");
    const triggeredAt = new Date().toISOString();
    updateWebsiteEmergencyOverride(true);
    updateEmergencyState(true);
    setEmergencyTimestamp(triggeredAt);
    setLocationTimezone(null);
    setEmergencyLocation(null);
    setLocationStatus("loading");
    void synchronizeEsp32("emergency");

    try {
      if (backendStatusRef.current !== "ready" || !userIdRef.current) {
        throw new Error("Supabase is not ready; the dashboard emergency is active but the incident could not be saved.");
      }
      const record = await createEmergencyEvent(userIdRef.current, triggeredAt, source);
      activeEventIdRef.current = record.id;
      setActiveEventId(record.id);
      setEvents(previous => [record, ...previous.filter(event => event.id !== record.id)]);
      requestEmergencyLocation(record.id);
    } catch (error) {
      setBackendError(`Dashboard emergency is active, but the incident could not be saved to Supabase: ${error.message}`);
    } finally {
      actionBusyRef.current = false;
      setActionBusy(false);
    }
    return true;
  }

  async function resetAlert() {
    if (actionBusyRef.current) return;
    actionBusyRef.current = true;
    setActionBusy(true);
    setBackendError("");
    applyDeviceSafeState();
    esp32ResetSyncPending.current = true;
    void synchronizeEsp32("reset");
    try {
      await resolveActiveSupabaseEmergency();
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
  const esp32StatusUnknown = !esp32Status.apiConnected ||
    !esp32Status.connected || !esp32Status.state_known;
  const esp32EmergencyActive = !esp32StatusUnknown && esp32Status.emergency_active;
  const activeSupabaseEvent = events.find(event => event.status === "active");
  const databaseEventTime = Date.parse(activeSupabaseEvent?.triggered_at || "");
  const deviceEventTime = Date.parse(esp32Status.last_event_at || "");
  const databaseEventNewerThanDevice = activeSupabaseEvent && (
    !esp32Status.connected ||
    !esp32Status.state_known ||
    !esp32Status.last_event_at ||
    !Number.isFinite(databaseEventTime) ||
    !Number.isFinite(deviceEventTime) ||
    databaseEventTime > deviceEventTime
  );
  const displayedEmergency = websiteEmergencyOverride === false
    ? false
    : websiteEmergencyOverride === true
      ? true
      : esp32EmergencyActive || (emergency && (esp32StatusUnknown || databaseEventNewerThanDevice));
  const websiteIncidentActive = websiteEmergencyOverride === true ||
    (websiteEmergencyOverride === null && emergency &&
      (esp32StatusUnknown || databaseEventNewerThanDevice));
  const displayedStatusUnknown = websiteEmergencyOverride === false
    ? false
    : esp32StatusUnknown;
  const activityEvents = [...events, ...esp32Events].sort((left, right) =>
    Date.parse(right.triggered_at) - Date.parse(left.triggered_at)
  );
  const systemStatusClass = displayedEmergency
    ? "danger"
    : displayedStatusUnknown ? "pending" : "safe";
  const systemStatusLabel = websiteIncidentActive
    ? "EMERGENCY DETECTED"
    : displayedEmergency ? "EMERGENCY ACTIVE"
    : displayedStatusUnknown ? "ESP32 STATUS UNAVAILABLE" : "SYSTEM SAFE";

  return (
    <div className="dashboard">
      <aside className="sidebar">
        <div className="brand">
          <ShieldCheck size={30} />
          <span>SafeGuard <b>AI</b></span>
        </div>
        <button
          className="mobile-nav-toggle"
          type="button"
          aria-label={mobileNavOpen ? "Close navigation" : "Open navigation"}
          aria-expanded={mobileNavOpen}
          onClick={() => setMobileNavOpen(open => !open)}
        >
          {mobileNavOpen ? <X size={21} /> : <Menu size={21} />}
        </button>

        <p className={`side-label ${mobileNavOpen ? "is-visible" : ""}`}>MONITORING SYSTEM</p>
        <nav className={mobileNavOpen ? "is-open" : ""}>
          <div className="nav-active"><Activity size={19}/> Dashboard</div>
          <div><Camera size={19}/> Camera Monitoring</div>
          <div><Bell size={19}/> Alert History</div>
          <div><Cpu size={19}/> ESP32 Device</div>
        </nav>

        <div className="sidebar-bottom">
          <span className={`online-dot ${backendStatus === "ready" ? "" : "offline"}`}></span>
          {dashboardConnectionLabel}
        </div>
      </aside>

      <main className="main">
        {backendError && (
          <div className="backend-alert" role="alert">
            <strong>Data service issue</strong>
            <span>{backendError}</span>
          </div>
        )}

        <motion.section
          className="hero-shell"
          id="dashboard"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: "easeOut" }}
        >
          <div className="hero-copy">
            <p className="eyebrow">INDUSTRIAL SAFETY PLATFORM</p>
            <h1>
              Safety <span>Overview</span>
            </h1>
            <p className="muted">Real-time emergency monitoring dashboard</p>
          </div>

          <div className="hero-scene">
            <img className="hero-scene-art desktop-scene" src={dashboardHeroImage} alt="" />
            <img className="hero-mobile-board" src={boardImage} alt="" />
            <div className={`supabase-pill ${backendStatus === "ready" ? "connected" : "disconnected"}`}>
              <Wifi size={15} />
              {dashboardConnectionLabel}
            </div>
            <div className="hero-device-card">
              <span className="device-icon"><Cpu size={21} /></span>
              <div className="device-copy">
                <strong>ESP32 DEVKIT</strong>
                <span>THE HEART OF IDEAS</span>
              </div>
              <span className="device-arrow" aria-hidden="true">›</span>
              <div className="device-tags">
                <span>IoT</span>
                <span>Embedded</span>
                <span>Creative Tech</span>
              </div>
            </div>
          </div>
        </motion.section>

        <motion.section
          className={`status-banner ${systemStatusClass}`}
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.08 }}
        >
          <div className="status-chip">
            <img src={statusChipImage} alt="" className="status-chip-image" />
          </div>

          <div className="status-copy">
            <p>SYSTEM STATUS</p>
            <h2>{systemStatusLabel}</h2>
            <span>
              {websiteEmergencyOverride === false && esp32EmergencyActive
                ? "Website emergency resolved; ESP32 still reports emergency and its reset is not confirmed"
                : websiteEmergencyOverride === false && esp32StatusUnknown
                ? "Website emergency resolved; ESP32 reset status is unconfirmed"
                : websiteEmergencyOverride === true
                ? activeEventId
                  ? "Website emergency is active and its incident is recorded in Supabase"
                  : "Dashboard emergency is active; incident is being saved to Supabase"
                : esp32EmergencyActive
                ? emergency
                  ? "Emergency active in Supabase and on ESP32"
                  : "ESP32 emergency active · display only; not saved to Supabase"
                : displayedEmergency
                  ? "Emergency is active and recorded in Supabase"
                  : esp32StatusUnknown
                    ? !esp32Status.apiConnected
                      ? `Could not read ESP32 emergency state: ${esp32Status.statusError || "backend unavailable"}`
                      : !esp32Status.connected
                        ? "ESP32 disconnected; showing last known dashboard emergency state"
                        : "ESP32 connected; waiting for its initial state report"
                    : esp32Status.connected
                      ? emergency
                        ? "ESP32 is safe; resolving stale Supabase emergency state"
                        : "ESP32 reports system safe"
                      : "No active emergency; ESP32 disconnected"}
            </span>
          </div>

          <div className="status-summary">
            <span className={`status-badge ${displayedEmergency ? "is-emergency" : displayedStatusUnknown ? "is-pending" : ""}`}>
              <span className="status-dot" />
              {displayedEmergency ? "EMERGENCY" : displayedStatusUnknown ? "UNKNOWN" : "SAFE"}
            </span>
          </div>
        </motion.section>

        <section className="stats">
          <motion.div className="stat-card" whileHover={{ y: -5 }}>
            <Camera size={23}/>
            <p>Camera Status</p>
            <h3>{cameraStatus === "live" ? "Camera Online" : cameraStatus === "requesting" ? "Connecting..." : "Camera Offline"}</h3>
            <small>
              {cameraStatus === "live" ? "Browser feed active" : cameraStatus === "error"
                ? "Check permissions or camera connection"
                : cameraStatus === "requesting" ? "Waiting for camera permission" : "Start to preview browser camera"}
            </small>
          </motion.div>

          <motion.div className="stat-card" whileHover={{ y: -5 }}>
            <Cpu size={23}/>
            <p>ESP32 Device</p>
            <h3>{!esp32Status.apiConnected
              ? "ESP32 Status Unavailable"
              : esp32Status.connected
                ? "ESP32 Connected"
                : "ESP32 Disconnected"}</h3>
            <small>
              {!esp32Status.apiConnected
                ? `ESP32 status unavailable: ${esp32Status.statusError || "backend unavailable"}`
                : esp32Status.connected
                  ? !esp32Status.state_known
                    ? `${esp32Status.port} · ${esp32Status.baud_rate} baud · waiting for ESP32 state report`
                    : `${esp32Status.port} · ${esp32Status.baud_rate} baud · ${esp32Status.emergency_active ? "EMERGENCY ACTIVE" : "SYSTEM SAFE"}`
                  : `${esp32Status.port} unavailable · reconnecting · last state unconfirmed (${esp32Status.emergency_active ? "EMERGENCY" : "SAFE"})`}
            </small>
          </motion.div>

          <motion.div className="stat-card" whileHover={{ y: -5 }}>
            <Bell size={23}/>
            <p>Stored Emergencies</p>
            <h3>{backendStatus === "ready" ? events.length : "—"}</h3>
            <small>{backendStatus === "ready" ? "Recent Supabase records" : dashboardConnectionLabel}</small>
          </motion.div>
        </section>

        <section className="content-grid">
          <div id="camera-monitoring">
            <CameraFeed
              onStatusChange={setCameraStatus}
              onFireDetected={() => triggerAlert("camera")}
              emergencyActive={displayedEmergency}
            />
          </div>

          <div className="panel emergency-control" id="emergency-control">
            <div className="panel-heading">
              <h3><Bell size={20}/> Emergency Control</h3>
              <span className={`tag backend-tag ${backendStatus === "ready" ? "is-ready" : ""}`}>
                {backendStatus === "ready" ? "SUPABASE LOGGED" : dashboardConnectionLabel.toUpperCase()}
              </span>
              <span className="tag">PROTOTYPE</span>
            </div>
            <p className="muted control-text">
              Create a persistent emergency record, request this browser's location, and save the result to Supabase.
            </p>
            <button
              className="emergency-btn"
              onClick={() => triggerAlert("manual")}
              disabled={actionBusy || displayedEmergency}
            >
              <Flame size={19}/>
              {actionBusy ? "Saving emergency..."
                  : emergency ? "Emergency Active" : "Activate Emergency"}
            </button>
            <button
              className="reset-btn"
              onClick={resetAlert}
              disabled={(!displayedEmergency && !activeEventId &&
                !esp32ResetSyncPending.current) || actionBusy}
            >
              <RotateCcw size={18}/>
              {esp32ResetSyncPending.current && !displayedEmergency
                ? "Retry Incident Resolution"
                : "Resolve Emergency"}
            </button>
            <div className="notice">
              Prototype only — not a production safety control. Website controls require an ESP32 serial acknowledgement. Manual and AI camera alerts retain the existing Supabase history and location workflow. ESP32-originated emergencies never create Supabase records; a reset resolves an existing active record.
            </div>
            <div className={`notice command-status ${esp32CommandStatus.state}`} role="status" aria-live="polite">
              <strong>ESP32 command: </strong>{esp32CommandStatus.message}
              {!esp32Status.connected && esp32Status.apiConnected &&
                <span> Serial device disconnected on {esp32Status.port}.</span>}
            </div>
          </div>
        </section>

        <div id="location-map">
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
        </div>

        <section className="panel history" id="alert-history">
          <div className="panel-heading">
            <h3><Activity size={20}/> Recent Activity</h3>
            <span className="tag">SUPABASE + ESP32</span>
          </div>
          {activityEvents.length === 0 ? (
            <p className="muted">No recent activity.</p>
          ) : (
            activityEvents.map(event => (
              <div className={`event ${event.status === "resolved" ? "resolved" : ""}`} key={event.id}>
                <Flame size={18}/>
                <span>
                  {event.activityLabel || (event.status === "active"
                    ? (event.source === "camera" ? "Possible fire alert (AI camera)" : "Emergency activated")
                    : "Emergency resolved")}
                  {event.latitude != null && ` · ${Number(event.latitude).toFixed(5)}, ${Number(event.longitude).toFixed(5)}`}
                </span>
                <time dateTime={event.triggered_at}>
                  {formatTimestamp(event.triggered_at, event.location_timezone)}
                </time>
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