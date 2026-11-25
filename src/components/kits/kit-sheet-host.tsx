"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { KitSheet, type KitSheetInitial } from "@/components/kits/kit-sheet";

interface Props {
  /** `new` opens create on `?new=1` (the list); `edit` and `copy` open on `?edit=1` / `?copy=1` for `kit` (the record). */
  mode: "new" | "edit" | "copy";
  /** Required for `edit` and `copy`; the sheet does not open until it has arrived. */
  kit?: KitSheetInitial | null;
}

/**
 * Opens the Kit sheet from the URL so the old `/kits/new` and `/kits/[id]/edit` links, the `N` shortcut and the
 * menus all land in ONE place. Closing removes the param (replace, so Back does not reopen it).
 */
export function KitSheetHost({ mode, kit }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const open = params.get(mode) === "1" && (mode === "new" || !!kit);

  const onOpenChange = (next: boolean) => {
    if (next) return;
    const q = new URLSearchParams(params.toString());
    q.delete(mode);
    const qs = q.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  };

  return <KitSheet open={open} onOpenChange={onOpenChange} kit={mode === "edit" ? (kit ?? undefined) : undefined} copyOf={mode === "copy" ? (kit ?? undefined) : undefined} />;
}
