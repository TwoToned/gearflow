/**
 * Xero account-coding cascade resolver (WS1 #940) — PURE functions, no I/O, so
 * every level is independently unit-testable (see xeroAccountCascade.test.ts).
 * Callers (src/server/xero.ts `pushInvoiceToXero`) look up each level's raw
 * value themselves (a per-line override, the model/kit doc, the category doc,
 * the org's `xeroIntegrations` config) and pass them in already-resolved —
 * this module only encodes the PRECEDENCE, never touches the database.
 *
 * Equipment/kit line cascade (first non-null wins):
 *   1. projectLineItems.xeroAccountCode (per-line override, incl. kit-line override)
 *   2. models.xeroRentalAccountCode / xeroSaleAccountCode (by line kind) OR
 *      kits.xeroAccountCode (for a kit-parent line — kits aren't models)
 *   3. categories.xeroAccountCode
 *   4. xeroIntegrations.defaultAccountCode (org default)
 *
 * Service cascade (first non-null wins):
 *   1. projectServices.xeroAccountCode (per-line override)
 *   2. xeroIntegrations.serviceAccountDefaults[type] (per-service-type default)
 *   3. xeroIntegrations.defaultAccountCode (org default)
 *
 * Tax-type cascade (first non-null wins):
 *   1. Per-line xeroTaxType override (projectLineItems / projectServices)
 *   2. xeroIntegrations.defaultTaxType (mapping of the org's default GST rate)
 */

export type LineKind = "RENTAL" | "SALE";

/** Which service types get their own org-configured default account. Mirrors
 *  the 3 buckets called out in the spec (labour / delivery-transport / misc) —
 *  a superset ServiceType (see convex/lib/validators.ts) collapses onto these. */
export type ServiceAccountDefaultKey = "LABOUR" | "DELIVERY_TRANSPORT" | "MISC";

/**
 * Resolve which of a model's two account codes (rental vs sale) or a kit's
 * single account code applies to a line — level 2 of the equipment cascade.
 * A kit-parent line (isKitChild === false && kitId set) is not a model, so it
 * never reads model codes even if `modelId` happens to be set on the row.
 */
export function resolveModelOrKitAccountCode(opts: {
  isKitParent: boolean;
  lineKind: LineKind;
  kitCode?: string | null;
  modelRentalCode?: string | null;
  modelSaleCode?: string | null;
}): string | null {
  if (opts.isKitParent) return opts.kitCode ?? null;
  return (opts.lineKind === "SALE" ? opts.modelSaleCode : opts.modelRentalCode) ?? null;
}

/** The full 4-level equipment/kit-line account cascade. `levels` are ALREADY
 *  resolved per-entity values (see resolveModelOrKitAccountCode for level 2). */
export function resolveEquipmentAccountCode(levels: {
  lineOverride?: string | null;
  modelOrKitCode?: string | null;
  categoryCode?: string | null;
  orgDefaultCode?: string | null;
}): string | null {
  return (
    nonEmpty(levels.lineOverride) ??
    nonEmpty(levels.modelOrKitCode) ??
    nonEmpty(levels.categoryCode) ??
    nonEmpty(levels.orgDefaultCode) ??
    null
  );
}

/** The 3-level service account cascade: line override -> per-service-type
 *  default -> org default. */
export function resolveServiceAccountCode(levels: {
  lineOverride?: string | null;
  serviceTypeDefault?: string | null;
  orgDefaultCode?: string | null;
}): string | null {
  return (
    nonEmpty(levels.lineOverride) ??
    nonEmpty(levels.serviceTypeDefault) ??
    nonEmpty(levels.orgDefaultCode) ??
    null
  );
}

/** Tax-type cascade: per-line override -> the org's default GST TaxType mapping. */
export function resolveTaxType(levels: {
  lineOverride?: string | null;
  orgDefaultTaxType?: string | null;
}): string | null {
  return nonEmpty(levels.lineOverride) ?? nonEmpty(levels.orgDefaultTaxType) ?? null;
}

/** Map a ProjectService's `type` enum value (convex/lib/validators.ts ServiceType:
 *  DELIVERY | PICKUP | BUMP_IN | BUMP_OUT | LABOUR | MISC) onto one of the 3
 *  configured service-account-default buckets. Unrecognised/future types fall
 *  to MISC so a new ServiceType never silently resolves to "no default" — MISC
 *  -> org default keeps the cascade terminating instead of dead-ending. */
export function serviceAccountDefaultKeyForType(serviceType: string): ServiceAccountDefaultKey {
  switch (serviceType) {
    case "LABOUR":
      return "LABOUR";
    case "DELIVERY":
    case "PICKUP":
    case "BUMP_IN":
    case "BUMP_OUT":
      return "DELIVERY_TRANSPORT";
    default:
      return "MISC";
  }
}

function nonEmpty(value: string | null | undefined): string | null | undefined {
  return value && value.trim() !== "" ? value : undefined;
}
