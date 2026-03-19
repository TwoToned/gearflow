import { cn } from "@/lib/utils"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("skeleton-shimmer rounded-md", className)}
      {...props}
    />
  )
}

/** Table skeleton — matches DataTable structure */
function TableSkeleton({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="rounded-lg surface-ring overflow-hidden">
      {/* Header */}
      <div className="flex gap-4 border-b border-border px-4 py-3">
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={i} className="h-3 rounded" style={{ width: `${60 + Math.random() * 40}px` }} />
        ))}
      </div>
      {/* Rows */}
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex items-center gap-4 border-b border-border px-4 py-3 last:border-b-0">
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} className="h-3.5 rounded" style={{ width: `${50 + Math.random() * 80}px` }} />
          ))}
        </div>
      ))}
    </div>
  )
}

/** Card skeleton — matches info card pattern */
function CardSkeleton() {
  return (
    <div className="rounded-lg bg-bg-surface p-4 surface-ring-xs space-y-3">
      <Skeleton className="h-3 w-24 rounded" />
      <div className="space-y-2">
        <div className="flex justify-between">
          <Skeleton className="h-3 w-16 rounded" />
          <Skeleton className="h-3 w-20 rounded" />
        </div>
        <div className="flex justify-between">
          <Skeleton className="h-3 w-20 rounded" />
          <Skeleton className="h-3 w-14 rounded" />
        </div>
        <div className="flex justify-between">
          <Skeleton className="h-3 w-14 rounded" />
          <Skeleton className="h-3 w-24 rounded" />
        </div>
      </div>
    </div>
  )
}

/** Detail page skeleton */
function DetailPageSkeleton() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex gap-4">
          <Skeleton className="size-16 shrink-0 rounded-lg" />
          <div className="space-y-2">
            <Skeleton className="h-6 w-48 rounded" />
            <div className="flex gap-2">
              <Skeleton className="h-4 w-20 rounded-sm" />
              <Skeleton className="h-4 w-16 rounded-sm" />
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-8 w-20 rounded-md" />
          <Skeleton className="h-8 w-20 rounded-md" />
        </div>
      </div>
      {/* Tabs */}
      <div className="flex gap-1 border-b border-border pb-2">
        <Skeleton className="h-7 w-16 rounded-md" />
        <Skeleton className="h-7 w-16 rounded-md" />
        <Skeleton className="h-7 w-16 rounded-md" />
      </div>
      {/* Card grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <CardSkeleton />
        <CardSkeleton />
        <CardSkeleton />
      </div>
    </div>
  )
}

/** Form page skeleton */
function FormSkeleton({ fields = 6 }: { fields?: number }) {
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="space-y-1">
        <Skeleton className="h-5 w-40 rounded" />
        <Skeleton className="h-3.5 w-64 rounded" />
      </div>
      {/* Form surface */}
      <div className="rounded-lg bg-bg-surface p-5 surface-ring space-y-6">
        {/* Fields in 2-col grid */}
        <div className="grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2">
          {Array.from({ length: fields }).map((_, i) => (
            <div key={i} className="space-y-1.5">
              <Skeleton className="h-3 w-20 rounded" />
              <Skeleton className="h-9 w-full rounded-md" />
            </div>
          ))}
        </div>
        {/* Save button */}
        <div className="flex justify-end border-t border-border pt-4">
          <Skeleton className="h-9 w-24 rounded-md" />
        </div>
      </div>
    </div>
  )
}

/** List page skeleton (header + table) */
function ListPageSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <Skeleton className="h-5 w-32 rounded" />
          <Skeleton className="h-3.5 w-56 rounded" />
        </div>
        <Skeleton className="h-9 w-28 rounded-md" />
      </div>
      {/* Table */}
      <TableSkeleton rows={rows} />
    </div>
  )
}

export {
  Skeleton,
  TableSkeleton,
  CardSkeleton,
  DetailPageSkeleton,
  FormSkeleton,
  ListPageSkeleton,
}
