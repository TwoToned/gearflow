"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";

import { ActivityTimeline } from "@/components/activity/activity-timeline";
import { MaintenanceSheetHost } from "@/components/maintenance/maintenance-sheet-host";
import { CompleteRecordDialog } from "@/components/maintenance/record/complete-record-dialog";
import { PartsTab } from "@/components/maintenance/record/parts-tab";
import { useMaintenanceRecordWrites } from "@/components/maintenance/record/use-maintenance-record-writes";
import { Facts, HealthRows, Headline, RecordRows, RecordShell, type HealthItem, type RecordTab } from "@/components/people/record-shell";
import { AppImage } from "@/components/ui/app-image";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { useMaintenanceWrites } from "@/hooks/use-maintenance-writes";
import { useStableNow } from "@/hooks/use-stable-now";
import { PHONE_MAX } from "@/lib/breakpoints";
import { formatCurrency, formatDate } from "@/lib/formatters";
import { announceListWrite } from "@/lib/list-write-toast";
import { maintenanceSheetInitialOf } from "@/lib/maintenance-sheet";
import { maintenanceChecks, maintenanceStateWord, type CheckFix, type MaintenanceChecks, type StateWord } from "@/lib/maintenance-record-facts";
import { buildMaintenanceRecordActions } from "@/lib/row-actions/maintenance";
import { showError } from "@/lib/show-error";
import { maintenanceResultLabels, maintenanceTypeLabels, formatLabel } from "@/lib/status-labels";
import { useCanDo } from "@/lib/use-permissions";
import { api } from "../../../../convex/_generated/api";

/** The record as `maintenanceRecords.recordDetail` returns it (`cost` is ABSENT for a caller who cannot see job cost). */
interface RecordDetail {
  id: string;
  title: string;
  type: string;
  status: string;
  description: string | null;
  assignedToId?: string | null;
  reportedById?: string | null;
  scheduledDate: string | null;
  completedDate: string | null;
  nextDueDate: string | null;
  result: string | null;
  partsUsed: string | null;
  tags: string[];
  photos: string[];
  attachments: string[];
  createdAt: string;
  cost?: number | null;
  assets: Array<{ assetId: string; asset: { id: string; assetTag: string; customName?: string; model: { name: string } } }>;
  assignedTo: { name: string } | null;
  reportedBy: { name: string } | null;
}

type PartsRead = NonNullable<ReturnType<typeof useAuthedQuery<typeof api.maintenanceParts.listForRecord>>>;

const ms = (iso: string | null): number | null => (iso ? Date.parse(iso) : null);
const resultLabel = (r: string | null): string | null => (r ? maintenanceResultLabels[r] ?? formatLabel(r) : null);
const dateOf = (iso: string | null): string | null => (iso ? formatDate(iso) : null);

/** The Overview: one headline word, `n of m checks clear` with each failing check's action, then three fact columns. */
function Overview({ record, word, checks, health, parts }: { record: RecordDetail; word: StateWord; checks: MaintenanceChecks; health: HealthItem[]; parts: PartsRead | undefined }) {
  const cost = parts?.cost ?? null;
  const sub = [record.status === "COMPLETED" ? resultLabel(record.result) && `Result: ${resultLabel(record.result)}` : null, cost?.total != null ? `${formatCurrency(cost.total)} so far` : null].filter(Boolean).join(" · ");
  const onOrder = parts && parts.summary.onOrder > 0 ? ` · ${parts.summary.onOrder} on order` : "";
  return (
    <div className="flex flex-col gap-8">
      <Headline sub={sub || undefined}>{word.label}{onOrder}</Headline>
      {checks.closed ? (
        <p className="text-table-cell text-muted">{record.status === "COMPLETED" ? "Completed. Reopen it if more work is needed." : "Cancelled."}</p>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-caption text-muted">{checks.clear} of {checks.total} checks clear</p>
          <HealthRows items={health} allClear="Nothing needs a look." />
        </div>
      )}
      <div className="grid gap-8 md:grid-cols-3">
        <Facts title="Dates" facts={[{ label: "Scheduled", value: dateOf(record.scheduledDate) }, { label: "Completed", value: dateOf(record.completedDate) }, { label: "Next due", value: dateOf(record.nextDueDate) }]} />
        <Facts title="Job" facts={[{ label: "Type", value: maintenanceTypeLabels[record.type] ?? formatLabel(record.type) }, { label: "Assigned to", value: record.assignedTo?.name }, { label: "Reported by", value: record.reportedBy?.name }, { label: "Result", value: resultLabel(record.result) }]} />
        {cost ? <Facts title="Cost" facts={[{ label: "Parts", value: formatCurrency(cost.parts) }, { label: "Labour", value: cost.labour == null ? null : formatCurrency(cost.labour) }, { label: "Total", value: cost.total == null ? null : formatCurrency(cost.total) }]} /> : <div />}
      </div>
      {record.description ? <p className="max-w-prose whitespace-pre-wrap text-table-cell text-ink-2">{record.description}</p> : null}
      {record.tags.length > 0 ? <p className="text-caption text-muted">{record.tags.join(" · ")}</p> : null}
    </div>
  );
}

