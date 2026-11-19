"use client";

import { StateGlyphs } from "@/components/ui/state-glyph";
import { FooterTotals } from "@/components/ui/footer-totals";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ROLLUP_SUBTOTAL_LABEL } from "@/lib/category-pricing-display";
import { buildEquipmentFooterTotals } from "@/lib/equipment-footer-totals";
import type {
  ClientViewChild,
  ClientViewRow,
  ClientViewSection,
  EquipmentClientView as ClientViewData,
} from "@/lib/equipment-client-view";
import type { StateGlyph } from "@/lib/primitives/types";
import { cn } from "@/lib/utils";
import type { EquipmentView } from "@/hooks/use-equipment-client-view";

/**
 * The Equipment tab's view words (spec §7: `List · Client view`). Underlined
 * words with `aria-pressed`, the same look as the stage filter. The caller
 * keeps the value in the URL (`useEquipmentViewParam`).
 */
const VIEW_WORDS: Array<{ key: EquipmentView; label: string }> = [
  { key: "list", label: "List" },
  { key: "client", label: "Client view" },
];

export function EquipmentViewWords({ value, onChange }: { value: EquipmentView; onChange: (v: EquipmentView) => void }) {
  return (
    <div role="toolbar" aria-label="Equipment view" className="flex items-center gap-4">
      {VIEW_WORDS.map((w) => {
        const on = w.key === value;
        return (
          <button
            key={w.key}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(w.key)}
            className={cn(
              "inline-flex min-h-11 shrink-0 items-center whitespace-nowrap border-b-2 border-transparent text-table-cell font-semibold outline-none",
              "focus-visible:ring-2 focus-visible:ring-red",
              on ? "border-red text-ink" : "text-muted hover:text-ink",
            )}
          >
            {w.label}
          </button>
        );
      })}
    </div>
  );
}

function rowGlyphs(row: ClientViewRow): StateGlyph[] {
  const glyphs: StateGlyph[] = [];
  if (row.isOptional) glyphs.push({ key: "optional", tooltip: "Optional · prints without counting" });
  if (row.priceHidden) glyphs.push({ key: "priceHidden", tooltip: "Price in the category's combined price" });
  return glyphs;
}

/** `×2 · $85.00 · -15%`: the quantity and the PDF's unit and discount cells.
 *  A blank cell (rolled-up) or the PDF's `-` (nothing) is left out. */
function rowMeta(row: ClientViewRow): string {
  const shown = (text: string) => text !== "" && text !== "-";
  return [`×${row.qty}`, shown(row.unitPrice) ? row.unitPrice : "", shown(row.discount) ? row.discount : ""]
    .filter(Boolean)
    .join(" · ");
}

function ChildLines({ items, depth }: { items: ClientViewChild[]; depth: 1 | 2 }) {
  return (
    <>
      {items.map((c) => (
        <li key={c.id} data-client-child className={cn("text-caption text-ink-2", depth === 1 ? "pl-4" : "pl-8")}>
          <div className="flex items-baseline gap-2 py-0.5">
            <span className="min-w-0 truncate">{c.name}</span>
            <span className="t-mono text-muted">×{c.qty}</span>
          </div>
          {c.children.length > 0 && (
            <ul>
              <ChildLines items={c.children} depth={2} />
            </ul>
          )}
        </li>
      ))}
    </>
  );
}

function Row({ row }: { row: ClientViewRow }) {
  return (
    <li data-client-row={row.id} className="py-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="min-w-0 text-ui-text text-ink">{row.name}</span>
          <span className="t-mono text-muted">{rowMeta(row)}</span>
          <StateGlyphs glyphs={rowGlyphs(row)} />
        </div>
        <span className="shrink-0 font-mono text-ui-text tabular-nums text-ink">{row.total}</span>
      </div>
      {row.subtitle && <div className="text-caption text-muted">{row.subtitle}</div>}
      {row.notes && <div className="line-clamp-2 whitespace-pre-line text-caption text-muted">{row.notes}</div>}
      {row.children.length > 0 && (
        <ul aria-label={`${row.name} includes`}>
          <ChildLines items={row.children} depth={1} />
        </ul>
      )}
    </li>
  );
}

function Section({ section }: { section: ClientViewSection }) {
  return (
    <section data-client-section={section.key} aria-label={section.title ?? "Other lines"} className="mt-2">
      {section.title && (
        <div className="flex items-baseline justify-between gap-3 border-b border-line pb-1 pt-2.5">
          <h3 className="text-ui-text font-semibold text-ink">{section.title}</h3>
          {section.rollupText && (
            <span className="shrink-0 text-caption text-muted">
              {ROLLUP_SUBTOTAL_LABEL} <span className="font-mono text-ui-text font-semibold tabular-nums text-ink">{section.rollupText}</span>
            </span>
          )}
        </div>
      )}
      <ul>
        {section.rows.map((r) => (
          <Row key={r.id} row={r} />
        ))}
      </ul>
    </section>
  );
}

/**
 * The quote as it prints, read-only (spec §7, §13): every row, price and
 * section header comes from the quote's own table model on the server
 * (`getEquipmentClientView`), so this renders text and never decides what
 * prints. No add bar, no selection, no row menus.
 */
export function EquipmentClientViewBody({ view, versionNumber }: { view: ClientViewData; versionNumber?: number }) {
  const empty = view.sections.every((s) => s.rows.length === 0);
  return (
    <div aria-label="Client view" role="region" className="max-w-[760px]">
      <p className="t-overline pb-1 text-muted">
        {versionNumber != null ? `Client view · v${versionNumber}` : "Client view"} · as it prints
      </p>
      {empty ? (
        <p className="py-8 text-center text-caption text-muted">Nothing prints on the quote yet.</p>
      ) : (
        view.sections.map((s) => <Section key={s.key} section={s} />)
      )}
      <FooterTotals lines={buildEquipmentFooterTotals(view.totals)} className="mt-3" />
    </div>
  );
}

/** Loading, error and loaded states around `EquipmentClientViewBody`. */
export function EquipmentClientView({
  view,
  isLoading,
  error,
  onRetry,
  versionNumber,
}: {
  view: ClientViewData | undefined;
  isLoading: boolean;
  error: Error | null;
  onRetry: () => void;
  versionNumber?: number;
}) {
  if (view) return <EquipmentClientViewBody view={view} versionNumber={versionNumber} />;
  if (error && !isLoading) {
    return (
      <div className="flex items-center gap-3 py-8 text-caption text-muted">
        Couldn&apos;t load the client view.
        <Button variant="ghost" size="sm" onClick={onRetry}>
          Try again
        </Button>
      </div>
    );
  }
  return (
    <div aria-label="Loading client view" className="max-w-[760px] space-y-3 py-2">
      {Array.from({ length: 4 }, (_, i) => (
        <Skeleton key={i} className="h-5 w-full" />
      ))}
    </div>
  );
}
