import { useEffect, useMemo } from "react";
import { motion } from "motion/react";
import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import { ExternalLink, MapPin } from "lucide-react";
import { formatTimestamp } from "./lib/locationTime";
import "leaflet/dist/leaflet.css";
import "./LocationMap.css";

const INITIAL_MAP_CENTER = [20, 0];

const OPEN_STREET_MAP_TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const OPEN_STREET_MAP_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>';

function MapViewport({ position, zoom }) {
  const map = useMap();

  useEffect(() => {
    const currentCenter = map.getCenter();
    if (currentCenter.lat === position[0] && currentCenter.lng === position[1]) {
      if (map.getZoom() !== zoom) map.flyTo(position, zoom, { duration: 0.6 });
      return;
    }

    map.stop();
    map.flyTo(position, zoom, { duration: 0.6 });
  }, [map, position, zoom]);

  return null;
}

export default function LocationMap({
  emergency,
  emergencyTimestamp,
  locationTimezone,
  emergencyLocation,
  locationStatus,
  locationError
}) {
  const activeLocation = emergencyLocation;
  const position = useMemo(
    () => activeLocation
      ? [activeLocation.latitude, activeLocation.longitude]
      : INITIAL_MAP_CENTER,
    [activeLocation]
  );
  const mapsUrl = activeLocation
    ? `https://www.google.com/maps/search/?api=1&query=${activeLocation.latitude},${activeLocation.longitude}`
    : null;
  const locationLabel = emergencyLocation ? "Browser GPS" : "No GPS coordinates recorded";
  const locationName = emergencyLocation ? "Emergency device location" : "Awaiting verified location";
  const timestampText = formatTimestamp(emergencyTimestamp, locationTimezone);
  const markerIcon = useMemo(() => L.divIcon({
    className: "factory-marker-wrapper",
    html: `<span class="factory-marker ${emergency ? "is-emergency" : "is-safe"}"><span class="factory-marker-core"></span><span class="factory-marker-pulse"></span></span>`,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
    popupAnchor: [0, -17]
  }), [emergency]);
  return (
    <motion.section
      className={`panel emergency-map-panel ${emergency ? "is-emergency" : "is-safe"}`}
      aria-labelledby="location-map-title"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
    >
      <div className="emergency-map-heading">
        <div>
          <p className="map-eyebrow">SITE OVERVIEW</p>
          <h3 id="location-map-title"><MapPin size={20} /> Emergency Location Map</h3>
        </div>
        <span className={`map-status-badge ${emergency ? "is-emergency" : "is-safe"}`}>
          <span className="map-status-dot" />
          {emergency ? "EMERGENCY" : "SAFE"}
        </span>
      </div>

      <p className="map-info-note">
        The browser location is requested when an emergency is activated. Device GPS identifies this device,
        not a fire location detected by the camera.
      </p>
      {emergency && locationStatus === "loading" && !emergencyLocation && (
        <p className="map-location-feedback" role="status">
          Waiting for browser location permission and a high-accuracy GPS fix...
        </p>
      )}
      {emergency && locationStatus === "error" && (
        <p className="map-location-feedback is-error" role="alert">
          {locationError} No coordinates are available for this emergency.
        </p>
      )}
      {emergency && emergencyLocation && locationError && (
        <p className="map-location-feedback is-caution" role="status">{locationError}</p>
      )}

      <div className="emergency-map-frame">
        <MapContainer
          center={position}
          zoom={emergencyLocation ? 17 : 2}
          scrollWheelZoom
          zoomControl
          className="emergency-leaflet-map"
        >
          <MapViewport position={position} zoom={emergencyLocation ? 17 : 2} />
          <TileLayer
            attribution={OPEN_STREET_MAP_ATTRIBUTION}
            url={OPEN_STREET_MAP_TILE_URL}
            maxZoom={19}
          />
          {activeLocation && (
            <Marker position={position} icon={markerIcon}>
              <Popup className="factory-location-popup">
                <div className="factory-popup-content">
                  <strong>{locationName}</strong>
                  <span>{locationLabel}</span>
                  <span>
                    Alert status: <b className={emergency ? "popup-danger" : "popup-safe"}>
                      {emergency ? "EMERGENCY" : "SAFE"}
                    </b>
                  </span>
                  <span>Event timestamp: {timestampText}</span>
                  <span>
                    {activeLocation.latitude.toFixed(6)}, {activeLocation.longitude.toFixed(6)}
                  </span>
                  <span>Accuracy: ±{Math.round(activeLocation.accuracy)} m</span>
                </div>
              </Popup>
            </Marker>
          )}
        </MapContainer>
        <div className="map-overlay-label">
          <MapPin size={14} />
          {locationName}
        </div>
        {!activeLocation && (
          <div className="map-no-location">
            {locationStatus === "loading" ? "Waiting for GPS fix..." : "Location appears here after GPS is available"}
          </div>
        )}
      </div>

      <div className="map-footer">
        <div className="map-factory-details">
          <span className="map-detail-label">LOCATION</span>
          <strong>{emergencyLocation ? "Current device location" : "No location recorded"}</strong>
          <span className="map-location-label">{locationLabel}</span>
          <span className="map-location-label">
            {activeLocation
              ? `${activeLocation.latitude.toFixed(6)}, ${activeLocation.longitude.toFixed(6)} · Accuracy ±${Math.round(activeLocation.accuracy)} m`
              : "Coordinates not yet available"}
          </span>
        </div>
        <div className="map-event-details">
          <span className="map-detail-label">ALERT STATUS</span>
          <strong className={emergency ? "popup-danger" : "popup-safe"}>
            {emergency ? "Emergency active" : "System safe"}
          </strong>
          <span className="map-location-label">
            {emergency
              ? `Triggered ${timestampText}`
              : "No active emergency"}
          </span>
        </div>
        {mapsUrl
          ? (
            <a className="google-maps-link" href={mapsUrl} target="_blank" rel="noreferrer">
              <ExternalLink size={16} />
              Open in Google Maps
            </a>
          )
          : (
            <span className="google-maps-link is-disabled" aria-disabled="true">
              <ExternalLink size={16} />
              GPS required for Maps link
            </span>
          )}
      </div>
    </motion.section>
  );
}
