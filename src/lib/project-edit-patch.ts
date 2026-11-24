import type { z } from "zod";
import type { projectSchema } from "@/lib/validations/project";

/**
 * The `set` / `clear` payload `projectWrites.updateNative` takes, built from a
 * parsed `projectSchema` value. ONE builder for both callers (R-3.1):
 *
 * - **Full** (no `before`): every field, blanks as `clear`. The legacy shape.
 * - **Diff** (`before` given): only the fields that changed. This is what the
 *   job edit sheet sends. It matters for two reasons: a pricing-locked job
 *   refuses ANY write that touches `taxRate` / `discountPercent`
 *   (`assertPricingUnlocked`), so a full payload made every save fail even
 *   though the Discount input was disabled; and `status` is not a field of the
 *   form (it moves through the header stepper's gates), so a diff never sends it.
 */
type ParsedProjectForm = z.output<typeof projectSchema>;

interface ProjectUpdate {
  set: Record<string, unknown>;
  clear: string[];
}

/** Always written in full mode, compared like any other field in diff mode. */
const REQUIRED_KEYS = ["projectNumber", "name", "type"] as const;

/** Written as `set` when present, `clear` when blank. */
const OPTIONAL_KEYS = [
  "clientId", "clientContactId", "description", "locationId",
  "siteContactName", "siteContactPhone", "siteContactEmail",
  "loadInDate", "loadInTime", "eventStartDate", "eventStartTime",
  "eventEndDate", "eventEndTime", "loadOutDate", "loadOutTime",
  "projectStartDate", "projectStartTime", "projectEndDate", "projectEndTime",
  "rentalStartDate", "rentalEndDate",
  "billingWeeksOverride", "billingDaysOverride", "taxRate",
  "crewNotes", "internalNotes", "clientNotes", "discountPercent",
] as const;

type Key = (typeof REQUIRED_KEYS)[number] | (typeof OPTIONAL_KEYS)[number];

/** Blank (`undefined`, `null`, `""`) is `null`; a Date is epoch-ms. `0` stays `0`. */
function normalise(value: unknown): unknown {
  if (value === undefined || value === null || value === "") return null;
  if (value instanceof Date) return value.getTime();
  return value;
}

const sameValue = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const read = (p: ParsedProjectForm, key: Key) => normalise((p as Record<string, unknown>)[key]);

/** The fields that differ (every field when there is no `before`). */
function collectFields(parsed: ParsedProjectForm, before?: ParsedProjectForm): ProjectUpdate {
  const set: Record<string, unknown> = {};
  const clear: string[] = [];
  for (const key of [...REQUIRED_KEYS, ...OPTIONAL_KEYS]) {
    const next = read(parsed, key);
    if (before && sameValue(next, read(before, key))) continue;
    if (next === null) clear.push(key);
    else set[key] = next;
  }
  if (!before || !sameValue(parsed.tags, before.tags)) set.tags = parsed.tags;
  return { set, clear };
}

export function buildProjectUpdate(
  parsed: ParsedProjectForm,
  opts: { before?: ParsedProjectForm; now: number },
): ProjectUpdate {
  const { before, now } = opts;
  const { set, clear } = collectFields(parsed, before);
  // Full mode keeps its historical `status` write; a diff never sends it.
  if (!before) set.status = parsed.status;
  if (before && Object.keys(set).length === 0 && clear.length === 0) return { set: {}, clear: [] };
  set.updatedAt = now;
  return { set, clear };
}

