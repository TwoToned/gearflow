"use client";

import type { ReactNode } from "react";
import { useFormatters } from "@/components/providers/format-provider";
import { cn } from "@/lib/utils";
import { PROJECT_TYPE_LABELS } from "@/lib/project-type-labels";
import { rentalDatesLabel } from "@/lib/job-header";
import type { ProjectFormValues } from "@/lib/validations/project";
import { AvailabilityLine } from "./availability-line";
import type { WizardLines } from "./step-what";

/** The statuses a new job can START as. Confirmed and later stay on the Overview stepper (its gates). */
export type StartStatus = "ENQUIRY" | "QUOTING";
const STARTS: { value: StartStatus; label: string }[] = [
  { value: "ENQUIRY", label: "Enquiry" },
  { value: "QUOTING", label: "Quoting" },
];

/**
 * Wizard step 3, Review: read-out sections, each with an `Edit` word, then `Starts
 * as`. Money is read, never computed here: hire is the sum of the lines' server-
 * derived totals and the discount is the server's `discountAmount` (no cents).
 */
export function StepReview({
  values, clientName, locationName, managerCount, number, data, discountAmount, others, startsAs, onStartsAs, onEdit,
}: {
  values: ProjectFormValues;
  clientName?: string;
  locationName?: string;
  managerCount: number;
  number?: string;
  data: WizardLines;
  discountAmount: number;
  others: { total: number; jobs: { number: string; id: string; status: string; start: number; end: number; hard: boolean }[] } | null;
  startsAs: StartStatus;
  onStartsAs: (s: StartStatus) => void;
  onEdit: (step: "who" | "what") => void;
}) {
  const rental = rentalDatesLabel(values.rentalStartDate as string | undefined, values.rentalEndDate as string | undefined);
  const hasDates = !!values.rentalStartDate;
  const short = data.lines.filter((l) => (data.overbooked[l.id]?.overBy ?? 0) > 0).length;
  return (
    <div className="space-y-6">
      <Section title="Job" onEdit={() => onEdit("who")}>
        <Row label="Name" value={values.name} />
        <Row label="Code" value={number ?? values.projectNumber} mono />
        <Row label="Client" value={clientName} />
        <Row label="Type" value={values.type ? PROJECT_TYPE_LABELS[values.type] : undefined} />
        <Row label="Managers" value={managerCount ? `${managerCount} assigned` : undefined} />
        <Row label="Tags" value={values.tags?.length ? values.tags.join(", ") : undefined} />
      </Section>
      <Section title="When" onEdit={() => onEdit("who")}>
        <Row label="Rental" value={rental || undefined} />
        <Row label="Job window" value={windowText(values)} />
        <AvailabilityLine hasDates={hasDates} others={others} shortLines={short} lineCount={data.lines.length} />
      </Section>
      <Section title="Where" onEdit={() => onEdit("who")}>
        <Row label="Location" value={locationName} />
        <Row label="Site contact" value={values.siteContactName} />
      </Section>
      <Section title={`What ${data.lines.length}`} onEdit={() => onEdit("what")}>
        <WhatBody data={data} discountAmount={discountAmount} />
      </Section>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-table-cell" role="group" aria-label="Starts as">
        <span className="text-muted">Starts as</span>
        {STARTS.map((s) => (
          <button
            key={s.value}
            type="button"
            aria-pressed={startsAs === s.value}
            onClick={() => onStartsAs(s.value)}
            className={cn("min-h-11 border-b-2 px-1 md:min-h-8", startsAs === s.value ? "border-red font-semibold text-ink" : "border-transparent text-ink-2 hover:text-ink")}
          >
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function WhatBody({ data, discountAmount }: { data: WizardLines; discountAmount: number }) {
  const { formatCurrency } = useFormatters();
  const money = (n: number) => formatCurrency(n, { cents: false });
  return (
    <>
      {data.lines.length === 0 ? (
        <p className="text-ui-text text-muted">No gear yet. You can add it from the job after it is created.</p>
      ) : (
        <>
          <ul className="text-ui-text text-ink">
            {data.lines.slice(0, 8).map((l) => (
              <li key={l.id} className="truncate">{l.quantity} × {l.description}</li>
            ))}
            {data.lines.length > 8 && <li className="text-muted">+{data.lines.length - 8} more</li>}
          </ul>
          <p className="mt-2 font-mono text-table-cell text-ink-2">
            Hire {money(data.total)} · Discount {money(discountAmount)} · Total ex GST {money(data.total - discountAmount)}
          </p>
        </>
      )}
      <p className="t-micro text-muted">Gear is pencilled, not held, until the job is Confirmed.</p>
    </>
  );
}

const windowText = (v: ProjectFormValues) =>
  v.projectStartDate || v.projectEndDate ? `${v.projectStartDate ?? "…"} – ${v.projectEndDate ?? "…"}` : "Same as rental";

function Section({ title, onEdit, children }: { title: string; onEdit: () => void; children: ReactNode }) {
  return (
    <section className="space-y-2 border-b border-line pb-4">
      <div className="flex items-baseline justify-between">
        <h3 className="t-overline text-muted">{title}</h3>
        <button type="button" onClick={onEdit} className="min-h-11 px-1 text-table-cell text-ink-2 underline-offset-4 hover:underline md:min-h-0">Edit</button>
      </div>
      {children}
    </section>
  );
}

function Row({ label, value, mono }: { label: string; value?: string | null; mono?: boolean }) {
  return (
    <div className="flex gap-3 text-ui-text">
      <span className="w-28 shrink-0 text-muted">{label}</span>
      <span className={cn("min-w-0 flex-1", value ? "text-ink" : "text-muted", mono && "font-mono text-caption")}>{value || "Not set"}</span>
    </div>
  );
}
