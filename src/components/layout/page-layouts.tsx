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

// ─── Detail Two-Column Layout ───────────────────────────────────

/**
 * Two-column body for detail pages: a flexible main column beside a
 * fixed-width (340px) sticky sidebar, stacking vertically below `lg`.
 *
 * Distinct from DetailPageLayout (which owns the title/header row): a
 * detail page's header sits above, this 2-column body sits below it.
 * Compose with DetailMain + DetailSidebar:
 *
 *   <DetailLayout>
 *     <DetailMain>{tabs / content}</DetailMain>
 *     <DetailSidebar>
 *       <SidebarSection title="…">…</SidebarSection>
 *     </DetailSidebar>
 *   </DetailLayout>
 */
export function DetailLayout({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-6 lg:flex-row", className)}>
      {children}
    </div>
  );
}

/** Main (left) column of a DetailLayout — flexes to fill remaining width. */
export function DetailMain({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={cn("min-w-0 flex-1", className)}>{children}</div>;
}

/**
 * Sidebar (right) column of a DetailLayout — fixed 340px on `lg`, sticky
 * to the top while the main column scrolls.
 */
export function DetailSidebar({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("w-full space-y-4 lg:w-[340px] lg:shrink-0", className)}>
      <div className="lg:sticky lg:top-4 space-y-4">{children}</div>
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

interface SettingsCardProps {
  children: React.ReactNode;
  className?: string;
}

/**
 * Surface-ringed card wrapper for settings-page sections — the single
 * source of truth for the "rounded-lg bg-bg-surface p-5 surface-ring sm:p-6"
 * style used across settings and admin pages.
 */
export function SettingsCard({ children, className }: SettingsCardProps) {
  return (
    <div className={cn("rounded-lg bg-bg-surface p-5 surface-ring sm:p-6", className)}>
      {children}
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
      <SettingsCard>
        <div className="space-y-6">{children}</div>
        {actions && (
          <div className="mt-6 flex justify-end gap-2 border-t border-border pt-4">
            {actions}
          </div>
        )}
      </SettingsCard>
    </div>
  );
}

// ─── Section Header ─────────────────────────────────────────────

interface SectionHeaderProps {
  /** Label text (overline style, sentence case — never uppercase, §5.2) */
  label: string;
  className?: string;
}

/**
 * Section header — calm muted overline (the DESIGN §5.2 *default* treatment,
 * Linear/Plane-style grey labels). Reserve the red/Kalam "prominent" label for
 * the `ui/section-header.tsx` prominent variant — routine section dividers stay
 * quiet so a sidebar of them reads calm, not loud.
 */
export function SectionHeader({ label, className }: SectionHeaderProps) {
  return (
    <div className={className}>
      <span className="t-overline text-muted">{label}</span>
    </div>
  );
}

// ─── Sidebar Section ────────────────────────────────────────────

interface SidebarSectionProps {
  /** Section label, rendered via SectionHeader. */
  title: string;
  children: React.ReactNode;
  /**
   * Bottom divider. Keep `true` (default) for every section except the
   * last one in a sidebar, which omits the trailing rule.
   */
  divider?: boolean;
  className?: string;
}

/**
 * One block inside a DetailSidebar: a SectionHeader plus content, with a
 * bottom divider separating it from the next block.
 */
export function SidebarSection({
  title,
  children,
  divider = true,
  className,
}: SidebarSectionProps) {
  return (
    <div
      className={cn(
        divider ? "border-b border-border pb-4 space-y-2" : "space-y-2",
        className,
      )}
    >
      <SectionHeader label={title} />
      {children}
    </div>
  );
}
