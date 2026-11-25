"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { LocationSheet, type LocationSheetInitial } from "@/components/locations/location-sheet";

interface Props {
  /** `new` opens the create sheet on `?new=1`; `edit` opens the edit sheet for `location` on `?edit=1`. */
  mode: "new" | "edit";
  /** Required for `edit`; the sheet does not open until it has arrived. */
  location?: LocationSheetInitial | null;
}

/**
 * Opens the Location sheet from the URL (`?new=1` on the list, `?edit=1` on the record) so the old
 * `/locations/new` and `/locations/[id]/edit` links, the `N` shortcut and the ⋯ menu all land in ONE place.
 * Closing removes the param (replace, so Back does not reopen it).
 */
export function LocationSheetHost({ mode, location }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const wanted = params.get(mode) === "1";
  const open = wanted && (mode === "new" || !!location);

  const onOpenChange = (next: boolean) => {
    if (next) return;
    const q = new URLSearchParams(params.toString());
    q.delete(mode);
    const qs = q.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  };

  return <LocationSheet open={open} onOpenChange={onOpenChange} location={mode === "edit" ? (location ?? undefined) : undefined} />;
}
