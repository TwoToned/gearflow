import { isDangerousObjectKey } from "@/lib/safe-object-key";

/**
 * Recursively convert Prisma Decimal fields to plain numbers
 * so data can be passed from server actions to client components.
 *
 * Detects Decimals by duck-typing (has toNumber method) since
 * Prisma v6 doesn't expose the Decimal class directly.
 */
export function serialize<T>(data: T): T {
  if (data === null || data === undefined) return data;
  if (typeof data === "object" && "toNumber" in data && typeof (data as Record<string, unknown>).toNumber === "function") {
    return (data as unknown as { toNumber(): number }).toNumber() as T;
  }
  if (data instanceof Date) return data;
  if (Array.isArray(data)) return data.map(serialize) as T;
  if (typeof data === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      if (isDangerousObjectKey(key)) continue;
      result[key] = serialize(value);
    }
    return result as T;
  }
  return data;
}
