import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, CameraOff, CircleStop, LoaderCircle, RefreshCw } from "lucide-react";
import { FIRE_API_URL } from "./lib/fireApi";
import "./CameraFeed.css";

const FRAME_INTERVAL_MS = 700;
const FIRE_FRAMES_REQUIRED = 3;
const FIRE_CLEAR_FRAMES_REQUIRED = 5;

function getCameraErrorMessage(error) {
  switch (error.name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
      return "Camera access was denied. Allow camera permission for this site in your browser settings, then try again.";
    case "NotFoundError":
    case "DevicesNotFoundError":
      return "No camera was found. Connect a camera and try again.";
    case "NotReadableError":
    case "TrackStartError":
      return "The camera is busy or unavailable. Close other apps or browser tabs using it, then retry.";
    case "OverconstrainedError":
      return "The selected camera could not satisfy the requested video settings. Choose another camera and retry.";
    case "SecurityError":
      return "Camera access is blocked by browser security settings. Open this site on HTTPS or localhost.";
    case "AbortError":
      return "The camera request was interrupted. Please try again.";
    default:
      return `Could not start the camera: ${error.message || "Unknown camera error."}`;
  }
}

function stopMediaStream(stream) {
  stream?.getTracks().forEach(track => track.stop());
}

export default function CameraFeed({
  onStatusChange,
  onFireDetected,
  emergencyActive
}) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const cameraToolsRef = useRef(null);
  const streamRef = useRef(null);
  const requestIdRef = useRef(0);
  const selectedDeviceIdRef = useRef("");
  const onFireDetectedRef = useRef(onFireDetected);
  const fireFrameStreak = useRef(0);
  const fireAlertLatched = useRef(false);
  const clearFrameStreak = useRef(0);
  const previousEmergencyActive = useRef(emergencyActive);
  const [stream, setStream] = useState(null);
  const [devices, setDevices] = useState([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState("");
  const [status, setStatus] = useState("idle");
  const [videoReady, setVideoReady] = useState(false);
  const [error, setError] = useState("");
  const [aiStatus, setAiStatus] = useState("checking");
  const [aiMessage, setAiMessage] = useState("Checking fire-detection backend...");
  const [predictions, setPredictions] = useState([]);
  const [smokeWarning, setSmokeWarning] = useState(false);
  const [alertAwaitingClear, setAlertAwaitingClear] = useState(false);

  useEffect(() => {
    onStatusChange(status);
  }, [onStatusChange, status]);

  useEffect(() => {
    onFireDetectedRef.current = onFireDetected;
  }, [onFireDetected]);

  useEffect(() => {
    if (previousEmergencyActive.current && !emergencyActive) {
      fireAlertLatched.current = true;
      fireFrameStreak.current = 0;
      clearFrameStreak.current = 0;
      setAlertAwaitingClear(true);
    }
    previousEmergencyActive.current = emergencyActive;
  }, [emergencyActive]);

  useEffect(() => {
    let active = true;
    let timeoutId;

    async function checkModel() {
      try {
        const response = await fetch(`${FIRE_API_URL}/api/health`);
        if (!response.ok) throw new Error(`Backend returned HTTP ${response.status}.`);
        const health = await response.json();
        if (!active) return;

        if (health.api_status !== "connected") {
          throw new Error("The health endpoint did not confirm an API connection.");
        }
        if (health.status === "ready") {
          setAiStatus("ready");
          setAiMessage(`${health.model} loaded · confidence threshold ${Math.round(health.confidence_threshold * 100)}%`);
        } else if (health.status === "model_not_loaded") {
          setAiStatus("connected_no_model");
          setAiMessage(health.detail || "Add fire-trained model weights to the backend.");
        } else {
          throw new Error(`Unexpected health status: ${health.status || "missing status"}.`);
        }
      } catch (healthError) {
        if (!active) return;
        setAiStatus("offline");
        setAiMessage(`Fire-detection backend unavailable: ${healthError.message}`);
      } finally {
        if (active) timeoutId = window.setTimeout(checkModel, 5000);
      }
    }

    void checkModel();
    return () => {
      active = false;
      window.clearTimeout(timeoutId);
    };
  }, []);

  useEffect(() => {
    if (!videoReady || aiStatus !== "ready") return undefined;
    let active = true;
    let timeoutId;

    async function detectNextFrame() {
      try {
        const video = videoRef.current;
        const canvas = canvasRef.current;
        if (!video || !canvas || video.videoWidth === 0 || video.videoHeight === 0) {
          throw new Error("The live camera frame is not available for analysis.");
        }

        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Could not prepare a camera frame for analysis.");
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        const frame = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", 0.8));
        if (!frame) throw new Error("Could not encode a camera frame for analysis.");

        const form = new FormData();
        form.append("frame", frame, "camera-frame.jpg");
        const response = await fetch(`${FIRE_API_URL}/api/detect`, {
          method: "POST",
          body: form
        });
        const result = await response.json();
        if (!active) return;

        if (response.status === 503 && result.detail?.status === "model_not_loaded") {
          setAiStatus("connected_no_model");
          setAiMessage(result.detail.detail || "Add fire-trained model weights to the backend.");
          setPredictions([]);
          setSmokeWarning(false);
          return;
        }
        if (!response.ok) {
          throw new Error(result.detail || `Backend returned HTTP ${response.status}.`);
        }

        setPredictions(result.detections);
        setSmokeWarning(Boolean(result.smoke_detected));
        const fireDetected = Boolean(result.fire_detected);
        if (fireAlertLatched.current) {
          clearFrameStreak.current = fireDetected ? 0 : clearFrameStreak.current + 1;
          if (clearFrameStreak.current >= FIRE_CLEAR_FRAMES_REQUIRED) {
            fireAlertLatched.current = false;
            clearFrameStreak.current = 0;
            fireFrameStreak.current = 0;
            setAlertAwaitingClear(false);
          }
        } else {
          fireFrameStreak.current = fireDetected ? fireFrameStreak.current + 1 : 0;
          if (fireFrameStreak.current >= FIRE_FRAMES_REQUIRED) {
            const activated = await onFireDetectedRef.current?.();
            if (!active) return;
            if (activated !== false) {
              fireAlertLatched.current = true;
              clearFrameStreak.current = 0;
              setAlertAwaitingClear(true);
            }
          }
        }
      } catch (detectionError) {
        if (!active) return;
        setAiStatus("error");
        setAiMessage(`Fire detection stopped: ${detectionError.message}`);
        setPredictions([]);
        setSmokeWarning(false);
      } finally {
        if (active) timeoutId = window.setTimeout(detectNextFrame, FRAME_INTERVAL_MS);
      }
    }

    void detectNextFrame();
    return () => {
      active = false;
      window.clearTimeout(timeoutId);
      fireFrameStreak.current = 0;
      setPredictions([]);
    };
  }, [aiStatus, videoReady]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !stream) return undefined;

    video.srcObject = stream;
    video.play().catch(playError => {
      if (streamRef.current !== stream) return;
      stopMediaStream(streamRef.current);
      streamRef.current = null;
      setStream(null);
      setError(`Camera stream is ready, but video playback failed: ${playError.message}`);
      setStatus("error");
    });

    return () => {
      if (video.srcObject === stream) video.srcObject = null;
      setVideoReady(false);
    };
  }, [stream]);

  const refreshDevices = useCallback(async activeStream => {
    if (!navigator.mediaDevices?.enumerateDevices) {
      setError("This browser cannot list camera devices.");
      return;
    }

    try {
      const inputs = (await navigator.mediaDevices.enumerateDevices())
        .filter(device => device.kind === "videoinput");
      setDevices(inputs);
      const activeDeviceId = activeStream?.getVideoTracks()[0]?.getSettings().deviceId;
      const nextDeviceId = activeDeviceId || selectedDeviceIdRef.current;
      if (nextDeviceId && inputs.some(device => device.deviceId === nextDeviceId)) {
        selectedDeviceIdRef.current = nextDeviceId;
        setSelectedDeviceId(nextDeviceId);
      } else if (inputs[0]) {
        selectedDeviceIdRef.current = inputs[0].deviceId;
        setSelectedDeviceId(inputs[0].deviceId);
      } else {
        selectedDeviceIdRef.current = "";
        setSelectedDeviceId("");
      }
    } catch (deviceError) {
      setError(`Camera is live, but the device list could not be loaded: ${deviceError.message}`);
    }
  }, []);

  useEffect(() => {
    if (!navigator.mediaDevices?.addEventListener) return undefined;
    const handleDeviceChange = () => {
      void refreshDevices(streamRef.current);
    };
    navigator.mediaDevices.addEventListener("devicechange", handleDeviceChange);
    return () => navigator.mediaDevices.removeEventListener("devicechange", handleDeviceChange);
  }, [refreshDevices]);

  useEffect(() => () => {
    requestIdRef.current += 1;
    const activeStream = streamRef.current;
    streamRef.current = null;
    stopMediaStream(activeStream);
  }, []);

  const startCamera = useCallback(async deviceId => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setError(window.isSecureContext
        ? "Camera access is not supported by this browser."
        : "Camera access requires HTTPS or localhost.");
      setStatus("error");
      return;
    }

    const requestId = ++requestIdRef.current;
    const previousStream = streamRef.current;
    streamRef.current = null;
    stopMediaStream(previousStream);
    setStream(null);
    setVideoReady(false);
    setError("");
    setStatus("requesting");

    try {
      const nextStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30, max: 30 }
        }
      });

      if (requestId !== requestIdRef.current) {
        stopMediaStream(nextStream);
        return;
      }

      streamRef.current = nextStream;
      setStream(nextStream);
      const videoTrack = nextStream.getVideoTracks()[0];
      if (!videoTrack) {
        stopMediaStream(nextStream);
        streamRef.current = null;
        setError("The selected device did not provide a video track.");
        setStatus("error");
        return;
      }
      videoTrack?.addEventListener("ended", () => {
        if (streamRef.current !== nextStream) return;
        streamRef.current = null;
        setStream(null);
        setVideoReady(false);
        setStatus("error");
        setError("The camera stream ended. Check the camera connection and restart the feed.");
      }, { once: true });
      await refreshDevices(nextStream);
    } catch (cameraError) {
      if (requestId !== requestIdRef.current) return;
      setStatus("error");
      setError(getCameraErrorMessage(cameraError));
    }
  }, [refreshDevices]);

  function stopCamera() {
    if (cameraToolsRef.current) {
      cameraToolsRef.current.open = false;
    }

    requestIdRef.current += 1;
    const activeStream = streamRef.current;
    streamRef.current = null;
    stopMediaStream(activeStream);
    setStream(null);
    setVideoReady(false);
    setPredictions([]);
    setStatus("idle");
    setError("");
  }

  function changeCamera(event) {
    const deviceId = event.target.value;
    selectedDeviceIdRef.current = deviceId;
    setSelectedDeviceId(deviceId);
    if (streamRef.current) void startCamera(deviceId);
  }

  return (
    <section className="panel camera-monitor-panel" aria-labelledby="camera-monitor-title">
      <div className="panel-heading">
        <h3 id="camera-monitor-title"><Camera size={20}/> Live Camera Monitoring</h3>
        <details ref={cameraToolsRef} className="camera-tools">
          <summary className={`tag camera-status-tag ${status}`}>
            <span className="camera-status-dot" />
            {status === "live" ? "CAMERA ONLINE" : status === "requesting" ? "CONNECTING" : status === "error" ? "CAMERA ISSUE" : "CAMERA OFFLINE"}
          </summary>
          <div className="camera-tools-popover">
            <div className={`camera-ai-status ${aiStatus}`} role="status" aria-live="polite">
              <div className="camera-ai-heading">
                <strong>
                  {aiStatus === "checking" ? "Checking AI Model..."
                    : aiStatus === "ready" ? "AI Fire Detection Active"
                      : aiStatus === "connected_no_model" ? "Backend Connected · AI Model Not Loaded"
                        : aiStatus === "offline" ? "AI Backend Offline" : "AI Detection Error"}
                </strong>
                {aiStatus === "checking" && <LoaderCircle size={14} className="camera-spinner" />}
              </div>
              <span>{aiMessage}</span>
              {aiStatus === "ready" && (
                <>
                  <span>
                    Auto-alert threshold: fire in {FIRE_FRAMES_REQUIRED} consecutive sampled frames.
                  </span>
                  {alertAwaitingClear && (
                    <span>
                      Alert is latched. Fire must be absent for {FIRE_CLEAR_FRAMES_REQUIRED} consecutive sampled frames before a new alert can trigger.
                    </span>
                  )}
                  <div className="camera-predictions" aria-label="Current model predictions">
                    {predictions.length
                      ? predictions.map((prediction, index) => (
                        <span
                          key={`${prediction.label}-${index}`}
                          className={prediction.is_fire ? "is-fire" : prediction.is_smoke ? "is-smoke" : ""}
                        >
                          {prediction.label} {(prediction.confidence * 100).toFixed(1)}%
                        </span>
                      ))
                      : <span>No detections above the configured confidence threshold.</span>}
                  </div>
                  {smokeWarning && (
                    <strong className="camera-smoke-warning">
                      Smoke detected — verify the area. Smoke alone will not automatically trigger an emergency.
                    </strong>
                  )}
                </>
              )}
            </div>

            <div className="camera-controls">
              <label className="camera-device-picker">
                <span>CAMERA DEVICE</span>
                <select
                  value={selectedDeviceId}
                  onChange={changeCamera}
                  disabled={status === "requesting" || (devices.length === 0 && !stream)}
                  aria-label="Select camera device"
                >
                  {devices.length === 0 && <option value="">Default camera</option>}
                  {devices.map((device, index) => (
                    <option key={device.deviceId || index} value={device.deviceId}>
                      {device.label || `Camera ${index + 1}`}
                    </option>
                  ))}
                </select>
              </label>
              {stream ? (
                <button className="camera-action-button stop" type="button" onClick={stopCamera}>
                  <CircleStop size={17} /> Stop Camera
                </button>
              ) : (
                <button
                  className="camera-action-button start"
                  type="button"
                  onClick={() => startCamera(selectedDeviceId)}
                  disabled={status === "requesting"}
                >
                  {status === "error" ? <RefreshCw size={17} /> : <Camera size={17} />}
                  {status === "requesting" ? "Connecting..." : status === "error" ? "Retry Camera" : "Start Camera"}
                </button>
              )}
            </div>

            <p className="camera-disclaimer">
              Detection uses selected frames from this live preview. AI results are advisory and must be independently verified.
            </p>
          </div>
        </details>
      </div>

      <div className={`camera-preview ${stream ? "has-stream" : ""} ${status}`}>
        <video
          ref={videoRef}
          className="camera-video"
          autoPlay
          muted
          playsInline
          aria-label="Live camera preview"
          onPlaying={() => {
            if (streamRef.current === stream) {
              setVideoReady(true);
              setStatus("live");
              if (cameraToolsRef.current) {
                cameraToolsRef.current.open = false;
              }
            }
          }}
        />
        <canvas ref={canvasRef} className="camera-analysis-canvas" aria-hidden="true" />
        {videoReady && predictions.map((prediction, index) => (
          <div
            key={`${prediction.label}-${prediction.bbox.x}-${prediction.bbox.y}-${index}`}
            className={`fire-detection-box ${prediction.is_fire ? "is-fire" : prediction.is_smoke ? "is-smoke" : ""}`}
            style={{
              left: `${prediction.bbox.x * 100}%`,
              top: `${prediction.bbox.y * 100}%`,
              width: `${prediction.bbox.width * 100}%`,
              height: `${prediction.bbox.height * 100}%`
            }}
          >
            <span>{prediction.label} · {(prediction.confidence * 100).toFixed(1)}%</span>
          </div>
        ))}
        {(!stream || !videoReady) && (
          <div className="camera-empty-state">
            {status === "requesting"
              ? <LoaderCircle size={42} className="camera-spinner" />
              : <CameraOff size={42} />}
            <h4>{status === "requesting" ? "Connecting to camera..." : "Camera is offline"}</h4>
            <p>
              {status === "requesting"
                ? "Waiting for camera permission and a live video stream."
                : "The live feed will appear here once the camera is connected."}
            </p>
          </div>
        )}
        {stream && videoReady && <span className="camera-live-indicator"><span /> LIVE PREVIEW</span>}
      </div>

      {error && <p className="camera-error" role="alert">{error}</p>}

    </section>
  );
}
