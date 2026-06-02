"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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

import { getMaintenanceRecord, deleteMaintenanceRecord } from "@/server/maintenance";
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
  formatLabel,
} from "@/lib/status-labels";
import { formatDate } from "@/lib/formatters";

const resultLabels: Record<string, string> = {
  PASS: "Pass",
  FAIL: "Fail",
  CONDITIONAL: "Conditional",
};

export default function MaintenanceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const { data: record, isLoading } = useQuery({
    queryKey: ["maintenance", orgId, id],
    queryFn: () => getMaintenanceRecord(id),
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteMaintenanceRecord(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["maintenance"] });
      toast.success("Record deleted");
      router.push("/maintenance");
    },
    onError: (e) => toast.error(e.message),
  });

  const [deleteOpen, setDeleteOpen] = useState(false);

  if (isLoading) return <DetailPageSkeleton />;
  if (!record) return <div className="py-20 text-center text-fg-3">Record not found.</div>;

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
    <RequirePermission resource="maintenance" action="read">
      <FadeIn>
        <PageMeta title={title} />
        <div className="space-y-6">
          {/* ── Header (full width) ────────────────────────────────── */}
          <div>
            {/* Breadcrumb */}
            <nav className="mb-2 flex items-center gap-1 text-sm text-fg-3">
              <Link href="/maintenance" className="hover:text-fg transition-colors">
                Maintenance
              </Link>
              <ChevronRight className="h-3.5 w-3.5" />
              <span className="text-fg-2 truncate">{title}</span>
            </nav>

            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="t-title text-fg">{title}</h1>
                  <StatusIndicator
                    category="maintenance"
                    value={status}
                    label={maintenanceStatusLabels[status] || formatLabel(status)}
                  />
                  <Badge variant="secondary">
                    {maintenanceTypeLabels[type] || formatLabel(type)}
                  </Badge>
                </div>
                <p className="text-fg-3 text-sm mt-1">
                  Created {formatDate(createdAt)}
                  {reportedBy && <> &middot; Reported by {reportedBy.name}</>}
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <CanDo resource="maintenance" action="update">
                  <Button
                    variant="outline"
                    size="sm"
                    render={<Link href={`/maintenance/${id}/edit`} />}
                  >
                    <Pencil className="mr-2 h-4 w-4" />
                    Edit
                  </Button>
                </CanDo>
                <CanDo resource="maintenance" action="delete">
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-destructive hover:bg-destructive/10"
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
                <div className="rounded-lg bg-bg-surface p-5 surface-ring sm:p-6">
                  <SectionHeader label="Description" />
                  <p className="mt-3 text-sm text-fg-2 whitespace-pre-wrap">
                    {description}
                  </p>
                </div>
              )}

              {/* Photos */}
              {Array.isArray(r.photos) && (r.photos as string[]).length > 0 && (
                <div className="rounded-lg bg-bg-surface p-5 surface-ring sm:p-6">
                  <SectionHeader label={`Photos (${(r.photos as string[]).length})`} />
                  <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
                    {(r.photos as string[]).map((url) => (
                      <a
                        key={url}
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block aspect-square overflow-hidden rounded-md border bg-bg-inset hover:opacity-90 transition-opacity"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={url} alt="" className="h-full w-full object-cover" />
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {/* Affected Assets */}
              <div className="rounded-lg bg-bg-surface p-5 surface-ring sm:p-6">
                <SectionHeader label={`Affected Assets (${assetLinks.length})`} />
                {assetLinks.length === 0 ? (
                  <p className="mt-3 py-4 text-center text-sm text-fg-3">
                    No assets linked to this record.
                  </p>
                ) : (
                  <div className="mt-3 space-y-2">
                    {assetLinks.map((link) => (
                      <Link
                        key={link.assetId}
                        href={`/assets/registry/${link.assetId}`}
                        className="flex items-center gap-3 rounded-lg border p-3 hover:bg-accent/50 transition-colors"
                      >
                        <Wrench className="h-4 w-4 text-fg-3 shrink-0" />
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">
                            <span className="font-mono">{link.asset.assetTag}</span>
                            {link.asset.customName && (
                              <span className="text-fg-2"> &middot; {link.asset.customName}</span>
                            )}
                          </p>
                          <p className="text-xs text-fg-3 truncate">{link.asset.model.name}</p>
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </div>

              {/* Work Details */}
              {(partsUsed || cost != null || result) && (
                <div className="rounded-lg bg-bg-surface p-5 surface-ring sm:p-6">
                  <SectionHeader label="Work Details" />
                  <div className="mt-3 space-y-3 text-sm">
                    {result && (
                      <div className="flex items-center justify-between">
                        <span className="text-fg-3">Result</span>
                        <Badge
                          variant={
                            result === "PASS"
                              ? "default"
                              : result === "FAIL"
                                ? "destructive"
                                : "secondary"
                          }
                        >
                          {resultLabels[result] || formatLabel(result)}
                        </Badge>
                      </div>
                    )}
                    {cost != null && (
                      <div className="flex items-center justify-between">
                        <span className="text-fg-3 flex items-center gap-1.5">
                          <DollarSign className="h-3.5 w-3.5" />
                          Cost
                        </span>
                        <span className="font-medium t-data">${Number(cost).toFixed(2)}</span>
                      </div>
                    )}
                    {partsUsed && (
                      <div>
                        <span className="text-fg-3 block mb-1">Parts Used</span>
                        <p className="text-fg-2 whitespace-pre-wrap">{partsUsed}</p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Tags */}
              {tags.length > 0 && (
                <div className="rounded-lg bg-bg-surface p-5 surface-ring sm:p-6">
                  <SectionHeader label="Tags" />
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {tags.map((tag) => (
                      <Badge key={tag} variant="outline">
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
                  <Badge variant="secondary">
                    {maintenanceTypeLabels[type] || formatLabel(type)}
                  </Badge>
                </SidebarSection>

                {/* Key Dates */}
                <SidebarSection title="Key Dates">
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between">
                      <span className="text-fg-3 flex items-center gap-1.5">
                        <Calendar className="h-3.5 w-3.5" />
                        Scheduled
                      </span>
                      <span className="font-medium">{formatDate(scheduledDate)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-fg-3 flex items-center gap-1.5">
                        <Calendar className="h-3.5 w-3.5" />
                        Completed
                      </span>
                      <span className="font-medium">{formatDate(completedDate)}</span>
                    </div>
                    {nextDueDate && (
                      <div className="flex justify-between">
                        <span className="text-fg-3 flex items-center gap-1.5">
                          <Calendar className="h-3.5 w-3.5" />
                          Next Due
                        </span>
                        <span className="font-medium">{formatDate(nextDueDate)}</span>
                      </div>
                    )}
                  </div>
                </SidebarSection>

                {/* Assigned To */}
                <SidebarSection title="Assigned To">
                  <div className="flex items-center gap-2 text-sm">
                    <User className="h-3.5 w-3.5 text-fg-3 shrink-0" />
                    <span className="font-medium">
                      {assignedTo?.name || "Unassigned"}
                    </span>
                  </div>
                </SidebarSection>

                {/* Affected Assets Summary */}
                <SidebarSection title="Affected Assets">
                  {assetLinks.length === 0 ? (
                    <p className="text-sm text-fg-3">None</p>
                  ) : (
                    <div className="space-y-1 text-sm">
                      {assetLinks.slice(0, 5).map((link) => (
                        <Link
                          key={link.assetId}
                          href={`/assets/registry/${link.assetId}`}
                          className="block truncate font-mono text-fg-2 hover:text-fg hover:underline"
                        >
                          {link.asset.assetTag}
                        </Link>
                      ))}
                      {assetLinks.length > 5 && (
                        <p className="text-fg-3">+{assetLinks.length - 5} more</p>
                      )}
                    </div>
                  )}
                </SidebarSection>

                {/* Result (if present) */}
                {result && (
                  <SidebarSection title="Result">
                    <Badge
                      variant={
                        result === "PASS"
                          ? "default"
                          : result === "FAIL"
                            ? "destructive"
                            : "secondary"
                      }
                    >
                      {resultLabels[result] || formatLabel(result)}
                    </Badge>
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
    </RequirePermission>
  );
}
