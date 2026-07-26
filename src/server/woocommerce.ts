"use server";

import crypto from "crypto";
import { createId } from "@paralleldrive/cuid2";
import { getConvexClient } from "@/lib/convex-client";
import { getClientsByOrg, getClientById, type ConvexClient } from "@/lib/clients-read";
import { getLocationsByOrg } from "@/lib/locations-read";
import { getModelsByOrg } from "@/lib/models-read";
import { getProjectsByOrg, getProjectByIdMapped } from "@/lib/projects-read";
import { api } from "../../convex/_generated/api";
import { requirePermission } from "@/lib/org-context";
import { serialize } from "@/lib/serialize";
import { logActivity } from "@/lib/activity-log";
import { recalculateProjectTotals } from "@/server/line-items";
import { flexibleDateParse, resolveWooDiscountPercent } from "@/lib/woocommerce-utils";
import {
  getWooCommerceOrderLogsPage,
  getFailedOrderLogById,
} from "@/lib/woocommerce-order-logs-read";
import { getWooCommerceIntegrationByOrg } from "@/lib/woocommerce-integration-read";
import { DANGEROUS_OBJECT_KEYS } from "@/lib/safe-object-key";
import {
  wooCommerceIntegrationSchema,
  type WooCommerceIntegrationFormValues,
  type WooOrder,
} from "@/lib/validations/woocommerce";

// wooCommerceOrderLog is CONVEX-ONLY (bucket-2 Phase B write inversion): every
// create/update is written via api.wooCommerceOrderLogs.* (createId() + Date.now())
// with no Prisma row and no mirror; reads go through
// src/lib/woocommerce-order-logs-read.ts. The table has NO @@unique constraint and no
// inbound FK — webhook idempotency (dedup by wooOrderId + COMPLETED) is replicated as a
// Convex read-before-write in the webhook route. The Prisma `woocommerce_order_log`
// table is left unwritten until Phase C drops it.
//
// wooCommerceIntegration is ALSO Convex-only now (Phase C config-leftover inversion):
// one-per-org row written via api.wooCommerceIntegrations.* (createId() + Date.now()),
// read via src/lib/woocommerce-integration-read.ts. Clears (empty optional strings) go
// through the custom api.wooCommerceIntegrations.patchWooCommerceIntegration mutation.

// ─── Server Actions (UI) ────────────────────────────────────────────────────

export async function getWooCommerceIntegration() {
  const { organizationId } = await requirePermission("orgSettings", "read");
  const integration = await getWooCommerceIntegrationByOrg(organizationId);
  return integration ? serialize(integration) : null;
}

export async function updateWooCommerceIntegration(data: WooCommerceIntegrationFormValues) {
  const { organizationId, userId, userName } = await requirePermission("orgSettings", "update");
  const parsed = wooCommerceIntegrationSchema.parse(data);

  const convex = await getConvexClient();
  const existing = await getWooCommerceIntegrationByOrg(organizationId);

  // Nullable optional-string fields: empty → cleared/omitted.
  const nullableKeys = [
    "storeUrl",
    "customFieldKey",
    "rentalStartKey",
    "rentalEndKey",
    "eventStartKey",
    "deliveryAddressKey",
    "notesKey",
    "locationMetaKey",
    "defaultLocationId",
  ] as const;

  const now = Date.now();
  if (existing) {
    // Build a `set` of present values + a `clear` list of emptied nullable fields.
    const set: Record<string, unknown> = {
      isEnabled: parsed.isEnabled,
      productMatchField: parsed.productMatchField,
      dateFormat: parsed.dateFormat,
      defaultProjectType: parsed.defaultProjectType,
      autoConfirmEnquiry: parsed.autoConfirmEnquiry,
      notifyUserIds: parsed.notifyUserIds,
      updatedAt: now,
    };
    const clear: string[] = [];
    for (const k of nullableKeys) {
      const value = parsed[k];
      if (value) set[k] = value;
      else clear.push(k);
    }
    await convex.mutation(api.wooCommerceIntegrations.patchWooCommerceIntegration, {
      id: existing.id,
      set,
      clear,
    });
  } else {
    const id = createId();
    await convex.mutation(api.wooCommerceIntegrations.create, {
      id,
      organizationId,
      webhookSecret: generateSecret(),
      isEnabled: parsed.isEnabled,
      productMatchField: parsed.productMatchField,
      dateFormat: parsed.dateFormat,
      defaultProjectType: parsed.defaultProjectType,
      autoConfirmEnquiry: parsed.autoConfirmEnquiry,
      notifyUserIds: parsed.notifyUserIds,
      storeUrl: parsed.storeUrl || undefined,
      customFieldKey: parsed.customFieldKey || undefined,
      rentalStartKey: parsed.rentalStartKey || undefined,
      rentalEndKey: parsed.rentalEndKey || undefined,
      eventStartKey: parsed.eventStartKey || undefined,
      deliveryAddressKey: parsed.deliveryAddressKey || undefined,
      notesKey: parsed.notesKey || undefined,
      locationMetaKey: parsed.locationMetaKey || undefined,
      defaultLocationId: parsed.defaultLocationId || undefined,
      createdAt: now,
      updatedAt: now,
    });
  }

  const result = await getWooCommerceIntegrationByOrg(organizationId);
  if (!result) throw new Error("Failed to load WooCommerce integration after save");

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "wooCommerceIntegration",
    entityId: result.id,
    entityName: "WooCommerce Integration",
    summary: `Updated WooCommerce integration settings`,
  });

  return serialize(result);
}

