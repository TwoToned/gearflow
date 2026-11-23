"use client";

import { useRef } from "react";
import { ChevronDown, Minus, Plus } from "lucide-react";

import { announceListWrite } from "@/lib/list-write-toast";
import type { ActionMenuSpec } from "@/lib/primitives/types";
import {
  FAILURE_ACTION_LABELS,
  METHOD_LABELS,
  makeOutlets,
  nextDueText,
  outletColumns,
  readingVerdict,
  testRows,
  visualItems,
  type FailureAction,
  type OutletDraft,
  type Reading,
  type SubKey,
  type TestMethod,
  type TestRow,
  type TtDraft,
  type TtProfile,
  type Verdict,
} from "@/lib/tt-draft";
import { cn } from "@/lib/utils";
import { ActionMenu } from "@/components/ui/action-menu";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { StatusWord } from "@/components/ui/status-word";
import { Textarea } from "@/components/ui/textarea";

type Edit = (fn: (d: TtDraft) => TtDraft) => void;

const OP_TEXT: Record<string, string> = { lt: "<", lte: "≤", gt: ">", gte: "≥" };
const VERDICT_WORD: Record<Verdict, { label: string; intent: "success" | "error" | "neutral" }> = {
  PASS: { label: "Pass", intent: "success" },
  FAIL: { label: "Fail", intent: "error" },
  NOT_APPLICABLE: { label: "N/A", intent: "neutral" },
};
// 16 px on phone (no iOS zoom on focus), the table size on desktop.
const inputClass = "h-11 w-28 font-mono text-reading-body md:h-9 md:text-ui-text";

/**
 * Test & tag mode's inline form (spec §9i.2): `Tested by` and `Method` as filter
 * words, Visual inspection ticks (always-on, shift-click range, Pass all with Undo),
 * Electrical rows from the profile with thresholds and `N/A`, Outlets for sub-test
 * profiles, then the Result with the DERIVED next due and, on a fail, the failure
 * action (default `Removed from service`, D53). One scroll — no steps.
 */
export function TtSection(p: {
  draft: TtDraft;
  edit: Edit;
  profile: TtProfile | null;
  testerMenu: { label: string; spec: ActionMenuSpec };
  result: "PASS" | "FAIL" | null;
  intervalMonths: number | null;
  now: number;
  canRefer: boolean;
}) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-caption">
        <WordMenu label={`Tested by: ${p.testerMenu.label}`} spec={p.testerMenu.spec} />
        <WordMenu label={`Method: ${METHOD_LABELS[p.draft.method]}`} spec={methodMenu(p.edit)} />
      </div>
      <VisualSection draft={p.draft} edit={p.edit} profile={p.profile} />
      <ElectricalSection draft={p.draft} edit={p.edit} profile={p.profile} />
      <OutletsSection draft={p.draft} edit={p.edit} profile={p.profile} />
      <ResultSection {...p} />
    </div>
  );
}

function WordMenu({ label, spec }: { label: string; spec: ActionMenuSpec }) {
  return (
    <ActionMenu
      spec={spec}
      label={label}
      trigger={
        <button type="button" className="inline-flex min-h-11 items-center gap-1 font-medium text-ink [@media(pointer:fine)]:min-h-8">
          {label} <ChevronDown aria-hidden="true" className="size-3" />
        </button>
      }
    />
  );
}

function methodMenu(edit: Edit): ActionMenuSpec {
  return {
    items: (Object.keys(METHOD_LABELS) as TestMethod[]).map((m) => ({
      key: m, label: METHOD_LABELS[m], group: "edit" as const, onSelect: () => edit((d) => ({ ...d, method: m })),
    })),
  };
}

function SectionHead({ id, title, meta, children }: { id: string; title: string; meta?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="flex min-h-11 items-center gap-2 border-b border-line">
      <h2 id={id} className="flex flex-1 items-baseline gap-2 text-ui-text font-semibold text-ink">
        {title} {meta ? <span className="text-caption font-normal text-muted">{meta}</span> : null}
      </h2>
      {children}
    </div>
  );
}

