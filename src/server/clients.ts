"use server";

import { createId } from "@paralleldrive/cuid2";
import { prisma } from "@/lib/prisma";
import { getConvexClient } from "@/lib/convex-client";
import { getClientById, getClientsByOrg, type ConvexClient } from "@/lib/clients-read";
import { api } from "../../convex/_generated/api";
import { getOrgContext, requirePermission } from "@/lib/org-context";
import { clientSchema, type ClientFormValues } from "@/lib/validations/client";
import { serialize } from "@/lib/serialize";
import { logActivity } from "@/lib/activity-log";
import type { FilterValue } from "@/lib/table-utils";

// Clients live in Convex (source of truth) as of the Phase 3 cutover. This file
// keeps all permission/validation/audit logic and calls Convex for client data;
// cross-domain joins (project counts, media) are composed from Prisma, which
// still owns those domains. See FEATUREDOCS/54.

/** Build the Convex create/patch payload from validated form values (null -> absent). */
function toClientFields(parsed: ClientFormValues) {
  return {
    name: parsed.name,
    type: parsed.type,
    contactName: parsed.contactName || undefined,
    contactEmail: parsed.contactEmail || undefined,
    contactPhone: parsed.contactPhone || undefined,
    billingAddress: parsed.billingAddress || undefined,
    billingLatitude: parsed.billingLatitude == null ? undefined : Number(parsed.billingLatitude),
    billingLongitude: parsed.billingLongitude == null ? undefined : Number(parsed.billingLongitude),
    shippingAddress: parsed.shippingAddress || undefined,
    shippingLatitude: parsed.shippingLatitude == null ? undefined : Number(parsed.shippingLatitude),
    shippingLongitude: parsed.shippingLongitude == null ? undefined : Number(parsed.shippingLongitude),
    taxId: parsed.taxId || undefined,
    paymentTerms: parsed.paymentTerms || undefined,
    defaultDiscount: parsed.defaultDiscount == null ? undefined : Number(parsed.defaultDiscount),
    notes: parsed.notes || undefined,
    tags: parsed.tags,
    isActive: parsed.isActive,
  };
}

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

  // Project counts per client (projects still live in Prisma).
  const ids = pageItems.map((c) => c.id);
  const counts = ids.length
    ? await prisma.project.groupBy({
        by: ["clientId"],
        where: { organizationId, clientId: { in: ids } },
        _count: { _all: true },
      })
    : [];
  const countByClient = new Map(counts.map((g) => [g.clientId, g._count._all]));
  const withCounts = pageItems.map((c) => ({
    ...c,
    _count: { projects: countByClient.get(c.id) ?? 0 },
  }));

  return serialize({ clients: withCounts, total, page, pageSize, totalPages: Math.ceil(total / pageSize) });
}

/**
 * Project counts per client (clientId -> count). Cross-domain: projects still
 * live in Prisma, so this can't come from Convex. Used by the reactive client
 * table, which subscribes to the client list via Convex and merges these counts.
 */
export async function getClientProjectCounts(): Promise<Record<string, number>> {
  const { organizationId } = await getOrgContext();
  const groups = await prisma.project.groupBy({
    by: ["clientId"],
    where: { organizationId, clientId: { not: null } },
    _count: { _all: true },
  });
  const counts: Record<string, number> = {};
  for (const g of groups) if (g.clientId) counts[g.clientId] = g._count._all;
  return serialize(counts);
}

export async function getClient(id: string) {
  const { organizationId } = await getOrgContext();
  const client = await getClientById(id);
  if (!client || client.organizationId !== organizationId) return serialize(null);

  const [projects, media] = await Promise.all([
    prisma.project.findMany({
      where: { clientId: id, organizationId },
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { _count: { select: { lineItems: true } } },
    }),
    prisma.clientMedia.findMany({
      where: { clientId: id },
      include: { file: true },
      orderBy: { sortOrder: "asc" },
    }),
  ]);

  return serialize({ ...client, projects, media });
}

export async function createClient(data: ClientFormValues) {
  const { organizationId, userId, userName } = await requirePermission("client", "create");
  const parsed = clientSchema.parse(data);

  const id = createId();
  const now = Date.now();
  await getConvexClient().mutation(api.clients.create, {
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

  await getConvexClient().mutation(api.clients.update, {
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
  await getConvexClient().mutation(api.clients.update, {
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
  await getConvexClient().mutation(api.clients.update, {
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