/** Photos as a grid and attachments as links. */
function FilesPanel({ photos, attachments }: { photos: string[]; attachments: string[] }) {
  if (photos.length === 0 && attachments.length === 0) return <p className="py-6 text-table-cell text-muted">No photos or files.</p>;
  return (
    <div className="space-y-6">
      {photos.length > 0 ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
          {photos.map((url) => (
            <a key={url} href={url} target="_blank" rel="noopener noreferrer" className="relative block aspect-square overflow-hidden rounded-[var(--r)] border border-line bg-paper-2 hover:opacity-90">
              <AppImage src={url} alt="" fill sizes={`(max-width: ${PHONE_MAX}px) 50vw, 200px`} className="object-cover" />
            </a>
          ))}
        </div>
      ) : null}
      {attachments.length > 0 ? (
        <ul className="divide-y divide-line border-y border-line">
          {attachments.map((url) => (
            <li key={url} className="py-2 text-table-cell"><Link href={url} target="_blank" rel="noopener noreferrer" className="text-ink hover:underline">{url.split("/").pop() || url}</Link></li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

type Writes = ReturnType<typeof useMaintenanceRecordWrites>;

/** Complete, Reopen and Delete, each toasted; Complete and Reopen carry the Undo of THEIR OWN audit id (none after a Retire). */
function recordCommands(a: { id: string; title: string; writes: Writes; remove: (id: string) => Promise<unknown>; onDeleted: () => void }) {
  const announce = (title: string, undoneTitle: string, auditId: string, undoable = true) =>
    announceListWrite({ title, undoneTitle, performUndo: undoable ? async () => void (await a.writes.undoLifecycle(auditId)) : undefined });
  return {
    reopen: async () => {
      try {
        const r = await a.writes.reopen();
        announce(`Reopened ${a.title}`, "Reopen undone", r.auditId);
      } catch (e) {
        showError(e, { fallbackTitle: "Could not reopen the job" });
      }
    },
    remove: async () => {
      try {
        await a.remove(a.id);
        toast.success("Job deleted");
        a.onDeleted();
      } catch (e) {
        showError(e, { fallbackTitle: "Could not delete the job" });
      }
    },
  };
}

/**
 * The maintenance RECORD page (UX Phase 14, 14b-3, §9n): a `DetailHeader` with the derived word (`Awaiting parts`,
 * `18d overdue`), Overview (`n of m checks clear`, three fact columns) · Assets · Parts · History · Files, `Complete…`
 * and `Reopen` in the ⋯ (each with an exact Undo from its toast), Edit the one primary. Cost is derived (parts +
 * labour) and ABSENT for a caller who cannot see job cost.
 */
export function MaintenanceRecord({ id, orgId }: { id: string; orgId: string | undefined }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const now = useStableNow();
  const canUpdate = useCanDo("maintenance", "update");
  const canDelete = useCanDo("maintenance", "delete");
  const record = useAuthedQuery(api.maintenanceRecords.recordDetail, orgId ? { orgId, id } : "skip") as RecordDetail | null | undefined;
  const parts = useAuthedQuery(api.maintenanceParts.listForRecord, orgId ? { orgId, recordId: id, now } : "skip");
  const writes = useMaintenanceRecordWrites(orgId, id);
  const recordWrites = useMaintenanceWrites();
  const [completing, setCompleting] = React.useState(false);

  if (!record) return null; // the page owns loading and not-found
  const cmd = recordCommands({ id, title: record.title, writes, remove: recordWrites.remove, onDeleted: () => router.push("/maintenance") });
  const assetCount = record.assets.length;
  const facts = { status: record.status, scheduledDate: ms(record.scheduledDate), now, assetCount, assigned: !!record.assignedTo, parts: parts ? parts.summary : null };
  const word = maintenanceStateWord(facts);
  const checks = maintenanceChecks(facts);
  const goTab = (tab: string) => router.replace(`${pathname}?tab=${tab}`, { scroll: false });
  const edit = () => {
    const q = new URLSearchParams(params.toString());
    q.set("edit", "1");
    router.push(`${pathname}?${q.toString()}`);
  };

  const fixAction = (fix: CheckFix | undefined): HealthItem["action"] => {
    if (fix === "parts") return { label: "Parts", onSelect: () => goTab("parts") };
    if (!canUpdate) return undefined;
    return fix === "complete" ? { label: "Complete", onSelect: () => setCompleting(true) } : fix === "edit" ? { label: "Edit", onSelect: edit } : undefined;
  };
  const health: HealthItem[] = checks.items.map((c) => ({ key: c.key, tone: c.tone, text: c.text, action: fixAction(c.fix) }));

  const assetRows = record.assets.map((l) => ({ id: l.assetId, title: <><span className="t-mono">{l.asset.assetTag}</span>{l.asset.customName ? ` · ${l.asset.customName}` : ""}</>, href: `/assets/registry/${l.assetId}`, meta: [l.asset.model.name] }));
  const tabs: RecordTab[] = [
    { value: "overview", label: "Overview", panel: <Overview record={record} word={word} checks={checks} health={health} parts={parts} /> },
    { value: "assets", label: "Assets", count: assetCount, panel: <RecordRows noun="asset" empty="No assets are linked to this job." rows={assetRows} /> },
    { value: "parts", label: "Parts", count: parts?.summary.count, panel: <PartsTab orgId={orgId} recordId={id} now={now} canUpdate={canUpdate} partsUsedNote={record.partsUsed} /> },
    { value: "history", label: "History", panel: <ActivityTimeline entityType="maintenance" entityId={id} limit={25} /> },
    { value: "files", label: "Files", count: record.photos.length + record.attachments.length, panel: <FilesPanel photos={record.photos} attachments={record.attachments} /> },
  ];
  const total = parts?.cost?.total ?? null;

  return (
    <>
      <RecordShell
        crumb={{ label: "Maintenance", href: "/maintenance" }}
        title={record.title}
        status={{ label: word.label, intent: word.intent, outline: word.outline }}
        meta={[maintenanceTypeLabels[record.type] ?? formatLabel(record.type), `${assetCount} asset${assetCount === 1 ? "" : "s"}`, record.assignedTo?.name].filter(Boolean)}
        onEdit={canUpdate ? edit : undefined}
        menu={buildMaintenanceRecordActions({
          title: record.title,
          status: record.status,
          onComplete: canUpdate ? () => setCompleting(true) : undefined,
          onReopen: canUpdate ? () => void cmd.reopen() : undefined,
          onDelete: canDelete ? () => void cmd.remove() : undefined,
        })}
        tabs={tabs}
        rail={<Facts title="At a glance" facts={[{ label: "Status", value: word.label }, { label: "Scheduled", value: dateOf(record.scheduledDate) }, { label: "Assigned to", value: record.assignedTo?.name }, { label: "Total", value: total != null ? formatCurrency(total) : null }]} />}
      />
      <MaintenanceSheetHost mode="edit" record={maintenanceSheetInitialOf(record)} />
      <CompleteRecordDialog orgId={orgId} id={id} open={completing} onOpenChange={setCompleting} />
    </>
  );
}
