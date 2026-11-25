"use client";

import { useState } from "react";
import Link from "next/link";
import { FileText } from "lucide-react";

import type { NativeAssetDetail } from "@/lib/asset-detail-reconstruct";
import { useAssetWrites } from "@/hooks/use-asset-writes";
import { useOptimisticAssetNotes } from "@/hooks/use-native-asset-writes";
import { useMediaWrites } from "@/hooks/use-media-writes";
import { ActivityTimeline } from "@/components/activity/activity-timeline";
import { EntityCommentsButton } from "@/components/collaboration/entity-comments-button";
import { MediaUploader, type MediaItem } from "@/components/media/media-uploader";
import { NotesEditor } from "@/components/ui/notes-editor";
import { StatusWord } from "@/components/ui/status-word";
import { getStatusIntent } from "@/lib/status-colors";
import { isAssetPhotoCustom } from "@/lib/media-utils";
import { formatDate } from "@/lib/formatters";
import { lineItemStatusLabels, maintenanceStatusLabels, maintenanceTypeLabels, mediaTypeLabels, formatLabel } from "@/lib/status-labels";
import { cn, focusRing } from "@/lib/utils";

type Asset = NativeAssetDetail;
const PAGE = 8;

const Empty = ({ title, hint }: { title: string; hint: string }) => (
  <div className="py-10 text-center">
    <p className="text-ui-text text-ink-2">{title}</p>
    <p className="mt-1 text-caption text-muted">{hint}</p>
  </div>
);

/** Words with the active one underlined (never a segmented control). */
function FilterWords<K extends string>({ value, onChange, items }: { value: K; onChange: (k: K) => void; items: [K, string][] }) {
  return (
    <div className="flex gap-5" role="group" aria-label="Filter">
      {items.map(([k, label]) => (
        <button key={k} type="button" aria-pressed={value === k} onClick={() => onChange(k)}
          className={cn("min-h-11 border-b-2 pb-0.5 text-table-cell md:min-h-9", value === k ? "border-red font-semibold text-ink" : "border-transparent text-muted hover:text-ink")}>
          {label}
        </button>
      ))}
    </div>
  );
}

