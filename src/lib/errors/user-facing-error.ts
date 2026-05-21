/**
 * Base class for any error that should show CONTEXT to the user rather than
 * a raw exception message. Wave 2 Item 2.A.
 *
 * The convention:
 *   - `title`: 2-5 words, what category of failure. "Duplicate asset tag",
 *     "Asset not available", "Permission denied".
 *   - `message`: the imperative sentence explaining what went wrong, in plain
 *     English. No stack trace, no SQL fragments, no Prisma error codes.
 *   - `hint?`: optional one-liner explaining how to fix it. "Try a different
 *     tag or update the existing asset."
 *   - `code`: stable machine-readable code so the client can branch on it.
 *     Use SCREAMING_SNAKE.
 *
 * Subclasses should call super() with the user-facing message — that becomes
 * `error.message` for any consumer that just reads .message (toast.error(e.message)
 * remains a sensible fallback while we migrate).
 */
export class UserFacingError extends Error {
  readonly code: string;
  readonly title: string;
  readonly hint?: string;
  /** Field path for form-level errors, e.g. "assetTag" — lets the form
   * surface the error next to the right input. */
  readonly field?: string;

  constructor(opts: {
    code: string;
    title: string;
    message: string;
    hint?: string;
    field?: string;
  }) {
    super(opts.message);
    this.name = "UserFacingError";
    this.code = opts.code;
    this.title = opts.title;
    this.hint = opts.hint;
    this.field = opts.field;
  }

  /** Plain-object form for serialization across the server-action boundary. */
  toJSON() {
    return {
      __userFacing: true,
      code: this.code,
      title: this.title,
      message: this.message,
      hint: this.hint,
      field: this.field,
    };
  }
}

/** Type guard for client code branching on this shape. */
export function isUserFacingError(e: unknown): e is UserFacingError {
  return e instanceof UserFacingError || (
    typeof e === "object" && e !== null && (e as Record<string, unknown>).__userFacing === true
  );
}
