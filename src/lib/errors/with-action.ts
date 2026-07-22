/**
 * Server-action wrapper that catches raw Prisma errors and re-throws them as
 * UserFacingError. Apply incrementally — adding `withAction` to a server fn
 * is a zero-risk change for happy paths, and turns "Unique constraint failed
 * on the fields: (`assetTag`)" into "That asset tag is already used."
 *
 * Usage:
 *
 *   export const createAsset = withAction(async function createAsset(input) {
 *     // ... your action body
 *   });
 *
 * Errors already typed as UserFacingError, TestTagBlockError, or
 * InventoryError pass through unchanged — they're already structured.
 * Anything else gets a translation attempt; if that fails, the original
 * error rethrows so unexpected failures still surface in logs and PostHog.
 */

import { translatePrismaError } from "./prisma-translator";
import { isUserFacingError } from "./user-facing-error";

// Marker names of existing structured errors that should pass through unchanged.
const STRUCTURED_ERROR_NAMES = new Set([
  "UserFacingError",
  "TestTagBlockError",
  "InventoryError",
]);

export function withAction<TArgs extends unknown[], TReturn>(
  fn: (...args: TArgs) => Promise<TReturn>,
): (...args: TArgs) => Promise<TReturn> {
  return async (...args: TArgs) => {
    try {
      return await fn(...args);
    } catch (e) {
      // Already structured — pass through.
      if (isUserFacingError(e)) throw e;
      if (e instanceof Error && STRUCTURED_ERROR_NAMES.has(e.name)) throw e;

      // Prisma → UserFacingError.
      const translated = translatePrismaError(e);
      if (translated) throw translated;

      // Unknown — let it bubble. PostHog / global handler will catch.
      throw e;
    }
  };
}
