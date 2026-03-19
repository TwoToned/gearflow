"use client";

import { AddressMap } from "./address-map";

interface AddressDisplayProps {
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  label?: string;
  compact?: boolean;
  showDirections?: boolean;
}

export function AddressDisplay({
  address,
  latitude,
  longitude,
  label,
  compact = false,
  showDirections = true,
}: AddressDisplayProps) {
  if (!address && latitude == null) return null;

  if (latitude != null && longitude != null) {
    return (
      <AddressMap
        latitude={latitude}
        longitude={longitude}
        address={address ?? undefined}
        label={label}
        height={compact ? 150 : 250}
        interactive={!compact}
        showDirectionsLink={showDirections}
      />
    );
  }

  if (address) {
    return (
      <p className="text-sm text-fg-3 whitespace-pre-wrap">{address}</p>
    );
  }

  return null;
}
