"use server";

import { createId } from "@paralleldrive/cuid2";
import { getOrgContext, getCurrentRole } from "@/lib/org-context";
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import { prisma } from "@/lib/prisma";
import { generateApiKey } from "@/lib/api-key";
import { findApiKeyPreset } from "@/lib/api-key-presets";
import { encryptSecret, decryptSecret } from "@/lib/crypto/secret-vault";
import { dispatch } from "@/lib/api/dispatcher";
import type { ApiErrorEnvelope } from "@/lib/api/errors";
import { serialize } from "@/lib/serialize";
import type { MiraPageContext } from "@/lib/mira/types";
import { buildMiraSystemPrompt } from "@/lib/mira/system-prompt";
import { buildMiraTools, findMiraTool } from "@/lib/mira/tool-defs";
import { formatOrgSnapshot, type DashboardStatsBundle } from "@/lib/mira/org-snapshot";
import { runMiraAgentLoop, type ExecuteTool, type ToolExecOk, type ToolExecError, type PendingConfirmation } from "@/lib/mira/agent-loop";
import type { OpenRouterMessage } from "@/lib/mira/openrouter-client";
import { DEFAULT_MIRA_MODEL } from "@/lib/validations/mira-settings";

/**
 * Mira, the in-app assistant — now a real LLM tool-calling loop over the SAME
 * curated dispatch()/MCP surface an external agent would use (FEATUREDOCS/56),
 * not a separate code path. See FEATUREDOCS/68 for the full architecture.
 *
 * Mira acts AS the asking user via a per-(org, user) `apiKeys` row it
 * provisions itself on first use (`miraKeys` table) — never a fixed "system"
 * identity, so its effective permissions are exactly that user's own live
 * RBAC. Which PRESET it provisions (read-only vs write-capable) is decided by
 * the org's own admin-controlled setting (`miraOrgSettings.writeAccessEnabled`,
 * src/server/mira-settings.ts) — see convex/miraOrgSettings.ts `patch` for how
 * flipping that setting revokes and re-provisions every member's key.
 */