/** History: the jobs this unit has been on, and the changes to its record (the old History tab and the sidebar Activity feed, merged). */
export function HistoryTab({ asset }: { asset: Asset }) {
  const [filter, setFilter] = useState<"all" | "jobs" | "changes">("all");
  const [shown, setShown] = useState(PAGE);
  const jobs = asset.lineItems;
  const jobRows = jobs.slice(0, shown);
  return (
    <div className="space-y-6">
      <FilterWords value={filter} onChange={setFilter} items={[["all", "All"], ["jobs", "Jobs"], ["changes", "Changes"]]} />
      {filter !== "changes" ? (
        <section aria-label="Jobs">
          {jobs.length === 0 ? <Empty title="No job history yet" hint="It will show up here once this unit is on a job." /> : (
            <ul>
              {jobRows.map((li) => (
                <li key={li.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-t border-line py-2 text-table-cell">
                  <Link href={`/projects/${li.projectId}`} className={cn("font-semibold text-ink hover:text-link hover:underline", focusRing)}>{li.project.name}</Link>
                  <span className="t-mono text-muted">{li.project.projectNumber}</span>
                  <StatusWord status={{ label: lineItemStatusLabels[li.status] ?? formatLabel(li.status), intent: getStatusIntent("lineItem", li.status) }} />
                  <span className="text-muted tabular-nums">
                    {li.checkedOutAt ? `Out ${formatDate(li.checkedOutAt)}` : "Assigned"}
                    {li.returnedAt ? ` · returned ${formatDate(li.returnedAt)}` : li.checkedOutAt ? " · still out" : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {jobs.length > shown ? (
            <button type="button" onClick={() => setShown((n) => n + PAGE)} className={cn("mt-2 min-h-11 text-table-cell text-ink-2 hover:underline", focusRing)}>
              Show {Math.min(PAGE, jobs.length - shown)} more · {jobs.length - shown} left
            </button>
          ) : null}
          {asset.facts.jobsTruncated ? <p className="mt-2 text-caption text-muted">Showing the newest {jobs.length} jobs.</p> : null}
        </section>
      ) : null}
      {filter !== "jobs" ? (
        <section aria-label="Changes">
          <h3 className="mb-2 text-card-title font-bold text-ink">Changes</h3>
          <ActivityTimeline entityType="asset" entityId={asset.id} />
        </section>
      ) : null}
    </div>
  );
}

/** Maintenance: every record linked to this unit as a row (title, type, status, date, result). */
export function MaintenanceTab({ asset }: { asset: Asset }) {
  const links = asset.maintenanceLinks;
  if (links.length === 0) return <Empty title="No maintenance records" hint="Servicing, repairs and test & tag history for this asset land here." />;
  return (
    <ul>
      {links.map(({ maintenanceRecord: m }) => <MaintenanceRow key={m.id} m={m} />)}
    </ul>
  );
}

type MaintenanceRecord = Asset["maintenanceLinks"][number]["maintenanceRecord"];

function MaintenanceRow({ m }: { m: MaintenanceRecord }) {
  const status = m.status ?? "";
  return (
    <li className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-t border-line py-2 text-table-cell">
      <Link href={`/maintenance/${m.id}`} className={cn("font-semibold text-ink hover:text-link hover:underline", focusRing)}>{m.title}</Link>
      {m.incidentType ? <span className="text-warn">Reported issue</span> : null}
      <span className="text-muted">{maintenanceTypeLabels[m.type] ?? formatLabel(m.type)}</span>
      <StatusWord status={{ label: maintenanceStatusLabels[status] ?? formatLabel(status), intent: getStatusIntent("maintenance", status) }} />
      <span className="text-muted tabular-nums">{formatDate(m.completedDate || m.scheduledDate)}</span>
      <MaintenanceResult result={m.result} />
    </li>
  );
}

function MaintenanceResult({ result }: { result: string | null }) {
  if (!result) return null;
  return <span className={result === "PASS" ? "text-ok" : "text-t-out"}>{result === "PASS" ? "Pass" : formatLabel(result)}</span>;
}

/** Files: this unit's photos (add, remove, set primary, as before) and the model's documents. */
export function FilesTab({ asset, photoUrl }: { asset: Asset; photoUrl: string | null }) {
  const media = useMediaWrites("asset");
  const photos = ((asset.media || []) as MediaItem[]).filter((m) => m.type === "PHOTO");
  const docs = ((asset.model?.media || []) as MediaItem[]).filter((m) => m.type !== "PHOTO");
  const custom = isAssetPhotoCustom(asset);
  return (
    <div className="space-y-8">
      <section aria-label="Photos">
        <h3 className="text-card-title font-bold text-ink">Photos</h3>
        <p className="mb-3 text-caption text-muted">
          {custom ? "Custom photo: remove it to go back to the model photo." : photoUrl ? "Showing the model photo. Upload one to override it." : "No photo yet."}
        </p>
        <MediaUploader
          entityType="asset"
          entityId={asset.id}
          accept="image/*"
          existingMedia={photos}
          onUploadComplete={async (f) => { await media.add({ parentId: asset.id, fileId: f.id, type: "PHOTO" }); }}
          onRemove={async (id) => { await media.remove(id); }}
          onSetPrimary={async (id) => { await media.setPrimary(asset.id, id); }}
        />
      </section>
      <section aria-label="Model documents">
        <h3 className="text-card-title font-bold text-ink">Model documents</h3>
        <p className="mb-2 text-caption text-muted">From {asset.model?.name ?? "this model"}. Manage them on the model page.</p>
        {docs.length === 0 ? <p className="text-table-cell text-muted">No documents attached to this model.</p> : (
          <ul>
            {docs.map((d) => (
              <li key={d.id} className="border-t border-line">
                <a href={d.file.url} target="_blank" rel="noopener noreferrer" className={cn("flex min-h-11 items-center gap-3 py-2 hover:bg-paper-2", focusRing)}>
                  <FileText className="size-4 text-muted" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate text-table-cell text-ink">{d.displayName || d.file.fileName}</span>
                  <span className="text-caption text-muted">{mediaTypeLabels[d.type] ?? formatLabel(d.type)} · {(d.file.fileSize / 1024).toFixed(0)} KB</span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** Notes: the note (its own tab owns it, the edit sheet does not) and the discussion on this unit. */
export function NotesTab({ asset, orgId }: { asset: Asset; orgId: string | undefined }) {
  const writes = useAssetWrites();
  const optimistic = useOptimisticAssetNotes(asset.id, orgId);
  return (
    <div className="space-y-6">
      <NotesEditor
        initialNotes={asset.notes || ""}
        onSave={optimistic.enabled ? optimistic.save : (notes) => writes.updateNotes(asset.id, notes)}
        placeholder="Add notes about this asset..."
      />
      {orgId ? (
        <section aria-label="Discussion" className="border-t border-line pt-4">
          <h3 className="mb-2 text-card-title font-bold text-ink">Discussion</h3>
          <EntityCommentsButton orgId={orgId} entityType="asset" entityId={asset.id} />
        </section>
      ) : null}
    </div>
  );
}