// ─── Visual ───────────────────────────────────────────────────────────────────

function VisualSection({ draft, edit, profile }: { draft: TtDraft; edit: Edit; profile: TtProfile | null }) {
  const items = visualItems(profile);
  const last = useRef<number | null>(null);
  if (items.length === 0) return null;
  const ok = items.filter((v) => draft.visual[v.key] === true).length;
  const failed = items.some((v) => draft.visual[v.key] === false);
  const set = (from: number, to: number, value: boolean) =>
    edit((d) => {
      const visual = { ...d.visual };
      for (let i = Math.min(from, to); i <= Math.max(from, to); i++) visual[items[i].key] = value;
      return { ...d, visual };
    });
  const onTick = (i: number, shift: boolean) => {
    const value = draft.visual[items[i].key] !== true;
    set(shift && last.current !== null ? last.current : i, i, value);
    last.current = i;
  };
  const passAll = () => {
    const before = draft.visual;
    set(0, items.length - 1, true);
    announceListWrite({ title: "Every visual check ticked", undoneTitle: "Visual ticks restored", performUndo: async () => edit((d) => ({ ...d, visual: before })) });
  };
  return (
    <section aria-labelledby="tt-visual-head" className="flex flex-col gap-1">
      <SectionHead id="tt-visual-head" title="Visual inspection" meta={<VisualMeta ok={ok} total={items.length} failed={failed} />}>
        <Button variant="ghost" size="sm" onClick={passAll}>Pass all</Button>
      </SectionHead>
      <ul className="flex flex-col">
        {items.map((v, i) => (
          <li key={v.key} className="flex min-h-11 items-center gap-3 text-ui-text">
            <Checkbox
              aria-label={v.label}
              checked={draft.visual[v.key] === true}
              onClick={(e) => {
                e.preventDefault();
                onTick(i, e.shiftKey);
              }}
            />
            <span className={cn("flex-1", draft.visual[v.key] === false && "text-t-out")}>{v.label}</span>
            <Button
              variant="ghost"
              size="sm"
              aria-pressed={draft.visual[v.key] === false}
              aria-label={`${v.label}: failed`}
              className={draft.visual[v.key] === false ? "text-t-out" : "text-muted"}
              onClick={() => edit((d) => ({ ...d, visual: { ...d.visual, [v.key]: false } }))}
            >
              Fail
            </Button>
          </li>
        ))}
      </ul>
      <Textarea
        aria-label="Visual notes"
        value={draft.visualNotes}
        onChange={(e) => {
          const visualNotes = e.target.value;
          edit((d) => ({ ...d, visualNotes }));
        }}
        placeholder="Visual notes"
        rows={2}
        className="text-reading-body md:text-ui-text"
      />
    </section>
  );
}

function VisualMeta({ ok, total, failed }: { ok: number; total: number; failed: boolean }) {
  return (
    <>
      <span className="font-mono tabular-nums">{ok}/{total}</span>
      {failed ? <StatusWord status={{ label: "Fail", intent: "error" }} /> : ok === total ? <StatusWord status={{ label: "Pass", intent: "success" }} /> : null}
    </>
  );
}

// ─── Electrical ───────────────────────────────────────────────────────────────

function thresholdText(row: Pick<TestRow, "threshold" | "operator" | "unit">): string {
  return row.threshold !== null && row.operator ? `${OP_TEXT[row.operator]} ${row.threshold} ${row.unit}`.trim() : "no limit set";
}

