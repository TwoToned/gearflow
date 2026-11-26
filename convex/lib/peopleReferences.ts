import type { MutationCtx } from "../_generated/server";
import { collectCapped } from "./pagination";

/**
 * EVERY table field that points at a client, a supplier, a crew member or a supplier order, as ONE table to
 * foreign-key map (UX Phase 13 slice 4 review). The exact Undo of a create (`peopleCreateUndo`) deletes the new
 * record only when nothing hangs off it; "nothing" is decided from THIS map and nowhere else, so a new referencing
 * table is a one-line addition here and a schema-walk test (`peopleReferences.test.ts`) fails until it is added
 * (as a blocker, or as `ignored` with the reason it is not one).
 *
 * A probe answers per record: `found` (a row references it), `clear`, or `unverifiable` (an unindexed scan hit its
 * cap; the Undo refuses, fail closed). Indexed foreign keys read the index; the three unindexed ones
 * (`projectVersions` / `xeroSyncLogs` / `wooCommerceOrderLogs`.clientId) read only this org's rows created SINCE
 * the record, which is exact for a record inside the 10-minute Undo window.
 */
export type PeopleKind = "client" | "supplier" | "crew" | "supplierOrder";
export type ProbeResult = "found" | "clear" | "unverifiable";
export interface Subject { id: string; _creationTime: number }
export type Probe = (ctx: MutationCtx, orgId: string, subject: Subject) => Promise<ProbeResult>;

export type Reference =
  | { table: string; field: string; why: string; probe: Probe; index?: string }
  | { table: string; field: string; ignored: string };

const TAKE = 5;
const SCAN_CAP = 1000;

/** A row of a GLOBAL index belongs to this org when it says so (a table with no org column counts). */
const inOrg = (orgId: string) => (r: object) => {
  const o = (r as { organizationId?: string; orgId?: string });
  const owner = o.organizationId ?? o.orgId;
  return owner === orgId || owner === undefined;
};

/** `table.field = id` read through `index` (`orgPrefix`: the index starts with the org column). */
function indexed(table: string, index: string, field: string, orgPrefix?: "organizationId" | "orgId"): Probe {
  return async (ctx, orgId, s) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const q = ctx.db.query(table as never).withIndex(index as never, ((x: any) => (orgPrefix ? x.eq(orgPrefix, orgId).eq(field, s.id) : x.eq(field, s.id))) as never);
    const rows = (await q.take(TAKE)) as object[];
    return rows.some(inOrg(orgId)) ? "found" : "clear";
  };
}

/** An UNINDEXED foreign key: this org's rows created since the record, capped (a capped read is `unverifiable`). */
function createdSince(table: string, field: string): Probe {
  return async (ctx, orgId, s) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const q = ctx.db.query(table as never).withIndex("by_organizationId" as never, ((x: any) => x.eq("organizationId", orgId).gte("_creationTime", s._creationTime)) as never);
    const { rows, truncated } = await collectCapped(q as never, SCAN_CAP);
    if ((rows as Record<string, unknown>[]).some((r) => r[field] === s.id)) return "found";
    return truncated ? "unverifiable" : "clear";
  };
}

/**
 * A client's contacts: the primary contact the CREATE wrote (stamped with the client's own `createdAt`, never edited)
 * goes with the client; any other contact, or an edited one, blocks.
 */
const clientContacts: Probe = async (ctx, orgId, s) => {
  const client = await ctx.db.query("clients").withIndex("by_cuid", (q) => q.eq("id", s.id)).first();
  const rows = (await ctx.db.query("clientContacts").withIndex("by_clientId", (q) => q.eq("clientId", s.id)).take(50)).filter((x) => x.organizationId === orgId);
  return rows.some((x) => x.createdAt !== client?.createdAt || x.updatedAt !== x.createdAt) ? "found" : "clear";
};

const OAUTH = "An OAuth client id (the API's own client registry), not a record of this kind.";
const TEXT = "Free text or a number about the thing, not a reference to a record of this kind.";
const CHILD = "Points at a sub-hire, a child that is only ever reached through its sub-hire's own supplier / order link (blocked above).";
const ROLE = "A crew ROLE (a catalogue row of the org), not a crew member.";
const CONTACT = "Points at a client CONTACT (a clientContacts row), not at the client; the client's contact probe covers contacts.";

