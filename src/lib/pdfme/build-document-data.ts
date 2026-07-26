/**
 * Assembles the full data contract for document generation.
 * Loads project, org, branding, overbooking status, and returns a flat token map
 * plus complex data arrays for custom plugins.
 */
import { prisma } from "@/lib/prisma";
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../../convex/_generated/api";
import { readOrgSettingsBlob } from "@/lib/org-settings-read";
import { getClientById } from "@/lib/clients-read";
import { getClientContactsByClientId } from "@/lib/client-contacts-read";
import { resolveClientContactDisplay } from "@/lib/client-contact-helpers";
import { getLocationMap } from "@/lib/locations-read";
import { getSupplierMap } from "@/lib/suppliers-read";
import { buildDocumentLineItemData } from "@/lib/project-line-item-read";
import { getProjectByIdMapped } from "@/lib/projects-read";
import { getProjectServicesByOrg } from "@/lib/project-services-read";
import {
  getAssignmentsByProject,
  getShiftsByAssignmentIds,
  sortProjectCrew,
  shiftsForAssignmentSortedAsc,
  EXCLUDED_ASSIGNMENT_STATUSES,
} from "@/lib/crew-scheduling-read";
import { getCrewMemberMap, getCrewRoleMap } from "@/lib/crew-read";
import { getSubHiresByProject, getSubHireGroups } from "@/lib/sub-hire-read";
import { computeOverbookedStatus } from "@/lib/availability";
import { getFileAsDataUri } from "@/lib/storage";
import { formatDate } from "./plugins/helpers";
import {
  structureLineItems,
  type CategoryForStructuring,
  type SubHireGroupForStructuring,
} from "./structure-line-items";
import type { DocumentData, DocumentLineItem, CrewEntry, CallSheetDayData, DocumentType } from "./types";
import type { OrgDocumentSettings } from "@/lib/org-settings-types";

const DEFAULT_DOC_COLOR = "#0d4f4f";

/**
 * The line-item tree (lineItems → childLineItems → units, with model/supplier/kit/
 * asset/bulkAsset + per-line category/group selects) and the categories-with-groups
 * array are reconstructed from the dual-written Convex tables via
 * `buildDocumentLineItemData` (Phase A keystone consumer 4/4) — see
 * `src/lib/project-line-item-read.ts`. The per-asset packer `locationName` is
 * resolved from a Convex location map by `locationId` (`deriveLocationName` below).
 * subHires + crewAssignments stay Prisma reads here.
 */

/** Serialize Decimal fields to numbers (Prisma v6 Decimal type) */
function serializeDecimals<T>(obj: T): T {
  return JSON.parse(
    JSON.stringify(obj, (_key, value) =>
      value && typeof value === "object" && typeof value.toNumber === "function"
        ? value.toNumber()
        : value
    )
  );
}

/**
 * Build the full document data contract for a project.
 * Used by the pdfme generation pipeline.
 */
