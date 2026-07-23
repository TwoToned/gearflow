import { NextResponse } from "next/server";
import type { z } from "zod";
import { runWithRequestId } from "@/lib/request-context";

type ValidatedBody<T> =
  | { ok: true; data: T }
  | { ok: false; response: NextResponse };

/**
 * Read and schema-validate a JSON request body (POLICY.md R-8.6.4). Requiring a
 * schema argument is the point: no route can read a body without validating it.
 * Returns a discriminated result so callers keep their own auth/flow control:
 *
 *   const parsed = await readValidatedBody(request, z.object({ id: z.string() }));
 *   if (!parsed.ok) return parsed.response;
 *   const { id } = parsed.data;
 */
export async function readValidatedBody<T>(
  request: Request,
  schema: z.ZodType<T>,
): Promise<ValidatedBody<T>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return {
      ok: false,
      response: NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }),
    };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Invalid request body", details: parsed.error.flatten() },
        { status: 400 },
      ),
    };
  }
  return { ok: true, data: parsed.data };
}

/**
 * Structural counterpart to `readValidatedBody` (POLICY.md R-8.6.4): wraps a
 * route handler so the schema is REQUIRED by the function signature, not just
 * available. `readValidatedBody` still lets a route read `request.json()`
 * directly and skip it by accident; a handler built with `withValidatedBody`
 * physically cannot run without a schema — the body is parsed + validated
 * before `handler` is ever called, so an unvalidated route is a compile error
 * (missing the wrapper call), not a discipline lapse.
 *
 * Any pre-body checks (rate limiting, CSRF, auth) stay in the exported route
 * function — call the wrapped handler from there once those pass:
 *
 *   const create = withValidatedBody(createSchema, async (body, request) => {
 *     ...
 *     return NextResponse.json({ ok: true });
 *   });
 *   export async function POST(request: NextRequest) {
 *     const csrfError = validateCsrfOrigin(request);
 *     if (csrfError) return csrfError;
 *     return create(request);
 *   }
 */
export function withValidatedBody<T, C = undefined>(
  schema: z.ZodType<T>,
  handler: (body: T, request: Request, context: C) => Promise<Response>,
) {
  return async (request: Request, context?: C): Promise<Response> => {
    const parsed = await readValidatedBody(request, schema);
    if (!parsed.ok) return parsed.response;
    // Auto-thread the x-request-id correlation id (POLICY.md R-8.9.5) into every
    // logger.* call the handler makes, without the handler passing it explicitly.
    const requestId = request.headers.get("x-request-id");
    if (!requestId) return handler(parsed.data, request, context as C);
    return runWithRequestId(requestId, () => handler(parsed.data, request, context as C));
  };
}
