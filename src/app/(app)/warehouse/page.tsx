"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Search,
  Warehouse as WarehouseIcon,
  CalendarDays,
  ChevronDown,
  PackageCheck,
  PackageOpen,
  CheckCircle,
} from "lucide-react";
import { toast } from "sonner";

import { getProjects, updateProjectStatus } from "@/server/projects";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CanDo } from "@/components/auth/permission-gate";
import { RequirePermission } from "@/components/auth/require-permission";
import { useActiveOrganization } from "@/lib/auth-client";

const WAREHOUSE_STATUSES = [
  "CONFIRMED",
  "PREPPING",
  "CHECKED_OUT",
  "ON_SITE",
  "RETURNED",
];

const statusColors: Record<string, string> = {
  CONFIRMED: "bg-green-500/10 text-green-500 border-green-500/20",
  PREPPING: "bg-amber-500/10 text-amber-500 border-amber-500/20",
  CHECKED_OUT: "bg-purple-500/10 text-purple-500 border-purple-500/20",
  ON_SITE: "bg-purple-500/10 text-purple-500 border-purple-500/20",
  RETURNED: "bg-teal-500/10 text-teal-500 border-teal-500/20",
};

const statusLabels: Record<string, string> = {
  CONFIRMED: "Confirmed",
  PREPPING: "Prepping",
  CHECKED_OUT: "Deployed",
  ON_SITE: "On Site",
  RETURNED: "Returned",
};

function formatDateRange(
  start: string | null | undefined,
  end: string | null | undefined
) {
  if (!start && !end) return "—";
  const fmt = (d: string) =>
    new Date(d).toLocaleDateString("en-AU", {
      day: "numeric",
      month: "short",
    });
  if (start && end) return `${fmt(start)} – ${fmt(end)}`;
  if (start) return `From ${fmt(start)}`;
  return `Until ${fmt(end!)}`;
}

type Project = {
  id: string;
  name: string;
  projectNumber: string;
  status: string;
  rentalStartDate?: string | null;
  rentalEndDate?: string | null;
  client?: { name: string } | null;
  lineItems?: Array<{ status: string; type: string; isKitChild: boolean }>;
};

type PendingAction = {
  project: Project;
  targetStatus: "CHECKED_OUT" | "RETURNED" | "COMPLETED";
  warningMessage: string;
};

