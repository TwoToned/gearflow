import * as React from "react";

import { cn } from "@/lib/utils";

function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("motion-safe:animate-pulse rounded-[8px] bg-elev", className)}
      {...props}
    />
  );
}

/** Table skeleton — matches DataTable structure. Deterministic widths (no
 * Math.random) to avoid SSR/CSR hydration mismatches. */
function TableSkeleton({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  const w = (n: number) => `${56 + ((n * 23) % 70)}px`;
  return (
    <div className="overflow-hidden rounded-[var(--r-lg)] border border-line">
      <div className="flex gap-4 border-b border-line px-4 py-3">
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={i} className="h-3" style={{ width: w(i + 1) }} />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex items-center gap-4 border-b border-line px-4 py-3 last:border-b-0">
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} className="h-3.5" style={{ width: w(r * cols + c + 2) }} />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Card skeleton — info card pattern. */
function CardSkeleton() {
  return (
    <div className="space-y-3 rounded-[var(--r-lg)] border border-line bg-card p-4 shadow-[var(--sh-card)]">
      <Skeleton className="h-3 w-24" />
      <div className="space-y-2">
        {[["w-16", "w-20"], ["w-20", "w-14"], ["w-14", "w-24"]].map(([a, b], i) => (
          <div key={i} className="flex justify-between">
            <Skeleton className={`h-3 ${a}`} />
            <Skeleton className={`h-3 ${b}`} />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Detail page skeleton — hero + tabs + card grid. */
function DetailPageSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex gap-4">
          <Skeleton className="size-16 shrink-0 rounded-[var(--r)]" />
          <div className="space-y-2">
            <Skeleton className="h-6 w-48" />
            <div className="flex gap-2">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-16" />
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-9 w-20" />
          <Skeleton className="h-9 w-20" />
        </div>
      </div>
      <div className="flex gap-1 border-b border-line pb-2">
        <Skeleton className="h-7 w-16" />
        <Skeleton className="h-7 w-16" />
        <Skeleton className="h-7 w-16" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <CardSkeleton />
        <CardSkeleton />
        <CardSkeleton />
      </div>
    </div>
  );
}

/** Form page skeleton — header + flat form surface. */
function FormSkeleton({ fields = 6 }: { fields?: number }) {
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-3.5 w-64" />
      </div>
      <div className="space-y-6 rounded-[var(--r-lg)] border border-line bg-card p-5 shadow-[var(--sh-card)]">
        <div className="grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2">
          {Array.from({ length: fields }).map((_, i) => (
            <div key={i} className="space-y-1.5">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-9 w-full" />
            </div>
          ))}
        </div>
        <div className="flex justify-end border-t border-line pt-4">
          <Skeleton className="h-9 w-24" />
        </div>
      </div>
    </div>
  );
}

/** List page skeleton — header + table. */
function ListPageSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-3.5 w-56" />
        </div>
        <Skeleton className="h-9 w-28" />
      </div>
      <TableSkeleton rows={rows} />
    </div>
  );
}

export { Skeleton, TableSkeleton, CardSkeleton, DetailPageSkeleton, FormSkeleton, ListPageSkeleton };
