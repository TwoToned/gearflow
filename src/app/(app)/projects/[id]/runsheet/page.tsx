"use client";

import { use } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  Truck,
  ArrowDownToLine,
  ArrowUpFromLine,
  HardHat,
  Wrench,
  PackageCheck,
  Clock,
  MapPin,
  Phone,
  Users,
} from "lucide-react";
import { useActiveOrganization } from "@/lib/auth-client";
import { getProject } from "@/server/projects";
import { getProjectServices } from "@/server/project-services";
import { StatusIndicator } from "@/components/ui/status-indicator";
import { SERVICE_STATUS_LABELS } from "@/lib/constants/services";
import { FadeIn, StaggerList, StaggerItem } from "@/components/ui/motion";
import { cn } from "@/lib/utils";

const SERVICE_TYPE_ICONS: Record<string, typeof Truck> = {
  DELIVERY: Truck,
  PICKUP: PackageCheck,
  BUMP_IN: ArrowDownToLine,
  BUMP_OUT: ArrowUpFromLine,
  LABOUR: HardHat,
  MISC: Wrench,
};

const SERVICE_TYPE_LABELS: Record<string, string> = {
  DELIVERY: "Delivery",
  PICKUP: "Pickup",
  BUMP_IN: "Bump In",
  BUMP_OUT: "Bump Out",
  LABOUR: "Labour",
  MISC: "Misc",
};

function formatTime(time: string | null | undefined): string {
  if (!time) return "";
  return time;
}

