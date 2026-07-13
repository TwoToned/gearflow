"use server";

import { createId } from "@paralleldrive/cuid2";
import { getConvexClient } from "@/lib/convex-client";
import { getClientMediaFromConvex, withResolvedFile } from "@/lib/media-read";
import { getClientById, getClientsByOrg, type ConvexClient } from "@/lib/clients-read";
import { getProjectsByOrg } from "@/lib/projects-read";
import {
  getLineItemsByProjectIds,
  countAllLineItemsByProject,
} from "@/lib/line-item-count-read";
import { api } from "../../convex/_generated/api";
import { getOrgContext, requirePermission } from "@/lib/org-context";
import { clientSchema, type ClientFormValues } from "@/lib/validations/client";
import { serialize } from "@/lib/serialize";
import { logActivity } from "@/lib/activity-log";
import { toClientFields } from "@/lib/client-fields";
import type { FilterValue } from "@/lib/table-utils";

// Clients live in Convex (source of truth). Browser WRITES go browser-direct
// (convex/clientWrites.ts + src/hooks/use-native-client-writes.ts); these server-action
// writes stay as the agent/MCP API's implementation (create_client + dynamic-dispatch)
// until a CONVEX_WRITES bridge re-points them at the native mutations. Reads compose
// cross-domain joins (project counts, media) in Node. See FEATUREDOCS/54.

function compareBy(sortBy: string, sortOrder: "asc" | "desc") {
  const dir = sortOrder === "desc" ? -1 : 1;
  return (a: ConvexClient, b: ConvexClient) => {
    const av = (a as Record<string, unknown>)[sortBy];
    const bv = (b as Record<string, unknown>)[sortBy];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
    return String(av).localeCompare(String(bv), undefined, { sensitivity: "base" }) * dir;
  };
}

export async function getClients(params?: {
  search?: string;
  type?: string;
  isActive?: boolean;
  filters?: Record<string, FilterValue>;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}) {
  const { organizationId } = await getOrgContext();
  const {
    search, type, isActive = true, filters, page = 1, pageSize = 25,
    sortBy = "name", sortOrder = "asc",
  } = params || {};

  let clients = await getClientsByOrg(organizationId);

  // Filters (mirrors the old Prisma where: isActive + type + search OR).
  clients = clients.filter((c) => (c.isActive ?? true) === isActive);
  const typeFilter = type ?? (filters?.type as string | undefined);
  if (typeFilter) clients = clients.filter((c) => c.type === typeFilter);
  if (search) {
    const q = search.toLowerCase();
    clients = clients.filter((c) =>
      c.name.toLowerCase().includes(q) ||
      (c.contactName?.toLowerCase().includes(q) ?? false) ||
      (c.contactEmail?.toLowerCase().includes(q) ?? false),
    );
  }

  const total = clients.length;
  clients.sort(compareBy(sortBy, sortOrder));
  const pageItems = clients.slice((page - 1) * pageSize, page * pageSize);

  // Project counts per client (from Convex).
  const ids = pageItems.map((c) => c.id);
  const countByClient = new Map<string, number>();
  if (ids.length) {
    const idSet = new Set(ids);
    const allProjects = await getProjectsByOrg(organizationId);
    for (const p of allProjects) {
      if (p.clientId && idSet.has(p.clientId)) {
        countByClient.set(p.clientId, (countByClient.get(p.clientId) ?? 0) + 1);
      }
    }
  }
  const withCounts = pageItems.map((c) => ({
    ...c,
    _count: { projects: countByClient.get(c.id) ?? 0 },
  }));

  return serialize({ clients: withCounts, total, page, pageSize, totalPages: Math.ceil(total / pageSize) });
}

/**
 * Project counts per client (clientId -> count). From Convex.
 */