async function getOrProvisionMiraToken(organizationId: string, userId: string, writeAccessEnabled: boolean): Promise<string> {
  const convex = await getConvexClient();
  const existing = await convex.query(api.miraKeys.getForUser, { organizationId, userId });
  if (existing) return decryptSecret(existing.encryptedToken);

  const presetId = writeAccessEnabled ? "full_agent" : "read_only_agent";
  const preset = findApiKeyPreset(presetId)!;
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

const NOT_CONFIGURED_ANSWER =
  "Mira isn't set up for this org yet — ask an org admin to add an OpenRouter API key under " +
  "Settings → Mira AI Assistant.";

interface MiraLlmConfig {
  apiKey: string;
  model: string;
  writeAccessEnabled: boolean;
}

async function getMiraLlmConfig(organizationId: string): Promise<MiraLlmConfig | null> {
  const convex = await getConvexClient();
  const settings = await convex.query(api.miraOrgSettings.getForOrg, { organizationId });
  if (!settings?.openRouterKeyEncrypted) return null;
  return {
    apiKey: decryptSecret(settings.openRouterKeyEncrypted),
    model: settings.model || DEFAULT_MIRA_MODEL,
    writeAccessEnabled: settings.writeAccessEnabled,
  };
}

/** A dispatch() response → a ToolExecResult, including the
 *  CONFIRMATION_REQUIRED → needsConfirmation mapping. Split out from
 *  createExecuteTool's returned closure so this decision chain scores its
 *  own complexity instead of stacking onto it. */
function toToolExecResult(status: number, rawBody: unknown, operation: string, args: Record<string, unknown>, idempotencyKey: string | undefined) {
  if (status < 400) return { ok: true as const, data: (rawBody as { data: unknown }).data };

  const err = (rawBody as ApiErrorEnvelope).error;
  const isConfirmationRequired = err?.code === "CONFIRMATION_REQUIRED" && idempotencyKey;
  if (isConfirmationRequired) {
    const details = err.details as { summary?: string } | null;
    return {
      ok: false as const,
      needsConfirmation: true as const,
      pending: { operation, args, idempotencyKey, summary: details?.summary ?? err.message },
    };
  }
  return { ok: false as const, error: { message: err?.message ?? "Unknown error", code: err?.code } };
}

function createExecuteTool(tools: ReturnType<typeof buildMiraTools>, authorizationHeader: string): ExecuteTool {
  return async (toolName, args) => {
    const tool = findMiraTool(tools, toolName);
    if (!tool || !tool.operation) {
      return { ok: false, error: { message: `Unknown tool "${toolName}".`, code: "UNKNOWN_TOOL" } };
    }

    const idempotencyKey = tool.isWrite ? createId() : undefined;
    const requestId = createId();
    const result = await dispatch(tool.operation, { args, idempotencyKey }, authorizationHeader, requestId);
    return toToolExecResult(result.status, result.body, tool.operation, args, idempotencyKey);
  };
}

// ─── Conversation persistence ────────────────────────────────────────────

interface MiraMessageRow {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string | null;
  toolCalls?: OpenRouterMessage["tool_calls"];
  toolCallId?: string;
  toolName?: string;
  pendingConfirmation?: PendingConfirmation | null;
  createdAt: number;
}

function rowToModelMessage(row: MiraMessageRow): OpenRouterMessage {
  return {
    role: row.role,
    content: row.content,
    ...(row.toolCalls?.length ? { tool_calls: row.toolCalls } : {}),
    ...(row.toolCallId ? { tool_call_id: row.toolCallId } : {}),
    ...(row.toolName ? { name: row.toolName } : {}),
  };
}

const MAX_HISTORY_TURNS = 12;

/** Cap history to the last N user-initiated turns WITHOUT splitting an
 *  assistant/tool exchange in half — a truncated "tool" message with no
 *  matching preceding assistant tool_calls is an invalid message sequence
 *  for the chat-completions API. */
function capHistory(rows: MiraMessageRow[]): MiraMessageRow[] {
  const turnStarts: number[] = [];
  rows.forEach((m, i) => {
    if (m.role === "user") turnStarts.push(i);
  });
  if (turnStarts.length <= MAX_HISTORY_TURNS) return rows;
  const startIdx = turnStarts[turnStarts.length - MAX_HISTORY_TURNS]!;
  return rows.slice(startIdx);
}

async function getOrCreateActiveConversation(organizationId: string, userId: string): Promise<{ id: string }> {
  const convex = await getConvexClient();
  const existing = await convex.query(api.miraConversations.getActiveForUser, { organizationId, userId });
  if (existing) return existing;
  const id = createId();
  await convex.mutation(api.miraConversations.create, { id, organizationId, userId, createdAt: Date.now() });
  return { id };
}

interface PersistMessageInput {
  conversationId: string;
  organizationId: string;
  userId: string;
  message: OpenRouterMessage;
  pendingConfirmation?: PendingConfirmation | null;
}

async function persistMessage(input: PersistMessageInput): Promise<MiraMessageRow> {
  const convex = await getConvexClient();
  const id = createId();
  const createdAt = Date.now();
  const row: MiraMessageRow = {
    id,
    role: input.message.role as "user" | "assistant" | "tool",
    content: input.message.content,
    toolCalls: input.message.tool_calls,
    toolCallId: input.message.tool_call_id,
    toolName: input.message.name,
    pendingConfirmation: input.pendingConfirmation ?? null,
    createdAt,
  };
  await convex.mutation(api.miraMessages.append, {
    id,
    conversationId: input.conversationId,
    organizationId: input.organizationId,
    userId: input.userId,
    role: row.role,
    content: row.content,
    toolCalls: row.toolCalls,
    toolCallId: row.toolCallId,
    toolName: row.toolName,
    pendingConfirmation: row.pendingConfirmation,
    createdAt,
  });
  return row;
}

/** Best-effort — a snapshot fetch failure (e.g. counters not yet seeded, or
 *  this user's role can't read `project`) should never block the conversation,
 *  it just means the prompt goes out without that section. */
async function fetchOrgSnapshot(authorizationHeader: string): Promise<string> {
  try {
    // `now`/`orgId` are auto-injected by the dispatcher from the token itself
    // (src/lib/api/arg-normalizer.ts) — never supplied by the caller.
    const result = await dispatch("dashboardStats.bundle", { args: {} }, authorizationHeader, createId());
    if (result.status >= 400) return "";
    const stats = (result.body as { data: DashboardStatsBundle }).data;
    return formatOrgSnapshot(stats);
  } catch {
    return "";
  }
}

async function buildSystemPromptFor(
  organizationId: string,
  userId: string,
  userName: string,
  canWrite: boolean,
  pageContext: MiraPageContext | null,
  authorizationHeader: string,
) {
  const [org, role, orgSnapshot] = await Promise.all([
    prisma.organization.findUnique({ where: { id: organizationId }, select: { name: true } }),
    getCurrentRole(),
    fetchOrgSnapshot(authorizationHeader),
  ]);
  return buildMiraSystemPrompt({
    organizationName: org?.name ?? "your org",
    userName,
    userRole: role ?? "member",
    canWrite,
    pageContext,
    orgSnapshot,
  });
}

// ─── Public server actions (UI) ────────────────────────────────────────────

export interface MiraConversationView {
  conversationId: string | null;
  messages: MiraMessageRow[];
}

export async function getMiraConversation(): Promise<MiraConversationView> {
  const { organizationId, userId } = await getOrgContext();
  const convex = await getConvexClient();
  const conversation = await convex.query(api.miraConversations.getActiveForUser, { organizationId, userId });
  if (!conversation) return serialize({ conversationId: null, messages: [] });
  const rows = await convex.query(api.miraMessages.listForConversation, { conversationId: conversation.id, organizationId });
  return serialize({ conversationId: conversation.id, messages: rows as MiraMessageRow[] });
}

export async function clearMiraConversation(): Promise<void> {
  const { organizationId, userId } = await getOrgContext();
  const convex = await getConvexClient();
  const conversation = await convex.query(api.miraConversations.getActiveForUser, { organizationId, userId });
  if (conversation) await convex.mutation(api.miraConversations.archive, { id: conversation.id, organizationId, userId });
}

export interface SendMiraMessageResult {
  conversationId: string | null;
  newMessages: MiraMessageRow[];
}

export async function sendMiraMessage(question: string, pageContext: MiraPageContext | null): Promise<SendMiraMessageResult> {
  const { organizationId, userId, userName } = await getOrgContext();
  const trimmed = question?.trim();
  if (!trimmed) throw new Error("Ask Mira something first.");

  const config = await getMiraLlmConfig(organizationId);
  if (!config) return serialize({ conversationId: null, newMessages: [{ id: createId(), role: "assistant", content: NOT_CONFIGURED_ANSWER, createdAt: Date.now() }] });

  const rawToken = await getOrProvisionMiraToken(organizationId, userId, config.writeAccessEnabled);
  const preset = findApiKeyPreset(config.writeAccessEnabled ? "full_agent" : "read_only_agent")!;
  const tools = buildMiraTools({ includeWrites: config.writeAccessEnabled, grantedScopes: new Set(preset.scopes) });

  const conversation = await getOrCreateActiveConversation(organizationId, userId);
  const convex = await getConvexClient();
  const priorRows = (await convex.query(api.miraMessages.listForConversation, {
    conversationId: conversation.id,
    organizationId,
  })) as MiraMessageRow[];

  const systemPrompt = await buildSystemPromptFor(organizationId, userId, userName, config.writeAccessEnabled, pageContext, `Bearer ${rawToken}`);
  const userMessage: OpenRouterMessage = { role: "user", content: trimmed };

  const messages: OpenRouterMessage[] = [
    { role: "system", content: systemPrompt },
    ...capHistory(priorRows).map(rowToModelMessage),
    userMessage,
  ];

  const executeTool = createExecuteTool(tools, `Bearer ${rawToken}`);
  const result = await runMiraAgentLoop({ apiKey: config.apiKey, model: config.model, messages, tools, executeTool });

  const persistedUser = await persistMessage({ conversationId: conversation.id, organizationId, userId, message: userMessage });
  const persisted: MiraMessageRow[] = [persistedUser];
  for (let i = 0; i < result.appended.length; i++) {
    const isLast = i === result.appended.length - 1;
    const msg = result.appended[i]!;
    persisted.push(
      await persistMessage({
        conversationId: conversation.id,
        organizationId,
        userId,
        message: msg,
        pendingConfirmation: isLast && msg.role === "assistant" ? result.pendingConfirmation : null,
      }),
    );
  }
  await convex.mutation(api.miraConversations.touch, { id: conversation.id, organizationId });

  return serialize({ conversationId: conversation.id, newMessages: persisted });
}

function toolExecResultFromDispatch(status: number, body: unknown): ToolExecOk | ToolExecError {
  if (status < 400) return { ok: true, data: (body as { data: unknown }).data };
  const err = (body as ApiErrorEnvelope).error;
  return { ok: false, error: { message: err?.message ?? "Unknown error", code: err?.code } };
}

export async function confirmMiraPendingAction(messageId: string): Promise<SendMiraMessageResult> {
  const { organizationId, userId, userName } = await getOrgContext();
  const convex = await getConvexClient();

  const message = (await convex.query(api.miraMessages.getById, { id: messageId, organizationId })) as MiraMessageRow | null;
  if (!message || message.pendingConfirmation == null) {
    throw new Error("There's nothing pending confirmation on that message.");
  }
  const pending = message.pendingConfirmation;

  const conversation = await convex.query(api.miraConversations.getActiveForUser, { organizationId, userId });
  if (!conversation) throw new Error("No active Mira conversation.");

  const config = await getMiraLlmConfig(organizationId);
  if (!config) return serialize({ conversationId: conversation.id, newMessages: [] });

  const rawToken = await getOrProvisionMiraToken(organizationId, userId, config.writeAccessEnabled);
  const requestId = createId();
  const result = await dispatch(pending.operation, { args: pending.args, idempotencyKey: pending.idempotencyKey, confirm: true }, `Bearer ${rawToken}`, requestId);
  const execResult = toolExecResultFromDispatch(result.status, result.body);

  await convex.mutation(api.miraMessages.clearPendingConfirmation, { id: messageId, organizationId });

  // A synthetic "user" turn carrying the confirmed outcome — NOT a `tool`
  // message, since the original tool_call_id was already closed out by the
  // CONFIRMATION_REQUIRED result persisted earlier in this same conversation
  // (a chat-completions tool_call_id may only be answered once).
  const noteMessage: OpenRouterMessage = {
    role: "user",
    content: execResult.ok
      ? `[Confirmed] The pending action ran successfully. Result: ${JSON.stringify(execResult.data).slice(0, 2000)}`
      : `[Confirmed] The pending action was attempted but failed: ${execResult.error.message}`,
  };

  const preset = findApiKeyPreset(config.writeAccessEnabled ? "full_agent" : "read_only_agent")!;
  const tools = buildMiraTools({ includeWrites: config.writeAccessEnabled, grantedScopes: new Set(preset.scopes) });
  const priorRows = (await convex.query(api.miraMessages.listForConversation, { conversationId: conversation.id, organizationId })) as MiraMessageRow[];
  const systemPrompt = await buildSystemPromptFor(organizationId, userId, userName, config.writeAccessEnabled, null, `Bearer ${rawToken}`);

  const messages: OpenRouterMessage[] = [{ role: "system", content: systemPrompt }, ...capHistory(priorRows).map(rowToModelMessage), noteMessage];
  const executeTool = createExecuteTool(tools, `Bearer ${rawToken}`);
  const loopResult = await runMiraAgentLoop({ apiKey: config.apiKey, model: config.model, messages, tools, executeTool });

  const persistedNote = await persistMessage({ conversationId: conversation.id, organizationId, userId, message: noteMessage });
  const persisted: MiraMessageRow[] = [persistedNote];
  for (let i = 0; i < loopResult.appended.length; i++) {
    const isLast = i === loopResult.appended.length - 1;
    const msg = loopResult.appended[i]!;
    persisted.push(
      await persistMessage({
        conversationId: conversation.id,
        organizationId,
        userId,
        message: msg,
        pendingConfirmation: isLast && msg.role === "assistant" ? loopResult.pendingConfirmation : null,
      }),
    );
  }
  await convex.mutation(api.miraConversations.touch, { id: conversation.id, organizationId });

  return serialize({ conversationId: conversation.id, newMessages: persisted });
}

export async function dismissMiraPendingAction(messageId: string): Promise<void> {
  const { organizationId } = await getOrgContext();
  const convex = await getConvexClient();
  await convex.mutation(api.miraMessages.clearPendingConfirmation, { id: messageId, organizationId });
}
