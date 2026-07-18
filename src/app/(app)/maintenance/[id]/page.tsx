"use client";

import { use, useState } from "react";
import { AppImage } from "@/components/ui/app-image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { useMaintenanceWrites } from "@/hooks/use-maintenance-writes";
import { api } from "../../../../../convex/_generated/api";
import {
  ChevronRight,
  Pencil,
  Trash2,
  Calendar,
  User,
  Wrench,
  DollarSign,
  Tag,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { DeleteDialog } from "@/components/ui/delete-dialog";
import { Badge } from "@/components/ui/badge";
import { useActiveOrganization } from "@/lib/auth-client";
import { CanDo } from "@/components/auth/permission-gate";
import { RequirePermission } from "@/components/auth/require-permission";
import { DetailPageSkeleton } from "@/components/ui/skeleton";
import { StatusIndicator } from "@/components/ui/status-indicator";
import { FadeIn } from "@/components/ui/motion";
import { DetailLayout, DetailMain, DetailSidebar, SectionHeader, SidebarSection } from "@/components/layout/page-layouts";
import { ActivityTimeline } from "@/components/activity/activity-timeline";
import { PageMeta } from "@/components/layout/page-meta";
import {
  maintenanceStatusLabels,
  maintenanceTypeLabels,
  maintenanceResultLabels,
  formatLabel,
} from "@/lib/status-labels";
import { formatCurrency, formatDate } from "@/lib/formatters";
import { cn, focusRing } from "@/lib/utils";

export default function MaintenanceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <RequirePermission resource="maintenance" action="read">
      <MaintenanceDetailContent params={params} />
    </RequirePermission>
  );
}

