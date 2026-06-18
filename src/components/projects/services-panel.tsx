"use client";

import { useMemo, useState } from "react";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { refreshProjectDetail } from "@/hooks/use-project-detail";
import { useProjectServices, refreshProjectServices, useProjectServicesSummary, refreshProjectServicesSummary, useProjectServicesLiveSync } from "@/hooks/use-project-services";
import { useServiceTemplates } from "@/hooks/use-service-templates";
import { refreshProjectCrew } from "@/hooks/use-project-crew";
import { useServerQuery } from "@/hooks/use-server-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Plus,
  Pencil,
  Trash2,
  Truck,
  PackageCheck,
  ArrowDownToLine,
  ArrowUpFromLine,
  HardHat,
  Wrench,
  DollarSign,
  MapPin,
  Clock,
  ChevronDown,
  Loader2,
  Navigation,
  Users,
  Send,
  UserCheck,
  RefreshCw,
  Copy,
  ArrowRightLeft,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";

import {
  createProjectService,
  updateProjectService,
  deleteProjectService,
  updateServiceStatus,
  updateServiceCrewStatus,
  generateProjectServices,
  cloneServicesFromProject,
  convertLineItemToService,
  generateCrewMessage,
} from "@/server/project-services";
import { useCrewRoles } from "@/hooks/use-crew";
import { getCrewMembersForAssignment } from "@/server/crew-assignments";
import {
  projectServiceSchema,
  type ProjectServiceFormValues,
} from "@/lib/validations/project-service";
import { SERVICE_TYPE_LABELS, SERVICE_STATUS_LABELS } from "@/lib/constants/services";
import { useActiveOrganization } from "@/lib/auth-client";
import { formatCurrency } from "@/lib/formatters";
import { cn, focusRing } from "@/lib/utils";
import { CanDo } from "@/components/auth/permission-gate";
import { StatusIndicator } from "@/components/ui/status-indicator";
import { PersonAvatar } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { FadeIn, StaggerList, StaggerItem } from "@/components/ui/motion";
import { ComboboxPicker, MultiComboboxPicker } from "@/components/ui/combobox-picker";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AddressInput } from "@/components/ui/address-input";
import type { PlaceResult } from "@/lib/address-autocomplete";

// ─── Constants ────────────────────────────────────────────────────────────────

type ServiceType = "DELIVERY" | "PICKUP" | "BUMP_IN" | "BUMP_OUT" | "LABOUR" | "MISC";
type ServiceStatus = "PLANNED" | "CONFIRMED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";

const SERVICE_TYPE_ICONS: Record<ServiceType, typeof Truck> = {
  DELIVERY: Truck,
  PICKUP: PackageCheck,
  BUMP_IN: ArrowDownToLine,
  BUMP_OUT: ArrowUpFromLine,
  LABOUR: HardHat,
  MISC: Wrench,
};

