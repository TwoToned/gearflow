"use client";
// Extracted from dashboard/page.tsx's "Upcoming" tile — same hook/JSX (R-3.1).

import Link from "next/link";
import { useNativeUpcoming } from "@/hooks/use-native-dashboard";
import { StaggerList, StaggerItem } from "@/components/ui/motion";
import { Skeleton } from "@/components/ui/skeleton";
import { ProjectLockGlyph } from "@/components/projects/project-lock-glyph";
import { getStatusIntent } from "@/lib/status-colors";
import { cn, focusRing } from "@/lib/utils";
import { formatDateDayMonth } from "@/lib/formatters";
import { ArrowRight } from "lucide-react";

type Hue = "blue" | "amber" | "green" | "purple" | "coral" | "teal" | "red";
const hueText: Record<Hue, string> = {
  blue: "text-blue",
  amber: "text-amber",
  green: "text-green",
  purple: "text-purple",
  coral: "text-coral",
  teal: "text-teal",
  red: "text-red",
};

export function UpcomingProjectsWidget({ orgId }: { orgId: string | undefined }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const upcoming = useNativeUpcoming(orgId) as any;

  return (
    <div className="flex h-full flex-col">
      <div className="mb-3 flex items-center justify-end">
        <Link
          href="/projects"
          className={cn("inline-flex items-center gap-1 rounded-[var(--r)] text-[11px] text-muted hover:text-ink", focusRing)}
        >
          All <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
      {!upcoming ? (
        <div className="space-y-2">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      ) : upcoming.length === 0 ? (
        <p className="t-body text-muted">Nothing booked ahead. Quote something.</p>
      ) : (
        <StaggerList className="space-y-1">
          {(upcoming as Record<string, unknown>[]).slice(0, 4).map((p) => {
            const client = p.client as { name?: string } | null;
            const start = p.rentalStartDate ? new Date(p.rentalStartDate as string) : null;
            const intent = getStatusIntent("project", p.status as string);
            return (
              <StaggerItem key={p.id as string}>
                <Link
                  href={`/projects/${p.id}`}
                  className={cn(
                    "group flex items-center justify-between gap-3 rounded-[var(--r)] px-2 py-2 transition-colors hover:bg-elev",
                    focusRing,
                  )}
                >
                  <div className="min-w-0">
                    <p className="truncate text-[14px] font-medium text-ink">{p.name as string}</p>
                    <p className="t-micro truncate text-muted">
                      <span className="font-mono">{p.projectNumber as string}</span>
                      {client?.name ? <> · {client.name}</> : null}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <ProjectLockGlyph status={p.status as string | null | undefined} />
                    {start && (
                      <span
                        className={`text-[11px] font-medium ${hueText[intent === "primary" ? "red" : (intent as Hue)] ?? "text-muted"}`}
                      >
                        {formatDateDayMonth(start)}
                      </span>
                    )}
                  </div>
                </Link>
              </StaggerItem>
            );
          })}
        </StaggerList>
      )}
    </div>
  );
}