function formatDate(date: string | Date | null | undefined): string {
  if (!date) return "";
  return new Date(date).toLocaleDateString("en-AU", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

interface ServiceGroup {
  dateKey: string;
  dateLong: string;
  services: Array<{
    id: string;
    type: string;
    title: string;
    status: string;
    startTime: string | null;
    endTime: string | null;
    address: string | null;
    notes: string | null;
    crewAssignments: Array<{
      id: string;
      status: string;
      crewMember: {
        id: string;
        firstName: string;
        lastName: string;
        image: string | null;
      };
    }>;
  }>;
}

function groupByDate(services: Array<Record<string, unknown>>): ServiceGroup[] {
  const groups = new Map<string, ServiceGroup>();

  for (const s of services) {
    const dateVal = s.date ? new Date(s.date as string) : null;
    const key = dateVal ? dateVal.toISOString().slice(0, 10) : "no-date";
    const long = dateVal ? formatDate(dateVal) : "Unscheduled";

    if (!groups.has(key)) {
      groups.set(key, { dateKey: key, dateLong: long, services: [] });
    }
    groups.get(key)!.services.push({
      id: s.id as string,
      type: s.type as string,
      title: s.title as string,
      status: s.status as string,
      startTime: s.startTime as string | null,
      endTime: s.endTime as string | null,
      address: s.address as string | null,
      notes: s.notes as string | null,
      crewAssignments: (s.crewAssignments as ServiceGroup["services"][0]["crewAssignments"]) || [],
    });
  }

  return Array.from(groups.values()).sort((a, b) => a.dateKey.localeCompare(b.dateKey));
}

export default function RunsheetPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const { data: project } = useQuery({
    queryKey: ["project", orgId, id],
    queryFn: () => getProject(id),
  });

  const { data: services, isLoading } = useQuery({
    queryKey: ["project-services", orgId, id],
    queryFn: () => getProjectServices(id),
  });

  const dateGroups = services ? groupByDate(services) : [];
  const today = new Date().toISOString().slice(0, 10);

  return (
    <FadeIn>
      <div className="mx-auto max-w-lg px-4 pb-safe">
        {/* Header — compact, back arrow + project info */}
        <div className="sticky top-0 z-10 -mx-4 bg-bg-base/95 backdrop-blur-sm px-4 pb-3 pt-4 border-b border-border">
          <div className="flex items-center gap-3">
            <Link
              href={`/projects/${id}`}
              className="flex h-10 w-10 items-center justify-center rounded-md hover:bg-bg-inset transition-colors"
            >
              <ArrowLeft className="h-5 w-5 text-fg-3" />
            </Link>
            <div className="min-w-0 flex-1">
              <h1 className="text-base font-bold text-fg truncate">
                {project?.name || "Loading..."}
              </h1>
              <p className="text-xs text-fg-3">
                {project?.projectNumber}
                {project?.location && ` · ${(project.location as { name: string }).name}`}
              </p>
            </div>
          </div>

          {/* Location quick-link */}
          {project?.location && (project.location as { latitude?: number | null }).latitude != null && (
            <a
              href={`https://www.google.com/maps/dir/?api=1&destination=${(project.location as { latitude: number }).latitude},${(project.location as { longitude: number }).longitude}`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 flex items-center gap-2 rounded-md bg-bg-inset px-3 py-2.5 text-sm text-fg-2 active:bg-bg-surface"
            >
              <MapPin className="h-4 w-4 text-teal-500 shrink-0" />
              <span className="truncate">
                {(project.location as { address?: string }).address || (project.location as { name: string }).name}
              </span>
            </a>
          )}
        </div>

        {/* Loading state */}
        {isLoading && (
          <div className="space-y-6 pt-6">
            {[1, 2].map((i) => (
              <div key={i} className="space-y-3">
                <div className="h-3 w-32 rounded bg-bg-inset animate-pulse" />
                <div className="space-y-2">
                  <div className="h-20 rounded-md bg-bg-inset animate-pulse" />
                  <div className="h-20 rounded-md bg-bg-inset animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Empty state */}
        {!isLoading && dateGroups.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Clock className="h-10 w-10 text-fg-4 mb-3" />
            <p className="text-sm font-medium text-fg-2">No services scheduled</p>
            <p className="text-xs text-fg-3 mt-1">
              Generate services from the project detail page.
            </p>
          </div>
        )}

        {/* Date groups */}
        {!isLoading && dateGroups.length > 0 && (
          <StaggerList className="space-y-6 pt-6">
            {dateGroups.map((group) => {
              const isToday = group.dateKey === today;
              return (
                <StaggerItem key={group.dateKey}>
                  {/* Date header */}
                  <div className="mb-3 flex items-center gap-2">
                    {isToday && (
                      <span className="rounded-sm bg-teal-500/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-teal-500">
                        Today
                      </span>
                    )}
                    <span
                      className={cn(
                        "t-overline",
                        isToday ? "text-teal-500" : "text-fg-3"
                      )}
                    >
                      {group.dateLong}
                    </span>
                    <div className="h-px flex-1 bg-border" />
                  </div>

                  {/* Service cards */}
                  <div className="space-y-2">
                    {group.services.map((service) => {
                      const Icon = SERVICE_TYPE_ICONS[service.type] || Wrench;
                      return (
                        <div
                          key={service.id}
                          className="rounded-md border border-border bg-bg-surface p-3.5"
                        >
                          {/* Type + title + status */}
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <Icon className="h-4 w-4 text-fg-3 shrink-0" />
                              <div className="min-w-0">
                                <span className="text-sm font-semibold text-fg truncate block">
                                  {service.title || SERVICE_TYPE_LABELS[service.type]}
                                </span>
                                <span className="text-[11px] text-fg-3">
                                  {SERVICE_TYPE_LABELS[service.type]}
                                </span>
                              </div>
                            </div>
                            <StatusIndicator
                              category="assignment"
                              value={service.status}
                              label={SERVICE_STATUS_LABELS[service.status] || service.status}
                            />
                          </div>

                          {/* Time */}
                          {(service.startTime || service.endTime) && (
                            <div className="mt-2 flex items-center gap-1.5 text-sm text-fg-2">
                              <Clock className="h-3.5 w-3.5 text-fg-3" />
                              <span className="tabular-nums">
                                {formatTime(service.startTime)}
                                {service.startTime && service.endTime && " – "}
                                {formatTime(service.endTime)}
                              </span>
                            </div>
                          )}

                          {/* Address */}
                          {service.address && (
                            <div className="mt-1.5 flex items-start gap-1.5 text-sm text-fg-3">
                              <MapPin className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                              <span>{service.address}</span>
                            </div>
                          )}

                          {/* Notes */}
                          {service.notes && (
                            <p className="mt-2 text-xs text-fg-3 leading-relaxed border-l-2 border-border pl-2">
                              {service.notes}
                            </p>
                          )}

                          {/* Crew */}
                          {service.crewAssignments.length > 0 && (
                            <div className="mt-3 border-t border-border pt-2.5">
                              <div className="flex items-center gap-1.5 mb-2">
                                <Users className="h-3 w-3 text-fg-4" />
                                <span className="t-overline text-fg-4">
                                  Crew ({service.crewAssignments.length})
                                </span>
                              </div>
                              <div className="space-y-1.5">
                                {service.crewAssignments.map((ca) => (
                                  <div
                                    key={ca.id}
                                    className="flex items-center justify-between"
                                  >
                                    <div className="flex items-center gap-2">
                                      <div className="h-6 w-6 rounded-full bg-bg-inset flex items-center justify-center text-[10px] font-medium text-fg-3 shrink-0">
                                        {ca.crewMember.image ? (
                                          <img
                                            src={ca.crewMember.image}
                                            alt=""
                                            className="h-6 w-6 rounded-full object-cover"
                                          />
                                        ) : (
                                          `${ca.crewMember.firstName.charAt(0)}${ca.crewMember.lastName.charAt(0)}`
                                        )}
                                      </div>
                                      <span className="text-sm text-fg">
                                        {ca.crewMember.firstName} {ca.crewMember.lastName}
                                      </span>
                                    </div>
                                    <StatusIndicator
                                      category="assignment"
                                      value={ca.status}
                                      label={SERVICE_STATUS_LABELS[ca.status] || ca.status}
                                      variant="pill"
                                    />
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </StaggerItem>
              );
            })}
          </StaggerList>
        )}

        {/* Site contact */}
        {project?.siteContactName && (
          <div className="mt-6 rounded-md border border-border bg-bg-surface p-3.5">
            <div className="t-overline text-fg-4 mb-2">
              Site Contact
            </div>
            <p className="text-sm font-medium text-fg">{project.siteContactName}</p>
            {project.siteContactPhone && (
              <a
                href={`tel:${project.siteContactPhone}`}
                className="mt-1 flex items-center gap-2 text-sm text-teal-500 active:text-teal-400"
              >
                <Phone className="h-3.5 w-3.5" />
                {project.siteContactPhone}
              </a>
            )}
          </div>
        )}

        {/* Bottom spacer for safe area */}
        <div className="h-8" />
      </div>
    </FadeIn>
  );
}