function ElectricalSection({ draft, edit, profile }: { draft: TtDraft; edit: Edit; profile: TtProfile | null }) {
  const rows = testRows(profile);
  if (rows.length === 0) return null;
  const setReading = (key: string, r: Reading) => edit((d) => ({ ...d, readings: { ...d.readings, [key]: r } }));
  const setManual = (key: string, v: Verdict) => edit((d) => ({ ...d, manual: { ...d.manual, [key]: v } }));
  return (
    <section aria-labelledby="tt-electrical-head" className="flex flex-col gap-1">
      <SectionHead id="tt-electrical-head" title="Electrical" meta={profile?.name} />
      {rows.map((row) =>
        row.numeric ? (
          <ReadingRow key={row.key} row={row} reading={draft.readings[row.key]} onChange={(r) => setReading(row.key, r)} />
        ) : (
          <ManualRow key={row.key} label={row.label} value={draft.manual[row.key] ?? null} onChange={(v) => setManual(row.key, v)} />
        ),
      )}
      {rows.some((r) => r.key === "insulationResistance") ? (
        <label className="flex min-h-11 items-center gap-3 text-ui-text">
          <span className="flex-1 text-muted">Insulation test voltage (optional)</span>
          <Input
            type="number"
            inputMode="decimal"
            value={draft.insulationVoltage}
            onChange={(e) => {
              const insulationVoltage = e.target.value;
              edit((d) => ({ ...d, insulationVoltage }));
            }}
            className={inputClass}
            aria-label="Insulation test voltage"
          />
          <span className="w-8 text-caption text-muted">V</span>
        </label>
      ) : null}
    </section>
  );
}

function ReadingRow({ row, reading, onChange }: { row: TestRow; reading: Reading | undefined; onChange: (r: Reading) => void }) {
  const r = reading ?? { value: "", na: false };
  const verdict = readingVerdict(r, row);
  const noLimit = row.threshold === null || !row.operator;
  return (
    <div className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 text-ui-text" data-reading={row.key}>
      <div className="min-w-0 flex-1">
        <p className="text-ink">{row.label}</p>
        <p className="text-caption text-muted">{thresholdText(row)}</p>
      </div>
      <Input
        type="number"
        inputMode="decimal"
        step="any"
        aria-label={row.label}
        disabled={r.na}
        value={r.value}
        onChange={(e) => onChange({ ...r, value: e.target.value })}
        className={inputClass}
      />
      <span className="w-10 text-caption text-muted">{row.unit}</span>
      {noLimit && !r.na && r.value ? <PassFailWords value={r.verdict ?? null} onChange={(v) => onChange({ ...r, verdict: v })} label={row.label} /> : null}
      <Button variant="ghost" size="sm" aria-pressed={r.na} aria-label={`${row.label}: N/A`} onClick={() => onChange({ value: "", na: !r.na })}>
        N/A
      </Button>
      <span className="w-12">{verdict ? <StatusWord status={VERDICT_WORD[verdict]} /> : null}</span>
    </div>
  );
}

function PassFailWords({ value, onChange, label }: { value: "PASS" | "FAIL" | null; onChange: (v: "PASS" | "FAIL") => void; label: string }) {
  return (
    <span className="inline-flex gap-1">
      {(["PASS", "FAIL"] as const).map((v) => (
        <Button key={v} variant="ghost" size="sm" aria-pressed={value === v} aria-label={`${label}: ${VERDICT_WORD[v].label}`} onClick={() => onChange(v)}>
          {VERDICT_WORD[v].label}
        </Button>
      ))}
    </span>
  );
}

function ManualRow({ label, value, onChange }: { label: string; value: Verdict | null; onChange: (v: Verdict) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex min-h-11 items-center gap-3 text-ui-text">
      <span className="flex-1 text-ink">{label}</span>
      {(["PASS", "FAIL", "NOT_APPLICABLE"] as const).map((v) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          onClick={() => onChange(v)}
          className={cn(
            "min-h-11 border-b-2 px-1 text-caption font-medium [@media(pointer:fine)]:min-h-8",
            value === v ? "border-ink text-ink" : "border-transparent text-muted",
          )}
        >
          {VERDICT_WORD[v].label}
        </button>
      ))}
    </div>
  );
}

// ─── Outlets ──────────────────────────────────────────────────────────────────