export const PEOPLE_REFERENCES: Record<PeopleKind, Reference[]> = {
  client: [
    { table: "projects", field: "clientId", index: "by_clientId", why: "a job was added to this client", probe: indexed("projects", "by_clientId", "clientId") },
    { table: "invoices", field: "clientId", index: "by_clientId", why: "an invoice was added to this client", probe: indexed("invoices", "by_clientId", "clientId") },
    { table: "clientMedia", field: "clientId", index: "by_clientId", why: "a file was added to this client", probe: indexed("clientMedia", "by_clientId", "clientId") },
    { table: "clientContacts", field: "clientId", index: "by_clientId", why: "a contact was added or edited", probe: clientContacts },
    { table: "projectVersions", field: "clientId", why: "a job version was saved for this client", probe: createdSince("projectVersions", "clientId") },
    { table: "xeroSyncLogs", field: "clientId", why: "a Xero sync was logged for this client", probe: createdSince("xeroSyncLogs", "clientId") },
    { table: "wooCommerceOrderLogs", field: "clientId", why: "a WooCommerce order was logged for this client", probe: createdSince("wooCommerceOrderLogs", "clientId") },
    { table: "activityEvents", field: "clientId", index: "by_orgId_clientId_createdAt", why: "activity was recorded on this client", probe: indexed("activityEvents", "by_orgId_clientId_createdAt", "clientId", "orgId") },
    { table: "apiKeys", field: "oauthClientId", ignored: OAUTH },
    { table: "oauthAuthorizationCodes", field: "clientId", ignored: OAUTH },
    { table: "oauthClients", field: "clientName", ignored: OAUTH },
    { table: "oauthClients", field: "clientSecretHash", ignored: OAUTH },
    { table: "projects", field: "clientContactId", ignored: CONTACT },
    { table: "projectVersions", field: "clientContactId", ignored: CONTACT },
    { table: "projects", field: "clientNotes", ignored: TEXT },
    { table: "projectVersions", field: "clientNotes", ignored: TEXT },
    { table: "projectServices", field: "billableToClient", ignored: TEXT },
    { table: "projectServices", field: "clientContactName", ignored: TEXT },
    { table: "projectServices", field: "clientContactPhone", ignored: TEXT },
    { table: "projectServices", field: "clientVehicle", ignored: TEXT },
  ],
  supplier: [
    { table: "supplierOrders", field: "supplierId", index: "by_organizationId_supplierId", why: "an order was added to this supplier", probe: indexed("supplierOrders", "by_organizationId_supplierId", "supplierId", "organizationId") },
    { table: "assets", field: "supplierId", index: "by_supplierId", why: "an asset was linked to this supplier", probe: indexed("assets", "by_supplierId", "supplierId") },
    { table: "supplierContacts", field: "supplierId", index: "by_supplierId", why: "a contact was added to this supplier", probe: indexed("supplierContacts", "by_supplierId", "supplierId") },
    { table: "supplierDocuments", field: "supplierId", index: "by_supplierId", why: "a document was added to this supplier", probe: indexed("supplierDocuments", "by_supplierId", "supplierId") },
    { table: "supplierModelRates", field: "supplierId", index: "by_supplierId", why: "a rate was added to this supplier", probe: indexed("supplierModelRates", "by_supplierId", "supplierId") },
    { table: "subHires", field: "supplierId", index: "by_supplierId", why: "a sub-hire was added for this supplier", probe: indexed("subHires", "by_supplierId", "supplierId") },
    { table: "projectLineItems", field: "supplierId", index: "by_supplierId", why: "a job line was linked to this supplier", probe: indexed("projectLineItems", "by_supplierId", "supplierId") },
    { table: "subHires", field: "supplierReference", ignored: TEXT },
    { table: "assets", field: "purchaseSupplier", ignored: "The supplier's NAME as typed on the asset (free text, max 200); the link to a supplier record is `assets.supplierId`, which blocks." },
    { table: "maintenanceParts", field: "supplierName", ignored: "The supplier's NAME as typed on a maintenance part (free text, max 200), not a link to a supplier record." },
    { table: "subHireItems", field: "subHireId", ignored: CHILD },
    { table: "subHireGroups", field: "subHireId", ignored: CHILD },
    { table: "subHireMedia", field: "subHireId", ignored: CHILD },
    { table: "projectLineItems", field: "subHireId", ignored: CHILD },
    { table: "projectLineItems", field: "subHireItemId", ignored: CHILD },
    { table: "projectLineItems", field: "subHireGroupId", ignored: CHILD },
    { table: "categorySlots", field: "subHireGroupId", ignored: CHILD },
    { table: "projectLineItems", field: "showSubhireOnDocs", ignored: TEXT },
    { table: "projectLineItems", field: "subhireOrderNumber", ignored: TEXT },
    { table: "projects", field: "subHireCostTotal", ignored: TEXT },
  ],
  crew: [
    { table: "crewAssignments", field: "crewMemberId", index: "by_crewMemberId", why: "a call was added for this person", probe: indexed("crewAssignments", "by_crewMemberId", "crewMemberId") },
    { table: "crewTimeEntries", field: "crewMemberId", index: "by_crewMemberId", why: "time was logged for this person", probe: indexed("crewTimeEntries", "by_crewMemberId", "crewMemberId") },
    { table: "crewAvailabilities", field: "crewMemberId", index: "by_crewMemberId", why: "availability was added for this person", probe: indexed("crewAvailabilities", "by_crewMemberId", "crewMemberId") },
    { table: "crewDocuments", field: "crewMemberId", index: "by_crewMemberId", why: "a document was added for this person", probe: indexed("crewDocuments", "by_crewMemberId", "crewMemberId") },
    { table: "projectTasks", field: "assigneeCrewId", index: "by_assigneeCrewId", why: "a task was assigned to this person", probe: indexed("projectTasks", "by_assigneeCrewId", "assigneeCrewId") },
    { table: "maintenanceRecords", field: "assignedToId", ignored: "A USER id (`maintenanceWrites` validates it with assertMemberInOrg), not a crew member." },
    { table: "crewMembers", field: "crewRoleId", ignored: ROLE },
    { table: "crewAssignments", field: "crewRoleId", ignored: ROLE },
    { table: "projectServices", field: "crewRoleId", ignored: ROLE },
    { table: "categories", field: "suggestedCrewRoles", ignored: ROLE },
    { table: "projects", field: "crewNotes", ignored: TEXT },
    { table: "projectVersions", field: "crewNotes", ignored: TEXT },
    { table: "projectServices", field: "crewChargeTotal", ignored: TEXT },
    { table: "projectServices", field: "crewCountRequired", ignored: TEXT },
    { table: "serviceTemplates", field: "defaultCrewCount", ignored: TEXT },
    { table: "dashboardCounters", field: "activeCrew", ignored: TEXT },
    { table: "dashboardCounters", field: "pendingCrewOffers", ignored: TEXT },
  ],
  supplierOrder: [
    { table: "supplierOrderItems", field: "orderId", index: "by_orderId", why: "a line was added to this order", probe: indexed("supplierOrderItems", "by_orderId", "orderId") },
    { table: "supplierOrderFiles", field: "orderId", index: "by_orderId", why: "a file was added to this order", probe: indexed("supplierOrderFiles", "by_orderId", "orderId") },
    { table: "assets", field: "supplierOrderId", index: "by_supplierOrderId", why: "an asset was linked to this order", probe: indexed("assets", "by_supplierOrderId", "supplierOrderId") },
    { table: "subHires", field: "supplierOrderId", index: "by_supplierOrderId", why: "a sub-hire was linked to this order", probe: indexed("subHires", "by_supplierOrderId", "supplierOrderId") },
    { table: "projectLineItems", field: "supplierOrderId", index: "by_supplierOrderId", why: "a job line was linked to this order", probe: indexed("projectLineItems", "by_supplierOrderId", "supplierOrderId") },
  ],
};

/** The first reason a record is not exactly as created, from the map alone; `null` when nothing references it. */
export async function referenceBlocker(ctx: MutationCtx, kind: PeopleKind, orgId: string, subject: Subject): Promise<string | null> {
  for (const ref of PEOPLE_REFERENCES[kind]) {
    if ("ignored" in ref) continue;
    const found = await ref.probe(ctx, orgId, subject);
    if (found === "found") return ref.why;
    if (found === "unverifiable") return `there are too many ${ref.table} records to check`;
  }
  return null;
}
