"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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
  getProjectServices,
  createProjectService,
  updateProjectService,
  deleteProjectService,
  updateServiceStatus,
  getProjectServicesSummary,
  getServiceTemplates,
  updateServiceCrewStatus,
  generateProjectServices,
  cloneServicesFromProject,
  convertLineItemToService,
  generateCrewMessage,
} from "@/server/project-services";
import { getCrewRoleOptions, createCrewRole } from "@/server/crew";
import { getCrewMembersForAssignment } from "@/server/crew-assignments";
import {
  projectServiceSchema,
  type ProjectServiceFormValues,
} from "@/lib/validations/project-service";
import { SERVICE_TYPE_LABELS, SERVICE_STATUS_LABELS } from "@/lib/constants/services";
import { useActiveOrganization } from "@/lib/auth-client";
import { CanDo } from "@/components/auth/permission-gate";
import { StatusIndicator } from "@/components/ui/status-indicator";
import { EmptyState } from "@/components/ui/empty-state";
import { FadeIn, StaggerList, StaggerItem } from "@/components/ui/motion";
import { ComboboxPicker, MultiComboboxPicker } from "@/components/ui/combobox-picker";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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

function formatCurrency(value: number | null | undefined): string {
  if (value == null) return "—";
  return `$${Number(value).toLocaleString("en-AU", { minimumFractionDigits: 2 })}`;
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
  const queryClient = useQueryClient();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingService, setEditingService] = useState<Record<string, unknown> | null>(null);
  const [preselectedType, setPreselectedType] = useState<ServiceType | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null);
  const [cloneDialogOpen, setCloneDialogOpen] = useState(false);
  const [messageTarget, setMessageTarget] = useState<{ crewMemberId: string; name: string } | null>(null);

  const { data: services = [], isLoading } = useQuery({
    queryKey: ["project-services", orgId, projectId],
    queryFn: () => getProjectServices(projectId),
  });

  const { data: summary } = useQuery({
    queryKey: ["project-services-summary", orgId, projectId],
    queryFn: () => getProjectServicesSummary(projectId),
  });

  const { data: templates = [] } = useQuery({
    queryKey: ["service-templates", orgId],
    queryFn: () => getServiceTemplates(),
  });

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["project-services", orgId, projectId] });
    queryClient.invalidateQueries({ queryKey: ["project-services-summary", orgId, projectId] });
    queryClient.invalidateQueries({ queryKey: ["project", orgId, projectId] });
    queryClient.invalidateQueries({ queryKey: ["project-crew", orgId, projectId] });
  };

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteProjectService(id),
    onSuccess: () => {
      toast.success("Service deleted");
      setDeleteTarget(null);
      invalidateAll();
    },
    onError: (e) => toast.error(e.message),
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: ServiceStatus }) =>
      updateServiceStatus(id, status),
    onSuccess: () => {
      toast.success("Status updated");
      invalidateAll();
    },
    onError: (e) => toast.error(e.message),
  });

  const generateMutation = useMutation({
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
                <div className="h-3 w-20 rounded bg-bg-elevated animate-pulse" />
                <div className="h-px flex-1 bg-border" />
              </div>
              <div className="h-16 rounded-lg bg-bg-elevated animate-pulse" />
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
                <DropdownMenuTrigger render={<Button size="sm" />}>
                  <Plus className="mr-2 h-4 w-4" />
                  Add Service
                  <ChevronDown className="ml-1 h-3 w-3" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>Service Type</DropdownMenuLabel>
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
                  variant={hasServices ? "outline" : "default"}
                  onClick={() => generateMutation.mutate()}
                  disabled={generateMutation.isPending}
                >
                  {generateMutation.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : hasServices ? (
                    <RefreshCw className="mr-2 h-4 w-4" />
                  ) : (
                    <Sparkles className="mr-2 h-4 w-4" />
                  )}
                  {hasServices ? "Regenerate" : "Generate Services"}
                </Button>
              )}

              {/* Import from another project */}
              <Button
                size="sm"
                variant="outline"
                onClick={() => setCloneDialogOpen(true)}
              >
                <Copy className="mr-2 h-4 w-4" />
                Import Services
              </Button>
            </div>
          </CanDo>
        </div>

        {/* Empty State */}
        {!hasServices && (
          <EmptyState
            preset="calendar"
            heading="No services yet"
            description={
              hasProjectDates
                ? "Generate services from your project dates, or add them manually."
                : "Set project dates first, then generate services automatically."
            }
            action={
              hasProjectDates
                ? {
                    label: "Generate Services",
                    onClick: () => generateMutation.mutate(),
                  }
                : undefined
            }
          />
        )}

        {/* Timeline — Date Groups */}
        {hasServices && (
          <StaggerList>
            {grouped.map(({ dateLabel, dateKey, dateLong, items }) => (
              <StaggerItem key={dateKey}>
                <div className="space-y-2">
                  {/* Date header — teal overline chip + extending line (D3) */}
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center rounded bg-primary/8 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-primary">
                      {dateLabel}
                    </span>
                    <div className="h-px flex-1 bg-border" />
                    {dateLong && (
                      <span className="text-[10px] text-fg-4">{dateLong}</span>
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
          <div className="rounded-lg bg-bg-surface p-4 surface-ring">
            <h4 className="text-sm font-medium text-fg-3 mb-2 flex items-center gap-1">
              <DollarSign className="h-3.5 w-3.5" />
              Services Financial Summary
            </h4>
            <div className="grid gap-4 sm:grid-cols-3 text-sm">
              <div>
                <span className="text-fg-3">On Documents</span>
                <p className="font-medium">{formatCurrency(summary.onDocumentsTotal)}</p>
              </div>
              <div>
                <span className="text-fg-3">Internal</span>
                <p className="font-medium">{formatCurrency(summary.internalTotal)}</p>
              </div>
              <div>
                <span className="text-fg-3">Total</span>
                <p className="font-semibold">{formatCurrency(summary.totalCost)}</p>
              </div>
            </div>
          </div>
        )}

        {/* Delete Confirmation Dialog */}
        <Dialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Delete Service</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-fg-2">
              Are you sure you want to delete &ldquo;{deleteTarget?.title}&rdquo;? This will also
              remove any linked crew assignments.
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleteTarget(null)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
                disabled={deleteMutation.isPending}
              >
                {deleteMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
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
    <div className={`rounded-lg bg-bg-surface p-4 surface-ring ${isCancelled ? "opacity-50" : ""}`}>
      <div className="flex items-start justify-between gap-2">
        {/* Left side */}
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <Icon className="h-4 w-4 text-fg-3 shrink-0" />
            <span className={`font-medium ${isCancelled ? "line-through" : ""}`}>
              {service.title}
            </span>
            {/* Status pill using StatusIndicator (D2) */}
            <StatusIndicator
              category="assignment"
              value={service.status.toLowerCase()}
              label={SERVICE_STATUS_LABELS[service.status]}
              variant="pill"
            />
          </div>

          {/* Time info */}
          {isMultiDay && (
            <div className="flex items-center gap-1 text-sm text-fg-3">
              <Clock className="h-3 w-3" />
              <span>{formatDate(service.date)} – {formatDate(service.endDate)}</span>
            </div>
          )}
          {!isMultiDay && (service.startTime || service.endTime) && (
            <div className="flex items-center gap-1 text-sm text-fg-3">
              <Clock className="h-3 w-3" />
              <span>
                {service.startTime}
                {service.endTime && ` – ${service.endTime}`}
              </span>
            </div>
          )}
          {service.scheduledTime && (service.type === "DELIVERY" || service.type === "PICKUP") && (
            <div className="flex items-center gap-1 text-sm text-fg-3">
              <Truck className="h-3 w-3" />
              <span>
                {service.type === "DELIVERY" ? "Delivery" : "Pickup"} at {service.scheduledTime}
              </span>
            </div>
          )}

          {/* Address */}
          {service.address && (
            <div className="flex items-center gap-1 text-sm text-fg-3">
              <MapPin className="h-3 w-3 shrink-0" />
              <span className="truncate">{service.address}</span>
              {service.latitude != null && service.longitude != null && (
                <a
                  href={`https://www.google.com/maps/dir/?api=1&destination=${service.latitude},${service.longitude}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-primary hover:text-primary/80 shrink-0"
                >
                  <Navigation className="h-3 w-3" />
                </a>
              )}
            </div>
          )}

          {/* Vehicle */}
          {service.vehicleDescription && (
            <div className="text-sm text-fg-3">
              Vehicle: {service.vehicleDescription}
            </div>
          )}

          {/* Crew — avatar stack with 3 max + overflow (D14) */}
          {(service.crewRole || service.crewAssignments?.length > 0 || (service.crewCountRequired != null && service.crewCountRequired > 0)) && (
            <div className="flex items-center gap-1.5 text-sm text-fg-3 flex-wrap">
              <Users className="h-3 w-3 shrink-0" />
              {service.crewRole && (
                <Badge variant="outline" className="text-xs py-0" style={service.crewRole.color ? { borderColor: service.crewRole.color, color: service.crewRole.color } : undefined}>
                  {service.crewRole.name}
                </Badge>
              )}
              {service.crewAssignments?.length > 0 ? (
                <div className="flex items-center gap-1">
                  {/* Avatar stack — max 3 */}
                  <div className="flex -space-x-1">
                    {service.crewAssignments.slice(0, 3).map((a) => (
                      <button
                        key={a.id}
                        onClick={() => onCrewMessage(a.crewMember.id, `${a.crewMember.firstName} ${a.crewMember.lastName}`)}
                        className="relative h-6 w-6 rounded-full border-2 border-bg-surface focus:outline-none focus:ring-2 focus:ring-primary"
                        title={`${a.crewMember.firstName} ${a.crewMember.lastName} — click to generate message`}
                      >
                        {a.crewMember.image ? (
                          <img src={a.crewMember.image} alt="" className="h-full w-full rounded-full object-cover" />
                        ) : (
                          <span className="flex h-full w-full items-center justify-center rounded-full bg-bg-inset text-[9px] font-medium">
                            {a.crewMember.firstName[0]}{a.crewMember.lastName[0]}
                          </span>
                        )}
                      </button>
                    ))}
                    {service.crewAssignments.length > 3 && (
                      <span className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-bg-surface bg-bg-inset text-[9px] font-medium">
                        +{service.crewAssignments.length - 3}
                      </span>
                    )}
                  </div>
                  {/* Crew cost subtotal (D12) */}
                  {crewCostTotal > 0 && (
                    <span className="text-xs text-fg-3 ml-1">
                      {service.crewAssignments.length} crew · {formatCurrency(crewCostTotal)}
                    </span>
                  )}
                </div>
              ) : service.crewCountRequired != null && service.crewCountRequired > 0 ? (
                <span className="text-amber-500">
                  {service.crewCountRequired} needed — none assigned
                </span>
              ) : null}
              {service.crewCountRequired != null && service.crewCountRequired > 0 && service.crewAssignments?.length > 0 && service.crewAssignments.length < service.crewCountRequired && (
                <span className="text-amber-500 text-xs">
                  ({service.crewAssignments.length}/{service.crewCountRequired})
                </span>
              )}
            </div>
          )}

          {/* Financial */}
          {(service.lineTotal != null || service.costTotal != null) && (
            <div className="flex items-center gap-3 text-sm">
              {service.lineTotal != null && (
                <div className="flex items-center gap-1">
                  <DollarSign className="h-3 w-3 text-fg-3" />
                  <span className="font-medium t-data">{formatCurrency(service.lineTotal)}</span>
                  <span className="text-fg-3 text-xs">charge</span>
                </div>
              )}
              {service.costTotal != null && Number(service.costTotal) > 0 && (
                <div className="flex items-center gap-1">
                  <span className="t-data text-fg-3">{formatCurrency(service.costTotal)}</span>
                  <span className="text-fg-3 text-xs">cost</span>
                </div>
              )}
              {service.showOnDocuments && (
                <span className="text-fg-3 text-xs">· On quote</span>
              )}
            </div>
          )}
        </div>

        {/* Right side — actions */}
        <div className="flex items-center gap-1 shrink-0">
          <CanDo resource="project" action="update">
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="ghost" size="sm" />}>
                <ChevronDown className="h-3.5 w-3.5" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Change Status</DropdownMenuLabel>
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

            <Button variant="ghost" size="sm" onClick={onEdit}>
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive"
              onClick={onDelete}
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
  const { data: projects = [] } = useQuery({
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

  const cloneMutation = useMutation({
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
          <DialogTitle>Import Services</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-fg-2">
          Clone services from a previous project. Dates will be automatically adjusted to match this project.
        </p>
        <div className="space-y-1.5">
          <Label>Source Project</Label>
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
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => cloneMutation.mutate()}
            disabled={!sourceProjectId || cloneMutation.isPending}
          >
            {cloneMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            <ArrowRightLeft className="mr-2 h-4 w-4" />
            Clone Services
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
  const { data: messageData, isLoading } = useQuery({
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
            <Loader2 className="h-5 w-5 animate-spin text-fg-3" />
          </div>
        ) : msg ? (
          <div className="space-y-3">
            {(msg.crewMemberPhone || msg.crewMemberEmail) && (
              <div className="flex items-center gap-3 text-sm text-fg-3">
                {msg.crewMemberPhone && (
                  <a href={`tel:${msg.crewMemberPhone}`} className="text-primary hover:underline">
                    {msg.crewMemberPhone}
                  </a>
                )}
                {msg.crewMemberEmail && (
                  <a href={`mailto:${msg.crewMemberEmail}`} className="text-primary hover:underline">
                    {msg.crewMemberEmail}
                  </a>
                )}
              </div>
            )}
            <pre className="whitespace-pre-wrap rounded-lg bg-bg-inset p-3 text-sm font-sans">
              {msg.message}
            </pre>
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button onClick={copyToClipboard} disabled={!msg?.message}>
            <Copy className="mr-2 h-4 w-4" />
            Copy Message
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
        Assign Crew Members
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
    ? "text-fg-3"
    : assigned > needed
      ? "text-red-500"
      : assigned === needed
        ? "text-green-500"
        : "text-amber-500";
  return (
    <span className={`text-xs font-normal ${color}`}>
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
  const queryClient = useQueryClient();
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

  const { data: crewRoles = [] } = useQuery({
    queryKey: ["crew-roles", orgId],
    queryFn: () => getCrewRoleOptions(),
    enabled: open,
  });

  const roleOptions = (crewRoles as { id: string; name: string }[]).map((r) => ({
    value: r.id,
    label: r.name,
  }));

  const { data: crewMembers = [] } = useQuery({
    queryKey: ["crew-members-for-assignment", orgId, projectId],
    queryFn: () => getCrewMembersForAssignment(projectId),
    enabled: open,
  });

  const crewMemberOptions: { value: string; label: string; icon: React.ReactNode }[] =
    (crewMembers as { id: string; firstName: string; lastName: string; image: string | null }[]).map((m) => ({
      value: m.id,
      label: `${m.firstName} ${m.lastName}`,
      icon: m.image ? (
        <img src={m.image} alt="" className="h-5 w-5 rounded-full object-cover" />
      ) : (
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-bg-inset text-[10px] font-medium">
          {m.firstName[0]}{m.lastName[0]}
        </span>
      ),
    }));

  const watchCrewMemberIds = (form.watch("crewMemberIds") || []) as string[];
  const watchCrewNeeded = Number(form.watch("crewCountRequired") || 0);
  const setCrewMemberIds = (ids: string[]) => { form.setValue("crewMemberIds", ids); };

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["project-services", orgId, projectId] });
    queryClient.invalidateQueries({ queryKey: ["project-services-summary", orgId, projectId] });
    queryClient.invalidateQueries({ queryKey: ["project", orgId, projectId] });
    queryClient.invalidateQueries({ queryKey: ["project-crew", orgId, projectId] });
  };

  const createMutation = useMutation({
    mutationFn: (data: ProjectServiceFormValues) =>
      createProjectService(projectId, data),
    onSuccess: () => {
      toast.success("Service added");
      invalidateAll();
      onOpenChange(false);
    },
    onError: (e) => toast.error(e.message),
  });

  const updateMutation = useMutation({
    mutationFn: (data: ProjectServiceFormValues) =>
      updateProjectService(editingService!.id as string, data),
    onSuccess: () => {
      toast.success("Service updated");
      invalidateAll();
      onOpenChange(false);
    },
    onError: (e) => toast.error(e.message),
  });

  const crewStatusMutation = useMutation({
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
              ? `Edit ${SERVICE_TYPE_LABELS[form.watch("type") as ServiceType]} Service`
              : `Add ${SERVICE_TYPE_LABELS[watchType]} Service`}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          {/* Title */}
          <div className="space-y-1.5">
            <Label>Title</Label>
            <Input {...form.register("title")} placeholder="Service title" />
            {form.formState.errors.title && (
              <p className="text-xs text-destructive">
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
                <Label>Start Date</Label>
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
                <Label>End Date</Label>
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
                <Label>Start Time</Label>
                <Input type="time" {...form.register("startTime")} />
              </div>
              <div className="space-y-1.5">
                <Label>End Time</Label>
                <Input type="time" {...form.register("endTime")} />
              </div>
            </div>
          )}

          {canBeMultiDay && !isCurrentlyMultiDay && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Start Time</Label>
                <Input type="time" {...form.register("startTime")} />
              </div>
              <div className="space-y-1.5">
                <Label>End Time</Label>
                <Input type="time" {...form.register("endTime")} />
              </div>
            </div>
          )}

          {(watchType === "DELIVERY" || watchType === "PICKUP") && (
            <div className="space-y-1.5">
              <Label>{watchType === "DELIVERY" ? "Delivery Time" : "Pickup Time"}</Label>
              <Input type="time" {...form.register("scheduledTime")} />
              <p className="text-xs text-fg-3">
                The actual {watchType === "DELIVERY" ? "delivery" : "pickup"} time (separate from crew work window)
              </p>
            </div>
          )}

          {/* Address */}
          {showAddress && (
            <div className="space-y-1.5">
              <Label>
                {watchType === "DELIVERY"
                  ? "Delivery To"
                  : watchType === "PICKUP"
                    ? "Pickup From"
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
            <h4 className="text-sm font-medium">Crew</h4>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Crew Role</Label>
                <ComboboxPicker
                  value={form.watch("crewRoleId") || ""}
                  onChange={(v) => {
                    const isExisting = roleOptions.some((r) => r.value === v);
                    if (isExisting || !v) {
                      form.setValue("crewRoleId", v);
                    } else {
                      createCrewRole({ name: v })
                        .then((role) => {
                          queryClient.invalidateQueries({ queryKey: ["crew-roles", orgId] });
                          form.setValue("crewRoleId", role.id);
                          toast.success(`Role "${role.name}" created`);
                        })
                        .catch((err) => toast.error((err as Error).message));
                    }
                  }}
                  options={roleOptions}
                  placeholder="Select or create role..."
                  allowClear
                  creatable
                />
              </div>
              <div className="space-y-1.5">
                <Label>Crew Needed</Label>
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
                  variant="outline"
                  size="sm"
                  disabled={!isEditing || crewStatusMutation.isPending}
                  title={!isEditing ? "Save the service first" : undefined}
                  onClick={() => crewStatusMutation.mutate({ status: "OFFERED" })}
                >
                  <Send className="mr-1.5 h-3.5 w-3.5" />
                  Send Offers
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!isEditing || crewStatusMutation.isPending}
                  title={!isEditing ? "Save the service first" : undefined}
                  onClick={() => crewStatusMutation.mutate({ status: "CONFIRMED" })}
                >
                  <UserCheck className="mr-1.5 h-3.5 w-3.5" />
                  Confirm All
                </Button>
                {crewStatusMutation.isPending && (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-fg-3" />
                )}
                {!isEditing && (
                  <span className="text-xs text-fg-3">Save first to send offers</span>
                )}
              </div>
            )}
          </div>

          {/* Financial Section */}
          <div className="border-t pt-4 space-y-4">
            <h4 className="text-sm font-medium">Pricing</h4>

            {/* Charge to Client */}
            <div className="space-y-3 rounded-md border border-border p-3">
              <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-fg-3">
                Charge to Client
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
                <Label htmlFor="showOnDocuments" className="text-sm font-normal cursor-pointer">
                  Show on quote / invoice
                </Label>
              </div>
            </div>

            {/* Cost to Business */}
            <div className="space-y-3 rounded-md border border-border p-3">
              <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-fg-3">
                Cost to Business
              </div>
              <div className="space-y-1.5">
                <Label>Total Cost</Label>
                <Input
                  type="number"
                  step="0.01"
                  {...form.register("costTotal")}
                  placeholder="0.00"
                />
                <p className="text-[11px] text-fg-4">
                  What this service costs you (crew, transport, etc). Used for margin calculation.
                </p>
              </div>
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <Label>Internal Notes</Label>
            <Textarea
              {...form.register("notes")}
              placeholder="Internal notes (not on client docs)..."
              rows={2}
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isEditing ? "Update" : "Add Service"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
