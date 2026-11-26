import { MEMBER_RATE_FIELDS } from "./crewPayFields";

/**
 * The fields a client / supplier / crew member EDIT (the sheet, or a bulk tag / archive) may write, record in its
 * `fieldEdit` audit snapshot, and have restored by `peopleBulkWrites.undoManyNative` (UX Phase 13 slice 4 review).
 * ONE list per kind, read by the forward write (so the snapshot holds nothing else: a server-owned secret such as a
 * crew member's `icalToken` can never land in an audit row) AND by the Undo (which refuses a snapshot that names a
 * field outside it, so a tampered or future audit row cannot make the Undo write an arbitrary field).
 *
 * Money: a crew member's pay rates are the only stored pay field here (`MEMBER_RATE_FIELDS`, the PAY line). The Undo
 * restores them only for a caller who can see crew pay (`canSeeCrewPay`), because it writes a number the caller may not
 * read. A client's and a supplier's cost and spend figures (quoted, outstanding, margin) are DERIVED on read, never
 * stored, so no client or supplier field sits on the job-cost line (a test pins that).
 */
type EditKind = "client" | "supplier" | "crew";

export const PEOPLE_EDIT_FIELDS: Record<EditKind, readonly string[]> = {
  client: [
    "name", "type", "billingAddress", "billingLatitude", "billingLongitude", "shippingAddress", "shippingLatitude", "shippingLongitude",
    "taxId", "taxExempt", "taxExemptReason", "paymentTerms", "defaultDiscount", "notes", "paymentProfile", "profileDepositPercent", "tags", "isActive",
  ],
  supplier: [
    "name", "contactName", "email", "phone", "website", "address", "latitude", "longitude", "notes", "accountNumber", "paymentTerms",
    "defaultLeadTime", "tags", "isActive",
  ],
  crew: [
    "firstName", "lastName", "email", "phone", "type", "status", "department", "crewRoleId", ...MEMBER_RATE_FIELDS, "currency", "address",
    "addressLatitude", "addressLongitude", "emergencyContactName", "emergencyContactPhone", "dateOfBirth", "abnOrGst", "notes", "tags", "userId", "isActive",
  ],
};

/**
 * The client fields the sheet can CLEAR (blank means cleared, not "keep the old value"): every optional field the form
 * holds. `name`, `type`, `taxExempt`, `paymentProfile`, `tags` and `isActive` always carry a value, so they are not here.
 */
export const CLIENT_CLEARABLE_FIELDS: readonly string[] = [
  "billingAddress", "billingLatitude", "billingLongitude", "shippingAddress", "shippingLatitude", "shippingLongitude",
  "taxId", "taxExemptReason", "paymentTerms", "defaultDiscount", "notes", "profileDepositPercent",
];

/** The stored pay fields of each kind: restorable only by a caller who sees crew pay. */
const PEOPLE_PAY_FIELDS: Record<EditKind, readonly string[]> = { client: [], supplier: [], crew: MEMBER_RATE_FIELDS };

/** Why an Undo that would write `fields` must be refused for this caller, or null. */
export function undoRefusal(kind: EditKind, fields: readonly string[], paySeen: boolean): string | null {
  const allowed = PEOPLE_EDIT_FIELDS[kind];
  if (fields.some((f) => !allowed.includes(f))) return "That change can't be undone.";
  if (!paySeen && fields.some((f) => PEOPLE_PAY_FIELDS[kind].includes(f))) {
    return "That change touched pay, which you can't see, so it can't be undone here.";
  }
  return null;
}
