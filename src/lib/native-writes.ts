import { ConvexError } from "convex/values";
// Import from the concrete module, NOT the "@/lib/errors" barrel: the barrel also
// re-exports `withAction` (a server-action wrapper) + the Prisma translator, and this
// module is imported by client hooks (use-line-item-writes / use-native-project-writes).
// Pulling the barrel into a small client chunk drags that server code in and trips
// Turbopack's scope-hoist merge (`EcmascriptModuleContent::new_merged failed`).
import { UserFacingError } from "@/lib/errors/user-facing-error";

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
 * Collapse the project-totals recalc (recalculateProjectTotals) from ~3 sequential
 * server→Convex-Cloud round-trips into ONE backend-local `recalcNative` mutation.
 * Every write across the app funnels through recalculateProjectTotals, so this one
 * flag speeds up ALL user-facing writes (line-items, groups, services, sub-hires,
 * project edits) — the fix for the 6–12s edit/delete tail. Default OFF.
 */
export const nativeRecalc = (): boolean =>
  process.env.NATIVE_RECALC === "true";

// Audit log is now Convex-only (write + read); the NATIVE_ACTIVITY_WRITES/READS
// cutover flags were removed once the Postgres activity_log table was frozen.

/**
 * Phase 6b — route post-write email side-effects through the Convex durable,
 * idempotent scheduler (`api.emails.enqueue` → `internal.emailActions.deliver`)
 * instead of an inline `sendEmail()` on the request path. Server-side runtime env
 * (Coolify, no rebuild), default OFF. Flip only after the Convex deployment has
 * `RESEND_API_KEY` + `EMAIL_FROM` set and a preview dogfood confirms delivery.
 */
export const nativeEmailSideEffects = (): boolean =>
  process.env.NATIVE_EMAIL_SIDEEFFECTS === "true";

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
    // Shared code across the asset-DELETE path (convex/assetWrites.ts) and the line-item
    // ADD path (convex/lineItemWrites.ts addNative). These are the DELETE-context static
    // fallbacks; the add path passes its own dynamic title/message/hint (all three are
    // preferred over these statics — see mapAssetWriteError), so neither context regresses.
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
  // Line-item availability guards (mirror src/server/line-items.ts). All carry a
  // dynamic message (and ASSET_UNAVAILABLE / INSUFFICIENT_STOCK a dynamic hint) from
  // the mutation; these are the static fallbacks / titles.
  INSUFFICIENT_STOCK: {
    title: "Not enough available",
    message: "Not enough stock is free during those dates.",
    hint: "Reduce the quantity, change the dates, or add a sub-hire to cover the gap.",
  },
  ASSET_DOUBLE_BOOKED: {
    title: "Asset already booked",
    message: "This asset is already booked during those dates.",
    hint: "Pick a different asset, adjust the rental dates, or remove it from the other project.",
  },
  ASSET_UNAVAILABLE: {
    title: "Asset cannot be added",
    message: "This asset is unavailable.",
    hint: "Pick a different asset.",
  },
  KIT_UNAVAILABLE: {
    title: "Kit cannot be added",
    message: "This kit is unavailable.",
    hint: "Pick a different kit.",
  },
  KIT_DOUBLE_BOOKED: {
    title: "Kit already booked",
    message: "This kit is already booked during those dates.",
    hint: "Pick a different kit, adjust the rental dates, or remove it from the other project.",
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
      // Prefer the mutation's own hint + title too (e.g. LOST vs RETIRED guidance, the
      // stock-breakdown detail, or the add-vs-delete context of a shared code like
      // ASSET_IN_KIT) over the static fallback — mirrors the message rule.
      const dynHint = (e.data as { hint?: unknown }).hint;
      const hint = typeof dynHint === "string" && dynHint ? dynHint : mapped.hint;
      const dynTitle = (e.data as { title?: unknown }).title;
      const title = typeof dynTitle === "string" && dynTitle ? dynTitle : mapped.title;
      return new UserFacingError({ code, title, message, hint });
    }
  }
  return e;
}

/**
 * Domain-agnostic alias — the DUPLICATE_ASSET_TAG mapping is shared by the kit
 * write path (kits reject duplicate tags with the same code).
 */
export const mapNativeWriteError = mapAssetWriteError;
