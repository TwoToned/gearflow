"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { LocationForm } from "@/components/locations/location-form";
import { FadeIn } from "@/components/ui/motion";

export default function NewLocationPage() {
  return (
    <FadeIn>
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="flex items-center gap-2 text-sm text-fg-3 mb-4">
          <Link href="/locations" className="hover:text-fg transition-colors">Locations</Link>
          <ChevronRight className="h-3 w-3" />
          <span className="text-fg">New Location</span>
        </div>
        <div>
          <h1 className="t-title text-fg">New Location</h1>
          <p className="t-body text-fg-3">
            Add a new warehouse, venue, or storage location.
          </p>
        </div>
        <LocationForm />
      </div>
    </FadeIn>
  );
}