export default function WarehousePage() {
  const [search, setSearch] = useState("");
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const queryClient = useQueryClient();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const { data, isLoading } = useQuery({
    queryKey: ["warehouse-projects", orgId, { search }],
    queryFn: () =>
      getProjects({
        search: search || undefined,
        pageSize: 100,
        includeLineItems: true,
        sortBy: "rentalStartDate",
        sortOrder: "asc",
      }),
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "CHECKED_OUT" | "RETURNED" | "COMPLETED" }) =>
      updateProjectStatus(id, status),
    onSuccess: (_, { status }) => {
      const label = status === "CHECKED_OUT" ? "Deployed" : status === "RETURNED" ? "Returned" : "Completed";
      toast.success(`Project marked as ${label}`);
      queryClient.invalidateQueries({ queryKey: ["warehouse-projects"] });
      setPendingAction(null);
    },
    onError: (e) => toast.error(e.message),
  });

  const projects = (data?.projects || []).filter((p) =>
    WAREHOUSE_STATUSES.includes(p.status)
  ) as Project[];

  function handleStatusAction(
    project: Project,
    targetStatus: "CHECKED_OUT" | "RETURNED" | "COMPLETED"
  ) {
    const lineItems = (project.lineItems || []).filter(
      (li) => li.type === "EQUIPMENT" && !li.isKitChild
    );

    if (lineItems.length === 0) {
      // No line items loaded — always show confirmation as a safety net
      setPendingAction({
        project,
        targetStatus,
        warningMessage: `Are you sure you want to mark this project as ${targetStatus === "CHECKED_OUT" ? "Deployed" : targetStatus === "RETURNED" ? "Returned" : "Completed"}?`,
      });
      return;
    }

    if (targetStatus === "CHECKED_OUT") {
      const notCheckedOut = lineItems.filter(
        (li) => li.status !== "CHECKED_OUT"
      ).length;
      if (notCheckedOut > 0) {
        setPendingAction({
          project,
          targetStatus,
          warningMessage: `${notCheckedOut} item${notCheckedOut !== 1 ? "s are" : " is"} not yet deployed. Are you sure you want to mark this project as Deployed?`,
        });
        return;
      }
    }

    if (targetStatus === "RETURNED" || targetStatus === "COMPLETED") {
      const notReturned = lineItems.filter(
        (li) => li.status === "CHECKED_OUT"
      ).length;
      if (notReturned > 0) {
        setPendingAction({
          project,
          targetStatus,
          warningMessage: `${notReturned} item${notReturned !== 1 ? "s have" : " has"} not been returned yet. Are you sure you want to mark this project as ${targetStatus === "RETURNED" ? "Returned" : "Completed"}?`,
        });
        return;
      }
    }

    // All items in expected state — still confirm
    setPendingAction({
      project,
      targetStatus,
      warningMessage: `Mark this project as ${targetStatus === "CHECKED_OUT" ? "Deployed" : targetStatus === "RETURNED" ? "Returned" : "Completed"}?`,
    });
  }

  return (
    <RequirePermission resource="warehouse" action="read">
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Warehouse</h1>
        <p className="text-muted-foreground">
          Deploy and return equipment for active projects.
        </p>
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search by project name or number..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Project cards */}
      {isLoading ? (
        <div className="text-muted-foreground">Loading...</div>
      ) : projects.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            <WarehouseIcon className="mx-auto mb-2 h-8 w-8 opacity-50" />
            <p>No projects ready for warehouse operations.</p>
            <p className="text-xs mt-1">
              Projects will appear here when they reach Confirmed status.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <Card key={project.id} className="hover:shadow-md transition-shadow">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs text-muted-foreground">
                    {project.projectNumber}
                  </span>
                  <Badge
                    variant="outline"
                    className={statusColors[project.status] || ""}
                  >
                    {statusLabels[project.status] || project.status}
                  </Badge>
                </div>
                <CardTitle className="text-base">
                  <Link
                    href={`/warehouse/${project.id}`}
                    className="hover:underline"
                  >
                    {project.name}
                  </Link>
                </CardTitle>
                {project.client && (
                  <p className="text-sm text-muted-foreground">
                    {project.client.name}
                  </p>
                )}
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <CalendarDays className="h-3.5 w-3.5" />
                  <span>
                    {formatDateRange(
                      project.rentalStartDate as string | null,
                      project.rentalEndDate as string | null
                    )}
                  </span>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    render={<Link href={`/warehouse/${project.id}`} />}
                  >
                    <WarehouseIcon className="mr-2 h-4 w-4" />
                    Open
                  </Button>
                  <CanDo resource="warehouse" action="check_out">
                    <DropdownMenu>
                      <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
                        Actions
                        <ChevronDown className="ml-1 h-3 w-3" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {project.status !== "CHECKED_OUT" && project.status !== "ON_SITE" && project.status !== "RETURNED" && project.status !== "COMPLETED" && (
                          <DropdownMenuItem
                            onClick={() => handleStatusAction(project, "CHECKED_OUT")}
                          >
                            <PackageOpen className="mr-2 h-4 w-4" />
                            Mark Deployed
                          </DropdownMenuItem>
                        )}
                        {(project.status === "CHECKED_OUT" || project.status === "ON_SITE") && (
                          <DropdownMenuItem
                            onClick={() => handleStatusAction(project, "RETURNED")}
                          >
                            <PackageCheck className="mr-2 h-4 w-4" />
                            Mark Returned
                          </DropdownMenuItem>
                        )}
                        {(project.status === "RETURNED" || project.status === "CHECKED_OUT" || project.status === "ON_SITE") && (
                          <DropdownMenuItem
                            onClick={() => handleStatusAction(project, "COMPLETED")}
                          >
                            <CheckCircle className="mr-2 h-4 w-4" />
                            Mark Completed
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </CanDo>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Confirmation dialog */}
      <Dialog open={!!pendingAction} onOpenChange={(open) => { if (!open) setPendingAction(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {pendingAction?.targetStatus === "CHECKED_OUT"
                ? "Mark as Deployed?"
                : pendingAction?.targetStatus === "RETURNED"
                ? "Mark as Returned?"
                : "Mark as Completed?"}
            </DialogTitle>
            <DialogDescription>
              {pendingAction?.warningMessage}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingAction(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (pendingAction) {
                  statusMutation.mutate({
                    id: pendingAction.project.id,
                    status: pendingAction.targetStatus,
                  });
                }
              }}
              disabled={statusMutation.isPending}
            >
              {statusMutation.isPending ? "Updating..." : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
    </RequirePermission>
  );
}