export async function regenerateWebhookSecret() {
  const { organizationId, userId, userName } = await requirePermission("orgSettings", "update");

  const secret = generateSecret();
  const convex = await getConvexClient();
  const existing = await getWooCommerceIntegrationByOrg(organizationId);

  let entityId: string;
  if (existing) {
    await convex.mutation(api.wooCommerceIntegrations.update, {
      id: existing.id,
      patch: { webhookSecret: secret, updatedAt: Date.now() },
    });
    entityId = existing.id;
  } else {
    const id = createId();
    const now = Date.now();
    await convex.mutation(api.wooCommerceIntegrations.create, {
      id,
      organizationId,
      webhookSecret: secret,
      createdAt: now,
      updatedAt: now,
    });
    entityId = id;
  }

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "wooCommerceIntegration",
    entityId,
    entityName: "WooCommerce Integration",
    summary: "Regenerated WooCommerce webhook secret",
  });

  return { secret };
}

export async function getWooCommerceOrderLogs(params?: {
  page?: number;
  pageSize?: number;
  status?: string;
}) {
  const { organizationId } = await requirePermission("orgSettings", "read");
  const page = params?.page ?? 1;
  const pageSize = params?.pageSize ?? 20;

  // Convex-only read: status filter + createdAt-desc + pagination + project join
  // reproduced in JS (no Prisma fallback).
  const { items, total } = await getWooCommerceOrderLogsPage(organizationId, {
    page,
    pageSize,
    status: params?.status,
  });

  return serialize({ items, total, page, pageSize });
}

export async function retryFailedOrder(logId: string) {
  const { organizationId } = await requirePermission("orgSettings", "update");

  const log = await getFailedOrderLogById(organizationId, logId);
  if (!log) throw new Error("Order log not found or not in FAILED status");

  const integration = await getWooCommerceIntegrationByOrg(organizationId);
  if (!integration?.isEnabled) throw new Error("Integration not enabled");

  // Re-process the stored payload
  await processWooCommerceOrder(organizationId, log.payload as unknown as WooOrder, integration, log.id);
}

export async function getLastPayloadMetaKeys() {
  const { organizationId } = await requirePermission("orgSettings", "read");

  const integration = await getWooCommerceIntegrationByOrg(organizationId);

  if (!integration?.lastPayload) return null;

  const order = integration.lastPayload as unknown as WooOrder;
  const keys = new Set<string>();

  // Collect meta_data keys from order
  if (order.meta_data) {
    for (const m of order.meta_data) {
      keys.add(m.key);
    }
  }

  // Collect meta_data keys from line items
  if (order.line_items) {
    for (const item of order.line_items) {
      if (item.meta_data) {
        for (const m of item.meta_data) {
          keys.add(m.key);
        }
      }
    }
  }

  return {
    orderMeta: order.meta_data?.map((m: { key: string; value: string }) => ({
      key: m.key,
      value: String(m.value).substring(0, 200),
    })) ?? [],
    lineItemMeta: Array.from(keys).sort(),
  };
}