function formatDate(date: string | null | undefined): string {
  if (!date) return "";
  return new Date(date).toLocaleDateString("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function formatDateLong(date: string): string {
  return new Date(date).toLocaleDateString("en-AU", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface ServicesPanelProps {
  projectId: string;
  projectAddress?: string;
  projectLatitude?: number | null;
  projectLongitude?: number | null;
  projectLoadInDate?: string;
  projectLoadOutDate?: string;
  projectEventStartDate?: string;
  projectEventEndDate?: string;
}

interface ServiceRow {
  id: string;
  type: ServiceType;
  title: string;
  description: string | null;
  date: string | null;
  endDate: string | null;
  startTime: string | null;
  endTime: string | null;
  scheduledTime: string | null;
  status: ServiceStatus;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  showOnDocuments: boolean;
  unitPrice: number | null;
  lineTotal: number | null;
  costTotal: number | null;
  discount: number | null;
  vehicleDescription: string | null;
  crewCountRequired: number | null;
  crewRoleId: string | null;
  crewRole: { id: string; name: string; color: string | null } | null;
  crewAssignments: {
    id: string;
    status: string;
    estimatedCost: number | null;
    crewMember: { id: string; firstName: string; lastName: string; image: string | null };
  }[];
}

// ─── Services Panel (Timeline View) ──────────────────────────────────────────

export function ServicesPanel({
  projectId,
  projectAddress,
  projectLatitude,
  projectLongitude,
  projectLoadInDate,
  projectLoadOutDate,
  projectEventStartDate,
  projectEventEndDate,
}: ServicesPanelProps) {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  // Cross-tab live sync: re-fetch the services composites when another tab edits.
  useProjectServicesLiveSync(projectId, orgId);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingService, setEditingService] = useState<Record<string, unknown> | null>(null);
  const [preselectedType, setPreselectedType] = useState<ServiceType | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null);
  const [cloneDialogOpen, setCloneDialogOpen] = useState(false);
  const [messageTarget, setMessageTarget] = useState<{ crewMemberId: string; name: string } | null>(null);

  const { data: services = [], isLoading } = useProjectServices(projectId);

  const { data: summary } = useProjectServicesSummary(projectId);

  const { data: templates = [] } = useServiceTemplates(orgId);

  const invalidateAll = () => {
    refreshProjectServices(projectId);
    refreshProjectServicesSummary(projectId);
    refreshProjectDetail(projectId);
    refreshProjectCrew(projectId);
  };

  const deleteMutation = useServerMutation({
    mutationFn: (id: string) => deleteProjectService(id),
    onSuccess: () => {
      toast.success("Service deleted");
      setDeleteTarget(null);
      invalidateAll();
    },
    onError: (e) => toast.error(e.message),
  });

  const statusMutation = useServerMutation({
    mutationFn: ({ id, status }: { id: string; status: ServiceStatus }) =>
      updateServiceStatus(id, status),
    onSuccess: () => {
      toast.success("Status updated");
      invalidateAll();
    },
    onError: (e) => toast.error(e.message),
  });

  const generateMutation = useServerMutation({
    mutationFn: () => generateProjectServices(projectId),
    onSuccess: (result) => {
      const r = result as { created: number; lineItemsCreated: number };
      if (r.created === 0) {
        toast.info("All services already exist — nothing new to add");
      } else {
        toast.success(
          `Generated ${r.created} services${r.lineItemsCreated > 0 ? `. ${r.lineItemsCreated} added as line items on your quote.` : ""}`,
        );
      }
      invalidateAll();
    },
    onError: (e) => toast.error(e.message),
  });

  function openCreate(type?: ServiceType) {
    setEditingService(null);
    setPreselectedType(type ?? null);
    setDialogOpen(true);
  }

  function openEdit(service: Record<string, unknown>) {
    setEditingService(service);
    setPreselectedType(null);
    setDialogOpen(true);
  }

  const grouped = groupByDate(services as ServiceRow[]);
  const hasProjectDates = !!(projectLoadInDate || projectLoadOutDate || projectEventStartDate);
  const hasServices = grouped.length > 0;

  if (isLoading) {
    return (
      <FadeIn>
        <div className="space-y-4">
          {/* Skeleton date groups */}
          {[1, 2, 3].map((i) => (
            <div key={i} className="space-y-2">
              <div className="flex items-center gap-2">
                <Skeleton className="h-3 w-20" />
                <div className="h-px flex-1 bg-line" />
              </div>
              <Skeleton className="h-16 rounded-[var(--r)]" />
            </div>
          ))}
        </div>
      </FadeIn>
    );
  }

  return (
    <FadeIn>
      <div className="space-y-4">
        {/* Timeline Header */}
        <div className="flex items-center justify-between gap-2">
          <CanDo resource="project" action="update">
            <div className="flex items-center gap-2 flex-wrap">
              {/* Quick Add */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm">
                    <Plus className="h-4 w-4" />
                    Add service
                    <ChevronDown className="h-3 w-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>Service type</DropdownMenuLabel>
                  </DropdownMenuGroup>
                  {(Object.keys(SERVICE_TYPE_LABELS) as ServiceType[]).map((type) => {
                    const Icon = SERVICE_TYPE_ICONS[type];
                    return (
                      <DropdownMenuItem key={type} onClick={() => openCreate(type)}>
                        <Icon className="mr-2 h-4 w-4" />
                        {SERVICE_TYPE_LABELS[type]}
                      </DropdownMenuItem>
                    );
                  })}
                  {(templates as Record<string, unknown>[]).filter((t) => t.isActive).length > 0 && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuGroup>
                        <DropdownMenuLabel>Templates</DropdownMenuLabel>
                      </DropdownMenuGroup>
                      {(templates as Record<string, unknown>[]).filter((t) => t.isActive).map((t) => {
                        const Icon = SERVICE_TYPE_ICONS[t.type as ServiceType];
                        return (
                          <DropdownMenuItem
                            key={t.id as string}
                            onClick={() => {
                              setEditingService(null);
                              setPreselectedType(t.type as ServiceType);
                              setDialogOpen(true);
                            }}
                          >
                            <Icon className="mr-2 h-4 w-4" />
                            {t.title as string}
                          </DropdownMenuItem>
                        );
                      })}
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>

              {/* Generate / Regenerate */}
              {hasProjectDates && (
                <Button
                  size="sm"
                  variant={hasServices ? "line" : "primary"}
                  onClick={() => generateMutation.mutate()}
                  disabled={generateMutation.isPending}
                >
                  {generateMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : hasServices ? (
                    <RefreshCw className="h-4 w-4" />
                  ) : (
                    <Sparkles className="h-4 w-4" />
                  )}
                  {hasServices ? "Regenerate" : "Generate services"}
                </Button>
              )}

              {/* Import from another project */}
              <Button
                size="sm"
                variant="line"
                onClick={() => setCloneDialogOpen(true)}
              >
                <Copy className="h-4 w-4" />
                Import services
              </Button>
            </div>
          </CanDo>
        </div>

        {/* Empty State */}
        {!hasServices && (
          <EmptyState
            title="No logistics yet"
            description={
              hasProjectDates
                ? "Generate delivery, bump-in, and pickup from your project dates — or add them by hand."
                : "Set project dates first, then generate the run automatically."
            }
            action={
              hasProjectDates ? (
                <Button
                  variant="line"
                  size="sm"
                  onClick={() => generateMutation.mutate()}
                  disabled={generateMutation.isPending}
                >
                  {generateMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Generate services
                </Button>
              ) : undefined
            }
          />
        )}

        {/* Timeline — Date Groups */}
        {hasServices && (
          <StaggerList>
            {grouped.map(({ dateLabel, dateKey, dateLong, items }) => (
              <StaggerItem key={dateKey}>
                <div className="space-y-2">
                  {/* Date header — red overline chip + extending line (D3) */}
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center rounded-full bg-red-soft px-2 py-0.5 text-badge font-bold text-red">
                      {dateLabel}
                    </span>
                    <div className="h-px flex-1 bg-line" />
                    {dateLong && (
                      <span className="text-caption text-faint">{dateLong}</span>
                    )}
                  </div>

                  {/* Service cards within this date */}
                  <div className="space-y-2">
                    {items.map((service) => (
                      <ServiceCard
                        key={service.id}
                        service={service}
                        onEdit={() => openEdit(service as unknown as Record<string, unknown>)}
                        onDelete={() => setDeleteTarget({ id: service.id, title: service.title })}
                        onStatusChange={(status) =>
                          statusMutation.mutate({ id: service.id, status })
                        }
                        onCrewMessage={(crewMemberId, name) =>
                          setMessageTarget({ crewMemberId, name })
                        }
                      />
                    ))}
                  </div>
                </div>
              </StaggerItem>
            ))}
          </StaggerList>
        )}

        {/* Financial Summary */}
        {summary && summary.serviceCount > 0 && (
          <div className="rounded-[var(--r-lg)] bg-card p-4 border border-line shadow-[var(--sh-card)]">
            <h4 className="t-overline text-muted mb-2 flex items-center gap-1">
              <DollarSign className="h-3.5 w-3.5" />
              Services financial summary
            </h4>
            <div className="grid gap-4 sm:grid-cols-3 text-ui-text">
              <div>
                <span className="text-muted">On documents</span>
                <p className="font-medium tabular-nums text-ink-2">{formatCurrency(summary.onDocumentsTotal)}</p>
              </div>
              <div>
                <span className="text-muted">Internal</span>
                <p className="font-medium tabular-nums text-ink-2">{formatCurrency(summary.internalTotal)}</p>
              </div>
              <div>
                <span className="text-muted">Total</span>
                <p className="font-semibold tabular-nums text-ink">{formatCurrency(summary.totalCost)}</p>
              </div>
            </div>
          </div>
        )}

        {/* Delete Confirmation Dialog */}
        <Dialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Delete service</DialogTitle>
            </DialogHeader>
            <p className="text-ui-text text-ink-2">
              Are you sure you want to delete &ldquo;{deleteTarget?.title}&rdquo;? This will also
              remove any linked crew assignments.
            </p>
            <DialogFooter>
              <Button variant="line" onClick={() => setDeleteTarget(null)}>
                Cancel
              </Button>
              <Button
                variant="line"
                className="border-t-out/40 text-t-out hover:bg-t-out hover:text-paper hover:border-t-out"
                onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
                disabled={deleteMutation.isPending}
              >
                {deleteMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Delete
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Clone Services Dialog */}
        <CloneServicesDialog
          open={cloneDialogOpen}
          onOpenChange={setCloneDialogOpen}
          targetProjectId={projectId}
          onSuccess={invalidateAll}
        />

        {/* Crew Message Dialog */}
        <CrewMessageDialog
          open={!!messageTarget}
          onOpenChange={() => setMessageTarget(null)}
          projectId={projectId}
          crewMemberId={messageTarget?.crewMemberId || ""}
          crewMemberName={messageTarget?.name || ""}
        />

        {/* Create/Edit Dialog */}
        <ServiceDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          projectId={projectId}
          editingService={editingService}
          preselectedType={preselectedType}
          templates={templates as Record<string, unknown>[]}
          projectAddress={projectAddress}
          projectLatitude={projectLatitude}
          projectLongitude={projectLongitude}
          projectLoadInDate={projectLoadInDate}
          projectLoadOutDate={projectLoadOutDate}
          projectEventStartDate={projectEventStartDate}
          projectEventEndDate={projectEventEndDate}
        />
      </div>
    </FadeIn>
  );
}

// ─── Service Card ─────────────────────────────────────────────────────────────

function ServiceCard({
  service,
  onEdit,
  onDelete,
  onStatusChange,
  onCrewMessage,
}: {
  service: ServiceRow;
  onEdit: () => void;
  onDelete: () => void;
  onStatusChange: (status: ServiceStatus) => void;
  onCrewMessage: (crewMemberId: string, name: string) => void;
}) {
  const Icon = SERVICE_TYPE_ICONS[service.type];
  const isCancelled = service.status === "CANCELLED";
  const isMultiDay = service.date && service.endDate &&
    new Date(service.date).toISOString().slice(0, 10) !== new Date(service.endDate).toISOString().slice(0, 10);

  // Crew cost subtotal (D12)
  const crewCostTotal = service.crewAssignments?.reduce(
    (sum, a) => sum + (a.estimatedCost ? Number(a.estimatedCost) : 0),
    0,
  ) ?? 0;

  return (
    <div className={`rounded-[var(--r-lg)] bg-card p-4 border border-line shadow-[var(--sh-card)] ${isCancelled ? "opacity-50" : ""}`}>
      <div className="flex items-start justify-between gap-2">
        {/* Left side */}
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <Icon className="h-4 w-4 text-muted shrink-0" />
            <span className={`font-medium text-ink ${isCancelled ? "line-through" : ""}`}>
              {service.title}
            </span>
            {/* Status pill using StatusIndicator (D2) */}
            <StatusIndicator
              category="service"
              value={service.status}
              label={SERVICE_STATUS_LABELS[service.status]}
              variant="pill"
            />
          </div>

          {/* Time info */}
          {isMultiDay && (
            <div className="flex items-center gap-1 text-ui-text text-muted">
              <Clock className="h-3 w-3" />
              <span>{formatDate(service.date)} – {formatDate(service.endDate)}</span>
            </div>
          )}
          {!isMultiDay && (service.startTime || service.endTime) && (
            <div className="flex items-center gap-1 text-ui-text text-muted">
              <Clock className="h-3 w-3" />
              <span>
                {service.startTime}
                {service.endTime && ` – ${service.endTime}`}
              </span>
            </div>
          )}
          {service.scheduledTime && (service.type === "DELIVERY" || service.type === "PICKUP") && (
            <div className="flex items-center gap-1 text-ui-text text-muted">
              <Truck className="h-3 w-3" />
              <span>
                {service.type === "DELIVERY" ? "Delivery" : "Pickup"} at {service.scheduledTime}
              </span>
            </div>
          )}

          {/* Address */}
          {service.address && (
            <div className="flex items-center gap-1 text-ui-text text-muted">
              <MapPin className="h-3 w-3 shrink-0" />
              <span className="truncate">{service.address}</span>
              {service.latitude != null && service.longitude != null && (
                <a
                  href={`https://www.google.com/maps/dir/?api=1&destination=${service.latitude},${service.longitude}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn("inline-flex items-center gap-1 text-caption text-link hover:underline shrink-0 rounded-sm", focusRing)}
                  title="Get directions"
                >
                  <Navigation className="h-3 w-3" />
                </a>
              )}
            </div>
          )}

          {/* Vehicle */}
          {service.vehicleDescription && (
            <div className="text-ui-text text-muted">
              Vehicle: {service.vehicleDescription}
            </div>
          )}

          {/* Crew — avatar stack with 3 max + overflow (D14) */}
          {(service.crewRole || service.crewAssignments?.length > 0 || (service.crewCountRequired != null && service.crewCountRequired > 0)) && (
            <div className="flex items-center gap-1.5 text-ui-text text-muted flex-wrap">
              <Users className="h-3 w-3 shrink-0" />
              {service.crewRole && (
                <span
                  className="inline-flex items-center rounded-full border px-2 py-0.5 text-badge font-medium"
                  style={service.crewRole.color ? { borderColor: service.crewRole.color, color: service.crewRole.color } : undefined}
                >
                  {service.crewRole.name}
                </span>
              )}
              {service.crewAssignments?.length > 0 ? (
                <div className="flex items-center gap-1">
                  {/* Avatar stack — max 3 */}
                  <div className="flex -space-x-1">
                    {service.crewAssignments.slice(0, 3).map((a) => (
                      <button
                        key={a.id}
                        onClick={() => onCrewMessage(a.crewMember.id, `${a.crewMember.firstName} ${a.crewMember.lastName}`)}
                        className={cn("relative rounded-full", focusRing)}
                        title={`${a.crewMember.firstName} ${a.crewMember.lastName} — click to generate message`}
                      >
                        <PersonAvatar
                          name={`${a.crewMember.firstName} ${a.crewMember.lastName}`}
                          src={a.crewMember.image ?? undefined}
                          className="size-6 border-2 border-card"
                        />
                      </button>
                    ))}
                    {service.crewAssignments.length > 3 && (
                      <span className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-card bg-paper-2 text-badge font-medium">
                        +{service.crewAssignments.length - 3}
                      </span>
                    )}
                  </div>
                  {/* Crew cost subtotal (D12) */}
                  {crewCostTotal > 0 && (
                    <span className="text-caption text-muted ml-1">
                      {service.crewAssignments.length} crew · {formatCurrency(crewCostTotal)}
                    </span>
                  )}
                </div>
              ) : service.crewCountRequired != null && service.crewCountRequired > 0 ? (
                <span className="text-warn">
                  {service.crewCountRequired} needed — none assigned
                </span>
              ) : null}
              {service.crewCountRequired != null && service.crewCountRequired > 0 && service.crewAssignments?.length > 0 && service.crewAssignments.length < service.crewCountRequired && (
                <span className="text-warn text-caption">
                  ({service.crewAssignments.length}/{service.crewCountRequired})
                </span>
              )}
            </div>
          )}

          {/* Financial */}
          {(service.lineTotal != null || service.costTotal != null) && (
            <div className="flex items-center gap-3 text-ui-text">
              {service.lineTotal != null && (
                <div className="flex items-center gap-1">
                  <DollarSign className="h-3 w-3 text-muted" />
                  <span className="font-medium tabular-nums text-ink-2">{formatCurrency(service.lineTotal)}</span>
                  <span className="text-muted text-caption">charge</span>
                </div>
              )}
              {service.costTotal != null && Number(service.costTotal) > 0 && (
                <div className="flex items-center gap-1">
                  <span className="tabular-nums text-muted">{formatCurrency(service.costTotal)}</span>
                  <span className="text-muted text-caption">cost</span>
                </div>
              )}
              {service.showOnDocuments && (
                <span className="text-muted text-caption">· On quote</span>
              )}
            </div>
          )}
        </div>

        {/* Right side — actions */}
        <div className="flex items-center gap-1 shrink-0">
          <CanDo resource="project" action="update">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="size-8" title="Change status">
                  <ChevronDown className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Change status</DropdownMenuLabel>
                </DropdownMenuGroup>
                {(
                  ["PLANNED", "CONFIRMED", "IN_PROGRESS", "COMPLETED", "CANCELLED"] as ServiceStatus[]
                ).map((s) => (
                  <DropdownMenuItem
                    key={s}
                    onClick={() => onStatusChange(s)}
                    disabled={s === service.status}
                  >
                    {SERVICE_STATUS_LABELS[s]}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <Button variant="ghost" size="icon" className="size-8" onClick={onEdit} title="Edit service">
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 text-t-out"
              onClick={onDelete}
              title="Delete service"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </CanDo>
        </div>
      </div>
    </div>
  );
}

// ─── Date Grouping ────────────────────────────────────────────────────────────

function groupByDate(services: ServiceRow[]) {
  const groups: { dateLabel: string; dateKey: string; dateLong: string; items: ServiceRow[] }[] = [];
  const map = new Map<string, ServiceRow[]>();

  for (const s of services) {
    const key = s.date ? new Date(s.date).toISOString().slice(0, 10) : "no-date";
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(s);
  }

  for (const [key, items] of map) {
    if (key === "no-date") {
      groups.push({ dateLabel: "Unscheduled", dateKey: key, dateLong: "", items });
    } else {
      groups.push({
        dateLabel: formatDate(items[0].date),
        dateKey: key,
        dateLong: formatDateLong(key),
        items,
      });
    }
  }

  groups.sort((a, b) => {
    if (a.dateKey === "no-date") return 1;
    if (b.dateKey === "no-date") return -1;
    return a.dateKey.localeCompare(b.dateKey);
  });

  return groups;
}

// ─── Clone Services Dialog ────────────────────────────────────────────────────

function CloneServicesDialog({
  open,
  onOpenChange,
  targetProjectId,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targetProjectId: string;
  onSuccess: () => void;
}) {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const [sourceProjectId, setSourceProjectId] = useState("");

  // Fetch recent projects to pick from
  const { data: projects = [] } = useServerQuery({
    queryKey: ["projects-list", orgId],
    queryFn: async () => {
      const { getProjects } = await import("@/server/projects");
      return getProjects();
    },
    enabled: open,
  });

  const projectOptions = (projects as { id: string; projectNumber: string; name: string }[])
    .filter((p) => p.id !== targetProjectId)
    .map((p) => ({
      value: p.id,
      label: `${p.projectNumber} — ${p.name}`,
    }));

  const cloneMutation = useServerMutation({
    mutationFn: () => cloneServicesFromProject(targetProjectId, sourceProjectId),
    onSuccess: (result) => {
      const r = result as { cloned: number };
      toast.success(`Cloned ${r.cloned} services`);
      onOpenChange(false);
      setSourceProjectId("");
      onSuccess();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Import services</DialogTitle>
        </DialogHeader>
        <p className="text-ui-text text-ink-2">
          Clone services from a previous project. Dates will be automatically adjusted to match this project.
        </p>
        <div className="space-y-1.5">
          <Label>Source project</Label>
          <ComboboxPicker
            value={sourceProjectId}
            onChange={setSourceProjectId}
            options={projectOptions}
            placeholder="Search projects..."
            searchPlaceholder="Search by name or number..."
            emptyMessage="No projects found"
          />
        </div>
        <DialogFooter>
          <Button variant="line" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => cloneMutation.mutate()}
            disabled={!sourceProjectId || cloneMutation.isPending}
          >
            {cloneMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            <ArrowRightLeft className="mr-2 h-4 w-4" />
            Clone services
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Crew Message Dialog ──────────────────────────────────────────────────────

function CrewMessageDialog({
  open,
  onOpenChange,
  projectId,
  crewMemberId,
  crewMemberName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  crewMemberId: string;
  crewMemberName: string;
}) {
  const { data: messageData, isLoading } = useServerQuery({
    queryKey: ["crew-message", projectId, crewMemberId],
    queryFn: () => generateCrewMessage(projectId, crewMemberId),
    enabled: open && !!crewMemberId,
  });

  const msg = messageData as {
    message: string;
    crewMemberName: string;
    crewMemberPhone: string | null;
    crewMemberEmail: string | null;
  } | undefined;

  function copyToClipboard() {
    if (msg?.message) {
      navigator.clipboard.writeText(msg.message);
      toast.success("Message copied to clipboard");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Message for {crewMemberName}</DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted" />
          </div>
        ) : msg ? (
          <div className="space-y-3">
            {(msg.crewMemberPhone || msg.crewMemberEmail) && (
              <div className="flex items-center gap-3 text-ui-text text-muted">
                {msg.crewMemberPhone && (
                  <a href={`tel:${msg.crewMemberPhone}`} className={cn("text-link hover:underline rounded-sm", focusRing)}>
                    {msg.crewMemberPhone}
                  </a>
                )}
                {msg.crewMemberEmail && (
                  <a href={`mailto:${msg.crewMemberEmail}`} className={cn("text-link hover:underline rounded-sm", focusRing)}>
                    {msg.crewMemberEmail}
                  </a>
                )}
              </div>
            )}
            <pre className="whitespace-pre-wrap rounded-[var(--r)] border border-line bg-paper-2 p-3 text-ui-text text-ink-2 font-sans">
              {msg.message}
            </pre>
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="line" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button onClick={copyToClipboard} disabled={!msg?.message}>
            <Copy className="mr-2 h-4 w-4" />
            Copy message
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Crew Helpers ─────────────────────────────────────────────────────────────

function CrewMemberSelect({
  needed,
  values,
  onChange,
  options,
}: {
  needed: number;
  values: string[];
  onChange: (ids: string[]) => void;
  options: { value: string; label: string; icon?: React.ReactNode }[];
}) {
  return (
    <div className="space-y-1.5">
      <Label className="flex items-center gap-2">
        Assign crew members
        <CrewCountBadge needed={needed} assigned={values.length} />
      </Label>
      <MultiComboboxPicker
        values={values}
        onChange={onChange}
        options={options}
        placeholder="Search and select crew..."
        searchPlaceholder="Search crew members..."
        emptyMessage="No crew members available"
      />
    </div>
  );
}

function CrewCountBadge({ needed, assigned }: { needed: number; assigned: number }) {
  if (needed <= 0 && assigned <= 0) return null;
  const color = needed <= 0
    ? "text-muted"
    : assigned > needed
      ? "text-t-out"
      : assigned === needed
        ? "text-ok"
        : "text-warn";
  return (
    <span className={`text-caption font-normal ${color}`}>
      ({assigned}/{needed || "?"})
    </span>
  );
}

// ─── Create/Edit Dialog ───────────────────────────────────────────────────────

function ServiceDialog({
  open,
  onOpenChange,
  projectId,
  editingService,
  preselectedType,
  templates,
  projectAddress,
  projectLatitude,
  projectLongitude,
  projectLoadInDate,
  projectLoadOutDate,
  projectEventStartDate,
  projectEventEndDate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  editingService: Record<string, unknown> | null;
  preselectedType: ServiceType | null;
  templates: Record<string, unknown>[];
  projectAddress?: string;
  projectLatitude?: number | null;
  projectLongitude?: number | null;
  projectLoadInDate?: string;
  projectLoadOutDate?: string;
  projectEventStartDate?: string;
  projectEventEndDate?: string;
}) {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const isEditing = !!editingService;

  const matchingTemplate = preselectedType
    ? templates.find((t) => t.type === preselectedType && t.isActive)
    : null;

  function getDefaultDate(type: ServiceType | null): string {
    if (!type) return projectEventStartDate || projectLoadInDate || "";
    switch (type) {
      case "DELIVERY":
      case "BUMP_IN":
        return projectLoadInDate || projectEventStartDate || "";
      case "PICKUP":
      case "BUMP_OUT":
        return projectLoadOutDate || projectEventEndDate || "";
      case "LABOUR":
      case "MISC":
        return projectEventStartDate || projectLoadInDate || "";
    }
  }

  const defaultAddress = projectAddress || "";
  const defaultLat = projectLatitude ?? null;
  const defaultLng = projectLongitude ?? null;

  const defaultValues: ProjectServiceFormValues = editingService
    ? {
        type: editingService.type as ServiceType,
        title: editingService.title as string,
        description: (editingService.description as string) || "",
        notes: (editingService.notes as string) || "",
        date: editingService.date
          ? new Date(editingService.date as string).toISOString().slice(0, 10)
          : "",
        endDate: editingService.endDate
          ? new Date(editingService.endDate as string).toISOString().slice(0, 10)
          : editingService.date
            ? new Date(editingService.date as string).toISOString().slice(0, 10)
            : "",
        startTime: (editingService.startTime as string) || "",
        endTime: (editingService.endTime as string) || "",
        scheduledTime: (editingService.scheduledTime as string) || "",
        estimatedDuration: (editingService.estimatedDuration as number) || undefined,
        address: (editingService.address as string) || "",
        latitude: editingService.latitude as number | null,
        longitude: editingService.longitude as number | null,
        showOnDocuments: (editingService.showOnDocuments as boolean) || false,
        unitPrice: (editingService.unitPrice as number) || undefined,
        discount: (editingService.discount as number) || undefined,
        costTotal: (editingService.costTotal as number) || undefined,
        taxable: editingService.taxable !== false,
        vehicleDescription: (editingService.vehicleDescription as string) || "",
        numberOfTrips: (editingService.numberOfTrips as number) || undefined,
        crewCountRequired: (editingService.crewCountRequired as number) || undefined,
        crewRoleId: (editingService.crewRoleId as string) || "",
        crewMemberIds: editingService.crewAssignments
          ? (editingService.crewAssignments as { crewMember: { id: string } }[]).map((a) => a.crewMember.id)
          : [],
      }
    : {
        type: preselectedType || "MISC",
        title: preselectedType ? SERVICE_TYPE_LABELS[preselectedType] : "",
        description: (matchingTemplate?.description as string) || "",
        notes: "",
        date: getDefaultDate(preselectedType),
        endDate: getDefaultDate(preselectedType),
        startTime: "",
        endTime: "",
        scheduledTime: "",
        address: defaultAddress,
        latitude: defaultLat,
        longitude: defaultLng,
        showOnDocuments: (matchingTemplate?.showOnDocuments as boolean) || false,
        unitPrice: (matchingTemplate?.defaultUnitPrice as number) || undefined,
        discount: undefined,
        taxable: true,
        vehicleDescription: (matchingTemplate?.defaultVehicle as string) || "",
        numberOfTrips: undefined,
        crewCountRequired: (matchingTemplate?.defaultCrewCount as number) || undefined,
        crewRoleId: "",
        crewMemberIds: [],
      };

  const form = useForm<ProjectServiceFormValues>({
    resolver: zodResolver(projectServiceSchema),
    defaultValues,
    values: open ? defaultValues : undefined,
  });

  const watchType = form.watch("type") as ServiceType;
  const showAddress = watchType === "DELIVERY" || watchType === "PICKUP" || watchType === "MISC";
  const showVehicle = watchType === "DELIVERY" || watchType === "PICKUP";
  const canBeMultiDay = watchType === "BUMP_IN" || watchType === "BUMP_OUT" || watchType === "LABOUR";
  const watchDate = form.watch("date") as string;
  const watchEndDate = form.watch("endDate") as string;
  const isCurrentlyMultiDay = canBeMultiDay && watchDate && watchEndDate && watchDate !== watchEndDate;

  // Reactive crew roles (Convex), skipped while closed (mirrors enabled:open).
  // Re-apply getCrewRoleOptions's active filter + sortOrder/name sort.
  const roleDocs = useCrewRoles(open ? orgId : undefined);
  const roleOptions = useMemo(
    () =>
      [...(roleDocs ?? [])]
        .filter((r) => r.isActive === true)
        .sort((a, b) => {
          const so = (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
          return so !== 0 ? so : a.name.localeCompare(b.name);
        })
        .map((r) => ({ value: r.id, label: r.name })),
    [roleDocs],
  );

  const { data: crewMembers = [] } = useServerQuery({
    queryKey: ["crew-members-for-assignment", orgId, projectId],
    queryFn: () => getCrewMembersForAssignment(projectId),
    enabled: open,
  });

  const crewMemberOptions: { value: string; label: string; icon: React.ReactNode }[] =
    (crewMembers as { id: string; firstName: string; lastName: string; image: string | null }[]).map((m) => ({
      value: m.id,
      label: `${m.firstName} ${m.lastName}`,
      icon: (
        <PersonAvatar
          name={`${m.firstName} ${m.lastName}`}
          src={m.image ?? undefined}
          className="size-6"
        />
      ),
    }));

  const watchCrewMemberIds = (form.watch("crewMemberIds") || []) as string[];
  const watchCrewNeeded = Number(form.watch("crewCountRequired") || 0);
  const setCrewMemberIds = (ids: string[]) => { form.setValue("crewMemberIds", ids); };

  const invalidateAll = () => {
    refreshProjectServices(projectId);
    refreshProjectServicesSummary(projectId);
    refreshProjectDetail(projectId);
    refreshProjectCrew(projectId);
  };

  const createMutation = useServerMutation({
    mutationFn: (data: ProjectServiceFormValues) =>
      createProjectService(projectId, data),
    onSuccess: () => {
      toast.success("Service added");
      invalidateAll();
      onOpenChange(false);
    },
    onError: (e) => toast.error(e.message),
  });

  const updateMutation = useServerMutation({
    mutationFn: (data: ProjectServiceFormValues) =>
      updateProjectService(editingService!.id as string, data),
    onSuccess: () => {
      toast.success("Service updated");
      invalidateAll();
      onOpenChange(false);
    },
    onError: (e) => toast.error(e.message),
  });

  const crewStatusMutation = useServerMutation({
    mutationFn: ({ status }: { status: "OFFERED" | "CONFIRMED" | "CANCELLED" }) =>
      updateServiceCrewStatus(editingService!.id as string, status),
    onSuccess: (result, { status }) => {
      const labels: Record<string, string> = {
        OFFERED: "Offers sent",
        CONFIRMED: "Crew confirmed",
        CANCELLED: "Crew cancelled",
      };
      toast.success(`${labels[status]} (${(result as { updated: number }).updated} updated)`);
      invalidateAll();
    },
    onError: (e) => toast.error(e.message),
  });

  function onSubmit(data: ProjectServiceFormValues) {
    if (isEditing) {
      updateMutation.mutate(data);
    } else {
      createMutation.mutate(data);
    }
  }

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEditing
              ? `Edit ${SERVICE_TYPE_LABELS[form.watch("type") as ServiceType]} service`
              : `Add ${SERVICE_TYPE_LABELS[watchType]} service`}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          {/* Title */}
          <div className="space-y-1.5">
            <Label>Title</Label>
            <Input {...form.register("title")} placeholder="Service title" />
            {form.formState.errors.title && (
              <p className="text-caption text-t-out">
                {form.formState.errors.title.message}
              </p>
            )}
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <Label>Description</Label>
            <Textarea
              {...form.register("description")}
              placeholder="Details..."
              rows={2}
            />
          </div>

          {/* Date & Time */}
          {canBeMultiDay ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Start date</Label>
                <Input
                  type="date"
                  {...form.register("date")}
                  onChange={(e) => {
                    form.setValue("date", e.target.value);
                    const currentEnd = form.getValues("endDate") as string;
                    if (!currentEnd || currentEnd < e.target.value) {
                      form.setValue("endDate", e.target.value);
                    }
                  }}
                />
              </div>
              <div className="space-y-1.5">
                <Label>End date</Label>
                <Input
                  type="date"
                  {...form.register("endDate")}
                  min={watchDate || undefined}
                />
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label>Date</Label>
                <Input type="date" {...form.register("date")} />
              </div>
              <div className="space-y-1.5">
                <Label>Start time</Label>
                <Input type="time" {...form.register("startTime")} />
              </div>
              <div className="space-y-1.5">
                <Label>End time</Label>
                <Input type="time" {...form.register("endTime")} />
              </div>
            </div>
          )}

          {canBeMultiDay && !isCurrentlyMultiDay && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Start time</Label>
                <Input type="time" {...form.register("startTime")} />
              </div>
              <div className="space-y-1.5">
                <Label>End time</Label>
                <Input type="time" {...form.register("endTime")} />
              </div>
            </div>
          )}

          {(watchType === "DELIVERY" || watchType === "PICKUP") && (
            <div className="space-y-1.5">
              <Label>{watchType === "DELIVERY" ? "Delivery time" : "Pickup time"}</Label>
              <Input type="time" {...form.register("scheduledTime")} />
              <p className="text-caption text-muted">
                The actual {watchType === "DELIVERY" ? "delivery" : "pickup"} time (separate from crew work window)
              </p>
            </div>
          )}

          {/* Address */}
          {showAddress && (
            <div className="space-y-1.5">
              <Label>
                {watchType === "DELIVERY"
                  ? "Delivery to"
                  : watchType === "PICKUP"
                    ? "Pickup from"
                    : "Address"}
              </Label>
              <AddressInput
                value={form.watch("address") || ""}
                onChange={(v) => form.setValue("address", v)}
                onPlaceSelect={(place: PlaceResult | null) => {
                  if (place) {
                    form.setValue("latitude", place.latitude);
                    form.setValue("longitude", place.longitude);
                  } else {
                    form.setValue("latitude", null);
                    form.setValue("longitude", null);
                  }
                }}
                initialCoordinates={
                  form.getValues("latitude") != null
                    ? {
                        latitude: form.getValues("latitude") as number,
                        longitude: form.getValues("longitude") as number,
                      }
                    : undefined
                }
              />
            </div>
          )}

          {/* Vehicle */}
          {showVehicle && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Vehicle</Label>
                <Input
                  {...form.register("vehicleDescription")}
                  placeholder="e.g. 3-tonne truck"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Number of Trips</Label>
                <Input
                  type="number"
                  min={1}
                  {...form.register("numberOfTrips")}
                  placeholder="1"
                />
              </div>
            </div>
          )}

          {/* Crew Section */}
          <div className="border-t pt-4 space-y-3">
            <h4 className="text-card-title font-semibold text-ink">Crew</h4>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Crew role</Label>
                <ComboboxPicker
                  value={form.watch("crewRoleId") || ""}
                  onChange={(v) => form.setValue("crewRoleId", v)}
                  options={roleOptions}
                  placeholder="Select role..."
                  allowClear
                />
              </div>
              <div className="space-y-1.5">
                <Label>Crew needed</Label>
                <Input
                  type="number"
                  min={0}
                  {...form.register("crewCountRequired")}
                  placeholder="0"
                />
              </div>
            </div>

            <CrewMemberSelect
              needed={watchCrewNeeded}
              values={watchCrewMemberIds}
              onChange={setCrewMemberIds}
              options={crewMemberOptions}
            />

            {watchCrewMemberIds.length > 0 && (
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="line"
                  size="sm"
                  disabled={!isEditing || crewStatusMutation.isPending}
                  title={!isEditing ? "Save the service first" : undefined}
                  onClick={() => crewStatusMutation.mutate({ status: "OFFERED" })}
                >
                  <Send className="mr-1.5 h-3.5 w-3.5" />
                  Send offers
                </Button>
                <Button
                  type="button"
                  variant="line"
                  size="sm"
                  disabled={!isEditing || crewStatusMutation.isPending}
                  title={!isEditing ? "Save the service first" : undefined}
                  onClick={() => crewStatusMutation.mutate({ status: "CONFIRMED" })}
                >
                  <UserCheck className="mr-1.5 h-3.5 w-3.5" />
                  Confirm all
                </Button>
                {crewStatusMutation.isPending && (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-muted" />
                )}
                {!isEditing && (
                  <span className="text-caption text-muted">Save first to send offers</span>
                )}
              </div>
            )}
          </div>

          {/* Financial Section */}
          <div className="border-t pt-4 space-y-4">
            <h4 className="text-card-title font-semibold text-ink">Pricing</h4>

            {/* Charge to Client */}
            <div className="space-y-3 rounded-[var(--r)] border border-line p-3">
              <div className="t-overline text-muted">
                Charge to client
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Rate ($)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    {...form.register("unitPrice")}
                    placeholder="0.00"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Discount ($)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    {...form.register("discount")}
                    placeholder="0.00"
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="showOnDocuments"
                  checked={form.watch("showOnDocuments")}
                  onCheckedChange={(checked) =>
                    form.setValue("showOnDocuments", !!checked)
                  }
                />
                <Label htmlFor="showOnDocuments" className="text-ui-text font-normal cursor-pointer">
                  Show on quote / invoice
                </Label>
              </div>
            </div>

            {/* Cost to Business */}
            <div className="space-y-3 rounded-[var(--r)] border border-line p-3">
              <div className="t-overline text-muted">
                Cost to Business
              </div>
              <div className="space-y-1.5">
                <Label>Total cost</Label>
                <Input
                  type="number"
                  step="0.01"
                  {...form.register("costTotal")}
                  placeholder="0.00"
                />
                <p className="text-[11px] text-faint">
                  What this service costs you (crew, transport, etc). Used for margin calculation.
                </p>
              </div>
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <Label>Internal notes</Label>
            <Textarea
              {...form.register("notes")}
              placeholder="Internal notes (not on client docs)..."
              rows={2}
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="line"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isEditing ? "Update" : "Add service"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