export async function buildDocumentData(
  projectId: string,
  organizationId: string,
  docType: DocumentType,
  callSheetDate?: Date,
  options?: {
    callSheetDates?: Date[];
    allDates?: boolean;
    crewMemberId?: string;
    crewRoleId?: string;
    /**
     * When true, Project Groups expand into a header row + each child line
     * item below (warehouse docs). When false (default), each group
     * collapses to a single virtual row (client-facing docs). Comes from
     * the doc type's fixed layout (`document-layouts.ts`) — see
     * `DOCUMENT_LAYOUTS[docType].expandProjectGroups`.
     */
    expandProjectGroups?: boolean;
  }
): Promise<DocumentData> {
  const expandProjectGroups = options?.expandProjectGroups ?? false;
  // Packer-walk sort piggy-backs on expandProjectGroups today — every doc
  // type that expands groups (packing-list, return-sheet, delivery-docket)
  // also wants packer order. A separate setting can split them later if a
  // user asks for one without the other.
  const packerSort = expandProjectGroups;
  // Load org identity (name) from Better Auth; business settings from Convex.
  const [org, orgSettings] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: organizationId },
      select: { name: true },
    }),
    readOrgSettingsBlob(organizationId) as Promise<Record<string, unknown>>,
  ]);

  const branding = orgSettings.branding as {
    primaryColor?: string;
    accentColor?: string;
    documentColor?: string;
    logoUrl?: string;
    iconUrl?: string;
    documentLogoMode?: "logo" | "icon" | "none";
    showOrgNameOnDocuments?: boolean;
  } | undefined;
  const documentSettings = orgSettings.documents as OrgDocumentSettings | undefined;

  // Load logo/icon as base64
  const [logoData, iconData] = await Promise.all([
    branding?.logoUrl ? getFileAsDataUri(branding.logoUrl) : null,
    branding?.iconUrl ? getFileAsDataUri(branding.iconUrl) : null,
  ]);

  const docColor = branding?.documentColor || branding?.primaryColor || DEFAULT_DOC_COLOR;

  // Project scalars + sub-hires + their groups are all Convex-only now. location +
  // the line-item tree + categories live in Convex (attached below / reconstructed
  // via buildDocumentLineItemData). crewAssignments are Convex-only (re-sourced
  // below for call sheets). SubHireGroup is nested under SubHire (sortOrder asc);
  // supplier is in Convex (attached below, not joined).
  const [projectScalars, subHireBase] = await Promise.all([
    getProjectByIdMapped(projectId, organizationId),
    getSubHiresByProject(projectId, organizationId),
  ]);
  const subHireRows = await Promise.all(
    subHireBase.map(async (sh) => ({
      ...sh,
      groups: await getSubHireGroups(sh.id),
    })),
  );

  if (!projectScalars) {
    throw new Error(`Project ${projectId} not found`);
  }

  // crewAssignments (call-sheet only) are Convex-only. Re-source the same shape the
  // old Prisma include produced: filter status notIn [CANCELLED, DECLINED] (+ the
  // optional crewMember/crewRole narrowing), order [isProjectManager desc, phase
  // asc, crewMember.lastName asc], and attach crewMember/crewRole (Convex maps) +
  // shifts (Convex, date asc).
  type CrewAssignmentInclude = {
    id: string;
    organizationId: string;
    crewMemberId: string;
    crewRoleId: string | null;
    status: string;
    phase: string | null;
    isProjectManager: boolean;
    startTime: string | null;
    endTime: string | null;
    notes: string | null;
    crewMember: { id: string; firstName: string; lastName: string; phone: string | null; email: string | null; department: string | null } | null;
    crewRole: { name: string } | null;
    shifts: Array<{ date: Date; callTime: string | null; endTime: string | null; breakMinutes: number | null; location: string | null; notes: string | null }>;
  };
  let crewAssignmentRows: CrewAssignmentInclude[] = [];
  if (docType === "call-sheet") {
    const assignments = (await getAssignmentsByProject(projectId, organizationId)).filter(
      (a) =>
        !EXCLUDED_ASSIGNMENT_STATUSES.has(a.status) &&
        (options?.crewMemberId ? a.crewMemberId === options.crewMemberId : true) &&
        (options?.crewRoleId ? a.crewRoleId === options.crewRoleId : true),
    );
    const [shifts, crewMemberMap, crewRoleMap] = await Promise.all([
      getShiftsByAssignmentIds(assignments.map((a) => a.id)),
      getCrewMemberMap(organizationId),
      getCrewRoleMap(organizationId),
    ]);
    const sorted = sortProjectCrew(assignments, (a) => crewMemberMap.get(a.crewMemberId)?.lastName);
    crewAssignmentRows = sorted.map((a) => {
      const member = crewMemberMap.get(a.crewMemberId);
      const role = a.crewRoleId ? crewRoleMap.get(a.crewRoleId) : undefined;
      return {
        id: a.id,
        organizationId: a.organizationId,
        crewMemberId: a.crewMemberId,
        crewRoleId: a.crewRoleId,
        status: a.status,
        phase: a.phase,
        isProjectManager: a.isProjectManager,
        startTime: a.startTime,
        endTime: a.endTime,
        notes: a.notes,
        crewMember: member
          ? {
              id: member.id,
              firstName: member.firstName,
              lastName: member.lastName,
              phone: member.phone ?? null,
              email: member.email ?? null,
              department: member.department ?? null,
            }
          : null,
        crewRole: role ? { name: role.name } : null,
        shifts: shiftsForAssignmentSortedAsc(shifts, a.id).map((s) => ({
          date: s.date,
          callTime: s.callTime,
          endTime: s.endTime,
          breakMinutes: s.breakMinutes,
          location: s.location,
          notes: s.notes,
        })),
      };
    });
  }

  const projectRow = { ...projectScalars, subHires: subHireRows, crewAssignments: crewAssignmentRows };

  // The line-item tree + categories come from Convex via buildDocumentLineItemData
  // (model/supplier/kit/asset/bulkAsset + per-line category/group selects, units in
  // the SELECT shape). client / location / subHire supplier are also Convex.
  const [docData, locationMap, supplierMap, clientRaw, clientContacts] = await Promise.all([
    buildDocumentLineItemData(projectId, organizationId),
    getLocationMap(organizationId),
    getSupplierMap(organizationId),
    projectRow.clientId ? getClientById(projectRow.clientId) : Promise.resolve(null),
    // WS9 #948 — the client's contact rows, for the client_contact/email/phone
    // token fallback chain below (project's selected contact -> client primary ->
    // legacy embedded). Empty when the project has no client.
    projectRow.clientId ? getClientContactsByClientId(projectRow.clientId, organizationId) : Promise.resolve([]),
  ]);
  // getClientById resolves by a GLOBAL by_cuid index — re-check org ownership (see
  // src/server/projects.ts getProject for the full rationale). A forged/stale
  // cross-org clientId must not leak another org's billing details onto a PDF.
  const client = clientRaw && clientRaw.organizationId === organizationId ? clientRaw : null;
  // Resolve the "Attn:" / email / phone tokens: the project's explicitly SELECTED
  // contact wins, else the client's primary contact, else the legacy embedded
  // clients.contactName/Email/Phone fields (migration-window fallback).
  const resolvedContact = resolveClientContactDisplay(
    { contactName: client?.contactName, contactEmail: client?.contactEmail, contactPhone: client?.contactPhone },
    client ? clientContacts : [],
    projectRow.clientContactId,
  );
  const project = {
    ...projectRow,
    client,
    location: projectRow.locationId ? locationMap.get(projectRow.locationId) ?? null : null,
    categories: docData.categories,
    lineItems: docData.lineItems,
    subHires: projectRow.subHires.map((sh) => ({
      ...sh,
      supplier: sh.supplierId ? supplierMap.get(sh.supplierId) ?? null : null,
    })),
  };

  // Compute overbooking status
  const overbookedMap = await computeOverbookedStatus(
    organizationId,
    project.lineItems,
    project.rentalStartDate,
    project.rentalEndDate,
    project.id
  );

  // Enrich line items with overbooking flags + category/group/location names
  type LineItemRow = (typeof project.lineItems)[number];
  /**
   * Pull the physical location name off a line item via its asset or
   * bulk-asset record. The asset rows carry only `locationId` now (no Prisma
   * `location` join) — the name is resolved from the Convex location map.
   * Custom items and services have neither and return null, sorting to the
   * "No Location" bucket on packer docs.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const deriveLocationName = (row: any): string | null => {
    const locId = row?.asset?.locationId ?? row?.bulkAsset?.locationId ?? null;
    return locId ? locationMap.get(locId)?.name ?? null : null;
  };
  const enrichedLineItems = project.lineItems.map((li: LineItemRow) => {
    const info = overbookedMap.get(li.id);
    const children = (li as unknown as { childLineItems?: LineItemRow[] }).childLineItems;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const liAny = li as any;
    const categoryName: string | null = liAny.category?.name ?? null;
    const groupTitle: string | null = liAny.group?.title ?? null;
    return {
      ...li,
      categoryName,
      groupTitle,
      locationName: deriveLocationName(liAny),
      supplierName: liAny.supplier?.name ?? null,
      isOverbooked: !!info,
      overbookedInherited: info?.inherited ?? false,
      overbookedReducedOnly: info?.reducedOnly ?? false,
      overbookedHasOverbooked: info?.hasOverbookedChildren ?? false,
      overbookedHasReduced: info?.hasReducedChildren ?? false,
      childLineItems: children?.map((child: LineItemRow) => {
        const childInfo = overbookedMap.get(child.id);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const childAny = child as any;
        return {
          ...child,
          categoryName: childAny.category?.name ?? null,
          groupTitle: childAny.group?.title ?? null,
          locationName: deriveLocationName(childAny),
          supplierName: childAny.supplier?.name ?? null,
          isOverbooked: !!childInfo,
          overbookedReducedOnly: childInfo?.reducedOnly ?? false,
        };
      }),
    };
  });

  // Serialize Decimals
  const serialized = serializeDecimals({
    ...project,
    lineItems: enrichedLineItems,
  });

  // serializeDecimals converts Prisma Decimal fields to numbers
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawLineItems: DocumentLineItem[] = serialized.lineItems as any;

  // ─── Restructure for categories & groups ─────────────────────────────────
  // Delegated to structureLineItems() so the logic is testable in isolation
  // and Phase 1's per-template expand toggle has a clean seam to extend.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const categories = (serialized as any).categories as
    | CategoryForStructuring[]
    | undefined;

  // Flatten sub-hire groups across all of the project's SubHires so the
  // structurer can render each one as its own top-level section in
  // warehouse mode. supplier.name is pre-resolved here so the helper
  // stays pure (no Prisma lookups in the data-shape transformation).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const subHires = (serialized as any).subHires as
    | Array<{
        supplier?: { name: string | null } | null;
        groups?: Array<{ id: string; title: string; sortOrder: number }>;
      }>
    | undefined;
  const subHireGroups: SubHireGroupForStructuring[] = [];
  for (const sh of subHires ?? []) {
    for (const g of sh.groups ?? []) {
      subHireGroups.push({
        id: g.id,
        title: g.title,
        sortOrder: g.sortOrder,
        supplierName: sh.supplier?.name ?? null,
      });
    }
  }

  const lineItems: DocumentLineItem[] = structureLineItems(
    rawLineItems,
    categories,
    { expandProjectGroups, packerSort },
    subHireGroups,
  );

  // ─── Append billable services as virtual line items ─────────────────────────
  // Services with showOnDocuments appear on quotes/invoices as their own section.
  // projectService is dual-written to Convex — read the org's services, filter to
  // this project (showOnDocuments === true, status != CANCELLED) and order by
  // sortOrder asc, replicating the dropped Prisma findMany.
  const billableServices = (await getProjectServicesByOrg(organizationId))
    .filter(
      (s) =>
        s.projectId === projectId &&
        s.showOnDocuments === true &&
        s.status !== "CANCELLED",
    )
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

  if (billableServices.length > 0) {
    for (const svc of billableServices) {
      lineItems.push({
        id: `svc-${svc.id}`,
        description: svc.title,
        quantity: 1,
        checkedOutQuantity: 0,
        unitPrice: svc.unitPrice ? Number(svc.unitPrice) : null,
        pricingType: "FLAT",
        duration: 1,
        discount: svc.discount ? Number(svc.discount) : null,
        lineTotal: svc.lineTotal ? Number(svc.lineTotal) : null,
        groupName: "Services",
        categoryName: "Services",
        groupTitle: null,
        isGroupRow: false,
        isOptional: false,
        notes: svc.description || null,
        status: "CONFIRMED",
        model: null,
        asset: null,
        bulkAsset: null,
      } as DocumentLineItem);
    }
  }

  // Compute totals for packing list / delivery docket
  const topLevelItems = lineItems.filter((i) => !i.isKitChild && !i.isContainerLineItem);
  const totalItems = topLevelItems.reduce((sum, i) => {
    if (i.kitId && !i.isKitChild) {
      const children = i.childLineItems || [];
      let count = 0;
      for (const child of children) {
        if (child.kitId && child.childLineItems?.length) {
          count += child.childLineItems.reduce((s, gc) => s + gc.quantity, 0);
        } else {
          count += child.quantity;
        }
      }
      return sum + count;
    }
    return sum + i.quantity;
  }, 0);

  const totalWeight = topLevelItems.reduce((sum, i) => {
    const w = i.model?.weight ? Number(i.model.weight) : 0;
    return sum + w * i.quantity;
  }, 0);

  // ─── PM extraction ───────────────────────────────────────────────────────
  let pmName = "";
  let pmPhone = "";
  let pmEmail = "";

  if (docType === "call-sheet") {
    // Primary source: ProjectManager join table (Convex-only now); the linked
    // user (name/email) stays Prisma (Better Auth — kept forever).
    const convex = await getConvexClient();
    const pmRows = await convex.query(api.projectManagers.listByProject, {
      projectId,
      orgId: organizationId,
    });
    const firstPm = pmRows
      .slice()
      .sort((a, b) => (a.addedAt ?? 0) - (b.addedAt ?? 0))[0];

    if (firstPm) {
      const user = await prisma.user.findUnique({
        where: { id: firstPm.userId },
        select: { name: true, email: true },
      });
      pmName = user?.name || "";
      pmEmail = user?.email || "";
      pmPhone = (orgSettings.phone as string) || ""; // User has no phone field
    }
  }

  // ─── Equipment summary ─────────────────────────────────────────────────
  const equipmentSummary = (() => {
    const topLevel = lineItems.filter(i => !i.isKitChild && !i.isContainerLineItem);
    if (topLevel.length === 0) return "No equipment assigned";
    const categories = new Set(topLevel.map(i => i.categoryName).filter(Boolean));
    const count = topLevel.reduce((sum, i) => sum + i.quantity, 0);
    if (categories.size > 0) {
      return `${count} item${count !== 1 ? "s" : ""} across ${categories.size} categor${categories.size !== 1 ? "ies" : "y"}`;
    }
    return `${count} item${count !== 1 ? "s" : ""}`;
  })();

  // ─── Build crew entries for call sheet ──────────────────────────────────
  type CrewAssignmentRow = {
    crewMember: { id: string; firstName: string; lastName: string; phone: string | null; email: string | null; department: string | null };
    crewRole: { name: string } | null;
    phase: string | null;
    isProjectManager: boolean;
    startTime: string | null;
    endTime: string | null;
    notes: string | null;
    status: string;
    shifts: Array<{
      date: string | Date;
      callTime: string | null;
      endTime: string | null;
      breakMinutes: number | null;
      location: string | null;
      notes: string | null;
    }>;
  };

  let crew: CrewEntry[] = [];
  const crewByDay: CallSheetDayData[] = [];

  if (docType === "call-sheet") {
    const crewAssignments: CrewAssignmentRow[] =
      (serialized as unknown as { crewAssignments?: CrewAssignmentRow[] }).crewAssignments || [];

    /** Build a CrewEntry from an assignment, optionally matched to a specific shift */
    function buildCrewEntry(a: CrewAssignmentRow, shift?: CrewAssignmentRow["shifts"][number]): CrewEntry {
      return {
        name: `${a.crewMember.firstName} ${a.crewMember.lastName}`,
        role: a.crewRole?.name || null,
        phase: a.phase,
        callTime: shift?.callTime || a.startTime || null,
        endTime: shift?.endTime || a.endTime || null,
        phone: a.crewMember.phone || null,
        email: a.crewMember.email || null,
        notes: a.notes || null,
        status: a.status,
        department: a.crewMember.department || null,
        breakMinutes: shift?.breakMinutes ?? null,
        shiftLocation: shift?.location || null,
        shiftNotes: shift?.notes || null,
        isProjectManager: a.isProjectManager,
      };
    }

    const isMultiDay = !!(options?.allDates || options?.callSheetDates?.length);

    if (isMultiDay) {
      // ─── Multi-day mode: group crew by date ──────────────────────────
      let targetDates: string[];

      if (options?.callSheetDates?.length) {
        targetDates = options.callSheetDates.map(d => new Date(d).toISOString().split("T")[0]);
      } else {
        // allDates: collect unique shift dates
        const shiftDateSet = new Set<string>();
        for (const a of crewAssignments) {
          for (const s of a.shifts) {
            shiftDateSet.add(new Date(s.date).toISOString().split("T")[0]);
          }
        }
        // Fall back to project dates if no shifts exist
        if (shiftDateSet.size === 0) {
          const projectDates = [
            project.loadInDate,
            project.eventStartDate,
            project.eventEndDate,
            project.loadOutDate,
          ].filter(Boolean);
          for (const d of projectDates) {
            shiftDateSet.add(new Date(d as Date).toISOString().split("T")[0]);
          }
        }
        targetDates = Array.from(shiftDateSet).sort();
      }

      // Cap at 31 days
      if (targetDates.length > 31) {
        targetDates = targetDates.slice(0, 31);
      }

      // Track which crew members have been assigned to at least one day
      const assignedCrewIds = new Set<string>();

      for (const dateStr of targetDates) {
        const dayCrew: CrewEntry[] = [];
        const dayPhases = new Set<string>();
        // Track seen crew members to deduplicate (same person with multiple assignments/roles)
        const seenCrewMembers = new Map<string, number>(); // crewMemberId → index in dayCrew

        for (const a of crewAssignments) {
          const shift = a.shifts.find(s => new Date(s.date).toISOString().split("T")[0] === dateStr);
          if (shift) {
            const existingIdx = seenCrewMembers.get(a.crewMember.id);
            if (existingIdx !== undefined) {
              // Same person, different assignment/role — merge role and phase info
              const existing = dayCrew[existingIdx];
              if (a.crewRole?.name && existing.role && !existing.role.split(", ").includes(a.crewRole.name)) {
                existing.role = `${existing.role}, ${a.crewRole.name}`;
              } else if (a.crewRole?.name && !existing.role) {
                existing.role = a.crewRole.name;
              }
              if (a.phase && existing.phase && a.phase !== existing.phase) {
                existing.phase = null; // Multiple phases, show none rather than misleading single
              }
              // Use earliest call time and latest end time
              if (shift.callTime && (!existing.callTime || shift.callTime < existing.callTime)) {
                existing.callTime = shift.callTime;
              }
              if (shift.endTime && (!existing.endTime || shift.endTime > existing.endTime)) {
                existing.endTime = shift.endTime;
              }
            } else {
              seenCrewMembers.set(a.crewMember.id, dayCrew.length);
              dayCrew.push(buildCrewEntry(a, shift));
            }
            assignedCrewIds.add(a.crewMember.id);
            if (a.phase) dayPhases.add(a.phase);
          }
        }

        // Format day label: "Monday, 7 April 2026"
        const dateObj = new Date(dateStr + "T12:00:00Z");
        const dayLabel = dateObj.toLocaleDateString("en-AU", {
          weekday: "long",
          day: "numeric",
          month: "long",
          year: "numeric",
          timeZone: "UTC",
        });

        crewByDay.push({
          date: dateStr,
          dayLabel,
          phases: Array.from(dayPhases),
          crew: dayCrew,
        });
      }

      // Add "Unscheduled" group for crew with no shifts on any target date
      const unscheduledCrew: CrewEntry[] = [];
      const seenUnscheduledMap = new Map<string, number>();
      for (const a of crewAssignments) {
        if (!assignedCrewIds.has(a.crewMember.id)) {
          const existingIdx = seenUnscheduledMap.get(a.crewMember.id);
          if (existingIdx !== undefined) {
            const existing = unscheduledCrew[existingIdx];
            if (a.crewRole?.name && existing.role && !existing.role.split(", ").includes(a.crewRole.name)) {
              existing.role = `${existing.role}, ${a.crewRole.name}`;
            } else if (a.crewRole?.name && !existing.role) {
              existing.role = a.crewRole.name;
            }
          } else {
            seenUnscheduledMap.set(a.crewMember.id, unscheduledCrew.length);
            unscheduledCrew.push(buildCrewEntry(a));
          }
        }
      }
      if (unscheduledCrew.length > 0) {
        crewByDay.push({
          date: "",
          dayLabel: "Unscheduled",
          phases: [],
          crew: unscheduledCrew,
        });
      }

      // Keep data.crew populated for backward compat (all crew, flat, deduplicated)
      const seenFlat = new Set<string>();
      crew = [];
      for (const a of crewAssignments) {
        if (!seenFlat.has(a.crewMember.id)) {
          seenFlat.add(a.crewMember.id);
          crew.push(buildCrewEntry(a));
        }
      }
    } else {
      // ─── Single-date mode (backward compat) ─────────────────────────
      const callDate = callSheetDate || project.loadInDate || project.eventStartDate || project.rentalStartDate || new Date();
      const dateStr = new Date(callDate).toISOString().split("T")[0];

      crew = crewAssignments.map((a) => {
        const shift = a.shifts.find((s) => {
          const shiftDate = new Date(s.date).toISOString().split("T")[0];
          return shiftDate === dateStr;
        });
        return buildCrewEntry(a, shift);
      });
    }
  }

  const totalNum = Number(serialized.total) || 0;
  const depositNum = Number(serialized.depositPaid) || 0;
  const now = new Date();
  const quoteValidityDays = documentSettings?.quoteValidityDays ?? 30;
  const quoteValidUntil = new Date(now.getTime() + quoteValidityDays * 24 * 60 * 60 * 1000);

  return {
    // Org
    org_name: org?.name || "",
    org_email: (orgSettings.email as string) || "",
    org_phone: (orgSettings.phone as string) || "",
    org_address: (orgSettings.address as string) || "",
    org_website: (orgSettings.website as string) || "",
    org_logo: logoData,
    org_icon: iconData,
    org_tax_rate: (orgSettings.taxRate as number) || 10,
    org_tax_label: (orgSettings.taxLabel as string) || "GST",
    org_branding: branding,
    org_document_color: docColor,

    // Project
    project_number: serialized.projectNumber,
    project_name: serialized.name,
    project_status: serialized.status,
    project_type: serialized.type || "",

    // Dates
    rental_start: formatDate(serialized.rentalStartDate),
    rental_end: formatDate(serialized.rentalEndDate),
    event_start: formatDate(serialized.eventStartDate),
    event_end: formatDate(serialized.eventEndDate),
    load_in_date: formatDate(serialized.loadInDate),
    load_out_date: formatDate(serialized.loadOutDate),

    // Client
    client_name: serialized.client?.name || "",
    client_contact: resolvedContact.name || "",
    client_email: resolvedContact.email || "",
    client_phone: resolvedContact.phone || "",
    client_billing_address: serialized.client?.billingAddress || "",
    client_tax_id: serialized.client?.taxId || "",
    client_payment_terms: serialized.client?.paymentTerms || "",

    // Location
    venue_name: serialized.location?.name || "",
    venue_address: serialized.location?.address || "",
    site_contact_name: serialized.siteContactName || "",
    site_contact_phone: serialized.siteContactPhone || "",
    site_contact_email: serialized.siteContactEmail || "",

    // Financial
    subtotal: Number(serialized.subtotal) || 0,
    discount_percent: Number(serialized.discountPercent) || 0,
    discount_amount: Number(serialized.discountAmount) || 0,
    tax_label: (orgSettings.taxLabel as string) || "GST",
    tax_amount: Number(serialized.taxAmount) || 0,
    total: totalNum,
    deposit_paid: depositNum,
    balance_due: totalNum - depositNum,

    // Notes
    client_notes: serialized.clientNotes || "",
    crew_notes: serialized.crewNotes || "",
    internal_notes: serialized.internalNotes || "",

    // Metadata
    document_date: formatDate(now),
    document_footer_text: documentSettings?.footerText || "",
    document_footer_second_line: documentSettings?.footerSecondLine || "",
    quote_terms_and_conditions: documentSettings?.termsAndConditions || "",
    quote_valid_until: formatDate(quoteValidUntil),

    // PM
    pm_name: pmName,
    pm_phone: pmPhone,
    pm_email: pmEmail,

    // Schedule
    load_in_time: serialized.loadInDate ? formatDate(serialized.loadInDate) : "-",
    load_out_time: serialized.loadOutDate ? formatDate(serialized.loadOutDate) : "-",

    // Complex data
    line_items: lineItems,
    crew,
    crew_by_day: crewByDay,
    equipment_summary: equipmentSummary,

    // Computed
    total_items: totalItems,
    total_weight: totalWeight,
  };
}
