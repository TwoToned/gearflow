"use client";

import { useActiveOrganization } from "@/lib/auth-client";
import { useProjectServicesSummary } from "@/hooks/use-project-services";
import { useProjectLabourCost } from "@/hooks/use-project-crew";
import { formatCurrency } from "@/lib/formatters";
import { NotesEditor } from "@/components/ui/notes-editor";
import { FinancialSummary } from "@/components/projects/financial-summary";
import { ProjectFinancePanel } from "@/components/projects/project-finance-panel";
import { BillingSummaryRow } from "@/components/projects/billing-summary-row";
import { StalePricingBanner } from "@/components/projects/stale-pricing-banner";
import { ProjectCostsPanel } from "@/components/projects/project-costs-panel";
import { VersionNotTrackedNote } from "@/components/projects/version-not-tracked-note";
import { useProjectVersion } from "@/components/projects/project-version-context";

/**
 * The job page's tab bodies that used to live at the bottom of
 * `src/app/(app)/projects/[id]/page.tsx`, moved out unchanged (UX Phase 7) so
 * the page stays small enough for Phases 9 and 10 to merge into.
 */

export function ProjectSummaryStrip({
  projectId,
  equipmentRevenue,
  total,
}: {
  projectId: string;
  equipmentRevenue: number | null;
  total: number | null;
}) {
  const { data: summaryOrg } = useActiveOrganization();
  const { data: labourData } = useProjectLabourCost(projectId, summaryOrg?.id);

  const { data: serviceData } = useProjectServicesSummary(projectId);

  // A faint em-dash for an empty/placeholder metric — calm, not loud.
  const emptyValue = <span className="text-muted">{"—"}</span>;

  const metrics: {
    label: string;
    value: React.ReactNode;
    bold?: boolean;
  }[] = [
    {
      label: "Equipment",
      value: equipmentRevenue != null ? formatCurrency(equipmentRevenue) : emptyValue,
    },
    {
      // Lead with the charge; the cost rides along as a quiet muted sub-part.
      label: "Services",
      value: serviceData ? (
        <span>
          {formatCurrency(serviceData.chargeTotal)}
          <span className="font-normal text-muted"> · {formatCurrency(serviceData.costTotal)} cost</span>
        </span>
      ) : (
        emptyValue
      ),
    },
    {
      label: "Crew",
      value: labourData ? (
        <span>
          {formatCurrency(Number(labourData.totalLabourCost))}
          <span className="font-normal text-muted"> · {labourData.assignmentCount}</span>
        </span>
      ) : (
        emptyValue
      ),
    },
    {
      label: "Total",
      value: total != null ? formatCurrency(total) : emptyValue,
      bold: true,
    },
  ];

  // Inline metrics strip (single surface, vertical dividers) per DESIGN dashboard rule.
  return (
    <div className="grid grid-cols-2 gap-px rounded-[var(--r)] border border-line bg-line shadow-[var(--sh-card)] sm:grid-cols-4 sm:gap-0 sm:divide-x sm:divide-line sm:bg-card">
      {metrics.map((m) => (
        <div
          key={m.label}
          className="bg-card px-4 py-3 sm:first:rounded-l-[var(--r)] sm:last:rounded-r-[var(--r)]"
        >
          <div className="t-overline text-muted">
            {m.label}
          </div>
          <div
            className={
              m.bold
                ? "text-card-title font-bold tabular-nums tracking-tight text-ink"
                : "text-ui-text font-semibold tabular-nums text-ink-2"
            }
          >
            {m.value}
          </div>
        </div>
      ))}
    </div>
  );
}

interface FinanceTabSlotProps {
  projectId: string;
  orgId: string | undefined;
  projectNumber: string;
  clientId: string | null | undefined;
  projectStatus: string | null | undefined;
  subtotal: number | null;
  taxAmount: number | null;
  total: number | null;
  rentalStartDate: Date | null;
  rentalEndDate: Date | null;
  billingWeeksOverride: number | null;
  billingDaysOverride: number | null;
  categories: { groups: { title: string; quantity: number; price: unknown }[] }[] | undefined;
  equipmentRevenue: number | null;
  saleRevenue: number | null;
  saleCostTotal: number | null;
  serviceCostTotal: number | null;
  labourCostTotal: number | null;
  subHireCostTotal: number | null;
  discountPercent: number | null;
  discountAmount: number | null;
  taxRate: number | null;
  margin: number | null;
  depositPaid: number | null;
  invoicedTotal: number | null;
}

