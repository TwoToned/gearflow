import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { api } from "../../../../../../convex/_generated/api";
import { withValidatedBody } from "@/lib/api-validation";
import { getAmbientRequestId } from "@/lib/request-context";
import { lineItemSchema } from "@/lib/validations/line-item";
import { authenticateAgentRequest, parseBearerToken } from "@/lib/api/agent-auth";
import { deriveWriteIds, hashArgs } from "@/lib/api/idempotency";
import { statusForError, toErrorEnvelope } from "@/lib/api/errors";

/**
 * PHASE 0 PATTERN-PROVER — the one throwaway route (#996).
 *
 * Deliberately hard-coded and deliberately narrow: one operation, no registry, no
 * OpenAPI, no MCP, no typed aliases. Phase 2 replaces it wholesale with the
 * universal dispatcher at `/api/v1/ops/{operation}`, and this file goes away.
 *
 * Its job is to make the vertical REAL rather than notional — bearer key → agent
 * token → `lineItemWrites.addNative` — so the eight assertions in
 * `convex/agentVertical.test.ts` describe a path that a request can actually take,
 * and so the shape of every Phase-2 decision is settled by something that works
 * instead of by argument:
 *
 *   • auth: bearer only, so CSRF is structurally N/A (R-8.11.1) — there is no
 *     cookie path into this route;
 *   • authorization: NOT here. RBAC, scopes, project locks, overbooking and audit
 *     all happen inside the Convex mutation, under the agent token. This route
 *     does not check a single gate, and that is the entire point of the design;
 *   • normalization: the ~7 injected args (§8) are set server-side from the key
 *     context and the clock. `organizationId` in particular is taken from the KEY,
 *     never the body;
 *   • idempotency: `id`/`auditId` derived deterministically from the caller's key,
 *     so a retry cannot double-write even if the ledger is stale (§9);
 *   • errors: one envelope, mapped from the ConvexError the guards already throw.
 *
 * `runtime = "nodejs"` because the token minter uses node:crypto via Better Auth.
 */
export const runtime = "nodejs";

/**
 * The agent-facing body: the BUSINESS fields only. Every injected arg
 * (`actor`, `id`, `auditId`, `now`, `organizationId`, `emitSideEffects`) is
 * absent by construction, so a caller cannot supply one — which is how "the
 * client never originates identity, time, or org" is enforced rather than
 * documented.
 *
 * `fields` reuses `lineItemSchema` (the same schema the UI form runs), so the API
 * inherits every business bound instead of relying on the in-Convex `fieldGuards`
 * backstop alone. Phase 2 generalises this into the validation registry (§8).
 */
const bodySchema = z.object({
  projectId: z.string().min(1),
  fields: lineItemSchema,
  includeAccessories: z.boolean().default(false),
  /** Softens the availability check. Accepted, but the Convex guard rejects it
   *  unless the key holds `project:allow_overbook` — forcing it here AND asserting
   *  there is stronger than stripping it, because a leaked token could call Convex
   *  directly (§6). */
  allowOverbook: z.boolean().default(false),
  /** Required once the project is ON_SITE+ with no unlock session open (§6). */
  justification: z.string().min(10).max(1000).optional(),
  /** Required: every agent write is idempotent. */
  idempotencyKey: z.string().min(8).max(200),
});

const OPERATION = "line_item.add";

const handler = withValidatedBody(bodySchema, async (body, request) => {
  const requestId = getAmbientRequestId() ?? null;

  const rawToken = parseBearerToken(request.headers.get("authorization"));
  if (!rawToken) {
    return NextResponse.json(
      toErrorEnvelope(
        Object.assign(new Error("Missing bearer token."), { code: "MISSING_CREDENTIALS" }),
        { requestId },
      ),
      { status: 401 },
    );
  }

  try {
    const { key, actor, client } = await authenticateAgentRequest(rawToken);

    // Deterministic ids: the same idempotency key + operation always derive the
    // same row ids, so a retry is rejected by addNative's own duplicate guard
    // rather than silently creating a second line (§9, decision 8).
    const { id, auditId } = deriveWriteIds(body.idempotencyKey, OPERATION);

    const result = await client.mutation(api.lineItemWrites.addNative, {
      id,
      auditId,
      // From the KEY, never the body — a caller naming another org gets its own
      // org's write, not a cross-tenant one, and the Convex guard rejects the
      // mismatch anyway.
      organizationId: key.organizationId,
      projectId: body.projectId,
      fields: body.fields,
      includeAccessories: body.includeAccessories,
      allowOverbook: body.allowOverbook,
      justification: body.justification,
      // Re-pinned by `resolveActor` against the verified token subject regardless
      // of what we send; supplied so the display name is right on first write.
      actor: { userId: actor.userId, userName: actor.userName },
      now: Date.now(),
    });

    return NextResponse.json(
      { data: result, requestId, argsHash: hashArgs(body) },
      { status: 201 },
    );
  } catch (error) {
    return NextResponse.json(toErrorEnvelope(error, { requestId }), {
      status: statusForError(error),
    });
  }
});

export async function POST(request: NextRequest) {
  return handler(request);
}
