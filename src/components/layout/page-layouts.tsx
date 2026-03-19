import { cn } from "@/lib/utils";
import { PageHeader } from "./page-header";

// ─── List Page Layout ───────────────────────────────────────────

interface ListPageLayoutProps {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  /** Filter bar or search inputs */
  filters?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

/**
 * Layout for list/table pages: PageHeader + optional filters + DataTable + empty state.
 */
export function ListPageLayout({
  title,
  description,
  actions,
  filters,
  children,
  className,
}: ListPageLayoutProps) {
  return (
    <div className={cn("space-y-4", className)}>
      <PageHeader title={title} description={description} actions={actions} />
      {filters && <div className="flex flex-wrap items-center gap-2">{filters}</div>}
      {children}
    </div>
  );
}

// ─── Detail Page Layout ─────────────────────────────────────────

interface DetailPageLayoutProps {
  /** Left side of header: title + badges/status */
  header: React.ReactNode;
  /** Right side of header: action buttons */
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

/**
 * Layout for detail pages: Flexible header + tabs/content.
 *
 * The header slot is flexible — pass whatever combination of
 * thumbnail, title, badges, and metadata you need.
 */
export function DetailPageLayout({
  header,
  actions,
  children,
  className,
}: DetailPageLayoutProps) {
  return (
    <div className={cn("space-y-6", className)}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">{header}</div>
        {actions && (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {actions}
          </div>
        )}
      </div>
      {children}
    </div>
  );
}

// ─── Form Page Layout ───────────────────────────────────────────

interface FormSectionProps {
  /** Section title (t-heading, 14px/700) */
  title?: string;
  /** Section description */
  description?: string;
  children: React.ReactNode;
  className?: string;
}

/**
 * Flat form section separated by border-top divider.
 * Per DESIGN.md: No Card wrapping per section. Flat layout with dividers.
 */
export function FormSection({
  title,
  description,
  children,
  className,
}: FormSectionProps) {
  return (
    <div className={cn("border-t border-border pt-5 first:border-t-0 first:pt-0", className)}>
      {(title || description) && (
        <div className="mb-4">
          {title && <h3 className="t-heading text-fg">{title}</h3>}
          {description && (
            <p className="mt-0.5 text-[12px] text-fg-3">{description}</p>
          )}
        </div>
      )}
      <div className="grid grid-cols-1 gap-x-4 gap-y-3.5 sm:grid-cols-2">
        {children}
      </div>
    </div>
  );
}

interface FormPageLayoutProps {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

/**
 * Layout for form pages: PageHeader + surface container with flat form sections.
 * Per DESIGN.md: Actions (save/cancel) right-aligned at form bottom.
 */
export function FormPageLayout({
  title,
  description,
  actions,
  children,
  className,
}: FormPageLayoutProps) {
  return (
    <div className={cn("space-y-4", className)}>
      <PageHeader title={title} description={description} />
      <div className="rounded-lg bg-bg-surface p-5 surface-ring sm:p-6">
        <div className="space-y-6">{children}</div>
        {actions && (
          <div className="mt-6 flex justify-end gap-2 border-t border-border pt-4">
            {actions}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Section Header ─────────────────────────────────────────────

interface SectionHeaderProps {
  /** Label text (overline style, uppercase) */
  label: string;
  className?: string;
}

/**
 * Section header with teal label chip + extending line.
 * Per DESIGN.md: 10px/700/uppercase teal text on teal-subtle bg, with a
 * flex:1 line extending to the right.
 */
export function SectionHeader({ label, className }: SectionHeaderProps) {
  return (
    <div className={cn("section-label", className)}>
      <span className="t-overline shrink-0 rounded-sm bg-teal-subtle px-2 py-0.5 text-primary">
        {label}
      </span>
    </div>
  );
}
