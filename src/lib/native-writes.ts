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
};

export function mapAssetWriteError(e: unknown): unknown {
  if (
    e instanceof ConvexError &&
    e.data &&
    typeof e.data === "object" &&
    "code" in e.data &&
    typeof (e.data as { code: unknown }).code === "string"
  ) {
    const mapped = ASSET_WRITE_ERROR_MAP[(e.data as { code: string }).code];
    if (mapped) {
      return new UserFacingError({ code: (e.data as { code: string }).code, ...mapped });
    }
  }
  return e;
}
