import * as React from "react";

import { cn } from "@/lib/utils";
import { FlowMascot } from "@/components/ui/flow-mascot";
import { Button } from "@/components/ui/button";

type EmptyStateAction = React.ReactNode | { label: React.ReactNode; onClick?: () => void; href?: string };

type EmptyStateProps = React.HTMLAttributes<HTMLDivElement> & {
  title?: React.ReactNode;
  heading?: React.ReactNode;
  description?: React.ReactNode;
  action?: EmptyStateAction;
  preset?: string;
  icon?: React.ComponentType<{ className?: string }>;
};

const PRESETS: Record<string, { title: string; description: string }> = {
  activity: {
    title: "No activity yet",
    description: "Nothing has moved. Suspiciously peaceful.",
  },
  assets: {
    title: "No assets yet",
    description: "Add gear when it exists outside someone’s head.",
  },
  projects: {
    title: "No jobs yet",
    description: "Create the job before the job creates problems.",
  },
  suppliers: {
    title: "No supplier records yet",
    description: "Useful once the paperwork starts breeding.",
  },
  calendar: {
    title: "Nothing scheduled",
    description: "A clear calendar. Rare. Enjoy the silence.",
  },
  kits: {
    title: "No kits yet",
    description: "Bundle the repeat offenders before they wander off.",
  },
  maintenance: {
    title: "No maintenance records",
    description: "No faults logged. Either excellent or terrifying.",
  },
  models: {
    title: "No models yet",
    description: "Add the reusable gear template before tracking the individual unit.",
  },
};

/**
 * RVLT empty state (DESIGN.md §15.5) — the Flow mascot + one operator-voice line, the
 * sanctioned home for personality in the app. Compatible with the old app's `heading`
 * and object-action props while new pages use `title`.
 */
const EmptyState = React.forwardRef<HTMLDivElement, EmptyStateProps>(
  ({ className, title, heading, description, action, children, preset, icon: Icon, ...props }, ref) => {
    const presetCopy = preset ? PRESETS[preset] : undefined;
    const resolvedTitle = title ?? heading ?? presetCopy?.title;
    const resolvedDescription = description ?? presetCopy?.description;
    const resolvedAction =
      action && typeof action === "object" && !React.isValidElement(action) && "label" in action ? (
        action.href ? (
          <Button asChild variant="line" size="sm">
            <a href={action.href}>{action.label}</a>
          </Button>
        ) : (
          <Button type="button" variant="line" size="sm" onClick={action.onClick}>
            {action.label}
          </Button>
        )
      ) : (
        action
      );

    return (
      <div
        ref={ref}
        className={cn(
          "flex flex-col items-center gap-3 rounded-[var(--r-lg)] border-2 border-dashed border-border p-7 text-center",
          className,
        )}
        {...props}
      >
        {Icon ? <Icon className="size-12 text-muted" /> : <FlowMascot className="size-12 text-muted" />}
        <div className="flex flex-col gap-1">
          <p className="text-[14px] font-medium text-ink-2">{resolvedTitle}</p>
          {resolvedDescription ? <p className="text-[12.5px] text-faint">{resolvedDescription}</p> : null}
        </div>
        {resolvedAction}
        {children}
      </div>
    );
  },
);
EmptyState.displayName = "EmptyState";

export { EmptyState };
