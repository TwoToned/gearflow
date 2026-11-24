"use client";

import { Controller } from "react-hook-form";
import { AlertTriangle, Plus, Send, UserCheck } from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { ComboboxPicker } from "@/components/ui/combobox-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LockedField } from "@/components/ui/locked-field";
import { Textarea } from "@/components/ui/textarea";
import { XeroAccountCodeField, XeroTaxTypeField } from "@/components/settings/xero-coding-fields";
import { useXeroLinked } from "@/hooks/use-xero-linked";
import { useIsManagerPlus } from "@/lib/use-permissions";
import { formatCurrency } from "@/lib/formatters";
import { scrollToLockStrip } from "@/lib/lock-copy";
import { crewRateTypeLabels } from "@/lib/status-labels";
import { CrewRateTable } from "../../service-dialogs";
import { SectionHead } from "./when-where-sections";
import type { ServiceSheetState } from "./use-service-sheet";

export function CrewSection(props: {
  s: ServiceSheetState;
  onPick: () => void;
  onRemove: (crewMemberId: string) => void;
  onBulk: (status: "OFFERED" | "CONFIRMED") => void;
  hasPending: boolean;
  hasAccepted: boolean;
}) {
  const { s, onPick, onRemove, onBulk, hasPending, hasAccepted } = props;
  const { form } = s;
  const needed = Number(form.watch("crewCountRequired") || 0);
  const roleOptions = (s.roleDocs ?? [])
    .filter((r) => r.isActive === true)
    .map((r) => ({ value: r.id, label: r.name }));
  // The per-day rule (`crewGap`): the worst day's count, never `Needed − rows`.
  const short = s.crewGap?.shortfall ?? 0;
  const filled = s.crewGap ? s.crewGap.filled : s.rows.length;
  return (
    <section className="space-y-3" aria-label="Crew">
      <SectionHead title="Crew" hint={`${filled} of ${needed || 0}`} />
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Role</Label>
          <ComboboxPicker
            value={(form.watch("crewRoleId") as string) || ""}
            onChange={(v) => form.setValue("crewRoleId", v)}
            options={roleOptions}
            placeholder="No role"
            allowClear
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="service-needed">Needed</Label>
          <Input id="service-needed" type="number" min={0} placeholder="0" {...form.register("crewCountRequired")} />
        </div>
      </div>
      {s.rows.length > 0 && (
        <CrewRateTable
          rows={s.rows}
          crewMemberById={s.members.byId}
          previewCost={s.math.previewCost}
          onChangeRow={s.editRow}
          onRemoveRow={onRemove}
          total={s.math.costTotal}
        />
      )}
      {!s.members.hasDates ? (
        <p className="text-caption text-muted">Set service dates to check availability</p>
      ) : (
        s.clashes > 0 && (
          <p className="flex items-center gap-1.5 text-caption font-medium text-warn">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            {s.clashes} of {s.rows.length} assigned have clashes
          </p>
        )
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="line" size="sm" className="touch-target" onClick={onPick}>
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          {short > 0 ? `Pick crew · ${short} needed` : "Pick crew"}
        </Button>
        {hasPending && (
          <Button type="button" variant="line" size="sm" disabled={s.crewStatus.isPending} onClick={() => onBulk("OFFERED")}>
            <Send className="mr-1.5 h-3.5 w-3.5" />
            Send offers
          </Button>
        )}
        {hasAccepted && (
          <Button type="button" variant="line" size="sm" disabled={s.crewStatus.isPending} onClick={() => onBulk("CONFIRMED")}>
            <UserCheck className="mr-1.5 h-3.5 w-3.5" />
            Confirm all accepted
          </Button>
        )}
      </div>
      <p className="text-caption text-muted">
        Picking, removing, sending offers and confirming act straight away. Rate changes here save with the service.
      </p>
    </section>
  );
}

function Locked({ s, children }: { s: ServiceSheetState; children: React.ReactNode }) {
  return (
    <LockedField locked={s.locked} reason={s.lockReason} exitLabel="Unlock financials" onExit={scrollToLockStrip}>
      {children}
    </LockedField>
  );
}

function ChargeFields({ s }: { s: ServiceSheetState }) {
  const { form } = s;
  const auto = s.math.crewChargeTotal;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="service-charge">Charge to client</Label>
          <Locked s={s}>
            <Input
              id="service-charge"
              type="number"
              step="0.01"
              {...form.register("unitPrice")}
              placeholder={auto > 0 ? `auto ${formatCurrency(auto)}` : "0 · internal"}
            />
          </Locked>
          {!s.locked && !form.watch("unitPrice") && auto > 0 && (
            <p className="text-caption text-muted">
              Auto from crew: {formatCurrency(auto)}.{" "}
              <button type="button" className="text-link hover:underline" onClick={() => form.setValue("unitPrice", Number(auto.toFixed(2)))}>
                use {formatCurrency(auto)}
              </button>
            </p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="service-discount">Discount</Label>
          <Locked s={s}>
            <Input id="service-discount" type="number" step="0.01" placeholder="0.00" {...form.register("discount")} />
          </Locked>
        </div>
      </div>
      {s.rows.length > 0 && (
        <div className="space-y-1.5">
          <Label htmlFor="service-charge-rate">
            Charge rate override{s.role?.rateType ? ` / ${crewRateTypeLabels[s.role.rateType].toLowerCase()}` : ""}
          </Label>
          <Input id="service-charge-rate" type="number" step="0.01" placeholder="0.00" {...form.register("chargeRateOverride")} />
          <p className="text-caption text-muted">
            Overrides the role&apos;s charge rate for this service&apos;s crew. Blank uses the role default
            {s.role?.chargeRate ? ` ($${s.role.chargeRate})` : " (none set, so no auto-pricing)"}.
          </p>
        </div>
      )}
    </div>
  );
}

function CostMargin({ s }: { s: ServiceSheetState }) {
  const { form } = s;
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="space-y-1.5">
        <Label htmlFor="service-cost">Cost</Label>
        {s.rows.length > 0 ? (
          <div className="flex h-9 items-center text-ui-text font-medium tabular-nums text-ink">
            {formatCurrency(s.math.costTotal)} <span className="ml-1.5 text-caption font-normal text-muted">from crew rates</span>
          </div>
        ) : (
          <Locked s={s}>
            <Input id="service-cost" type="number" step="0.01" placeholder="what it costs us" {...form.register("costTotal")} />
          </Locked>
        )}
      </div>
      <div className="space-y-1.5">
        <Label>Margin</Label>
        <div className={"flex h-9 items-center text-ui-text font-medium tabular-nums " + (s.margin && s.margin.amount < 0 ? "text-t-out" : "text-ink")}>
          {s.margin ? `${formatCurrency(s.margin.amount)} · ${s.margin.percent}%` : "—"}
        </div>
      </div>
    </div>
  );
}

function XeroCoding({ s }: { s: ServiceSheetState }) {
  const linked = useXeroLinked();
  if (!linked) return null;
  return (
    <Accordion type="single" collapsible className="rounded-[var(--r)] border border-line">
      <AccordionItem value="xero-coding" className="border-none px-3">
        <AccordionTrigger>Advanced: Xero coding</AccordionTrigger>
        <AccordionContent>
          <div className="grid grid-cols-2 gap-3 pt-1">
            <Controller control={s.form.control} name="xeroAccountCode" render={({ field }) => (
              <XeroAccountCodeField value={field.value} onChange={field.onChange} label="Account" placeholder="Inherit default" />
            )} />
            <Controller control={s.form.control} name="xeroTaxType" render={({ field }) => (
              <XeroTaxTypeField value={field.value} onChange={field.onChange} label="Tax type" placeholder="Use org default" />
            )} />
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}

export function MoneySection({ s }: { s: ServiceSheetState }) {
  const manager = useIsManagerPlus();
  const client = s.form.watch("type") === "CLIENT_PICKUP" || s.form.watch("type") === "CLIENT_DROPOFF";
  return (
    <section className="space-y-3" aria-label="Money">
      <SectionHead title="Money" hint={s.locked ? "Pricing locked" : undefined} />
      <ChargeFields s={s} />
      {manager && <CostMargin s={s} />}
      <p className="text-caption text-muted">
        {s.charge > 0
          ? "Has a charge · prints on the quote and invoice."
          : client
            ? "No charge · the client is doing the transport; add a handling fee here if you charge one."
            : "No charge · stays internal, never prints."}
      </p>
      <XeroCoding s={s} />
    </section>
  );
}

export function NotesSection({ s }: { s: ServiceSheetState }) {
  return (
    <section className="space-y-3" aria-label="Notes">
      <SectionHead title="Notes" />
      <div className="space-y-1.5">
        <Label htmlFor="service-notes">Internal notes</Label>
        <Textarea id="service-notes" rows={2} placeholder="Internal · prints on the call sheet, never for the client" {...s.form.register("notes")} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="service-description">Description</Label>
        <Textarea id="service-description" rows={2} placeholder="Details…" {...s.form.register("description")} />
      </div>
    </section>
  );
}
