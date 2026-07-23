"use client";
// use-client: interactive — React state/effects (client-only) (R-8.1.1)

import { useEffect, useState, useCallback, use } from "react";

// ─── Types ───────────────────────────────────────────────────────────────────

interface DispatchProject {
  id: string;
  projectNumber: string;
  name: string;
  deliveryTime: string | null;
  destination: string | null;
  vehicle: string | null;
  status: string;
  totalItems: number;
  checkedOutItems: number;
}

interface ReturnProject {
  id: string;
  projectNumber: string;
  name: string;
  dueTime: string | null;
  expectedItems: number;
}

interface PrepCard {
  projectId: string;
  projectNumber: string;
  projectName: string;
  packedItems: number;
  totalItems: number;
}

interface UpcomingDay {
  date: string;
  dispatching: number;
  returning: number;
}

interface Alert {
  type: "warning" | "error";
  message: string;
}

interface DisplayData {
  orgName: string;
  locationName: string | null;
  tokenName: string;
  layout: string;
  todaysDispatch: DispatchProject[];
  todaysReturns: ReturnProject[];
  prepStatus: PrepCard[];
  upcoming: UpcomingDay[];
  alerts: Alert[];
}

// ─── Page Component ──────────────────────────────────────────────────────────

export default function WarehouseDisplayPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = use(params);
  const [data, setData] = useState<DisplayData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  // Initialize clock as null to avoid hydration mismatch (server vs client Date)
  const [clock, setClock] = useState<Date | null>(null);

  // Initial fetch + 60s refresh
  // fetchData depends only on `token` — NOT on `data`, which caused an infinite
  // re-fetch loop (data changes → new fetchData → effect re-runs → fetch → data changes)
  useEffect(() => {
    let hasData = false;

    async function fetchData() {
      try {
        const res = await fetch(`/api/warehouse/display/${token}`);
        if (!res.ok) {
          setError(res.status === 404 ? "Display not found or revoked" : "Failed to load");
          return;
        }
        const json = await res.json();
        setData(json);
        setLastUpdated(new Date());
        setError(null);
        hasData = true;
      } catch {
        // Keep old data, show stale indicator
        if (!hasData) setError("Unable to connect");
      }
    }

    fetchData();
    const interval = setInterval(fetchData, 60_000);
    return () => clearInterval(interval);
  }, [token]);

  // Clock tick every second — start on mount to avoid hydration mismatch
  useEffect(() => {
    setClock(new Date()); // eslint-disable-line react-hooks/set-state-in-effect
    const interval = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  if (error && !data) {
    return (
      <div className="flex h-screen items-center justify-center bg-warehouse-display text-white">
        <div className="text-center space-y-2">
          <p className="text-2xl font-bold text-red-400">{error}</p>
          <p className="text-lg text-gray-500">Check the display URL in settings</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex h-screen items-center justify-center bg-warehouse-display text-white">
        <div className="text-xl text-gray-400 animate-pulse">Loading warehouse display...</div>
      </div>
    );
  }

  const layout = data.layout || "standard";

  if (layout === "compact") {
    return <CompactLayout data={data} clock={clock} lastUpdated={lastUpdated} />;
  }

  if (layout === "dispatch-only") {
    return <DispatchOnlyLayout data={data} clock={clock} lastUpdated={lastUpdated} />;
  }

  return <StandardLayout data={data} clock={clock} lastUpdated={lastUpdated} />;
}

// ─── Standard Layout ─────────────────────────────────────────────────────────

function StandardLayout({
  data,
  clock,
  lastUpdated,
}: {
  data: DisplayData;
  clock: Date | null;
  lastUpdated: Date | null;
}) {
  return (
    <div className="h-screen w-screen overflow-hidden bg-warehouse-display text-white p-6 flex flex-col">
      {/* Header */}
      <Header data={data} clock={clock} />

      {/* Main grid */}
      <div className="flex-1 grid grid-cols-2 gap-5 min-h-0 mt-5">
        {/* Left: Dispatch */}
        <Section title="TODAY'S DISPATCH" count={data.todaysDispatch.length}>
          {data.todaysDispatch.length === 0 ? (
            <EmptyState text="No dispatches today" />
          ) : (
            <div className="space-y-3 overflow-y-auto max-h-full">
              {data.todaysDispatch.map((p) => (
                <DispatchCard key={p.id} project={p} />
              ))}
            </div>
          )}
        </Section>

        {/* Right: Returns */}
        <Section title="RETURNS DUE TODAY" count={data.todaysReturns.length}>
          {data.todaysReturns.length === 0 ? (
            <EmptyState text="No returns due today" />
          ) : (
            <div className="space-y-3 overflow-y-auto max-h-full">
              {data.todaysReturns.map((p) => (
                <ReturnCard key={p.id} project={p} />
              ))}
            </div>
          )}
        </Section>
      </div>

      {/* Prep status */}
      {data.prepStatus.length > 0 && (
        <div className="mt-5">
          <Section title="PREP STATUS" count={data.prepStatus.length}>
            <div className="flex gap-3 overflow-x-auto pb-1">
              {data.prepStatus.map((p) => (
                <PrepStatusCard key={p.projectId} prep={p} />
              ))}
            </div>
          </Section>
        </div>
      )}

      {/* Upcoming + Alerts */}
      <div className="mt-5 grid grid-cols-2 gap-5">
        <Section title="UPCOMING 7 DAYS">
          <UpcomingWeek days={data.upcoming} />
        </Section>
        <Section title="ALERTS" count={data.alerts.length}>
          {data.alerts.length === 0 ? (
            <p className="text-gray-500 text-lg">No alerts</p>
          ) : (
            <div className="space-y-2 overflow-y-auto max-h-32">
              {data.alerts.map((a, i) => (
                <AlertRow key={i} alert={a} />
              ))}
            </div>
          )}
        </Section>
      </div>

      {/* Footer */}
      <Footer lastUpdated={lastUpdated} />
    </div>
  );
}

// ─── Compact Layout ──────────────────────────────────────────────────────────

function CompactLayout({
  data,
  clock,
  lastUpdated,
}: {
  data: DisplayData;
  clock: Date | null;
  lastUpdated: Date | null;
}) {
  return (
    <div className="h-screen w-screen overflow-hidden bg-warehouse-display text-white p-8 flex flex-col">
      <Header data={data} clock={clock} />

      <div className="flex-1 grid grid-cols-2 gap-6 min-h-0 mt-6">
        <Section title="TODAY'S DISPATCH" count={data.todaysDispatch.length}>
          {data.todaysDispatch.length === 0 ? (
            <EmptyState text="No dispatches today" />
          ) : (
            <div className="space-y-4 overflow-y-auto max-h-full">
              {data.todaysDispatch.map((p) => (
                <DispatchCard key={p.id} project={p} large />
              ))}
            </div>
          )}
        </Section>

        <Section title="RETURNS DUE TODAY" count={data.todaysReturns.length}>
          {data.todaysReturns.length === 0 ? (
            <EmptyState text="No returns due today" />
          ) : (
            <div className="space-y-4 overflow-y-auto max-h-full">
              {data.todaysReturns.map((p) => (
                <ReturnCard key={p.id} project={p} large />
              ))}
            </div>
          )}
        </Section>
      </div>

      {data.alerts.length > 0 && (
        <div className="mt-6">
          <div className="flex gap-3 flex-wrap">
            {data.alerts.map((a, i) => (
              <AlertRow key={i} alert={a} />
            ))}
          </div>
        </div>
      )}

      <Footer lastUpdated={lastUpdated} />
    </div>
  );
}

// ─── Dispatch Only Layout ────────────────────────────────────────────────────

function DispatchOnlyLayout({
  data,
  clock,
  lastUpdated,
}: {
  data: DisplayData;
  clock: Date | null;
  lastUpdated: Date | null;
}) {
  return (
    <div className="h-screen w-screen overflow-hidden bg-warehouse-display text-white p-8 flex flex-col">
      <Header data={data} clock={clock} />

      <div className="flex-1 min-h-0 mt-6 space-y-6">
        <Section title="TODAY'S DISPATCH" count={data.todaysDispatch.length}>
          {data.todaysDispatch.length === 0 ? (
            <EmptyState text="No dispatches today" />
          ) : (
            <div className="grid grid-cols-2 gap-4 overflow-y-auto max-h-full">
              {data.todaysDispatch.map((p) => (
                <DispatchCard key={p.id} project={p} large />
              ))}
            </div>
          )}
        </Section>

        {data.prepStatus.length > 0 && (
          <Section title="PREP STATUS" count={data.prepStatus.length}>
            <div className="flex gap-4 overflow-x-auto pb-1">
              {data.prepStatus.map((p) => (
                <PrepStatusCard key={p.projectId} prep={p} large />
              ))}
            </div>
          </Section>
        )}
      </div>

      {data.alerts.length > 0 && (
        <div className="mt-6 flex gap-3 flex-wrap">
          {data.alerts.map((a, i) => (
            <AlertRow key={i} alert={a} />
          ))}
        </div>
      )}

      <Footer lastUpdated={lastUpdated} />
    </div>
  );
}

// ─── Shared Components ───────────────────────────────────────────────────────

function Header({ data, clock }: { data: DisplayData; clock: Date | null }) {
  const title = data.locationName || data.orgName;
  const now = clock ?? new Date();
  const dateStr = now.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const timeStr = now.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  return (
    <div className="flex items-center justify-between border-b border-gray-800 pb-4">
      <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
      <div className="text-right">
        <div className="text-2xl font-mono font-bold tabular-nums">{timeStr}</div>
        <div className="text-sm text-gray-400">{dateStr}</div>
      </div>
    </div>
  );
}

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-0 flex flex-col">
      <div className="flex items-center gap-2 mb-3">
        <h2 className="text-sm font-semibold tracking-widest text-gray-400 uppercase">
          {title}
        </h2>
        {count !== undefined && count > 0 && (
          <span className="bg-gray-800 text-gray-300 text-xs font-medium px-2 py-0.5 rounded-full">
            {count}
          </span>
        )}
      </div>
      <div className="flex-1 min-h-0">{children}</div>
    </div>
  );
}