export function FinanceTabSlot(props: FinanceTabSlotProps) {
  const { isViewingVersion } = useProjectVersion();
  const allGroups = props.categories?.flatMap((c) => c.groups) ?? [];
  const totalGroupCount = allGroups.length;
  const pricedGroupCount = allGroups.filter((g) => g.price != null && Number(g.price) > 0).length;
  const groupBreakdown = allGroups
    .filter((g) => g.price != null && Number(g.price) > 0)
    .map((g) => ({ title: g.title, quantity: g.quantity, price: Number(g.price) }));

  return (
    <>
      {/* Recalculate is a live-data write action — not meaningful while
          viewing a read-only historical version. */}
      {!isViewingVersion && <StalePricingBanner projectId={props.projectId} orgId={props.orgId} />}
      {/* The invoice ledger is project-level, never per-version (design doc
          decision 3 — invoices are lineage-labelled, not per-version
          ledgers), so it stays live regardless of the viewed version. */}
      <ProjectFinancePanel
        projectId={props.projectId}
        projectNumber={props.projectNumber}
        clientId={props.clientId}
        projectStatus={props.projectStatus}
        subtotal={props.subtotal}
        taxAmount={props.taxAmount}
        total={props.total}
      />
      <div className="h-px bg-line" />
      {/* The money breakdown below is always the LIVE project's — Phase 5
          didn't extend this tab's read hooks with a `versionId` arg (scoped
          to Equipment, the mockups' one worked example). A viewed version's
          OWN figures aren't computable without recalculating totals against
          that version's own line items (`recalcVersionTotals`, a Convex-side
          job), which is out of scope here — flagged, not silently dropped. */}
      {isViewingVersion && <VersionNotTrackedNote what="This financial breakdown" />}
      <BillingSummaryRow
        projectId={props.projectId}
        orgId={props.orgId}
        rentalStartDate={props.rentalStartDate}
        rentalEndDate={props.rentalEndDate}
        billingWeeksOverride={props.billingWeeksOverride}
        billingDaysOverride={props.billingDaysOverride}
      />
      <FinancialSummary
        equipmentRevenue={props.equipmentRevenue}
        saleRevenue={props.saleRevenue}
        saleCostTotal={props.saleCostTotal}
        serviceChargeTotal={
          props.subtotal != null && props.equipmentRevenue != null
            ? props.subtotal - props.equipmentRevenue - (props.saleRevenue ?? 0)
            : null
        }
        serviceCostTotal={props.serviceCostTotal}
        labourCostTotal={props.labourCostTotal}
        subHireCostTotal={props.subHireCostTotal}
        subtotal={props.subtotal}
        discountPercent={props.discountPercent}
        discountAmount={props.discountAmount}
        taxRate={props.taxRate}
        taxAmount={props.taxAmount}
        total={props.total}
        margin={props.margin}
        depositPaid={props.depositPaid}
        invoicedTotal={props.invoicedTotal}
        pricedGroupCount={pricedGroupCount}
        totalGroupCount={totalGroupCount}
        groupBreakdown={groupBreakdown}
      />
      <div className="h-px bg-line" />
      <ProjectCostsPanel projectId={props.projectId} />
    </>
  );
}

interface NotesTabSlotProps {
  liveCrewNotes: string;
  liveInternalNotes: string;
  liveClientNotes: string;
  onChanged: () => void;
  onSave: (field: "crewNotes" | "internalNotes" | "clientNotes", notes: string) => Promise<unknown>;
}

function ReadOnlyNoteBlock({ title, value }: { title: string; value: string | null }) {
  return (
    <div className="rounded-[var(--r-lg)] border-2 border-line bg-card p-4">
      <h3 className="text-card-title font-bold text-ink">{title}</h3>
      <p className="mt-2 whitespace-pre-wrap text-ui-text text-ink-2">{value || "—"}</p>
    </div>
  );
}

/**
 * `crewNotes`/`internalNotes`/`clientNotes` ARE PLAN FIELDS
 * (`convex/lib/versionPlanFields.ts`), so the caller already hands this
 * component the COMPOSED value (design §5 D32) — a non-live version's own
 * captured text, no separate snapshot-projection read needed anymore. Notes
 * writes (`useOptimisticProjectNotes`) patch the LIVE `projects` row only
 * (#1221 follow-up closed this same class of gap for new equipment/group/
 * category/service INSERTS — see `EquipmentTabProps.addDisabledReason`'s
 * doc comment — but notes are a PLAN FIELD on `projects` itself, not one of
 * the five versioned plan tables, so this one is untouched by that fix), so
 * this stays READ-ONLY while viewing a non-live version rather than
 * silently writing the wrong version's notes.
 */
export function NotesTabSlot({ liveCrewNotes, liveInternalNotes, liveClientNotes, onChanged, onSave }: NotesTabSlotProps) {
  const { isViewingVersion, viewingVersion } = useProjectVersion();

  if (isViewingVersion && viewingVersion) {
    return (
      <div className="grid gap-4 pt-4">
        <p className="text-caption text-muted">Notes as captured in v{viewingVersion.number} — read-only.</p>
        <ReadOnlyNoteBlock title="Crew notes" value={liveCrewNotes} />
        <ReadOnlyNoteBlock title="Internal notes" value={liveInternalNotes} />
        <ReadOnlyNoteBlock title="Client notes" value={liveClientNotes} />
      </div>
    );
  }

  return (
    <div className="grid gap-4 pt-4">
      <NotesEditor
        title="Crew notes"
        initialNotes={liveCrewNotes}
        onChanged={onChanged}
        onSave={(notes) => onSave("crewNotes", notes)}
        placeholder="Notes for crew members..."
        rows={4}
      />
      <NotesEditor
        title="Internal notes"
        initialNotes={liveInternalNotes}
        onChanged={onChanged}
        onSave={(notes) => onSave("internalNotes", notes)}
        placeholder="Internal notes (not visible to client)..."
        rows={4}
      />
      <NotesEditor
        title="Client notes"
        initialNotes={liveClientNotes}
        onChanged={onChanged}
        onSave={(notes) => onSave("clientNotes", notes)}
        placeholder="Notes visible to client on documents... supports **bold**, *italic*, and '- ' bullets."
        rows={4}
      />
    </div>
  );
}
