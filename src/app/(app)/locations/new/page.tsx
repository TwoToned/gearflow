"use client";

import { LocationForm } from "@/components/locations/location-form";

export default function NewLocationPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="t-title text-fg">New Location</h1>
        <p className="text-[13px] text-fg-3">
          Add a new warehouse, venue, or storage location.
        </p>
      </div>
      <LocationForm />
    </div>
  );
}
