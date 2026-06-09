/**
 * Assembles the full data contract for document generation.
 * Loads project, org, branding, overbooking status, and returns a flat token map
 * plus complex data arrays for custom plugins.
 */
import { prisma } from "@/lib/prisma";
import { getClientById } from "@/lib/clients-read";
import { computeOverbookedStatus } from "@/lib/availability";
import { getFileAsDataUri } from "@/lib/storage";
import { formatCurrency, formatDate } from "./plugins/helpers";
import {
  structureLineItems,
  type CategoryForStructuring,
  type SubHireGroupForStructuring,
} from "./structure-line-items";
import { getDefaultSettings, type TemplateSettings } from "./template-settings";
import type { DocumentData, DocumentLineItem, CrewEntry, CallSheetDayData, DocumentType } from "./types";

const DEFAULT_DOC_COLOR = "#0d4f4f";

/**
 * Per-unit asset selection. The line item include below pulls these in
 * so renderers can show every physical asset assigned to a multi-qty
 * line — not just the legacy `line.asset` (which is null post-cutover).
 * CANCELLED units are filtered out; everything else is included so the
 * docket reflects what's actually packed.
 */
const unitInclude = {
  orderBy: { ordinal: "asc" as const },
  where: { status: { not: "CANCELLED" as const } },
  select: {
    id: true,
    status: true,
    asset: { select: { assetTag: true } },
    bulkAsset: { select: { assetTag: true } },
  },
} as const;

/**
 * Asset include shape with location data attached. Used for both
 * `asset` (serialised) and `bulkAsset` (bulk) on line items so the
 * packer-sort logic in `structureLineItems` can read `locationName`.
 */
const assetWithLocation = {
  include: { location: { select: { name: true } } },
} as const;

/** Deep include for line items — 2 levels of children for nested kits */
const lineItemInclude = {
  model: { include: { category: true } },
  asset: assetWithLocation,
  bulkAsset: assetWithLocation,
  kit: true,
  units: unitInclude,
  supplier: { select: { name: true } },
  category: { select: { id: true, name: true, sortOrder: true } },
  group: { select: { id: true, title: true, sortOrder: true, categoryId: true } },
  childLineItems: {
    orderBy: { sortOrder: "asc" as const },
    include: {
      model: { include: { category: true } },
      asset: assetWithLocation,
      bulkAsset: assetWithLocation,
      kit: true,
      units: unitInclude,
      supplier: { select: { name: true } },
      category: { select: { id: true, name: true, sortOrder: true } },
      group: { select: { id: true, title: true, sortOrder: true, categoryId: true } },
      childLineItems: {
        orderBy: { sortOrder: "asc" as const },
        include: {
          model: { include: { category: true } },
          asset: assetWithLocation,
          bulkAsset: assetWithLocation,
          units: unitInclude,
          supplier: { select: { name: true } },
        },
      },
    },
  },
} as const;

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
     * Pre-resolved template settings (already merged against the docType
     * defaults). When omitted, the docType defaults are used. The data
     * builder reads `settings.table.expandProjectGroups` to decide how to
     * structure line items; downstream renderers consume the same settings
     * object for visual concerns.
     */
    settings?: TemplateSettings;
  }
): Promise<DocumentData> {
  const settings = options?.settings ?? getDefaultSettings(docType);
  const expandProjectGroups = settings.table.expandProjectGroups;
  // Packer-walk sort piggy-backs on expandProjectGroups today — every doc
  // type that expands groups (packing-list, return-sheet, delivery-docket)
  // also wants packer order. A separate setting can split them later if a
  // user asks for one without the other.
  const packerSort = expandProjectGroups;
  // Load org
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
  });

  let orgSettings: Record<string, unknown> = {};
  if (org?.metadata) {
    try {
      orgSettings = JSON.parse(org.metadata);
    } catch {
      // ignore
    }
  }

  const branding = orgSettings.branding as {
    primaryColor?: string;
    accentColor?: string;
    documentColor?: string;
    logoUrl?: string;
    iconUrl?: string;
    documentLogoMode?: "logo" | "icon" | "none";
    showOrgNameOnDocuments?: boolean;
  } | undefined;

  // Load logo/icon as base64
  const [logoData, iconData] = await Promise.all([
    branding?.logoUrl ? getFileAsDataUri(branding.logoUrl) : null,
    branding?.iconUrl ? getFileAsDataUri(branding.iconUrl) : null,
  ]);

  const docColor = branding?.documentColor || branding?.primaryColor || DEFAULT_DOC_COLOR;

  // Load project with deep includes + categories/groups for document structure
  const projectRow = await prisma.project.findUnique({
    where: { id: projectId, organizationId },
    include: {
      location: true,
      categories: {
        orderBy: { sortOrder: "asc" },
        include: {
          groups: { orderBy: { sortOrder: "asc" } },
        },
      },
      // Sub-hires + their groups are loaded for Phase 1+ (sub-hire-as-section
      // feature). Phase 0 includes them but doesn't consume them yet so the
      // include shape is locked alongside the snapshot fixtures.
      // SubHireGroup is nested under SubHire, not directly on Project.
      subHires: {
        include: {
          supplier: { select: { name: true } },
          groups: { orderBy: { sortOrder: "asc" } },
        },
      },
      lineItems: {
        where: { status: { not: "CANCELLED" } },
        orderBy: { sortOrder: "asc" },
        include: lineItemInclude,
      },
      ...(docType === "call-sheet"
        ? {
            crewAssignments: {
              where: {
                organizationId,
                status: { notIn: ["CANCELLED", "DECLINED"] },
                ...(options?.crewMemberId ? { crewMemberId: options.crewMemberId } : {}),
                ...(options?.crewRoleId ? { crewRoleId: options.crewRoleId } : {}),
              },
              include: {
                crewMember: {
                  select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    phone: true,
                    email: true,
                    department: true,
                  },
                },
                crewRole: { select: { name: true } },
                shifts: { orderBy: { date: "asc" } },
              },
              orderBy: [
                { isProjectManager: "desc" },
                { phase: "asc" },
                { crewMember: { lastName: "asc" } },
              ],
            },
          }
        : {}),
    },
  });

  if (!projectRow) {
    throw new Error(`Project ${projectId} not found`);
  }

  // Clients live in Convex — attach instead of a Prisma join.
  const project = {
    ...projectRow,
    client: projectRow.clientId ? await getClientById(projectRow.clientId) : null,
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
   * bulk-asset record. Custom items and services have neither and
   * return null, sorting to the "No Location" bucket on packer docs.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const deriveLocationName = (row: any): string | null => {
    return row?.asset?.location?.name ?? row?.bulkAsset?.location?.name ?? null;
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
  // Services with showOnDocuments appear on quotes/invoices as their own section
  const billableServices = await prisma.projectService.findMany({
    where: {
      projectId,
      organizationId,
      showOnDocuments: true,
      status: { not: "CANCELLED" },
    },
    orderBy: { sortOrder: "asc" },
  });

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
    // Primary source: ProjectManager join table
    const projectManagers = await prisma.projectManager.findMany({
      where: { projectId, organizationId },
      include: { user: { select: { name: true, email: true } } },
      orderBy: { addedAt: "asc" },
      take: 1,
    });

    if (projectManagers.length > 0) {
      const pm = projectManagers[0];
      pmName = pm.user.name || "";
      pmEmail = pm.user.email || "";
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
    client_contact: serialized.client?.contactName || "",
    client_email: serialized.client?.contactEmail || "",
    client_phone: serialized.client?.contactPhone || "",
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
    document_date: formatDate(new Date().toISOString()),

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
