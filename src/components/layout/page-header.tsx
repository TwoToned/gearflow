import { cn } from "@/lib/utils";

interface PageHeaderProps {
  /** Page title — uses t-title (20px/700) */
  title: string;
  /** Optional description below the title */
  description?: string;
  /** Action buttons rendered on the right side */
  actions?: React.ReactNode;
  /** Optional content below description (e.g., status indicator, breadcrumb) */
  meta?: React.ReactNode;
  className?: string;
}

/**
 * Consistent page header with title, description, and action buttons.
 *
 * Per DESIGN.md: t-title typography, no "Manage your X directory" boilerplate.
 * Right-aligned action buttons on desktop, stacked on mobile.
 */
export function PageHeader({
  title,
  description,
  actions,
  meta,
  className,
}: PageHeaderProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between",
        className,
      )}
    >
      <div className="min-w-0 space-y-1">
        <h1 className="t-title text-fg">{title}</h1>
        {description && (
          <p className="t-body text-fg-3">{description}</p>
        )}
        {meta && <div className="mt-1">{meta}</div>}
      </div>
      {actions && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {actions}
        </div>
      )}
    </div>
  );
}
