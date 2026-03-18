"use client";

import dynamic from "next/dynamic";

interface AddressMapProps {
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

// Dynamic import to avoid SSR issues with Google Maps
const MapInner = dynamic(() => import("./address-map-inner"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center rounded-md border bg-muted/30 text-sm text-muted-foreground" style={{ height: 250 }}>
      Loading map...
    </div>
  ),
});

export function AddressMap(props: AddressMapProps) {
  return <MapInner {...props} />;
}

export type { AddressMapProps };
