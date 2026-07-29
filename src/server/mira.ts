"use server";

import { createId } from "@paralleldrive/cuid2";
import { getOrgContext } from "@/lib/org-context";
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import { generateApiKey } from "@/lib/api-key";
import { findApiKeyPreset } from "@/lib/api-key-presets";
import { encryptSecret, decryptSecret } from "@/lib/crypto/secret-vault";
import { dispatch } from "@/lib/api/dispatcher";
import { serialize } from "@/lib/serialize";
import { routeMiraQuestion, type MiraPageContext } from "@/lib/mira/intent-router";
import { formatMiraAnswer } from "@/lib/mira/format-answer";

/**
 * Mira as the first first-party MCP consumer (Phase 8, #1004). `askMira`
 * answers a page-contextual question by calling the SAME curated
 * dispatch()/MCP surface an external agent would — see FEATUREDOCS/56 and
 * src/lib/mira/intent-router.ts for what "answers" means today (a small
 * deterministic router, not an LLM — the plumbing this phase asked for).
 *
 * Mira acts AS the asking user, via a per-(org, user) `apiKeys` row it
 * provisions itself on first use (`miraKeys` table, convex/miraKeys.ts) —
 * never a fixed "system" identity, so its effective permissions are exactly
 * that user's own live RBAC, identical to every other agent token. The
 * `read_only_agent` preset (the same one "Connect an AI Agent" uses) is
 * reused rather than inventing a new scope set (R-3.1).
 *
 * Deliberately provisioned via the raw Convex mutations rather than the
 * `createApiKey` server action: that action requires `orgSettings:update`
 * (an admin managing OTHER people's keys), but any org member should be able
 * to ask Mira a question. This is safe specifically because the preset is
 * fixed and read-only and the key always acts as the CALLER — a member can
 * never get more access through Mira than their own role already grants.
 * For the same reason this path does NOT fire `api_key.created` — that
 * webhook is for keys an operator deliberately created, not Mira's silent
 * internal plumbing.
 */
async function getOrProvisionMiraToken(organizationId: string, userId: string): Promise<string> {
  const convex = await getConvexClient();
  const existing = await convex.query(api.miraKeys.getForUser, { organizationId, userId });
  if (existing) return decryptSecret(existing.encryptedToken);

  const preset = findApiKeyPreset("read_only_agent")!;
  const { raw, prefix, tokenHash } = generateApiKey();
  const id = createId();
  const now = Date.now();

  await convex.mutation(api.apiKeys.create, {
    id,
    organizationId,
    name: "Mira Assistant",
    prefix,
    tokenHash,
    scopes: JSON.stringify(preset.scopes),
    isActive: true,
    actingUserId: userId,
    createdById: userId,
    createdAt: now,
    noFinancials: preset.noFinancialsDefault,
  });
  await convex.mutation(api.miraKeys.create, {
    organizationId,
    userId,
    apiKeyId: id,
    encryptedToken: encryptSecret(raw),
    createdAt: now,
  });

  return raw;
}

const NO_ROUTE_ANSWER =
  "I can look up the project you're currently viewing, or list your org's assets — try asking about " +
  "a project, or say \"list assets\".";

export async function askMira(question: string, pageContext: MiraPageContext | null) {
  const { organizationId, userId } = await getOrgContext();

  const trimmed = question?.trim();
  if (!trimmed) throw new Error("Ask Mira something first.");

  const route = routeMiraQuestion(trimmed, pageContext);
  if (!route) {
    return serialize({ answer: NO_ROUTE_ANSWER, operation: null });
  }

  const rawToken = await getOrProvisionMiraToken(organizationId, userId);
  const requestId = createId();
  const result = await dispatch(route.operation, { args: route.args }, `Bearer ${rawToken}`, requestId);

  if (result.status >= 400) {
    const body = result.body as { error?: { message?: string } };
    return serialize({
      answer: `I couldn't fetch that: ${body.error?.message ?? "an unexpected error occurred"}.`,
      operation: route.operation,
    });
  }

  const { data } = result.body as { data: unknown };
  return serialize({ answer: formatMiraAnswer(route.operation, data), operation: route.operation });
}