function MaintenanceDetailContent({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const record = useAuthedQuery(
    api.maintenanceRecords.recordDetail,
    orgId ? { orgId, id } : "skip",
  );
  const isLoading = record === undefined;

  // Navigates to the list on success; the list reader (reactive) remounts fresh,
  // so no cross-route invalidation is needed.
  const writes = useMaintenanceWrites();
  const deleteMutation = useServerMutation({
    mutationFn: () => writes.remove(id),
    onSuccess: () => {
      toast.success("Record deleted");
      router.push("/maintenance");
    },
    onError: (e) => toast.error(e.message),
  });

  const [deleteOpen, setDeleteOpen] = useState(false);

  if (isLoading) return <DetailPageSkeleton />;
  if (!record) {
    return (
      <div className="mx-auto max-w-3xl rounded-[var(--r-lg)] border border-line border-l-2 border-l-t-out bg-card p-6 text-center">
        <p className="text-ui-text text-ink-2">Record not found.</p>
        <p className="mt-1 text-caption text-muted">It may have been deleted, or you don&apos;t have access to it.</p>
        <Button variant="line" size="sm" className="mt-4" asChild>
          <Link href="/maintenance">Back to maintenance</Link>
        </Button>
      </div>
    );
  }

  const r = record as Record<string, unknown>;
  const assetLinks = (r.assets as Array<{ assetId: string; asset: { id: string; assetTag: string; customName?: string; model: { name: string } } }>) || [];
  const assignedTo = r.assignedTo as { name: string } | null | undefined;
  const reportedBy = r.reportedBy as { name: string } | null | undefined;
  const tags = (r.tags as string[]) ?? [];
  const status = r.status as string;
  const type = r.type as string;
  const title = r.title as string;
  const description = r.description as string | null;
  const scheduledDate = r.scheduledDate as string | null;
  const completedDate = r.completedDate as string | null;
  const nextDueDate = r.nextDueDate as string | null;
  const result = r.result as string | null;
  const cost = r.cost as number | null;
  const partsUsed = r.partsUsed as string | null;
  const createdAt = r.createdAt as string;

  return (
    <>
      <FadeIn>
        <PageMeta title={title} />
        <div className="space-y-6">
          {/* ── Header (full width) ────────────────────────────────── */}
          <div>
            {/* Breadcrumb */}
            <nav className="mb-2 flex items-center gap-1 t-small text-muted">
              <Link href="/maintenance" className={cn("rounded-sm transition-colors hover:text-ink", focusRing)}>
                Maintenance
              </Link>
              <ChevronRight className="h-3.5 w-3.5" />
              <span className="truncate text-ink-2">{title}</span>
            </nav>

            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="t-title text-ink">{title}</h1>
                  <StatusIndicator
                    category="maintenance"
                    value={status}
                    label={maintenanceStatusLabels[status] || formatLabel(status)}
                  />
                  <Badge status="neutral">
                    {maintenanceTypeLabels[type] || formatLabel(type)}
                  </Badge>
                </div>
                <p className="mt-1 t-small text-muted">
                  Created {formatDate(createdAt)}
                  {reportedBy && <> &middot; Reported by {reportedBy.name}</>}
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <CanDo resource="maintenance" action="update">
                  <Button variant="line" size="sm" asChild>
                    <Link href={`/maintenance/${id}/edit`}>
                      <Pencil className="mr-2 h-4 w-4" />
                      Edit
                    </Link>
                  </Button>
                </CanDo>
                <CanDo resource="maintenance" action="delete">
                  <Button
                    variant="line"
                    size="sm"
                    className="text-t-out hover:border-red hover:bg-red hover:text-white"
                    disabled={deleteMutation.isPending}
                    onClick={() => setDeleteOpen(true)}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete
                  </Button>
                </CanDo>
              </div>
            </div>
          </div>

          {/* ── 2-Column Layout ────────────────────────────────────── */}
          <DetailLayout>
            {/* ── Main content (left) ─────────────────────────────── */}
            <DetailMain className="space-y-6">
              {/* Description */}
              {description && (
                <div className="rounded-[var(--r)] border border-line bg-card p-5 shadow-[var(--sh-card)] sm:p-6">
                  <SectionHeader label="Description" />
                  <p className="mt-3 whitespace-pre-wrap text-ui-text text-ink-2">
                    {description}
                  </p>
                </div>
              )}

              {/* Photos */}
              {Array.isArray(r.photos) && (r.photos as string[]).length > 0 && (
                <div className="rounded-[var(--r)] border border-line bg-card p-5 shadow-[var(--sh-card)] sm:p-6">
                  <SectionHeader label={`Photos (${(r.photos as string[]).length})`} />
                  <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
                    {(r.photos as string[]).map((url) => (
                      <a
                        key={url}
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={cn("relative block aspect-square overflow-hidden rounded-[var(--r)] border border-line bg-paper-2 transition-opacity hover:opacity-90", focusRing)}
                      >
                        <AppImage src={url} alt="" fill sizes="(max-width: 768px) 50vw, 200px" className="object-cover" />
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {/* Affected assets */}
              <div className="rounded-[var(--r)] border border-line bg-card p-5 shadow-[var(--sh-card)] sm:p-6">
                <SectionHeader label={`Affected assets (${assetLinks.length})`} />
                {assetLinks.length === 0 ? (
                  <p className="mt-3 py-4 text-center text-ui-text text-muted">
                    No assets linked to this record.
                  </p>
                ) : (
                  <div className="mt-3 space-y-2">
                    {assetLinks.map((link) => (
                      <Link
                        key={link.assetId}
                        href={`/assets/registry/${link.assetId}`}
                        className={cn("flex items-center gap-3 rounded-[var(--r)] border border-line p-3 transition-colors hover:bg-elev", focusRing)}
                      >
                        <Wrench className="h-4 w-4 shrink-0 text-muted" />
                        <div className="min-w-0">
                          <p className="truncate text-ui-text font-medium text-ink">
                            <span className="t-mono">{link.asset.assetTag}</span>
                            {link.asset.customName && (
                              <span className="text-ink-2"> &middot; {link.asset.customName}</span>
                            )}
                          </p>
                          <p className="truncate text-caption text-muted">{link.asset.model.name}</p>
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </div>

              {/* Work details */}
              {(partsUsed || cost != null || result) && (
                <div className="rounded-[var(--r)] border border-line bg-card p-5 shadow-[var(--sh-card)] sm:p-6">
                  <SectionHeader label="Work details" />
                  <div className="mt-3 space-y-3 text-ui-text">
                    {result && (
                      <div className="flex items-center justify-between">
                        <span className="text-muted">Result</span>
                        <StatusIndicator
                          category="maintenanceResult"
                          value={result}
                          label={maintenanceResultLabels[result] || formatLabel(result)}
                          variant="pill"
                        />
                      </div>
                    )}
                    {cost != null && (
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-1.5 text-muted">
                          <DollarSign className="h-3.5 w-3.5" />
                          Cost
                        </span>
                        <span className="t-data font-medium text-ink tabular-nums">{formatCurrency(Number(cost))}</span>
                      </div>
                    )}
                    {partsUsed && (
                      <div>
                        <span className="mb-1 block text-muted">Parts used</span>
                        <p className="whitespace-pre-wrap text-ink-2">{partsUsed}</p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Tags */}
              {tags.length > 0 && (
                <div className="rounded-[var(--r)] border border-line bg-card p-5 shadow-[var(--sh-card)] sm:p-6">
                  <SectionHeader label="Tags" />
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {tags.map((tag) => (
                      <Badge key={tag} status="neutral">
                        <Tag className="mr-1 h-3 w-3" />
                        {tag}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </DetailMain>

            {/* ── Sidebar (right) ─────────────────────────────────── */}
            <DetailSidebar>
                {/* Status */}
                <SidebarSection title="Status">
                  <div className="flex items-center gap-2">
                    <StatusIndicator
                      category="maintenance"
                      value={status}
                      label={maintenanceStatusLabels[status] || formatLabel(status)}
                    />
                  </div>
                </SidebarSection>

                {/* Type */}
                <SidebarSection title="Type">
                  <Badge status="neutral">
                    {maintenanceTypeLabels[type] || formatLabel(type)}
                  </Badge>
                </SidebarSection>

                {/* Key dates */}
                <SidebarSection title="Key dates">
                  <div className="space-y-1 text-ui-text">
                    <div className="flex justify-between">
                      <span className="flex items-center gap-1.5 text-muted">
                        <Calendar className="h-3.5 w-3.5" />
                        Scheduled
                      </span>
                      <span className="font-medium text-ink tabular-nums">{formatDate(scheduledDate)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="flex items-center gap-1.5 text-muted">
                        <Calendar className="h-3.5 w-3.5" />
                        Completed
                      </span>
                      <span className="font-medium text-ink tabular-nums">{formatDate(completedDate)}</span>
                    </div>
                    {nextDueDate && (
                      <div className="flex justify-between">
                        <span className="flex items-center gap-1.5 text-muted">
                          <Calendar className="h-3.5 w-3.5" />
                          Next due
                        </span>
                        <span className="font-medium text-ink tabular-nums">{formatDate(nextDueDate)}</span>
                      </div>
                    )}
                  </div>
                </SidebarSection>

                {/* Assigned to */}
                <SidebarSection title="Assigned to">
                  <div className="flex items-center gap-2 text-ui-text">
                    <User className="h-3.5 w-3.5 shrink-0 text-muted" />
                    <span className="font-medium text-ink">
                      {assignedTo?.name || "Unassigned"}
                    </span>
                  </div>
                </SidebarSection>

                {/* Affected assets summary */}
                <SidebarSection title="Affected assets">
                  {assetLinks.length === 0 ? (
                    <p className="text-ui-text text-muted">None</p>
                  ) : (
                    <div className="space-y-1 text-ui-text">
                      {assetLinks.slice(0, 5).map((link) => (
                        <Link
                          key={link.assetId}
                          href={`/assets/registry/${link.assetId}`}
                          className={cn("block truncate rounded-sm t-mono text-ink-2 hover:text-ink hover:underline", focusRing)}
                        >
                          {link.asset.assetTag}
                        </Link>
                      ))}
                      {assetLinks.length > 5 && (
                        <p className="text-muted">+{assetLinks.length - 5} more</p>
                      )}
                    </div>
                  )}
                </SidebarSection>

                {/* Result (if present) */}
                {result && (
                  <SidebarSection title="Result">
                    <StatusIndicator
                      category="maintenanceResult"
                      value={result}
                      label={maintenanceResultLabels[result] || formatLabel(result)}
                      variant="pill"
                    />
                  </SidebarSection>
                )}

                {/* Activity */}
                <SidebarSection title="Activity" divider={false}>
                  <ActivityTimeline entityType="maintenance" entityId={id} />
                </SidebarSection>
            </DetailSidebar>
          </DetailLayout>
        </div>
      </FadeIn>
      <DeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete maintenance record?"
        description="This permanently removes the maintenance record and its work-order history. This cannot be undone."
        confirmLabel="Delete record"
        onConfirm={() => {
          deleteMutation.mutate();
          setDeleteOpen(false);
        }}
        pending={deleteMutation.isPending}
      />
    </>
  );
}
