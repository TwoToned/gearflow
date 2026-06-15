import { type FunctionReference } from "convex/server";
import { getConvexClient, toConvexDoc } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";

/**
 * document_template and service_template are DUAL-WRITTEN: every create/update/
 * delete writes the Prisma row (the durable source the PDF pipeline + project
 * services read cross-domain) AND mirrors to the matching Convex table. Prisma is
 * written first; the Convex payload is derived from the written row via toConvexDoc
 * so the two can't drift; the backfill doubles as the heal path.
 *
 * Dual-write (not hard cutover) despite NO inbound FKs, because document_template
 * is read all over the PDF pipeline (build-document-data) — a hard cutover would
 * force a gratuitous PDF-pipeline rewrite. Like the other 0-row PDF/doc-coupled
 * domains (brand_template, section_preset), this is **infra-only**: the write paths
 * are mirrored + backfilled, but the template-management UIs stay on the
 * server-action reads over the fresh Prisma mirror for now (document settings has
 * gnarly virtual-system-default composition; both are 0-row, low-traffic). The
 * Convex CRUD + reactive hooks can be wired when those UIs go reactive. See
 * FEATUREDOCS/54.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRef = FunctionReference<"mutation", "public", any, any>;

async function create(fn: AnyRef, row: Record<string, unknown>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (await getConvexClient()).mutation(fn, toConvexDoc(row) as any);
}

async function patch(fn: AnyRef, id: string, row: Record<string, unknown>) {
  const { id: _id, ...rest } = toConvexDoc(row);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (await getConvexClient()).mutation(fn, { id, patch: rest } as any);
}

async function remove(fn: AnyRef, id: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (await getConvexClient()).mutation(fn, { id } as any);
}

// ─── Document templates ──────────────────────────────────────────────────────
export const mirrorDocumentTemplateCreate = (row: Record<string, unknown>) => create(api.documentTemplates.createIfMissing, row);
export const patchDocumentTemplateInConvex = (id: string, row: Record<string, unknown>) => patch(api.documentTemplates.update, id, row);
export const removeDocumentTemplateFromConvex = (id: string) => remove(api.documentTemplates.remove, id);

// ─── Service templates ───────────────────────────────────────────────────────
export const mirrorServiceTemplateCreate = (row: Record<string, unknown>) => create(api.serviceTemplates.createIfMissing, row);
export const patchServiceTemplateInConvex = (id: string, row: Record<string, unknown>) => patch(api.serviceTemplates.update, id, row);
export const removeServiceTemplateFromConvex = (id: string) => remove(api.serviceTemplates.remove, id);
