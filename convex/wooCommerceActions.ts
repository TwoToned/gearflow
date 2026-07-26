import { v, ConvexError } from "convex/values";
import { createId } from "@paralleldrive/cuid2";
import { internalAction } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";

/**
 * Convex-native WooCommerce order processing (Convex-native migration).
 *
 * Faithful port of `processWooCommerceOrder` + every private helper it transitively
 * uses from `src/server/woocommerce.ts`. Runs as a scheduled internalAction: the
 * webhook ingress (convex/http.ts) verifies the HMAC signature and schedules this
 * with the raw WooCommerce order. Every `convex.mutation(api.X)` in the original is
 * replaced by `ctx.runMutation(internal.wooCommerceInternal.X)` /
 * `ctx.runQuery(internal.wooCommerceInternal.X)`.
 *
 * AUTH: all DB access goes through UNGUARDED `internalMutation`/`internalQuery`
 * wrappers in convex/wooCommerceInternal.ts. Those are unreachable from clients by
 * construction, so — unlike the service-gated `api.*` CRUD — they need no SERVICE
 * identity, which a webhook-scheduled action does not have. Each wrapper's handler
 * is a verbatim copy of its `api.*` twin minus the auth guard.
 *
 * The RETRY path (retryFailedOrder) intentionally stays server-side in
 * src/server/woocommerce.ts — this action only handles the create-fresh-log path
 * the webhook schedules.
 */

// ─── Types (copied from src/server/woocommerce.ts) ──────────────────────────

interface WooOrder {
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
  locationMetaKey: string | null;
  defaultLocationId: string | null;
  dateFormat: string;
  defaultProjectType: string;
  autoConfirmEnquiry: boolean;
  notifyUserIds: string[];
}

/**
 * Apply the exact defaults `mapWooCommerceIntegration`
 * (src/lib/woocommerce-integration-read.ts) applies, so the config the ported
 * helpers see is byte-identical to what the Next route passed.
 */
function mapIntegration(d: Record<string, unknown>): WooCommerceIntegrationConfig {
  return {
    id: String(d.id),
    organizationId: String(d.organizationId),
    isEnabled: (d.isEnabled as boolean | undefined) ?? false,
    webhookSecret: (d.webhookSecret as string | undefined) ?? "",
    productMatchField: (d.productMatchField as string | undefined) ?? "sku",
    customFieldKey: (d.customFieldKey as string | undefined) ?? null,
    rentalStartKey: (d.rentalStartKey as string | undefined) ?? null,
    rentalEndKey: (d.rentalEndKey as string | undefined) ?? null,
    eventStartKey: (d.eventStartKey as string | undefined) ?? null,
    deliveryAddressKey: (d.deliveryAddressKey as string | undefined) ?? null,
    notesKey: (d.notesKey as string | undefined) ?? null,
    locationMetaKey: (d.locationMetaKey as string | undefined) ?? null,
    defaultLocationId: (d.defaultLocationId as string | undefined) ?? null,
    dateFormat: (d.dateFormat as string | undefined) ?? "auto",
    defaultProjectType: (d.defaultProjectType as string | undefined) ?? "DRY_HIRE",
    autoConfirmEnquiry: (d.autoConfirmEnquiry as boolean | undefined) ?? false,
    notifyUserIds: (d.notifyUserIds as string[] | undefined) ?? [],
  };
}

// ─── Pure helpers (copied verbatim from src/server/woocommerce.ts) ──────────

