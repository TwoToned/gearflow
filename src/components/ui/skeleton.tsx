import * as React from "react";

import { cn } from "@/lib/utils";

function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("animate-pulse rounded-[8px] bg-elev", className)}
      {...props}
    />
  );
}

function FormSkeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("space-y-5", className)} {...props}>
      <Skeleton className="h-8 w-64" />
      <div className="rounded-[var(--r-lg)] border-2 border-border bg-paper-2 p-5 shadow-[var(--sh-card)]">
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-28 w-full md:col-span-2" />
        </div>
      </div>
    </div>
  );
}

function DetailPageSkeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("space-y-6", className)} {...props}>
      <div className="rounded-[var(--r-lg)] border-2 border-border bg-paper-2 p-6 shadow-[var(--sh-card)]">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="mt-4 h-11 w-2/3" />
        <Skeleton className="mt-3 h-4 w-1/2" />
      </div>
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
        <Skeleton className="h-80 w-full" />
      </div>
    </div>
  );
}

export { Skeleton, FormSkeleton, DetailPageSkeleton };