export async function getClientProjectCounts(): Promise<Record<string, number>> {
  const { organizationId } = await getOrgContext();
  const allProjects = await getProjectsByOrg(organizationId);
  const counts: Record<string, number> = {};
  for (const p of allProjects) if (p.clientId) counts[p.clientId] = (counts[p.clientId] ?? 0) + 1;
  return serialize(counts);
}

export async function getClient(id: string) {
  const { organizationId } = await getOrgContext();
  const client = await getClientById(id);
  if (!client || client.organizationId !== organizationId) return serialize(null);

  const [allOrgProjects, media] = await Promise.all([
    getProjectsByOrg(organizationId),
    // clientMedia gallery now read from the Convex mirror (was a Prisma
    // clientMedia + file join). Dual-written, so identical data. See media-read.ts.
    getClientMediaFromConvex(id),
  ]);

  const clientProjects = allOrgProjects
    .filter((p) => p.clientId === id)
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
    .slice(0, 20);

  // Per-project line-item counts (all line items, like the old groupBy scoped by
  // the project's clientId) now come from the dual-written Convex line items, for
  // exactly the projects rendered on the detail page.
  const projectIds = clientProjects.map((p) => p.id);
  const lineItemCountMap = countAllLineItemsByProject(
    await getLineItemsByProjectIds(organizationId, projectIds),
    projectIds,
  );
  const projects = clientProjects.map((p) => ({
    ...p,
    _count: { lineItems: lineItemCountMap.get(p.id) ?? 0 },
  }));

  return serialize({ ...client, projects, media: withResolvedFile(media) });
}

export async function createClient(data: ClientFormValues) {
  const { organizationId, userId, userName } = await requirePermission("client", "create");
  const parsed = clientSchema.parse(data);

  const id = createId();
  const now = Date.now();
  await (await getConvexClient()).mutation(api.clients.createIfMissing, {
    id,
    organizationId,
    ...toClientFields(parsed),
    createdAt: now,
    updatedAt: now,
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "CREATE",
    entityType: "client",
    entityId: id,
    entityName: parsed.name,
    summary: `Created client ${parsed.name}`,
  });

  const saved = await getClientById(id);
  if (!saved) throw new Error("Client not found after write");
  return serialize(saved);
}

export async function updateClient(id: string, data: ClientFormValues) {
  const { organizationId, userId, userName } = await requirePermission("client", "update");
  const parsed = clientSchema.parse(data);

  const existing = await getClientById(id);
  if (!existing || existing.organizationId !== organizationId) {
    throw new Error("Client not found");
  }

  await (await getConvexClient()).mutation(api.clients.update, {
    id,
    patch: { ...toClientFields(parsed), updatedAt: Date.now() },
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "client",
    entityId: id,
    entityName: parsed.name,
    summary: `Updated client ${parsed.name}`,
  });

  const saved = await getClientById(id);
  if (!saved) throw new Error("Client not found after write");
  return serialize(saved);
}

export async function updateClientNotes(id: string, notes: string) {
  const { organizationId } = await requirePermission("client", "update");
  const existing = await getClientById(id);
  if (!existing || existing.organizationId !== organizationId) {
    throw new Error("Client not found");
  }
  await (await getConvexClient()).mutation(api.clients.update, {
    id,
    patch: { notes: notes || undefined, updatedAt: Date.now() },
  });
  const saved = await getClientById(id);
  if (!saved) throw new Error("Client not found after write");
  return serialize(saved);
}

export async function archiveClient(id: string) {
  const { organizationId, userId, userName } = await requirePermission("client", "update");
  const existing = await getClientById(id);
  if (!existing || existing.organizationId !== organizationId) {
    throw new Error("Client not found");
  }
  await (await getConvexClient()).mutation(api.clients.update, {
    id,
    patch: { isActive: false, updatedAt: Date.now() },
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "DELETE",
    entityType: "client",
    entityId: id,
    entityName: existing.name,
    summary: `Archived client ${existing.name}`,
  });

  const saved = await getClientById(id);
  if (!saved) throw new Error("Client not found after write");
  return serialize(saved);
}
