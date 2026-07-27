"use client";
// use-client: interactive board (range picker, dialogs) (R-8.1.1)

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, Boxes, HardHat, UserCheck, Users2, ExternalLink } from "lucide-react";
import { useActiveOrganization } from "@/lib/auth-client";
import { RequirePermission } from "@/components/auth/require-permission";
import { PageHeader } from "@/components/layout/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { FlowMascot } from "@/components/ui/flow-mascot";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from "@/components/ui/select";
import { formatDate } from "@/lib/formatters";
import { cn, focusRing } from "@/lib/utils";
import {
  useNativeOverbookingBoard,
  DEFAULT_OVERBOOKING_RANGE_DAYS,
  OVERBOOKING_RANGE_STORAGE_KEY,
  type OverbookingGearRow,
  type OverbookingSaleStockRow,
  type OverbookingMissingCrewRow,
  type OverbookingUnconfirmedCrewRow,
  type OverbookingDoubleBookingRow,
} from "@/hooks/use-native-overbooking-board";
import { SubHireShortfallDialog } from "@/components/overbookings/sub-hire-shortfall-dialog";

const RANGE_OPTIONS = [7, 14, 30, 60, 90];

const TILE = "rounded-[var(--r-lg)] border border-line bg-card p-5 shadow-[var(--sh-card)]";
const HARD_PILL = "bg-out-soft text-t-out";
const SOFT_PILL = "bg-warn-soft text-warn";

function useRangeDays(): [number, (days: number) => void] {
  const router = useRouter();
  const searchParams = useSearchParams();
  const fromUrl = searchParams.get("days");
  const parsed = fromUrl ? parseInt(fromUrl, 10) : NaN;
  const fromStorage = typeof window !== "undefined" ? window.localStorage.getItem(OVERBOOKING_RANGE_STORAGE_KEY) : null;
  const parsedStorage = fromStorage ? parseInt(fromStorage, 10) : NaN;
  const days = RANGE_OPTIONS.includes(parsed)
    ? parsed
    : RANGE_OPTIONS.includes(parsedStorage)
      ? parsedStorage
      : DEFAULT_OVERBOOKING_RANGE_DAYS;

  const setDays = (next: number) => {
    if (typeof window !== "undefined") window.localStorage.setItem(OVERBOOKING_RANGE_STORAGE_KEY, String(next));
    const params = new URLSearchParams(searchParams.toString());
    params.set("days", String(next));
    router.replace(`/overbookings?${params.toString()}`);
  };

  return [days, setDays];
}

function totalIssueCount(data: ReturnType<typeof useNativeOverbookingBoard>["data"]): number {
  if (!data) return 0;
  return (
    data.gearHard.length +
    data.gearPencilled.length +
    data.saleStockToProcure.length +
    data.servicesMissingCrew.length +
    data.unconfirmedCrew.length +
    data.crewDoubleBookings.length
  );
}

