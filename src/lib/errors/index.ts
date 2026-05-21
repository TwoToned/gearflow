/**
 * Error infrastructure for user-facing error contexts (Wave 2 Item 2.A).
 *
 * Server side: wrap mutating server actions with `withAction` to translate
 * Prisma errors into structured UserFacingError instances and re-throw, so
 * the existing useMutation onError pattern keeps working.
 *
 * Client side: use `showError(e)` instead of `toast.error(e.message)` to get
 * a structured toast (title + message + optional hint + retry action).
 *
 * Existing error subclasses (TestTagBlockError, InventoryError) continue to
 * work and propagate up as-is — clients can branch on their `code`/`name`.
 */

export { UserFacingError, isUserFacingError } from "./user-facing-error";
export { translatePrismaError } from "./prisma-translator";
export { TestTagBlockError } from "./test-tag-block-error";
export { withAction } from "./with-action";