/** Strip common business suffixes, punctuation, and normalize whitespace */
function normalizeCompanyName(name: string): string {
  return name
    .toLowerCase()
    .replace(
      /\b(pty\.?\s*ltd\.?|proprietary\s+limited|limited|ltd\.?|inc\.?|incorporated|llc\.?|l\.?l\.?c\.?|corp\.?|corporation|co\.?|company|gmbh|pty|p\/l|group|holdings|enterprises|services|solutions|international|intl\.?|australia|aus|nz|uk|usa)\b/gi,
      "",
    )
    .replace(/[^\w\s]/g, "") // remove punctuation
    .replace(/\s+/g, " ") // collapse whitespace
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
 * Flexible date parse — copied verbatim from src/lib/woocommerce-utils.ts
 * (`flexibleDateParse`). Convex files can't import from src/.
 */
function flexibleDateParse(value: string, preferredFormat: string = "auto"): Date | null {
  if (!value || !value.trim()) return null;
  const trimmed = value.trim();

  // Try ISO 8601 first
  const isoDate = new Date(trimmed);
  if (preferredFormat === "ISO" && !isNaN(isoDate.getTime())) return isoDate;

  // DD/MM/YYYY or MM/DD/YYYY
  const ddmmyyyy = trimmed.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
  if (ddmmyyyy) {
    if (preferredFormat === "DD/MM/YYYY" || preferredFormat === "auto") {
      const d = new Date(Number(ddmmyyyy[3]), Number(ddmmyyyy[2]) - 1, Number(ddmmyyyy[1]));
      if (!isNaN(d.getTime())) return d;
    }
    if (preferredFormat === "MM/DD/YYYY") {
      const d = new Date(Number(ddmmyyyy[3]), Number(ddmmyyyy[1]) - 1, Number(ddmmyyyy[2]));
      if (!isNaN(d.getTime())) return d;
    }
  }

  // YYYY-MM-DD (ISO date part)
  const yyyymmdd = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (yyyymmdd) {
    const d = new Date(Number(yyyymmdd[1]), Number(yyyymmdd[2]) - 1, Number(yyyymmdd[3]));
    if (!isNaN(d.getTime())) return d;
  }

  // Natural language: "15 March 2026", "March 15, 2026", etc.
  const natural = new Date(trimmed);
  if (!isNaN(natural.getTime())) return natural;

  return null;
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

// ─── ctx-bound helpers ──────────────────────────────────────────────────────

/** Write an activity-log row (native equivalent of the server `logActivity`). */
async function logActivityConvex(
  ctx: ActionCtx,
  entry: {
    organizationId: string;
    action: string;
    entityType: string;
    entityId: string;
    entityName: string;
    summary: string;
    projectId?: string;
    metadata?: unknown;
  },
): Promise<void> {
  await ctx.runMutation(internal.wooCommerceInternal.recordActivity, {
    id: createId(),
    organizationId: entry.organizationId,
    userId: "system",
    userName: "WooCommerce",
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    entityName: entry.entityName,
    summary: entry.summary,
    ...(entry.projectId ? { projectId: entry.projectId } : {}),
    ...(entry.metadata !== undefined ? { metadata: entry.metadata } : {}),
    createdAt: Date.now(),
  });
}

type ClientDoc = {
  id: string;
  name: string;
  type?: string;
  contactEmail?: string;
  isActive?: boolean;
};

/**
 * Fuzzy-match a company name against existing COMPANY clients. (Verbatim logic
 * from src/server/woocommerce.ts `fuzzyMatchCompany`.)
 */
function fuzzyMatchCompany(allClients: ClientDoc[], companyName: string): ClientDoc | null {
  const candidates = allClients.filter((c) => c.type === "COMPANY" && (c.isActive ?? true));
  if (candidates.length === 0) return null;

  const normalizedInput = normalizeCompanyName(companyName);

  // Exact normalized match
  const exact = candidates.find((c) => normalizeCompanyName(c.name) === normalizedInput);
  if (exact) return exact;

  // Bigram similarity match
  const inputBigrams = getBigrams(normalizedInput);
  let bestMatch: { client: ClientDoc; score: number } | null = null;

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

async function findOrCreateClient(
  ctx: ActionCtx,
  orgId: string,
  billing: WooOrder["billing"],
): Promise<ClientDoc> {
  const hasCompany = !!billing.company?.trim();

  // Clients live in Convex — fetch the org's clients once and match in memory.
  const all = (await ctx.runQuery(internal.wooCommerceInternal.listClientsByOrg, { orgId })) as ClientDoc[];

  // 1. Try exact email match first
  let client: ClientDoc | null =
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
    ]
      .filter(Boolean)
      .join(", ");

    const id = createId();
    const now = Date.now();
    const name = hasCompany ? billing.company!.trim() : `${billing.first_name} ${billing.last_name}`;
    await ctx.runMutation(internal.wooCommerceInternal.createClientIfMissing, {
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
    client = (await ctx.runQuery(internal.wooCommerceInternal.getClientById, { id })) as ClientDoc | null;
    if (!client) throw new ConvexError("Failed to load auto-created client");

    await logActivityConvex(ctx, {
      organizationId: orgId,
      action: "CREATE",
      entityType: "client",
      entityId: id,
      entityName: name,
      summary: `Auto-created client from WooCommerce order`,
    });
  }

  return client;
}

type LocationDoc = { id: string; name: string; address?: string };

async function resolveLocation(
  ctx: ActionCtx,
  orgId: string,
  order: WooOrder,
  integration: WooCommerceIntegrationConfig,
): Promise<string | null> {
  // Try to match from meta field
  if (integration.locationMetaKey) {
    const metaValue = order.meta_data?.find((m) => m.key === integration.locationMetaKey)?.value;

    if (metaValue?.trim()) {
      const locationName = metaValue.trim();
      const lowerName = locationName.toLowerCase();

      const candidates = (await ctx.runQuery(internal.wooCommerceInternal.listLocationsByOrg, { orgId })) as LocationDoc[];

      // 1. Exact name match (case-insensitive)
      const exactName = candidates.find((c) => c.name.toLowerCase() === lowerName);
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
          (normalizedAddress &&
            (normalizedAddress.includes(normalizedInput) ||
              normalizedInput.includes(normalizedAddress)))
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

      // 4. No match — create a new VENUE location.
      const newLocationId = createId();
      const now = Date.now();
      const address =
        /\d/.test(locationName) || locationName.includes(",") ? locationName : undefined;
      await ctx.runMutation(internal.wooCommerceInternal.createLocation, {
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

      await logActivityConvex(ctx, {
        organizationId: orgId,
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

type ModelDoc = {
  id: string;
  name?: string;
  sku?: string;
  modelNumber?: string;
  isActive?: boolean;
};

async function matchProducts(
  ctx: ActionCtx,
  orgId: string,
  lineItems: WooOrder["line_items"],
  integration: WooCommerceIntegrationConfig,
): Promise<MatchResult[]> {
  // Fetch all org models once; each line item matches in JS over this array.
  const models = (await ctx.runQuery(internal.wooCommerceInternal.listModelsByOrg, { orgId })) as ModelDoc[];

  return lineItems.map((item): MatchResult => {
    let model: ModelDoc | null = null;

    switch (integration.productMatchField) {
      case "sku":
        if (item.sku) {
          model = models.find((m) => m.sku === item.sku && m.isActive !== false) ?? null;
          // Fallback to modelNumber if no SKU match
          if (!model) {
            model = models.find((m) => m.modelNumber === item.sku && m.isActive !== false) ?? null;
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
              m.name?.toLowerCase().includes(item.name.toLowerCase()) && m.isActive !== false,
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
  });
}

/**
 * Faithful port of `generateWebOrderProjectNumber` — `WEB-<orderNumber>` with a
 * base-36 suffix on collision. The original does NOT use the project-number format
 * engine or org settings; keeping that exactly preserves web-order numbering.
 */
async function generateWebOrderProjectNumber(
  ctx: ActionCtx,
  orgId: string,
  order: WooOrder,
): Promise<string> {
  const prefix = `WEB-${order.number || order.id}`;
  // Check if this project number already exists (targeted org+number lookup —
  // equivalent to the original getProjectsByOrg().find(p.projectNumber === prefix)).
  const existing = await ctx.runQuery(internal.wooCommerceInternal.getProjectByOrgAndNumber, {
    organizationId: orgId,
    projectNumber: prefix,
  });
  if (!existing) return prefix;
  // Append suffix if duplicate
  return `${prefix}-${Date.now().toString(36).slice(-4)}`;
}

async function notifyNewWebsiteOrder(
  ctx: ActionCtx,
  orgId: string,
  project: { id: string; projectNumber: string; name: string },
  client: { name: string },
  matchedCount: number,
  totalCount: number,
  userIds: string[],
): Promise<void> {
  const matchStatus =
    matchedCount === totalCount
      ? `All ${totalCount} products matched`
      : `${matchedCount}/${totalCount} products matched`;

  for (const userId of userIds) {
    await logActivityConvex(ctx, {
      organizationId: orgId,
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

function errMsg(e: unknown): string {
  if (e instanceof ConvexError) return typeof e.data === "string" ? e.data : JSON.stringify(e.data);
  if (e instanceof Error) return e.message;
  return String(e);
}

// ─── Scheduled processing action ────────────────────────────────────────────

export const processOrder = internalAction({
  args: {
    orgId: v.string(),
    order: v.any(),
    integrationId: v.string(),
  },
  handler: async (ctx, { orgId, order: rawOrder, integrationId }) => {
    const order = rawOrder as WooOrder;

    // Load the integration config fresh (mirrors the Next route passing the row).
    const integrationDoc = await ctx.runQuery(internal.wooCommerceInternal.getIntegrationById, {
      id: integrationId,
    });
    if (!integrationDoc) {
      throw new ConvexError("WooCommerce integration not found: " + integrationId);
    }
    // Defence-in-depth: the httpAction already resolved this integration for `orgId`,
    // but re-assert org ownership after the async hop so a mid-flight reassignment
    // can never process an order under the wrong tenant.
    if ((integrationDoc as { organizationId?: string }).organizationId !== orgId) {
      throw new ConvexError("WooCommerce integration org mismatch: " + integrationId);
    }
    const integration = mapIntegration(integrationDoc as Record<string, unknown>);

    // Create a fresh PROCESSING log; `logId` tracks the flow.
    const logId = createId();
    await ctx.runMutation(internal.wooCommerceInternal.createLog, {
      id: logId,
      organizationId: orgId,
      wooOrderId: order.id,
      wooOrderNumber: order.number ?? undefined,
      status: "PROCESSING",
      payload: order,
      createdAt: Date.now(),
    });

    try {
      // 1. Create or find client
      const client = await findOrCreateClient(ctx, orgId, order.billing);

      // 2. Extract rental dates from order meta
      const dates = extractDates(order, integration);

      // 3. Match order line items to RVLT Flow models
      const matchResults = await matchProducts(ctx, orgId, order.line_items, integration);

      // 4. Resolve location (from meta field or default)
      const locationId = await resolveLocation(ctx, orgId, order, integration);

      // 5. Generate a project number
      const projectNumber = await generateWebOrderProjectNumber(ctx, orgId, order);

      // 6. Create the project (createWithUniqueNumber enforces the org+number guard;
      // on a rare race-clash, append a unique suffix and retry).
      const projectId = createId();
      const projectName = order.billing.company
        ? `${order.billing.company} — Website Order #${order.number || order.id}`
        : `${order.billing.first_name} ${order.billing.last_name} — Website Order #${order.number || order.id}`;
      const clientNotes = extractNotes(order, integration);
      const projectCreatedAt = Date.now();
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
        // WS2 (#941) — eventStartDate is deprecated/dropped; the rental dates
        // above already carry the show date.
        ...(clientNotes ? { clientNotes } : {}),
        tags: ["website-order"],
        createdAt: projectCreatedAt,
        updatedAt: projectCreatedAt,
      });
      let createResult = await ctx.runMutation(
        internal.wooCommerceInternal.createProjectWithUniqueNumber,
        buildProjectArgs(projectNumber),
      );
      let finalProjectNumber = projectNumber;
      if (!createResult.created) {
        finalProjectNumber = `${projectNumber}-${Date.now().toString(36).slice(-4)}`;
        createResult = await ctx.runMutation(
          internal.wooCommerceInternal.createProjectWithUniqueNumber,
          buildProjectArgs(finalProjectNumber),
        );
        if (!createResult.created) {
          throw new ConvexError("Could not allocate a unique web-order project number");
        }
      }
      const project = await ctx.runQuery(internal.wooCommerceInternal.getProjectByOrgAndNumber, {
        organizationId: orgId,
        projectNumber: finalProjectNumber,
      });
      if (!project) throw new ConvexError("WooCommerce project create failed");

      // 7. Add line items for matched and unmatched products.
      const duration =
        dates.rentalStart && dates.rentalEnd
          ? Math.max(
              1,
              Math.ceil(
                (dates.rentalEnd.getTime() - dates.rentalStart.getTime()) / (1000 * 60 * 60 * 24),
              ),
            )
          : 1;
      const nowMs = Date.now();
      let sortOrder = 0;
      for (const match of matchResults) {
        await ctx.runMutation(internal.wooCommerceInternal.createLineItem, {
          id: createId(),
          organizationId: orgId,
          projectId: project.id,
          type: match.modelId ? "EQUIPMENT" : "MISC",
          modelId: match.modelId || undefined,
          description: match.modelId
            ? undefined
            : `[WooCommerce] ${match.wooProductName}${match.wooSku ? ` (SKU: ${match.wooSku})` : ""}`,
          quantity: match.wooQuantity,
          unitPrice: match.wooPrice,
          pricingType: "PER_DAY",
          duration,
          lineTotal: match.wooPrice * match.wooQuantity,
          sortOrder: sortOrder++,
          createdAt: nowMs,
          updatedAt: nowMs,
        });
      }

      // 8. Recalculate project totals (native drop-in for recalculateProjectTotals).
      const settingsRow = await ctx.runQuery(internal.wooCommerceInternal.getOrgSettingsByOrg, {
        organizationId: orgId,
      });
      const orgDefaultTaxRate =
        (settingsRow?.defaultTaxRate as number | null | undefined) ?? null;
      await ctx.runMutation(internal.wooCommerceInternal.recalcProjectTotalsInternal, {
        projectId: project.id,
        orgId,
        orgDefaultTaxRate,
        now: Date.now(),
      });

      // 9. Log success
      const matchedCount = matchResults.filter((m) => m.matched).length;
      const totalCount = matchResults.length;

      await ctx.runMutation(internal.wooCommerceInternal.updateLog, {
        id: logId,
        patch: {
          status: "COMPLETED",
          projectId: project.id,
          clientId: client.id,
          matchResults: matchResults,
          // Convex rejects `Date` values — store the extracted dates as epoch ms
          // (the field is display/debug only). The Next original stored raw Dates,
          // which only serialised because unconfigured date-keys yield all-null.
          dateExtraction: {
            rentalStart: dates.rentalStart ? dates.rentalStart.getTime() : null,
            rentalEnd: dates.rentalEnd ? dates.rentalEnd.getTime() : null,
            eventStart: dates.eventStart ? dates.eventStart.getTime() : null,
          },
        },
      });

      // 10. Log activity
      await logActivityConvex(ctx, {
        organizationId: orgId,
        action: "CREATE",
        entityType: "project",
        entityId: project.id,
        entityName: project.projectNumber,
        summary: `Created project from WooCommerce order #${order.number || order.id} (${matchedCount}/${totalCount} products matched)`,
        projectId: project.id,
      });

      // 11. Notify admins
      if (integration.notifyUserIds.length > 0) {
        await notifyNewWebsiteOrder(
          ctx,
          orgId,
          project,
          client,
          matchedCount,
          totalCount,
          integration.notifyUserIds,
        );
      }
    } catch (error) {
      await ctx.runMutation(internal.wooCommerceInternal.updateLog, {
        id: logId,
        patch: {
          status: "FAILED",
          errorMessage: errMsg(error),
        },
      });
    }
  },
});