function RangeSelect({ days, onChange }: { days: number; onChange: (days: number) => void }) {
  return (
    <Select value={String(days)} onValueChange={(v) => onChange(parseInt(v, 10))}>
      <SelectTrigger className="w-36">
        <SelectValue>{days} days</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {RANGE_OPTIONS.map((d) => (
          <SelectItem key={d} value={String(d)}>{d} days</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-40 w-full rounded-[var(--r-lg)]" />
      <Skeleton className="h-40 w-full rounded-[var(--r-lg)]" />
      <Skeleton className="h-40 w-full rounded-[var(--r-lg)]" />
    </div>
  );
}

function AllClearState({ days }: { days: number }) {
  return (
    <div className={cn(TILE, "flex flex-col items-center gap-3 py-16 text-center")}>
      <FlowMascot className="h-12 w-12" eyeColor="var(--ok)" />
      <div>
        <p className="text-[15px] font-medium text-ink">All clear for the next {days} days.</p>
        <p className="t-micro text-muted">No overbookings, no crew gaps, nothing pencilled that would collide.</p>
      </div>
    </div>
  );
}

type BoardData = NonNullable<ReturnType<typeof useNativeOverbookingBoard>["data"]>;

function BoardSections({ data, onSubHire }: { data: BoardData; onSubHire: (row: OverbookingGearRow) => void }) {
  return (
    <div className="space-y-4">
      <GearSection
        title="Overbooked gear"
        subtitle="Hard — already committed, over capacity"
        icon={AlertTriangle}
        pillClass={HARD_PILL}
        rows={data.gearHard}
        onSubHire={onSubHire}
        emptyLabel="No hard overbookings."
      />
      <GearSection
        title="Pencilled collisions"
        subtitle="Would only collide if a quoted/optional line is confirmed"
        icon={AlertTriangle}
        pillClass={SOFT_PILL}
        rows={data.gearPencilled}
        emptyLabel="No pencilled collisions."
      />
      <SaleStockSection rows={data.saleStockToProcure} />
      <MissingCrewSection rows={data.servicesMissingCrew} />
      <UnconfirmedCrewSection rows={data.unconfirmedCrew} />
      <DoubleBookingSection rows={data.crewDoubleBookings} />
    </div>
  );
}

function BoardBody({
  isLoading,
  days,
  data,
  onSubHire,
}: {
  isLoading: boolean;
  days: number;
  data: BoardData | undefined;
  onSubHire: (row: OverbookingGearRow) => void;
}) {
  if (isLoading) return <LoadingSkeleton />;
  if (!data || totalIssueCount(data) === 0) return <AllClearState days={days} />;
  return <BoardSections data={data} onSubHire={onSubHire} />;
}

export default function OverbookingsPage() {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const [days, setDays] = useRangeDays();
  const { data, isLoading } = useNativeOverbookingBoard(orgId, days);
  const [subHireRow, setSubHireRow] = useState<OverbookingGearRow | null>(null);

  return (
    <RequirePermission resource="project" action="read">
      <div className="space-y-6">
        <PageHeader
          title="Overbookings & Gaps"
          description="Org-wide gear and crew risk over the selected window — pencilled items warn, they never block."
          actions={<RangeSelect days={days} onChange={setDays} />}
        />
        <BoardBody isLoading={isLoading} days={days} data={data} onSubHire={setSubHireRow} />
      </div>

      {subHireRow && (
        <SubHireShortfallDialog
          open={!!subHireRow}
          onOpenChange={(open) => !open && setSubHireRow(null)}
          modelName={subHireRow.modelName}
          shortfallQty={subHireRow.qty}
          projects={subHireRow.projects}
        />
      )}
    </RequirePermission>
  );
}

function SectionHeader({ icon: Icon, title, subtitle, count, pillClass }: { icon: typeof AlertTriangle; title: string; subtitle: string; count: number; pillClass: string }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      <div>
        <h2 className="flex items-center gap-2 t-overline text-muted">
          <Icon className="h-4 w-4" /> {title}
        </h2>
        <p className="t-micro text-faint">{subtitle}</p>
      </div>
      {count > 0 && (
        <span className={cn("rounded-full px-2.5 py-1 text-badge font-medium", pillClass)}>{count}</span>
      )}
    </div>
  );
}

function ProjectLinks({ projects }: { projects: { id: string; name: string; projectNumber: string }[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {projects.map((p) => (
        <Link
          key={p.id}
          href={`/projects/${p.id}`}
          className={cn("inline-flex items-center gap-1 rounded-[var(--r)] bg-elev px-2 py-0.5 text-caption text-ink-2 hover:text-red", focusRing)}
        >
          {p.projectNumber} <ExternalLink className="h-3 w-3" />
        </Link>
      ))}
    </div>
  );
}

function GearSection({
  title,
  subtitle,
  icon,
  pillClass,
  rows,
  onSubHire,
  emptyLabel,
}: {
  title: string;
  subtitle: string;
  icon: typeof AlertTriangle;
  pillClass: string;
  rows: OverbookingGearRow[];
  onSubHire?: (row: OverbookingGearRow) => void;
  emptyLabel: string;
}) {
  return (
    <div className={TILE}>
      <SectionHeader icon={icon} title={title} subtitle={subtitle} count={rows.length} pillClass={pillClass} />
      {rows.length === 0 ? (
        <p className="t-micro text-faint">{emptyLabel}</p>
      ) : (
        <div className="flex flex-col gap-2.5">
          {rows.map((row) => (
            <div key={row.modelId} className="flex flex-col gap-1.5 rounded-[var(--r)] border border-line p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="truncate text-[14px] font-medium text-ink">
                  {row.modelName} <span className={cn("ml-1 rounded-full px-1.5 py-0.5 text-badge", pillClass)}>{row.qty} short</span>
                </p>
                <p className="t-micro text-faint">{formatDate(new Date(row.spanStart))} – {formatDate(new Date(row.spanEnd))}</p>
                <div className="mt-1"><ProjectLinks projects={row.projects} /></div>
              </div>
              {onSubHire && (
                <button
                  type="button"
                  onClick={() => onSubHire(row)}
                  className={cn("shrink-0 rounded-[var(--r)] border-2 border-border px-3 py-1.5 text-table-cell font-medium text-ink hover:bg-ink hover:text-paper", focusRing)}
                >
                  Sub-hire this
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SaleStockSection({ rows }: { rows: OverbookingSaleStockRow[] }) {
  return (
    <div className={TILE}>
      <SectionHeader icon={Boxes} title="Sale stock to procure" subtitle="Models sold below their new-stock sale pool" count={rows.length} pillClass={SOFT_PILL} />
      {rows.length === 0 ? (
        <p className="t-micro text-faint">No sale stock to procure.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((row) => (
            <div key={row.modelId} className="flex flex-col gap-1.5 rounded-[var(--r)] border border-line p-3">
              <div className="flex items-center justify-between">
                <p className="truncate text-[14px] font-medium text-ink">{row.modelName}</p>
                <span className={cn("rounded-full px-2 py-0.5 text-badge font-medium", SOFT_PILL)}>{row.shortfallQty} to procure</span>
              </div>
              {row.contributingSaleLines.length > 0 && (
                <div className="flex flex-wrap gap-x-3 gap-y-1">
                  {row.contributingSaleLines.map((li) => (
                    <Link
                      key={li.lineItemId}
                      href={`/projects/${li.projectId}`}
                      className={cn("t-micro text-muted hover:text-link hover:underline rounded-sm", focusRing)}
                    >
                      {li.quantity}&times; on {li.projectNumber}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MissingCrewSection({ rows }: { rows: OverbookingMissingCrewRow[] }) {
  return (
    <div className={TILE}>
      <SectionHeader icon={HardHat} title="Services missing crew" subtitle="Assigned crew (excluding declined) below the required count" count={rows.length} pillClass={HARD_PILL} />
      {rows.length === 0 ? (
        <p className="t-micro text-faint">Every service in range is fully staffed.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((row) => (
            <Link key={row.serviceId} href={`/projects/${row.projectId}`} className={cn("flex items-center justify-between rounded-[var(--r)] border border-line p-3 hover:bg-elev", focusRing)}>
              <div className="min-w-0">
                <p className="truncate text-[14px] font-medium text-ink">{row.title} — {row.projectNumber} {row.projectName}</p>
                <p className="t-micro text-faint">{row.date ? formatDate(new Date(row.date)) : "No date"}</p>
              </div>
              <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-badge font-medium", HARD_PILL)}>{row.assignedCount}/{row.crewCountRequired}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function UnconfirmedCrewSection({ rows }: { rows: OverbookingUnconfirmedCrewRow[] }) {
  return (
    <div className={TILE}>
      <SectionHeader icon={UserCheck} title="Unconfirmed crew" subtitle="Not yet CONFIRMED, on a project starting in range" count={rows.length} pillClass={SOFT_PILL} />
      {rows.length === 0 ? (
        <p className="t-micro text-faint">Every upcoming assignment is confirmed.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((row) => (
            <Link key={row.assignmentId} href={`/projects/${row.projectId}`} className={cn("flex items-center justify-between rounded-[var(--r)] border border-line p-3 hover:bg-elev", focusRing)}>
              <div className="min-w-0">
                <p className="truncate text-[14px] font-medium text-ink">{row.projectNumber} — {row.projectName}</p>
                <p className="t-micro text-faint">Starts {row.startDate ? formatDate(new Date(row.startDate)) : "—"}</p>
              </div>
              <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-badge font-medium", SOFT_PILL)}>{row.status}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function DoubleBookingSection({ rows }: { rows: OverbookingDoubleBookingRow[] }) {
  return (
    <div className={TILE}>
      <SectionHeader icon={Users2} title="Crew double-bookings" subtitle="Hard = unavailable block clash · Soft = two overlapping assignments" count={rows.length} pillClass={HARD_PILL} />
      {rows.length === 0 ? (
        <p className="t-micro text-faint">No crew double-bookings in range.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((row, i) => (
            <div key={`${row.crewMemberId}-${i}`} className="rounded-[var(--r)] border border-line p-3">
              <div className="flex items-center justify-between">
                <p className="text-[14px] font-medium text-ink">{row.label}</p>
                <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-badge font-medium", row.severity === "hard" ? HARD_PILL : SOFT_PILL)}>
                  {row.severity}
                </span>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                <Link href={`/projects/${row.a.projectId}`} className={cn("rounded-[var(--r)] bg-elev px-2 py-0.5 text-caption text-ink-2 hover:text-red", focusRing)}>
                  {row.a.projectNumber} — {row.a.projectName}
                </Link>
                {row.b && (
                  <Link href={`/projects/${row.b.projectId}`} className={cn("rounded-[var(--r)] bg-elev px-2 py-0.5 text-caption text-ink-2 hover:text-red", focusRing)}>
                    {row.b.projectNumber} — {row.b.projectName}
                  </Link>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
