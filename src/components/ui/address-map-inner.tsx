"use client";

import { useEffect, useRef } from "react";
import { Map, AdvancedMarker, Pin, InfoWindow, useMap } from "@/lib/maps-sdk";
import { ExternalLink } from "lucide-react";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";
import { useState } from "react";

function getDirectionsUrl(lat: number, lng: number, label: string) {
  const isIOS =
    typeof navigator !== "undefined" && /iPad|iPhone|iPod/.test(navigator.userAgent);
  if (isIOS) {
    return `maps:?daddr=${lat},${lng}&q=${encodeURIComponent(label)}`;
  }
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}

// Keeps map centered when coordinates change
function RecenterMap({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap();
  const prevRef = useRef({ lat, lng });

  useEffect(() => {
    if (!map) return;
    if (prevRef.current.lat !== lat || prevRef.current.lng !== lng) {
      map.panTo({ lat, lng });
      prevRef.current = { lat, lng };
    }
  }, [map, lat, lng]);

  return null;
}

interface Props {
  latitude: number;
  longitude: number;
  address?: string;
  label?: string;
  height?: number;
  zoom?: number;
  interactive?: boolean;
  showDirectionsLink?: boolean;
  className?: string;
}

export default function AddressMapInner({
  latitude,
  longitude,
  address,
  label,
  height = 250,
  zoom = 15,
  interactive = true,
  showDirectionsLink = true,
  className,
}: Props) {
  const { resolvedTheme } = useTheme();
  const [infoOpen, setInfoOpen] = useState(false);
  const position = { lat: latitude, lng: longitude };
  const directionsUrl = getDirectionsUrl(latitude, longitude, label || address || "");

  return (
    <div className={cn("space-y-2", className)}>
      <div className="overflow-hidden rounded-md border" style={{ height }}>
        <Map
          defaultCenter={position}
          defaultZoom={zoom}
          gestureHandling={interactive ? "auto" : "none"}
          disableDefaultUI={!interactive}
          colorScheme={resolvedTheme === "dark" ? "DARK" : "LIGHT"}
          mapId="gearflow-map"
          style={{ width: "100%", height: "100%" }}
        >
          <AdvancedMarker position={position} onClick={() => setInfoOpen(true)}>
            <Pin
              background="#0d9488"
              borderColor="#0f766e"
              glyphColor="#ffffff"
            />
          </AdvancedMarker>
          {infoOpen && (
            <InfoWindow
              position={position}
              onCloseClick={() => setInfoOpen(false)}
            >
              <div className="text-sm">
                {label && <div className="font-medium">{label}</div>}
                {address && <div className="text-gray-600">{address}</div>}
              </div>
            </InfoWindow>
          )}
          <RecenterMap lat={latitude} lng={longitude} />
        </Map>
      </div>

      {showDirectionsLink && (
        <a
          href={directionsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-sm text-fg-3 hover:text-fg transition-colors"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          Get Directions
        </a>
      )}
    </div>
  );
}