// ─── Webhook Processing (called from API route) ─────────────────────────────
// WooOrder is derived from `wooOrderSchema` (src/lib/validations/woocommerce.ts)
// via `z.infer` — the runtime Zod parse at the webhook trust boundary
// (route.ts) is what actually enforces this shape (R-8.2.3).

interface WooCommerceIntegrationConfig {
  id: string;
  organizationId: string;
  isEnabled: boolean;
  webhookSecret: string;
  productMatchField: string;
  customFieldKey: string | null;
  rentalStartKey: string | null;
  rentalEndKey: string | null;
  eventStartKey: string | null;
  deliveryAddressKey: string | null;
  notesKey: string | null;
  locationMetaKey: string | null;
  defaultLocationId: string | null;
  dateFormat: string;
  defaultProjectType: string;
  autoConfirmEnquiry: boolean;
  notifyUserIds: string[];
}

export async function processWooCommerceOrder(
  orgId: string,
  order: WooOrder,
  integration: WooCommerceIntegrationConfig,
  existingLogId?: string,
) {
  // Convex-only write. Either move an existing log to PROCESSING (retry) or create a
  // fresh PROCESSING log. `logId` is the cuid we track through the rest of the flow.
  const convex = await getConvexClient();
  let logId: string;
  if (existingLogId) {
    logId = existingLogId;
    await convex.mutation(api.wooCommerceOrderLogs.update, {
      id: existingLogId,
      patch: { status: "PROCESSING" },
    });
  } else {
    logId = createId();
    await convex.mutation(api.wooCommerceOrderLogs.create, {
      id: logId,
      organizationId: orgId,
      wooOrderId: order.id,
      wooOrderNumber: order.number ?? undefined,
      status: "PROCESSING",
      payload: order,
      createdAt: Date.now(),
    });
  }

  try {
    // 1. Create or find client
    const client = await findOrCreateClient(orgId, order.billing);

    // 2. Extract rental dates from order meta
    const dates = extractDates(order, integration);

    // 3. Match order line items to RVLT Flow models
    const matchResults = await matchProducts(orgId, order.line_items, integration);

    // 4. Resolve location (from meta field or default)
    const locationId = await resolveLocation(orgId, order, integration);

    // 5. Generate a project number
    const projectNumber = await generateWebOrderProjectNumber(orgId, order);

    // 6. Create the project (Convex-only — createWithUniqueNumber enforces the
    // org+number guard; on a rare race-clash, append a unique suffix and retry).
    const projectId = createId();
    const projectName = order.billing.company
      ? `${order.billing.company} — Website Order #${order.number || order.id}`
      : `${order.billing.first_name} ${order.billing.last_name} — Website Order #${order.number || order.id}`;
    const clientNotes = extractNotes(order, integration);
    const projectCreatedAt = Date.now();
    // QW-4 (#953): seed the discount cascade here too — this path creates the
    // project via api.projects.createWithUniqueNumber (a plain insert), which
    // does NOT run projectWrites.createNative's in-mutation defaultDiscount
    // lookup. A snapshot, not a live link (see the "no retroactive change" note
    // on createNative).
    const wooDiscountPercent = resolveWooDiscountPercent(client);
    const buildProjectArgs = (num: string) => ({
      id: projectId,
      organizationId: orgId,
      projectNumber: num,
      name: projectName,
      clientId: client.id,
      status: (integration.autoConfirmEnquiry ? "QUOTING" : "ENQUIRY") as never,
      type: integration.defaultProjectType as never,
      ...(locationId ? { locationId } : {}),
      ...(dates.rentalStart ? { rentalStartDate: dates.rentalStart.getTime() } : {}),
      ...(dates.rentalEnd ? { rentalEndDate: dates.rentalEnd.getTime() } : {}),
      ...(dates.eventStart ? { eventStartDate: dates.eventStart.getTime() } : {}),
      ...(clientNotes ? { clientNotes } : {}),
      ...(wooDiscountPercent != null ? { discountPercent: wooDiscountPercent } : {}),
      tags: ["website-order"],
      createdAt: projectCreatedAt,
      updatedAt: projectCreatedAt,
    });
    let createResult = await convex.mutation(api.projects.createWithUniqueNumber, buildProjectArgs(projectNumber));
    if (!createResult.created) {
      const retryProjectNumber = `${projectNumber}-${Date.now().toString(36).slice(-4)}`;
      createResult = await convex.mutation(api.projects.createWithUniqueNumber, buildProjectArgs(retryProjectNumber));
      if (!createResult.created) throw new Error("Could not allocate a unique web-order project number");
    }
    const project = await getProjectByIdMapped(projectId, orgId);
    if (!project) throw new Error("WooCommerce project create failed");

    // 7. Add line items for matched and unmatched products.
    // projectLineItem is Convex-only. Build every row in memory and write them all in
    // ONE array mutation (api.projectLineItems.createMany) instead of one round-trip
    // per matched product (bulk single-call invariant, Phase 3). organizationId is
    // stamped from the mutation arg, not per-row.
    const duration = dates.rentalStart && dates.rentalEnd
      ? Math.max(1, Math.ceil((dates.rentalEnd.getTime() - dates.rentalStart.getTime()) / (1000 * 60 * 60 * 24)))
      : 1;
    const nowMs = Date.now();
    const lineItemRows = matchResults.map((match, sortOrder) => ({
      id: createId(),
      projectId: project.id,
      type: (match.modelId ? "EQUIPMENT" : "MISC") as never,
      modelId: match.modelId || undefined,
      description: match.modelId
        ? undefined
        : `[WooCommerce] ${match.wooProductName}${match.wooSku ? ` (SKU: ${match.wooSku})` : ""}`,
      quantity: match.wooQuantity,
      unitPrice: match.wooPrice,
      pricingType: "PER_DAY" as never,
      duration,
      lineTotal: match.wooPrice * match.wooQuantity,
      sortOrder,
      createdAt: nowMs,
      updatedAt: nowMs,
    }));
    if (lineItemRows.length > 0) {
      await convex.mutation(api.projectLineItems.createMany, {
        organizationId: orgId,
        rows: lineItemRows,
      });
    }

    // 8. Recalculate project totals
    await recalculateProjectTotals(project.id);

    // 9. Log success
    const matchedCount = matchResults.filter((m) => m.matched).length;
    const totalCount = matchResults.length;

    await convex.mutation(api.wooCommerceOrderLogs.update, {
      id: logId,
      patch: {
        status: "COMPLETED",
        projectId: project.id,
        clientId: client.id,
        matchResults: matchResults,
        dateExtraction: dates,
      },
    });

    // 10. Log activity
    await logActivity({
      organizationId: orgId,
      userId: "system",
      userName: "WooCommerce",
      action: "CREATE",
      entityType: "project",
      entityId: project.id,
      entityName: project.projectNumber,
      summary: `Created project from WooCommerce order #${order.number || order.id} (${matchedCount}/${totalCount} products matched)`,
      projectId: project.id,
    });

    // 11. Notify admins
    if (integration.notifyUserIds.length > 0) {
      await notifyNewWebsiteOrder(orgId, project, client, matchedCount, totalCount, integration.notifyUserIds);
    }
  } catch (error) {
    await convex.mutation(api.wooCommerceOrderLogs.update, {
      id: logId,
      patch: {
        status: "FAILED",
        errorMessage: error instanceof Error ? error.message : String(error),
      },
    });
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function generateSecret(): string {
  return crypto.randomBytes(32).toString("hex");
}

async function findOrCreateClient(orgId: string, billing: WooOrder["billing"]) {
  const hasCompany = !!billing.company?.trim();

  // Clients live in Convex — fetch the org's clients once and match in memory.
  const all = await getClientsByOrg(orgId);

  // 1. Try exact email match first
  //    But if the order has a company name and the email match is an INDIVIDUAL client,
  //    skip it — we want to create/match a COMPANY client instead.
  let client: ConvexClient | null =
    all.find((c) => (c.isActive ?? true) && c.contactEmail === billing.email) ?? null;
  if (client && hasCompany && client.type === "INDIVIDUAL") {
    client = null; // skip personal match, fall through to company matching
  }

  // 2. If company name provided, try fuzzy company matching
  if (!client && hasCompany) {
    client = fuzzyMatchCompany(all, billing.company!.trim());
  }

  // 3. If still no match, create a new client
  if (!client) {
    const address = [
      billing.address_1,
      billing.address_2,
      billing.city,
      billing.state,
      billing.postcode,
      billing.country,
    ].filter(Boolean).join(", ");

    const id = createId();
    const now = Date.now();
    const name = hasCompany ? billing.company!.trim() : `${billing.first_name} ${billing.last_name}`;
    await (await getConvexClient()).mutation(api.clients.createIfMissing, {
      id,
      organizationId: orgId,
      name,
      type: hasCompany ? "COMPANY" : "INDIVIDUAL",
      contactName: `${billing.first_name} ${billing.last_name}`,
      contactEmail: billing.email,
      contactPhone: billing.phone || undefined,
      billingAddress: address || undefined,
      tags: ["website-order"],
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    client = await getClientById(id);
    if (!client) throw new Error("Failed to load auto-created client");

    await logActivity({
      organizationId: orgId,
      userId: "system",
      userName: "WooCommerce",
      action: "CREATE",
      entityType: "client",
      entityId: id,
      entityName: name,
      summary: `Auto-created client from WooCommerce order`,
    });
  }

  return client;
}

/**
 * Fuzzy-match a company name against existing COMPANY clients.
 *
 * Strategy:
 * 1. Normalize both strings (lowercase, strip suffixes like Pty Ltd / Inc / LLC,
 *    remove punctuation, collapse whitespace)
 * 2. Try exact normalized match first
 * 3. Fall back to bigram similarity (Dice coefficient) — threshold 0.7
 */
function fuzzyMatchCompany(allClients: ConvexClient[], companyName: string): ConvexClient | null {
  const candidates = allClients.filter((c) => c.type === "COMPANY" && (c.isActive ?? true));
  if (candidates.length === 0) return null;

  const normalizedInput = normalizeCompanyName(companyName);

  // Exact normalized match
  const exact = candidates.find(
    (c) => normalizeCompanyName(c.name) === normalizedInput,
  );
  if (exact) return exact;

  // Bigram similarity match
  const inputBigrams = getBigrams(normalizedInput);
  let bestMatch: { client: ConvexClient; score: number } | null = null;

  for (const candidate of candidates) {
    const candidateNormalized = normalizeCompanyName(candidate.name);
    const candidateBigrams = getBigrams(candidateNormalized);
    const score = diceCoefficient(inputBigrams, candidateBigrams);

    if (score >= 0.7 && (!bestMatch || score > bestMatch.score)) {
      bestMatch = { client: candidate, score };
    }
  }

  return bestMatch ? bestMatch.client : null;
}

/** Strip common business suffixes, punctuation, and normalize whitespace */
function normalizeCompanyName(name: string): string {
  return name
    .toLowerCase()
    .replace(
      /\b(pty\.?\s*ltd\.?|proprietary\s+limited|limited|ltd\.?|inc\.?|incorporated|llc\.?|l\.?l\.?c\.?|corp\.?|corporation|co\.?|company|gmbh|pty|p\/l|group|holdings|enterprises|services|solutions|international|intl\.?|australia|aus|nz|uk|usa)\b/gi,
      "",
    )
    .replace(/[^\w\s]/g, "") // remove punctuation
    .replace(/\s+/g, " ")   // collapse whitespace
    .trim();
}

/** Generate character bigrams from a string */
function getBigrams(str: string): Set<string> {
  const bigrams = new Set<string>();
  for (let i = 0; i < str.length - 1; i++) {
    bigrams.add(str.substring(i, i + 2));
  }
  return bigrams;
}

/** Dice coefficient: 2 * |intersection| / (|A| + |B|) */
function diceCoefficient(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;

  let intersection = 0;
  for (const bigram of a) {
    if (b.has(bigram)) intersection++;
  }

  return (2 * intersection) / (a.size + b.size);
}

/**
 * Resolve a project location from WooCommerce order meta.
 * 1. If a locationMetaKey is configured, try to match the meta value to an existing Location
 *    (exact name, address/substring, or bigram fuzzy match).
 * 2. If no match found, auto-create a new VENUE location from the meta value.
 * 3. Fall back to defaultLocationId if no meta key is set or the field is empty.
 */
async function resolveLocation(
  orgId: string,
  order: WooOrder,
  integration: WooCommerceIntegrationConfig,
): Promise<string | null> {
  // Try to match from meta field
  if (integration.locationMetaKey) {
    const metaValue = order.meta_data?.find(
      (m) => m.key === integration.locationMetaKey,
    )?.value;

    if (metaValue?.trim()) {
      const locationName = metaValue.trim();
      const lowerName = locationName.toLowerCase();

      // Fetch all org locations once (reactive Convex read); the exact-name,
      // exact-address, and fuzzy steps below all match in JS over this array.
      const candidates = await getLocationsByOrg(orgId);

      // 1. Exact name match (case-insensitive)
      const exactName = candidates.find(
        (c) => c.name.toLowerCase() === lowerName,
      );
      if (exactName) return exactName.id;

      // 2. Address match (case-insensitive)
      const addressMatch = candidates.find(
        (c) => (c.address?.toLowerCase() ?? "") === lowerName && !!c.address,
      );
      if (addressMatch) return addressMatch.id;

      // 3. Fuzzy match against all locations (name + address)
      const normalizedInput = locationName.toLowerCase().trim();
      let bestMatch: { id: string; score: number } | null = null;

      for (const candidate of candidates) {
        const normalizedName = candidate.name.toLowerCase().trim();
        const normalizedAddress = candidate.address?.toLowerCase().trim() ?? "";

        // Substring match (either direction) on name or address
        if (
          normalizedName.includes(normalizedInput) ||
          normalizedInput.includes(normalizedName) ||
          (normalizedAddress && (
            normalizedAddress.includes(normalizedInput) ||
            normalizedInput.includes(normalizedAddress)
          ))
        ) {
          return candidate.id;
        }

        // Bigram similarity on name
        const inputBigrams = getBigrams(normalizedInput);
        const nameBigrams = getBigrams(normalizedName);
        const nameScore = diceCoefficient(inputBigrams, nameBigrams);

        // Also try address similarity
        let addrScore = 0;
        if (normalizedAddress) {
          const addrBigrams = getBigrams(normalizedAddress);
          addrScore = diceCoefficient(inputBigrams, addrBigrams);
        }

        const bestScore = Math.max(nameScore, addrScore);
        if (bestScore >= 0.6 && (!bestMatch || bestScore > bestMatch.score)) {
          bestMatch = { id: candidate.id, score: bestScore };
        }
      }

      if (bestMatch) return bestMatch.id;

      // 4. No match — create a new VENUE location. Locations are Convex-only
      // (Phase B write inversion), so write the Convex doc directly (no Prisma row).
      const newLocationId = createId();
      const now = Date.now();
      const address =
        /\d/.test(locationName) || locationName.includes(",") ? locationName : undefined;
      await (await getConvexClient()).mutation(api.locations.create, {
        id: newLocationId,
        organizationId: orgId,
        name: locationName,
        type: "VENUE",
        address,
        isDefault: false,
        tags: [],
        createdAt: now,
        updatedAt: now,
      });

      await logActivity({
        organizationId: orgId,
        userId: "system",
        userName: "WooCommerce",
        action: "CREATE",
        entityType: "location",
        entityId: newLocationId,
        entityName: locationName,
        summary: `Auto-created venue location from WooCommerce order`,
      });

      return newLocationId;
    }
  }

  // Fall back to default location
  return integration.defaultLocationId || null;
}

interface DateExtractionResult {
  rentalStart: Date | null;
  rentalEnd: Date | null;
  eventStart: Date | null;
  raw: Record<string, string>;
}

function extractDates(order: WooOrder, integration: WooCommerceIntegrationConfig): DateExtractionResult {
  const meta = new Map<string, string>();
  if (order.meta_data) {
    for (const m of order.meta_data) {
      meta.set(m.key, m.value);
    }
  }

  const raw: Record<string, string> = {};
  const format = integration.dateFormat;

  function parseDate(key: string | null): Date | null {
    if (!key || DANGEROUS_OBJECT_KEYS.includes(key)) return null;
    const value = meta.get(key);
    if (!value) return null;
    raw[key] = value;
    return flexibleDateParse(value, format);
  }

  return {
    rentalStart: parseDate(integration.rentalStartKey),
    rentalEnd: parseDate(integration.rentalEndKey),
    eventStart: parseDate(integration.eventStartKey),
    raw,
  };
}

function extractNotes(order: WooOrder, integration: WooCommerceIntegrationConfig): string | null {
  const parts: string[] = [];

  // Customer note from WooCommerce
  if (order.customer_note) {
    parts.push(order.customer_note);
  }

  // Custom notes key from meta
  if (integration.notesKey) {
    const meta = order.meta_data?.find((m) => m.key === integration.notesKey);
    if (meta?.value) {
      parts.push(meta.value);
    }
  }

  // Delivery address from meta
  if (integration.deliveryAddressKey) {
    const meta = order.meta_data?.find((m) => m.key === integration.deliveryAddressKey);
    if (meta?.value) {
      parts.push(`Delivery address: ${meta.value}`);
    }
  }

  return parts.length > 0 ? parts.join("\n\n") : null;
}

interface MatchResult {
  wooProductName: string;
  wooSku: string | null;
  wooQuantity: number;
  wooPrice: number;
  modelId: string | null;
  modelName: string | null;
  matched: boolean;
}

async function matchProducts(
  orgId: string,
  lineItems: WooOrder["line_items"],
  integration: WooCommerceIntegrationConfig,
): Promise<MatchResult[]> {
  // Fetch all org models once (reactive Convex read); each line item matches in
  // JS over this array, preserving the per-field switch logic and isActive filters.
  const models = await getModelsByOrg(orgId);

  return Promise.all(
    lineItems.map(async (item): Promise<MatchResult> => {
      let model = null;

      switch (integration.productMatchField) {
        case "sku":
          if (item.sku) {
            model =
              models.find((m) => m.sku === item.sku && m.isActive !== false) ?? null;
            // Fallback to modelNumber if no SKU match
            if (!model) {
              model =
                models.find(
                  (m) => m.modelNumber === item.sku && m.isActive !== false,
                ) ?? null;
            }
          }
          break;
        case "custom_field":
          if (integration.customFieldKey) {
            const gearflowId = item.meta_data?.find(
              (m) => m.key === integration.customFieldKey,
            )?.value;
            if (gearflowId) {
              model = models.find((m) => m.id === gearflowId) ?? null;
            }
          }
          break;
        case "name":
          model =
            models.find(
              (m) =>
                m.name?.toLowerCase().includes(item.name.toLowerCase()) &&
                m.isActive !== false,
            ) ?? null;
          break;
      }

      return {
        wooProductName: item.name,
        wooSku: item.sku ?? null,
        wooQuantity: item.quantity,
        wooPrice: parseFloat(item.price),
        modelId: model?.id ?? null,
        modelName: model?.name ?? null,
        matched: !!model,
      };
    }),
  );
}

async function generateWebOrderProjectNumber(orgId: string, order: WooOrder): Promise<string> {
  const prefix = `WEB-${order.number || order.id}`;
  // Check if this project number already exists (header read from Convex)
  const projects = await getProjectsByOrg(orgId);
  const existing = projects.find((p) => p.projectNumber === prefix);
  if (!existing) return prefix;
  // Append suffix if duplicate
  return `${prefix}-${Date.now().toString(36).slice(-4)}`;
}

async function notifyNewWebsiteOrder(
  orgId: string,
  project: { id: string; projectNumber: string; name: string },
  client: { name: string },
  matchedCount: number,
  totalCount: number,
  userIds: string[],
) {
  // Create in-app notifications (activity log entries the users can see)
  const matchStatus =
    matchedCount === totalCount
      ? `All ${totalCount} products matched`
      : `${matchedCount}/${totalCount} products matched`;

  for (const userId of userIds) {
    await logActivity({
      organizationId: orgId,
      userId: "system",
      userName: "WooCommerce",
      action: "CREATE",
      entityType: "notification",
      entityId: project.id,
      entityName: project.projectNumber,
      summary: `New website order: ${project.name} for ${client.name} (${matchStatus})`,
      projectId: project.id,
      metadata: { notifyUserId: userId },
    });
  }
}
