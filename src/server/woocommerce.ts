"use server";

import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/org-context";
import { serialize } from "@/lib/serialize";
import { logActivity } from "@/lib/activity-log";
import { recalculateProjectTotals } from "@/server/line-items";
import { flexibleDateParse } from "@/lib/woocommerce-utils";
import {
  wooCommerceIntegrationSchema,
  type WooCommerceIntegrationFormValues,
} from "@/lib/validations/woocommerce";

// ─── Server Actions (UI) ────────────────────────────────────────────────────

export async function getWooCommerceIntegration() {
  const { organizationId } = await requirePermission("orgSettings", "read");
  const integration = await prisma.wooCommerceIntegration.findUnique({
    where: { organizationId },
  });
  return integration ? serialize(integration) : null;
}

export async function updateWooCommerceIntegration(data: WooCommerceIntegrationFormValues) {
  const { organizationId, userId, userName } = await requirePermission("orgSettings", "update");
  const parsed = wooCommerceIntegrationSchema.parse(data);

  const existing = await prisma.wooCommerceIntegration.findUnique({
    where: { organizationId },
  });

  const result = await prisma.wooCommerceIntegration.upsert({
    where: { organizationId },
    create: {
      organizationId,
      webhookSecret: existing?.webhookSecret || generateSecret(),
      ...parsed,
      storeUrl: parsed.storeUrl || null,
      customFieldKey: parsed.customFieldKey || null,
      rentalStartKey: parsed.rentalStartKey || null,
      rentalEndKey: parsed.rentalEndKey || null,
      eventStartKey: parsed.eventStartKey || null,
      deliveryAddressKey: parsed.deliveryAddressKey || null,
      notesKey: parsed.notesKey || null,
    },
    update: {
      ...parsed,
      storeUrl: parsed.storeUrl || null,
      customFieldKey: parsed.customFieldKey || null,
      rentalStartKey: parsed.rentalStartKey || null,
      rentalEndKey: parsed.rentalEndKey || null,
      eventStartKey: parsed.eventStartKey || null,
      deliveryAddressKey: parsed.deliveryAddressKey || null,
      notesKey: parsed.notesKey || null,
    },
  });

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
  const result = await prisma.wooCommerceIntegration.upsert({
    where: { organizationId },
    create: {
      organizationId,
      webhookSecret: secret,
    },
    update: {
      webhookSecret: secret,
    },
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "wooCommerceIntegration",
    entityId: result.id,
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

  const where = {
    organizationId,
    ...(params?.status && { status: params.status as never }),
  };

  const [items, total] = await Promise.all([
    prisma.wooCommerceOrderLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        project: { select: { id: true, projectNumber: true, name: true } },
      },
    }),
    prisma.wooCommerceOrderLog.count({ where }),
  ]);

  return serialize({ items, total, page, pageSize });
}

export async function retryFailedOrder(logId: string) {
  const { organizationId } = await requirePermission("orgSettings", "update");

  const log = await prisma.wooCommerceOrderLog.findFirst({
    where: { id: logId, organizationId, status: "FAILED" },
  });
  if (!log) throw new Error("Order log not found or not in FAILED status");

  const integration = await prisma.wooCommerceIntegration.findUnique({
    where: { organizationId },
  });
  if (!integration?.isEnabled) throw new Error("Integration not enabled");

  // Re-process the stored payload
  await processWooCommerceOrder(organizationId, log.payload as unknown as WooOrder, integration, log.id);
}

