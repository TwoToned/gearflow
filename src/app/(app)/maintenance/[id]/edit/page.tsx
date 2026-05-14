"use client";

import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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
import type { MaintenanceFormValues } from "@/lib/validations/maintenance";

export default function EditMaintenancePage({
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
    <RequirePermission resource="maintenance" action="read">
      <CanDo
        resource="maintenance"
        action="update"
        fallback={
          <div className="p-8 text-center text-fg-3">
            You don&apos;t have permission to perform this action.
          </div>
        }
      >
        <div className="mx-auto max-w-3xl space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="t-title text-fg">Edit Maintenance Record</h1>
              <p className="t-body text-fg-3">{r.title as string}</p>
            </div>
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
          <MaintenanceForm initialData={initialData} />
        </div>
      </CanDo>
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
