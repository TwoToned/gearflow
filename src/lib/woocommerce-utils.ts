import crypto from "crypto";

export function verifyWebhookSignature(rawBody: string, signature: string, secret: string): boolean {
  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("base64");
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

export function flexibleDateParse(value: string, preferredFormat: string = "auto"): Date | null {
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

/**
 * QW-4 (#953): the project-assembly discount seed for a WooCommerce order.
 *
 * Both Woo assembly paths (`convex/wooCommerceActions.ts`'s `processOrder` action
 * and this file's caller, `src/server/woocommerce.ts`'s legacy twin) build a new
 * project directly — neither goes through `projectWrites.createNative`, so
 * neither gets its in-mutation `defaultDiscount` cascade for free. This is the
 * canonical definition (R-3.1 single source of truth); `convex/wooCommerceActions.ts`
 * carries a verbatim copy (same pattern as `flexibleDateParse` in that file —
 * Convex's function bundler can't reach into `src/`, see its comment). Keep both
 * copies byte-identical on change. Woo orders never carry an explicit discount of
 * their own, so there's no "explicit value wins" case here (unlike `createNative`,
 * which also has to arbitrate a caller-supplied discount).
 */
export function resolveWooDiscountPercent(client: { defaultDiscount?: number | null }): number | undefined {
  return client.defaultDiscount != null ? client.defaultDiscount : undefined;
}