function OutletsSection({ draft, edit, profile }: { draft: TtDraft; edit: Edit; profile: TtProfile | null }) {
  const cols = outletColumns(profile);
  if (!cols) return null;
  const resize = (n: number) =>
    edit((d) => {
      const fresh = makeOutlets(n, profile?.subTestLabel ?? null);
      return { ...d, outlets: fresh.map((o, i) => d.outlets[i] ?? o) };
    });
  const update = (i: number, o: OutletDraft) => edit((d) => ({ ...d, outlets: d.outlets.map((x, j) => (j === i ? o : x)) }));
  const label = profile?.subTestLabel ?? "Outlet";
  return (
    <section aria-labelledby="tt-outlets-head" className="flex flex-col gap-1">
      <SectionHead id="tt-outlets-head" title={`${label}s`} meta={<span className="font-mono tabular-nums">{draft.outlets.length}</span>}>
        <Button variant="ghost" size="icon" aria-label={`One ${label.toLowerCase()} fewer`} disabled={draft.outlets.length <= 1} onClick={() => resize(draft.outlets.length - 1)}>
          <Minus aria-hidden="true" className="size-4" />
        </Button>
        <Button variant="ghost" size="icon" aria-label={`One more ${label.toLowerCase()}`} disabled={draft.outlets.length >= 50} onClick={() => resize(draft.outlets.length + 1)}>
          <Plus aria-hidden="true" className="size-4" />
        </Button>
      </SectionHead>
      {draft.outlets.map((o, i) => (
        <div key={i} className="flex flex-col gap-1 border-b border-line py-2" data-outlet={o.label}>
          <p className="text-caption font-medium text-ink">{o.label}</p>
          {cols.readings.map((row) => (
            <ReadingRow
              key={row.key}
              row={{ ...row, label: `${o.label} ${row.label.toLowerCase()}` }}
              reading={o.readings[row.key as SubKey]}
              onChange={(r) => update(i, { ...o, readings: { ...o.readings, [row.key]: r } })}
            />
          ))}
          {cols.polarity ? <ManualRow label={`${o.label} polarity`} value={o.polarity} onChange={(v) => update(i, { ...o, polarity: v })} /> : null}
        </div>
      ))}
    </section>
  );
}

// ─── Result ───────────────────────────────────────────────────────────────────

function ResultSection(p: { draft: TtDraft; edit: Edit; result: "PASS" | "FAIL" | null; intervalMonths: number | null; now: number; canRefer: boolean }) {
  return (
    <section aria-labelledby="tt-result-head" className="flex flex-col gap-2">
      <SectionHead
        id="tt-result-head"
        title="Result"
        meta={p.result ? <StatusWord status={VERDICT_WORD[p.result]} /> : <span>not finished</span>}
      />
      <p className="text-caption text-muted">{nextDueText(p.now, p.intervalMonths, p.result)}</p>
      {p.result === "FAIL" ? <FailureAction draft={p.draft} edit={p.edit} canRefer={p.canRefer} /> : null}
    </section>
  );
}

function FailureAction({ draft, edit, canRefer }: { draft: TtDraft; edit: Edit; canRefer: boolean }) {
  const actions = (Object.keys(FAILURE_ACTION_LABELS) as FailureAction[]).filter((a) => canRefer || a !== "REFERRED_TO_ELECTRICIAN");
  const spec: ActionMenuSpec = {
    items: actions.map((a) => ({ key: a, label: FAILURE_ACTION_LABELS[a], group: "edit" as const, onSelect: () => edit((d) => ({ ...d, failureAction: a })) })),
  };
  return (
    <div className="flex flex-col gap-2 border-l-[3px] border-l-t-out pl-3">
      <WordMenu label={`Failure action: ${FAILURE_ACTION_LABELS[draft.failureAction]}`} spec={spec} />
      <Textarea
        aria-label="Failure notes"
        value={draft.failureNotes}
        onChange={(e) => {
          const failureNotes = e.target.value;
          edit((d) => ({ ...d, failureNotes }));
        }}
        placeholder="What failed, and what was done"
        rows={2}
        className="text-reading-body md:text-ui-text"
      />
      <p className="text-caption text-muted">Saving flags the item: it shows as failed until it passes a test.</p>
    </div>
  );
}
