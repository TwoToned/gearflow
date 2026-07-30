import { getConvexClient } from "@/lib/convex-client";
import { requirePermission } from "@/lib/org-context";
import { generatePdf } from "@/lib/pdfme/generate-pdf";
import { quoteArtifactFileName, invoiceArtifactFileName } from "@/lib/finance-artifacts";
import { getServeInfo, uploadToS3 } from "@/lib/storage";
import type { ActorContext } from "@/lib/actor-types";
import { api } from "../../../convex/_generated/api";

/**
 * Agent-facing project document access (the MCP `get_project_document` tool +
 * `GET /api/v1/documents/{projectId}`, both bypassing `dispatch()` — see the
 * "why not a registry operation" note in `src/lib/api/mcp/build-server.ts`).
 *
 * `pdfme` needs Node and `build-document-data.ts` reads Prisma AND Convex, so
 * this can never be a Convex query/mutation the dispatcher could reach — the
 * same reason `src/server/finance-documents.ts` exists as a plain server
 * function rather than a Convex action. This module is that function's agent
 * counterpart: resolve RBAC + scope with `requirePermission` (Node-side, no
 * ambient session) FIRST, then read/render exactly the way the session-auth
 * routes already do (`src/app/api/documents/[projectId]/route.tsx` for the
 * live types, `src/server/finance-documents.ts` for the stored ones).
 *
 * The 5 project document types split into two behaviours:
 * - **packing-list / return-sheet / delivery-docket** — always live-rendered
 *   from TODAY's project state (a packer wants today's list, never a stale
 *   one) — gated on `project:read`, the same "any org member can view"
 *   posture the session route already has (no extra RBAC action exists for
 *   this — `document:generate`/`project:generate_documents` are write-tier
 *   actions for the finance-artifact flow, not a fit for a pure read that
 *   persists nothing).
 * - **quote / invoice** — gated on `invoice:read`, mirroring the finance PDF
 *   routes exactly. If there's a SENT quote or an ISSUED invoice, its frozen
 *   stored artifact is what's returned (never re-rendered — R-9.3, #987). If
 *   not, `quote` falls back to a watermarked "DRAFT PREVIEW" live render
 *   (matching the `preview=1` session path); `invoice` has no draft-preview
 *   analogue and reports `NOT_FOUND` instead.
 */

export const AGENT_DOCUMENT_TYPES = ["quote", "invoice", "packing-list", "return-sheet", "delivery-docket"] as const;
export type AgentDocumentType = (typeof AGENT_DOCUMENT_TYPES)[number];

export function isAgentDocumentType(value: string): value is AgentDocumentType {
  return (AGENT_DOCUMENT_TYPES as readonly string[]).includes(value);
}

export type AgentDocumentOutcome =
  | {
      kind: "bytes";
      docType: AgentDocumentType;
      status: "draft-preview" | "live";
      fileName: string;
      contentType: "application/pdf";
      bytes: Buffer;
      organizationId: string;
    }
  | {
      kind: "stored";
      docType: "quote" | "invoice";
      status: "sent" | "issued";
      fileName: string;
      organizationId: string;
      storageId: string;
    };

function apiError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

const LIVE_RENDER_TYPES = new Set<AgentDocumentType>(["packing-list", "return-sheet", "delivery-docket"]);

async function resolveQuote(actor: ActorContext, projectId: string): Promise<AgentDocumentOutcome> {
  const { organizationId } = await requirePermission("invoice", "read", actor);
  const convex = await getConvexClient();
  const now = Date.now();

  const revisionState = await convex.query(api.quotes.revisionStateForProject, { orgId: organizationId, projectId, now });

  if (!revisionState.liveQuote) {
    const bytes = await generatePdf(projectId, organizationId, "quote", { draftPreview: true });
    return {
      kind: "bytes",
      docType: "quote",
      status: "draft-preview",
      fileName: `quote-draft-${projectId}.pdf`,
      contentType: "application/pdf",
      bytes: Buffer.from(bytes),
      organizationId,
    };
  }

  const context = await convex.query(api.financeArtifacts.quoteArtifactContext, {
    quoteId: revisionState.liveQuote.id,
    orgId: organizationId,
    now,
  });
  if (!context.pdfFileId) {
    throw apiError(
      "DOCUMENT_NOT_READY",
      "This quote was sent but its PDF hasn't finished generating yet. Try again shortly, or check the Finance tab.",
    );
  }

  return {
    kind: "stored",
    docType: "quote",
    status: "sent",
    fileName: quoteArtifactFileName(context.projectNumber, context.version),
    organizationId,
    storageId: context.pdfFileId,
  };
}

