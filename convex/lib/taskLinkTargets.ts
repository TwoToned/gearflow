import { ConvexError } from "convex/values";
import type { MutationCtx, QueryCtx } from "../_generated/server";

/**
 * What a task link may point at (UX Phase 10 Slice E): ONE place for the kinds, the
 * per-task cap and the "does this target belong to this job and org" check, used by
 * the link write (and the unlink Undo) and by the reads that resolve a link.
 */
export type LinkKind = "lineItem" | "file" | "discussion";
export const MAX_LINKS_PER_TASK = 25;

const WORDS: Record<LinkKind, string> = { lineItem: "line item", file: "file", discussion: "discussion" };
export const linkTargetLabel = (kind: LinkKind): string => WORDS[kind];

/**
 * The target's display label when it is THIS org's and THIS job's, else throws. Every
 * lookup is by a GLOBAL index (`by_cuid`) or a Convex id, so each row is org- and
 * project-checked here; a link can never reach another org's or another job's row.
 */
export async function assertLinkTarget(ctx: MutationCtx | QueryCtx, orgId: string, projectId: string, kind: LinkKind, linkedId: string): Promise<string> {
  const label = await targetLabel(ctx, orgId, projectId, kind, linkedId);
  if (label === null) throw new ConvexError(`That ${WORDS[kind]} is not on this job`);
  return label;
}

/** The label, or `null` when the target is missing / another org's / another job's. */
export async function targetLabel(ctx: MutationCtx | QueryCtx, orgId: string, projectId: string, kind: LinkKind, linkedId: string): Promise<string | null> {
  if (kind === "lineItem") return lineItemLabel(ctx, orgId, projectId, linkedId);
  if (kind === "file") return fileLabel(ctx, orgId, projectId, linkedId);
  return discussionLabel(ctx, orgId, projectId, linkedId);
}

type Ctx = MutationCtx | QueryCtx;

async function lineItemLabel(ctx: Ctx, orgId: string, projectId: string, id: string): Promise<string | null> {
  const li = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", id)).first();
  if (!li || li.organizationId !== orgId || li.projectId !== projectId) return null;
  return li.description ?? "Line item";
}

async function fileLabel(ctx: Ctx, orgId: string, projectId: string, id: string): Promise<string | null> {
  const m = await ctx.db.query("projectMedia").withIndex("by_cuid", (q) => q.eq("id", id)).first();
  if (!m || m.organizationId !== orgId || m.projectId !== projectId) return null;
  if (m.displayName) return m.displayName;
  const f = await ctx.db.query("fileUploads").withIndex("by_cuid", (q) => q.eq("id", m.fileId)).first();
  return f && f.organizationId === orgId ? f.fileName : "File";
}

async function discussionLabel(ctx: Ctx, orgId: string, projectId: string, id: string): Promise<string | null> {
  const threadId = ctx.db.normalizeId("commentThreads", id);
  const t = threadId ? await ctx.db.get(threadId) : null;
  if (!t || t.orgId !== orgId) return null;
  return t.projectId === projectId || t.entityId === projectId ? "Discussion" : null;
}
