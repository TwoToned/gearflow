"use server";

import { requirePermission } from "@/lib/org-context";
import { serialize } from "@/lib/serialize";
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import { getProjectByIdMapped } from "@/lib/projects-read";
import { buildDocumentLineItemData } from "@/lib/project-line-item-read";
import { getLocationMap } from "@/lib/locations-read";
import { getProjectServicesForVersion } from "@/lib/project-services-read";
import { DOCUMENT_LAYOUTS } from "@/lib/pdfme/document-layouts";
import { serializeDecimals, enrichDocumentLineItems, buildBillableServiceRows } from "@/lib/pdfme/document-line-items";
import { structureLineItems, type CategoryForStructuring } from "@/lib/pdfme/structure-line-items";
import type { DocumentLineItem } from "@/lib/pdfme/types";
import { buildLineItemsTableModel, QUOTE_TABLE_CONFIG } from "@/lib/react-pdf/line-items-table-model";
import { toClientViewSections, type EquipmentClientView } from "@/lib/equipment-client-view";
import { equipmentClientViewArgsSchema, type EquipmentClientViewArgs } from "@/lib/validations/equipment-client-view";

/**
 * The Equipment tab's Client view: what the quote for this version would
 * print, computed by the quote's own chain rather than re-derived from the
 * tab's data (R-3.1, UX unification §13):
 *
 *   buildDocumentLineItemData → enrichDocumentLineItems → structureLineItems
 *   (the quote layout's collapse mode) + buildBillableServiceRows (itemised,
 *   the send-time default) → buildLineItemsTableModel(QUOTE_TABLE_CONFIG)
 *   → toClientViewSections.
 *
 * Totals follow `buildDocumentData`'s rule for a draft preview: a viewed
 * version's freshly computed money (`versionPreviewContext`, the same query
 * the `preview=1` quote uses) wins, else the project's stored anchors.
 *
 * Gate: `project:read` — the view shows the same sell prices the Equipment
 * tab already shows to anyone who can read the job, and no cost, margin or
 * asset field leaves the server (`toClientViewSections` maps a slim DTO).
 * Hard overbooking is not computed: the quote prints no badges
 * (`QUOTE_TABLE_CONFIG.showBadges` is false), so it would change nothing.
 */
export async function getEquipmentClientView(input: EquipmentClientViewArgs): Promise<EquipmentClientView> {
  const { projectId, versionId } = equipmentClientViewArgsSchema.parse(input);
  const { organizationId } = await requirePermission("project", "read");

  // Org-checked: a foreign or unknown project id is "not found", never a read.
  const project = await getProjectByIdMapped(projectId, organizationId);
  if (!project) throw new Error("Job not found");

  // Checks the version belongs to THIS project in THIS org (throws otherwise).
  const versionContext = versionId
    ? await (await getConvexClient()).query(api.financeArtifacts.versionPreviewContext, {
        projectId,
        versionId,
        orgId: organizationId,
      })
    : null;
  const scopedVersionId = versionContext?.versionId ?? undefined;

  const [docData, locationMap, services] = await Promise.all([
    buildDocumentLineItemData(projectId, organizationId, scopedVersionId),
    getLocationMap(organizationId),
    getProjectServicesForVersion(organizationId, projectId, scopedVersionId),
  ]);

  const serialized = serializeDecimals({
    categories: docData.categories,
    lineItems: enrichDocumentLineItems(docData.lineItems, new Map(), locationMap),
  });
  const layout = DOCUMENT_LAYOUTS.quote;
  const lineItems = structureLineItems(
    serialized.lineItems as unknown as DocumentLineItem[],
    serialized.categories as unknown as CategoryForStructuring[],
    { expandProjectGroups: layout.expandProjectGroups, packerSort: layout.expandProjectGroups, byContainer: false },
    [],
  );
  lineItems.push(...buildBillableServiceRows(services, { combine: false }));

  const model = buildLineItemsTableModel(lineItems, QUOTE_TABLE_CONFIG);
  const money = versionContext ?? project;
  return serialize({
    sections: toClientViewSections(model, QUOTE_TABLE_CONFIG),
    totals: {
      subtotal: money.subtotal ?? null,
      discountAmount: money.discountAmount ?? null,
      taxAmount: money.taxAmount ?? null,
      total: money.total ?? null,
    },
  });
}
