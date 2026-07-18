import { NextResponse } from "next/server";
import type { z } from "zod";

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
