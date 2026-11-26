/**
 * The Team page's Undo token (UX Phase 17, D59). Team data lives in Better
 * Auth's Postgres tables, whose audit rows are best-effort Convex mirrors, so
 * an "ids only, read your own audit row" Undo has nowhere reliable to read from
 * and a schema change is not on the table. Instead the forward write returns a
 * SERVER-SIGNED token: the prior state, the state the write left, the actor, the
 * org and the server clock, sealed with HMAC-SHA256 (same primitive and key as
 * `xero-oauth-state.ts`). The client holds it opaquely and sends nothing else —
 * it cannot forge or edit a "restore to" value.
 *
 * Replay (the "once" rule) is enforced by `claimTeamUndo` in `team-writes.ts`
 * (an `undo:<id>` marker row), and every reverse is compare-and-set against the
 * state the forward write left.
 */
import crypto from "crypto";
import { z } from "zod";
import { env } from "@/env";
import { UNDO_WINDOW_MS } from "../../convex/lib/undoWindow";

const roleItem = z.object({ memberId: z.string().min(1).max(64), from: z.string().min(1).max(32), to: z.string().min(1).max(32) });
const revokeItem = z.object({ invitationId: z.string().min(1).max(64), expiresAt: z.number().int() });
const resendItem = z.object({
  invitationId: z.string().min(1).max(64),
  prevExpiresAt: z.number().int(),
  newExpiresAt: z.number().int(),
});

const teamUndoPayloadSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("role"), items: z.array(roleItem).min(1).max(100) }),
  z.object({ kind: z.literal("revoke"), items: z.array(revokeItem).min(1).max(100) }),
  z.object({ kind: z.literal("resend"), items: z.array(resendItem).min(1).max(100) }),
]);
export type TeamUndoPayload = z.infer<typeof teamUndoPayloadSchema>;

const envelopeSchema = z.object({
  id: z.string().min(8).max(64),
  orgId: z.string().min(1),
  actorId: z.string().min(1),
  iat: z.number().int(),
  body: teamUndoPayloadSchema,
});
export type TeamUndoEnvelope = z.infer<typeof envelopeSchema>;

class TeamUndoTokenError extends Error {}

// HMAC-SHA256 over a token payload, not a password hash (see xero-oauth-state.ts).
function sign(encoded: string): string {
  return crypto.createHmac("sha256", env.BETTER_AUTH_SECRET).update(encoded).digest("base64url"); // codeql[js/insufficient-password-hash]
}

export function createTeamUndoToken(input: { orgId: string; actorId: string; body: TeamUndoPayload; now?: number }): {
  token: string;
  id: string;
} {
  const id = crypto.randomBytes(12).toString("hex");
  const envelope: TeamUndoEnvelope = { id, orgId: input.orgId, actorId: input.actorId, iat: input.now ?? Date.now(), body: input.body };
  const encoded = Buffer.from(JSON.stringify(envelope)).toString("base64url");
  return { token: `${encoded}.${sign(encoded)}`, id };
}

/** Verify signature, shape and the server-clock window. Throws on any problem. */
export function verifyTeamUndoToken(token: string, now: number = Date.now()): TeamUndoEnvelope {
  const parts = token.split(".");
  if (parts.length !== 2) throw new TeamUndoTokenError("That Undo is no longer valid.");
  const [encoded, signature] = parts;
  const sigBuf = Buffer.from(signature!, "base64url");
  const expBuf = Buffer.from(sign(encoded!), "base64url");
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    throw new TeamUndoTokenError("That Undo is no longer valid.");
  }
  let envelope: TeamUndoEnvelope;
  try {
    envelope = envelopeSchema.parse(JSON.parse(Buffer.from(encoded!, "base64url").toString("utf8")));
  } catch {
    throw new TeamUndoTokenError("That Undo is no longer valid.");
  }
  if (now - envelope.iat > UNDO_WINDOW_MS) {
    throw new TeamUndoTokenError("A team change can only be undone within 10 minutes of making it.");
  }
  return envelope;
}
