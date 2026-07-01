import { ConvexError } from "convex/values";
import { UserFacingError } from "@/lib/errors";

/**
 * Per-domain feature flags for the Phase 5 native-write cutover (writes routed
 * through the RBAC + invariants + atomic-audit mutations in convex/*Writes.ts
 * instead of the inline-guard + service-mutation + Postgres-logActivity path).
 *
 * These gate SERVER-SIDE code (the server actions), so a plain runtime env var is
 * enough — no NEXT_PUBLIC build-inlining, and it flips via the Coolify env without a
 * rebuild. Default OFF (unset). Each domain flips independently once its write-parity
 * is verified.
 */
export const nativeAssetWrites = (): boolean =>
  process.env.NATIVE_ASSET_WRITES === "true";

export const nativeKitWrites = (): boolean =>
  process.env.NATIVE_KIT_WRITES === "true";

export const nativeCrewWrites = (): boolean =>
  process.env.NATIVE_CREW_WRITES === "true";

export const nativeProjectWrites = (): boolean =>
  process.env.NATIVE_PROJECT_WRITES === "true";

export const nativeLineItemWrites = (): boolean =>
  process.env.NATIVE_LINEITEM_WRITES === "true";

/**
 * Map an assetWrites mutation's `ConvexError({ code })` back to the rich
 * UserFacingError (title + hint) the server-action path threw, so the toast UX is
 * identical whether the write ran natively or on the legacy path. Non-matching
 * errors pass through unchanged.
 */
const ASSET_WRITE_ERROR_MAP: Record<
  string,
  { title: string; message: string; hint?: string }
> = {
  ASSET_IN_USE: {
    title: "Cannot delete",
    message: "This asset is referenced by project line items.",
    hint: "Archive it instead so the history stays intact.",
  },
  ASSET_IN_KIT: {
    title: "Cannot delete",
    message: "This asset is part of a kit.",
    hint: "Remove it from the kit first, then delete.",
  },
  ASSET_HAS_ACCESSORIES: {
    title: "Cannot delete",
    message: "This asset has accessories attached.",
    hint: "Detach its accessories first, then delete.",
  },
  DUPLICATE_ASSET_TAG: {
    title: "Duplicate asset tag",
    message: "That asset tag already exists.",
    hint: "Use a different asset tag.",
  },
  // Line-item removeNative guards (mirror src/server/line-items.ts).
  NOT_FOUND: {
    title: "Line item not found",
    message: "This item was deleted by someone else. Refresh the page.",
  },
  KIT_CHILD: {
    title: "Cannot remove this item",
    message: "This item is part of a Kit.",
    hint: "Remove the Kit from the project instead — that will remove all its members at once.",
  },
  ACCESSORY_CHILD: {
    title: "Cannot remove this item",
    message: "This item is an accessory of another asset.",
    hint: "Remove the parent asset's line to remove it, or detach the accessory from the asset in the catalog.",
  },
};

export function mapAssetWriteError(e: unknown): unknown {
  if (
    e instanceof ConvexError &&
    e.data &&
    typeof e.data === "object" &&
    "code" in e.data &&
    typeof (e.data as { code: unknown }).code === "string"
  ) {
    const code = (e.data as { code: string }).code;
    const mapped = ASSET_WRITE_ERROR_MAP[code];
    if (mapped) {
      // Prefer the mutation's own message (some carry dynamic detail, e.g. the
      // offending asset tag) over the static fallback.
      const dyn = (e.data as { message?: unknown }).message;
      const message = typeof dyn === "string" && dyn ? dyn : mapped.message;
      return new UserFacingError({ code, title: mapped.title, message, hint: mapped.hint });
    }
  }
  return e;
}

/**
 * Domain-agnostic alias — the DUPLICATE_ASSET_TAG mapping is shared by the kit
 * write path (kits reject duplicate tags with the same code).
 */
export const mapNativeWriteError = mapAssetWriteError;