function DispatchCard({
  project,
  large,
}: {
  project: DispatchProject;
  large?: boolean;
}) {
  const progress =
    project.totalItems > 0
      ? Math.round((project.checkedOutItems / project.totalItems) * 100)
      : 0;

  const statusColor =
    progress === 100
      ? "bg-emerald-500"
      : progress > 0
        ? "bg-amber-500"
        : "bg-red-500";

  const statusDot =
    progress === 100
      ? "text-emerald-400"
      : progress > 0
        ? "text-amber-400"
        : "text-red-400";

  return (
    <div className="rounded-lg bg-gray-900/80 border border-gray-800 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`inline-block w-2.5 h-2.5 rounded-full ${statusColor}`} />
            <span className={`font-bold ${large ? "text-2xl" : "text-xl"} truncate`}>
              #{project.projectNumber}
            </span>
          </div>
          <p className={`${large ? "text-lg" : "text-base"} text-gray-300 truncate mt-0.5`}>
            {project.name}
          </p>
        </div>
        <div className={`text-right shrink-0 ${statusDot}`}>
          <div className={`font-bold ${large ? "text-2xl" : "text-lg"}`}>
            {project.checkedOutItems}/{project.totalItems}
          </div>
          <div className="text-xs text-gray-500">packed</div>
        </div>
      </div>

      {/* Details row */}
      <div className={`flex flex-wrap gap-x-4 gap-y-1 mt-2 ${large ? "text-base" : "text-sm"} text-gray-400`}>
        {project.deliveryTime && (
          <span>Delivery {project.deliveryTime}</span>
        )}
        {project.destination && <span>{project.destination}</span>}
        {project.vehicle && <span>{project.vehicle}</span>}
      </div>

      {/* Progress bar */}
      <div className="mt-3 h-1.5 bg-gray-800 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${statusColor}`}
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}

function ReturnCard({
  project,
  large,
}: {
  project: ReturnProject;
  large?: boolean;
}) {
  return (
    <div className="rounded-lg bg-gray-900/80 border border-gray-800 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-blue-500" />
            <span className={`font-bold ${large ? "text-2xl" : "text-xl"} truncate`}>
              #{project.projectNumber}
            </span>
          </div>
          <p className={`${large ? "text-lg" : "text-base"} text-gray-300 truncate mt-0.5`}>
            {project.name}
          </p>
        </div>
        <div className="text-right shrink-0">
          <div className={`font-bold text-blue-400 ${large ? "text-2xl" : "text-lg"}`}>
            {project.expectedItems}
          </div>
          <div className="text-xs text-gray-500">items</div>
        </div>
      </div>
      {project.dueTime && (
        <p className={`mt-2 ${large ? "text-base" : "text-sm"} text-gray-400`}>
          Due back by {project.dueTime}
        </p>
      )}
    </div>
  );
}

function PrepStatusCard({
  prep,
  large,
}: {
  prep: PrepCard;
  large?: boolean;
}) {
  const progress =
    prep.totalItems > 0
      ? Math.round((prep.packedItems / prep.totalItems) * 100)
      : 0;
  const done = progress === 100;

  return (
    <div
      className={`shrink-0 rounded-lg border p-3 ${large ? "min-w-[180px]" : "min-w-[140px]"} ${
        done
          ? "bg-emerald-950/40 border-emerald-800"
          : "bg-gray-900/80 border-gray-800"
      }`}
    >
      <p className={`font-bold ${large ? "text-lg" : "text-base"} truncate`}>
        #{prep.projectNumber}
      </p>
      <p className="text-sm text-gray-400 truncate">{prep.projectName}</p>
      <div className="mt-2">
        <div className="flex items-center justify-between text-sm">
          <span className={done ? "text-emerald-400" : "text-gray-300"}>
            {prep.packedItems}/{prep.totalItems}
          </span>
          <span className={`text-xs ${done ? "text-emerald-400" : "text-gray-500"}`}>
            {done ? "Ready" : `${progress}%`}
          </span>
        </div>
        <div className="mt-1 h-1 bg-gray-800 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full ${done ? "bg-emerald-500" : "bg-amber-500"}`}
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
    </div>
  );
}

function UpcomingWeek({ days }: { days: UpcomingDay[] }) {
  if (days.length === 0) return <p className="text-gray-500 text-lg">No data</p>;

  return (
    <div className="flex gap-2">
      {days.map((day) => {
        const d = new Date(day.date);
        const dayName = d.toLocaleDateString(undefined, { weekday: "short" });
        const dayNum = d.getDate();

        return (
          <div
            key={day.date}
            className="flex-1 rounded-lg bg-gray-900/60 border border-gray-800 p-3 text-center"
          >
            <div className="text-xs text-gray-500 uppercase">{dayName}</div>
            <div className="text-lg font-bold">{dayNum}</div>
            <div className="mt-2 space-y-1 text-sm">
              {day.dispatching > 0 && (
                <div className="text-amber-400">{day.dispatching} out</div>
              )}
              {day.returning > 0 && (
                <div className="text-blue-400">{day.returning} back</div>
              )}
              {day.dispatching === 0 && day.returning === 0 && (
                <div className="text-gray-600">&mdash;</div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function AlertRow({ alert }: { alert: Alert }) {
  const isError = alert.type === "error";
  return (
    <div
      className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium ${
        isError
          ? "bg-red-950/50 text-red-300 border border-red-900"
          : "bg-amber-950/50 text-amber-300 border border-amber-900"
      }`}
    >
      <span>{isError ? "!!!" : "!"}</span>
      <span>{alert.message}</span>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex items-center justify-center h-full min-h-[120px]">
      <p className="text-xl text-gray-600">{text}</p>
    </div>
  );
}

function Footer({ lastUpdated }: { lastUpdated: Date | null }) {
  const timeAgo = lastUpdated
    ? `Updated ${lastUpdated.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`
    : "Loading...";

  return (
    <div className="mt-4 flex items-center justify-between text-xs text-gray-600 border-t border-gray-800 pt-3">
      <span>RVLT Flow Warehouse Display</span>
      <span>{timeAgo} &middot; Auto-refreshes every 60s</span>
    </div>
  );
}