async function resolveInvoice(actor: ActorContext, projectId: string): Promise<AgentDocumentOutcome> {
  const { organizationId } = await requirePermission("invoice", "read", actor);
  const convex = await getConvexClient();

  const invoices = await convex.query(api.invoices.listForProject, { orgId: organizationId, projectId });
  const issued = invoices
    .filter((invoice) => invoice.status === "ISSUED")
    .sort((a, b) => (b.issuedAt ?? 0) - (a.issuedAt ?? 0))[0];
  if (!issued) {
    throw apiError("NOT_FOUND", "No issued invoice found for this project yet.");
  }

  const context = await convex.query(api.financeArtifacts.invoiceArtifactContext, {
    invoiceId: issued.id,
    orgId: organizationId,
  });
  if (!context.pdfFileId) {
    throw apiError(
      "DOCUMENT_NOT_READY",
      "This invoice was issued but its PDF hasn't finished generating yet. Try again shortly, or check the Finance tab.",
    );
  }

  return {
    kind: "stored",
    docType: "invoice",
    status: "issued",
    fileName: invoiceArtifactFileName(context.projectNumber, context.invoiceNumber),
    organizationId,
    storageId: context.pdfFileId,
  };
}

async function resolveLiveWarehouseDoc(
  actor: ActorContext,
  projectId: string,
  docType: "packing-list" | "return-sheet" | "delivery-docket",
): Promise<AgentDocumentOutcome> {
  const { organizationId } = await requirePermission("project", "read", actor);
  const bytes = await generatePdf(projectId, organizationId, docType);
  return {
    kind: "bytes",
    docType,
    status: "live",
    fileName: `${docType}-${projectId}.pdf`,
    contentType: "application/pdf",
    bytes: Buffer.from(bytes),
    organizationId,
  };
}

/**
 * Resolve one of a project's PDF documents for an authenticated agent/API-key
 * actor. Throws an `Error` with a `.code` from `src/lib/api/errors.ts`'s
 * `CODE_SPECS` table (`toErrorEnvelope`/`statusForError` know how to map it)
 * on any auth/scope/not-found failure.
 */
export async function resolveProjectDocument(
  actor: ActorContext,
  projectId: string,
  docType: AgentDocumentType,
): Promise<AgentDocumentOutcome> {
  if (!projectId) throw apiError("VALIDATION_FAILED", "projectId is required.");
  if (!isAgentDocumentType(docType)) {
    throw apiError(
      "VALIDATION_FAILED",
      `Unknown document type "${docType}". Expected one of: ${AGENT_DOCUMENT_TYPES.join(", ")}.`,
    );
  }

  if (docType === "quote") return resolveQuote(actor, projectId);
  if (docType === "invoice") return resolveInvoice(actor, projectId);
  if (LIVE_RENDER_TYPES.has(docType)) return resolveLiveWarehouseDoc(actor, projectId, docType);

  throw apiError("VALIDATION_FAILED", `Unknown document type "${docType}".`);
}

export interface AgentDocumentUrl {
  docType: AgentDocumentType;
  status: "draft-preview" | "live" | "sent" | "issued";
  fileName: string;
  contentType: string;
  /** Short-lived Convex `_storage` URL (`files.getServeInfo`) — directly
   *  fetchable, no bearer token needed. */
  url: string;
}

/**
 * MCP-facing variant of {@link resolveProjectDocument} that resolves to a
 * short-lived download URL instead of raw bytes, mirroring `files.getServeInfo`
 * (the established "give an agent a fetchable URL" pattern in this codebase).
 *
 * Embedding the PDF inline as a base64 MCP `resource` content block was tried
 * first and doesn't survive every real MCP client/relay path intact (some
 * layer strips/nulls fields it doesn't recognise before the result reaches
 * the client's own schema validation) — plain JSON (a URL + metadata) is what
 * every other curated tool already returns reliably, so that's what this
 * returns too. A live-rendered document (no persisted artifact to point at)
 * is uploaded to Convex `_storage` under `agent-documents/` first so there's
 * something to hand back a URL for; unlike a finance artifact this is a
 * disposable snapshot, not attached to any row, and is never cleaned up
 * today (a follow-up, not a correctness issue).
 */
export async function resolveProjectDocumentUrl(
  actor: ActorContext,
  projectId: string,
  docType: AgentDocumentType,
): Promise<AgentDocumentUrl> {
  const outcome = await resolveProjectDocument(actor, projectId, docType);

  const storageId =
    outcome.kind === "stored"
      ? outcome.storageId
      : (
          await uploadToS3(outcome.bytes, {
            organizationId: outcome.organizationId,
            folder: "agent-documents",
            entityId: projectId,
            fileName: outcome.fileName,
            mimeType: outcome.contentType,
          })
        ).storageKey;

  const info = await getServeInfo(storageId);
  if (!info) {
    throw apiError(
      "DOCUMENT_NOT_READY",
      "The document was rendered but its download URL could not be resolved. Try again shortly.",
    );
  }

  return {
    docType: outcome.docType,
    status: outcome.status,
    fileName: outcome.fileName,
    contentType: info.contentType ?? "application/pdf",
    url: info.url,
  };
}