export async function getLastPayloadMetaKeys() {
  const { organizationId } = await requirePermission("orgSettings", "read");

  const integration = await prisma.wooCommerceIntegration.findUnique({
    where: { organizationId },
    select: { lastPayload: true },
  });

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

export interface WooOrder {
  id: number;
  number?: string;
  status?: string;
  billing: {
    first_name: string;
    last_name: string;
    company?: string;
    email: string;
    phone?: string;
    address_1?: string;
    address_2?: string;
    city?: string;
    state?: string;
    postcode?: string;
    country?: string;
  };
  customer_note?: string;
  line_items: Array<{
    name: string;
    sku?: string;
    quantity: number;
    price: string;
    meta_data?: Array<{ key: string; value: string }>;
  }>;
  meta_data?: Array<{ key: string; value: string }>;
}

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
  const log = existingLogId
    ? await prisma.wooCommerceOrderLog.update({
        where: { id: existingLogId },
        data: { status: "PROCESSING" },
      })
    : await prisma.wooCommerceOrderLog.create({
        data: {
          organizationId: orgId,
          wooOrderId: order.id,
          wooOrderNumber: order.number ?? null,
          status: "PROCESSING",
          payload: order as never,
        },
      });

  try {
    // 1. Create or find client
    const client = await findOrCreateClient(orgId, order.billing);

    // 2. Extract rental dates from order meta
    const dates = extractDates(order, integration);

    // 3. Match order line items to GearFlow models
    const matchResults = await matchProducts(orgId, order.line_items, integration);

    // 4. Generate a project number
    const projectNumber = await generateWebOrderProjectNumber(orgId, order);

    // 5. Create the project
    const project = await prisma.project.create({
      data: {
        organizationId: orgId,
        projectNumber,
        name: order.billing.company
          ? `${order.billing.company} — Website Order #${order.number || order.id}`
          : `${order.billing.first_name} ${order.billing.last_name} — Website Order #${order.number || order.id}`,
        clientId: client.id,
        status: integration.autoConfirmEnquiry ? "QUOTING" : "ENQUIRY",
        type: integration.defaultProjectType as never,
        rentalStartDate: dates.rentalStart ?? null,
        rentalEndDate: dates.rentalEnd ?? null,
        eventStartDate: dates.eventStart ?? null,
        clientNotes: extractNotes(order, integration),
        tags: ["website-order"],
      },
    });

    // 6. Add line items for matched and unmatched products
    let sortOrder = 0;
    for (const match of matchResults) {
      await prisma.projectLineItem.create({
        data: {
          organizationId: orgId,
          projectId: project.id,
          type: match.modelId ? "EQUIPMENT" : "MISC",
          modelId: match.modelId || null,
          description: match.modelId
            ? null
            : `[WooCommerce] ${match.wooProductName}${match.wooSku ? ` (SKU: ${match.wooSku})` : ""}`,
          quantity: match.wooQuantity,
          unitPrice: match.wooPrice,
          pricingType: "PER_DAY",
          duration: dates.rentalStart && dates.rentalEnd
            ? Math.max(1, Math.ceil((dates.rentalEnd.getTime() - dates.rentalStart.getTime()) / (1000 * 60 * 60 * 24)))
            : 1,
          lineTotal: match.wooPrice * match.wooQuantity,
          sortOrder: sortOrder++,
        },
      });
    }

    // 7. Recalculate project totals
    await recalculateProjectTotals(project.id);

    // 8. Log success
    const matchedCount = matchResults.filter((m) => m.matched).length;
    const totalCount = matchResults.length;

    await prisma.wooCommerceOrderLog.update({
      where: { id: log.id },
      data: {
        status: "COMPLETED",
        projectId: project.id,
        clientId: client.id,
        matchResults: matchResults as never,
        dateExtraction: dates as never,
      },
    });

    // 9. Log activity
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

    // 10. Notify admins
    if (integration.notifyUserIds.length > 0) {
      await notifyNewWebsiteOrder(orgId, project, client, matchedCount, totalCount, integration.notifyUserIds);
    }
  } catch (error) {
    await prisma.wooCommerceOrderLog.update({
      where: { id: log.id },
      data: {
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

  // 1. Try exact email match first
  //    But if the order has a company name and the email match is an INDIVIDUAL client,
  //    skip it — we want to create/match a COMPANY client instead.
  let client = await prisma.client.findFirst({
    where: { organizationId: orgId, contactEmail: billing.email, isActive: true },
  });
  if (client && hasCompany && client.type === "INDIVIDUAL") {
    client = null; // skip personal match, fall through to company matching
  }

  // 2. If company name provided, try fuzzy company matching
  if (!client && hasCompany) {
    client = await fuzzyMatchCompany(orgId, billing.company!.trim());
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

    client = await prisma.client.create({
      data: {
        organizationId: orgId,
        name: hasCompany ? billing.company!.trim() : `${billing.first_name} ${billing.last_name}`,
        type: hasCompany ? "COMPANY" : "INDIVIDUAL",
        contactName: `${billing.first_name} ${billing.last_name}`,
        contactEmail: billing.email,
        contactPhone: billing.phone || null,
        billingAddress: address || null,
        tags: ["website-order"],
        isActive: true,
      },
    });

    await logActivity({
      organizationId: orgId,
      userId: "system",
      userName: "WooCommerce",
      action: "CREATE",
      entityType: "client",
      entityId: client.id,
      entityName: client.name,
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
async function fuzzyMatchCompany(orgId: string, companyName: string) {
  const candidates = await prisma.client.findMany({
    where: { organizationId: orgId, type: "COMPANY", isActive: true },
    select: { id: true, name: true },
  });

  if (candidates.length === 0) return null;

  const normalizedInput = normalizeCompanyName(companyName);

  // Exact normalized match
  const exact = candidates.find(
    (c) => normalizeCompanyName(c.name) === normalizedInput,
  );
  if (exact) {
    return prisma.client.findUnique({ where: { id: exact.id } });
  }

  // Bigram similarity match
  const inputBigrams = getBigrams(normalizedInput);
  let bestMatch: { id: string; score: number } | null = null;

  for (const candidate of candidates) {
    const candidateNormalized = normalizeCompanyName(candidate.name);
    const candidateBigrams = getBigrams(candidateNormalized);
    const score = diceCoefficient(inputBigrams, candidateBigrams);

    if (score >= 0.7 && (!bestMatch || score > bestMatch.score)) {
      bestMatch = { id: candidate.id, score };
    }
  }

  if (bestMatch) {
    return prisma.client.findUnique({ where: { id: bestMatch.id } });
  }

  return null;
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
    if (!key) return null;
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
  return Promise.all(
    lineItems.map(async (item): Promise<MatchResult> => {
      let model = null;

      switch (integration.productMatchField) {
        case "sku":
          if (item.sku) {
            model = await prisma.model.findFirst({
              where: { organizationId: orgId, sku: item.sku, isActive: true },
            });
            // Fallback to modelNumber if no SKU match
            if (!model) {
              model = await prisma.model.findFirst({
                where: { organizationId: orgId, modelNumber: item.sku, isActive: true },
              });
            }
          }
          break;
        case "custom_field":
          if (integration.customFieldKey) {
            const gearflowId = item.meta_data?.find(
              (m) => m.key === integration.customFieldKey,
            )?.value;
            if (gearflowId) {
              model = await prisma.model.findFirst({
                where: { organizationId: orgId, id: gearflowId },
              });
            }
          }
          break;
        case "name":
          model = await prisma.model.findFirst({
            where: {
              organizationId: orgId,
              name: { contains: item.name, mode: "insensitive" },
              isActive: true,
            },
          });
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
  // Check if this project number already exists
  const existing = await prisma.project.findFirst({
    where: { organizationId: orgId, projectNumber: prefix },
  });
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
