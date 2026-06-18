"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useServerQuery } from "@/hooks/use-server-query";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { getMaintenanceRecord, deleteMaintenanceRecord } from "@/server/maintenance";
import { MaintenanceForm } from "@/components/maintenance/maintenance-form";
import { Button } from "@/components/ui/button";
import { DeleteDialog } from "@/components/ui/delete-dialog";
import { useActiveOrganization } from "@/lib/auth-client";
import { CanDo } from "@/components/auth/permission-gate";
import { RequirePermission } from "@/components/auth/require-permission";
import { DetailPageSkeleton } from "@/components/ui/skeleton";
import { FadeIn } from "@/components/ui/motion";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import type { MaintenanceFormValues } from "@/lib/validations/maintenance";

export default function EditMaintenancePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const { data: record, isLoading } = useServerQuery({
    queryKey: ["maintenance", orgId, id],
    queryFn: () => getMaintenanceRecord(id),
  });

  // Navigates to the list on success; the list reader (useServerQuery) remounts
  // fresh, so no cross-route invalidation is needed.
  const deleteMutation = useServerMutation({
    mutationFn: () => deleteMaintenanceRecord(id),
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
      <RequirePermission resource="maintenance" action="update">
        <div className="mx-auto max-w-3xl rounded-[var(--r-lg)] border border-line border-l-2 border-l-t-out bg-card p-6 text-center">
          <p className="text-ui-text text-ink-2">Record not found.</p>
          <p className="mt-1 text-caption text-muted">It may have been deleted, or you don&apos;t have access to it.</p>
          <Button variant="line" size="sm" className="mt-4" asChild>
            <Link href="/maintenance">Back to maintenance</Link>
          </Button>
        </div>
      </RequirePermission>
    );
  }

  const r = record as Record<string, unknown>;
  const assetLinks = (r.assets as Array<{ assetId: string }>) || [];
  const initialData: MaintenanceFormValues & { id: string } = {
    id: r.id as string,
    assetIds: assetLinks.map((a) => a.assetId),
    reportedById: (r.reportedById as string) || undefined,
    type: r.type as MaintenanceFormValues["type"],
    status: r.status as MaintenanceFormValues["status"],
    title: r.title as string,
    description: (r.description as string) || "",
    assignedToId: (r.assignedToId as string) || undefined,
    scheduledDate: r.scheduledDate
      ? new Date(r.scheduledDate as string).toISOString().split("T")[0]
      : "",
    completedDate: r.completedDate
      ? new Date(r.completedDate as string).toISOString().split("T")[0]
      : "",
    cost: r.cost != null ? Number(r.cost) : undefined,
    partsUsed: (r.partsUsed as string) || "",
    result: (r.result as MaintenanceFormValues["result"]) || undefined,
    nextDueDate: r.nextDueDate
      ? new Date(r.nextDueDate as string).toISOString().split("T")[0]
      : "",
    tags: (r.tags as string[]) ?? [],
  };

  return (
    <RequirePermission resource="maintenance" action="update">
      <FadeIn>
        <div className="mx-auto max-w-3xl space-y-4">
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink render={<Link href="/maintenance" />}>Maintenance</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbLink render={<Link href={`/maintenance/${id}`} />}>{r.title as string}</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>Edit</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="t-title text-ink">Edit maintenance record</h1>
              <p className="t-body text-muted">{r.title as string}</p>
            </div>
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
          <MaintenanceForm initialData={initialData} />
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
