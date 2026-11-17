"use client";

/**
 * The facts above the timeline (spec §8): Rental · charged, Load in, Load out,
 * Venue (with the access note), Site contact. Each is a word-button that opens
 * its editor in place. A two-column grid on a phone, never a horizontal scroll
 * (playbook §10); five across on a desktop.
 */
import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";

import { CanDo } from "@/components/auth/permission-gate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { useProjectWrites } from "@/hooks/use-native-project-writes";
import { dayShortLabel } from "@/lib/logistics-model";
import { cn } from "@/lib/utils";
import { refreshLogistics } from "./use-logistics-writes";
import type { ScheduleSnapshot } from "./dates-sheet";

export interface SiteFacts {
  venue: string;
  address: string;
  access: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
}

function Fact({
  label, value, sub, onClick, href, mono,
}: { label: string; value: string; sub?: string; onClick?: () => void; href?: string; mono?: boolean }) {
  const body = (
    <>
      <span className="t-overline text-muted">{label}</span>
      <span className={cn("block truncate text-ui-text font-medium text-ink", mono && "t-mono")}>{value || "—"}</span>
      {sub && <span className="block truncate text-caption text-muted">{sub}</span>}
    </>
  );
  const cls = "min-h-11 min-w-0 rounded-[var(--r)] px-1 py-1 text-left outline-none hover:bg-elev focus-visible:ring-2 focus-visible:ring-red";
  if (href) return <Link href={href} className={cls}>{body}</Link>;
  return <button type="button" onClick={onClick} className={cls}>{body}</button>;
}

const range = (a: string, b: string) => (a && b && a !== b ? `${dayShortLabel(a)} – ${dayShortLabel(b)}` : dayShortLabel(a || b));
const withTime = (day: string, time: string) => [dayShortLabel(day), time].filter(Boolean).join(" · ");

export function LogisticsFacts({
  orgId, projectId, schedule, site, onEditDates, canEdit,
}: {
  orgId: string | undefined;
  projectId: string;
  /** Effective dates: the job window, falling back to rental. */
  schedule: ScheduleSnapshot;
  site: SiteFacts;
  onEditDates: () => void;
  canEdit: boolean;
}) {
  const [contactOpen, setContactOpen] = React.useState(false);
  const inDay = schedule.loadIn || schedule.rentalStart;
  const outDay = schedule.loadOut || schedule.rentalEnd;
  const editable = canEdit ? onEditDates : () => {};
  return (
    <section aria-label="Job facts" className="grid grid-cols-2 gap-x-3 gap-y-1 border-b border-line pb-3 md:grid-cols-5">
      <Fact label="Rental · charged" value={range(schedule.rentalStart, schedule.rentalEnd)} onClick={editable} mono />
      <Fact label="Load in" value={withTime(inDay, schedule.loadInTime)} sub={schedule.loadIn ? "job window starts" : "same as rental"} onClick={editable} mono />
      <Fact label="Load out" value={withTime(outDay, schedule.loadOutTime)} sub={schedule.loadOut ? "job window ends" : "same as rental"} onClick={editable} mono />
      <Fact label="Venue" value={site.venue} sub={site.access || site.address} href={`/projects/${projectId}/edit`} />
      <Fact
        label="Site contact"
        value={site.contactName}
        sub={site.contactPhone}
        onClick={canEdit ? () => setContactOpen(true) : () => {}}
      />
      <CanDo resource="project" action="update">
        <SiteContactSheet open={contactOpen} onOpenChange={setContactOpen} orgId={orgId} projectId={projectId} site={site} />
      </CanDo>
    </section>
  );
}

function SiteForm({
  orgId, projectId, site, onDone,
}: { orgId: string | undefined; projectId: string; site: SiteFacts; onDone: () => void }) {
  const writes = useProjectWrites(orgId);
  const [v, setV] = React.useState({ name: site.contactName, phone: site.contactPhone, email: site.contactEmail });
  const [saving, setSaving] = React.useState(false);
  const on = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => setV((s) => ({ ...s, [k]: e.target.value }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await writes.updateSchedule(projectId, { siteContactName: v.name, siteContactPhone: v.phone, siteContactEmail: v.email });
      refreshLogistics(projectId);
      toast.success("Site contact saved");
      onDone();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-4 p-1">
      <SheetHeader>
        <SheetTitle>Site contact</SheetTitle>
        <SheetDescription>Who the crew calls on the day. Printed at the top of the call sheet.</SheetDescription>
      </SheetHeader>
      <div className="space-y-1"><Label htmlFor="sc-name">Name</Label><Input id="sc-name" value={v.name} onChange={on("name")} maxLength={200} /></div>
      <div className="space-y-1"><Label htmlFor="sc-phone">Phone</Label><Input id="sc-phone" type="tel" value={v.phone} onChange={on("phone")} maxLength={50} /></div>
      <div className="space-y-1"><Label htmlFor="sc-email">Email</Label><Input id="sc-email" type="email" value={v.email} onChange={on("email")} maxLength={200} /></div>
      <SheetFooter>
        <Button type="button" variant="line" onClick={onDone}>Cancel</Button>
        <Button type="submit" disabled={saving}>Save</Button>
      </SheetFooter>
    </form>
  );
}

function SiteContactSheet({
  open, onOpenChange, orgId, projectId, site,
}: { open: boolean; onOpenChange: (o: boolean) => void; orgId: string | undefined; projectId: string; site: SiteFacts }) {
  const isMobile = useIsMobile();
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side={isMobile ? "bottom" : "right"} className="sm:max-w-md">
        <SiteForm orgId={orgId} projectId={projectId} site={site} onDone={() => onOpenChange(false)} />
      </SheetContent>
    </Sheet>
  );
}
