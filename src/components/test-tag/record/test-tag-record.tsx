"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";

import { ActivityTimeline } from "@/components/activity/activity-timeline";
import { Facts, HealthRows, Headline, RecordRows, RecordShell, type HealthItem, type RecordRow, type RecordTab } from "@/components/people/record-shell";
import { TestTagSheetHost } from "@/components/test-tag/test-tag-sheet-host";
import { Button } from "@/components/ui/button";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { useOrganization } from "@/hooks/use-organization";
import { useStableNow } from "@/hooks/use-stable-now";
import { useTestTagWrites } from "@/hooks/use-test-tag-writes";
import { formatDate } from "@/lib/formatters";
import { announceListWrite } from "@/lib/list-write-toast";
import type { OrgSettings } from "@/lib/org-settings-types";
import { buildTestTagRecordActions } from "@/lib/row-actions/test-tag";
import { showError } from "@/lib/show-error";
import { applianceTypeLabels, equipmentClassLabels, testTagResultLabels } from "@/lib/status-labels";
import { testReadingWords, testTagChecks, testTagStateWord, type TestTagChecks, type TestTagWord } from "@/lib/test-tag-record-facts";
import { testTagSheetInitialOf } from "@/lib/test-tag-sheet";
import { useCanDo } from "@/lib/use-permissions";
import { api } from "../../../../convex/_generated/api";

/** The item as `testTagAssets.detail` returns it (dates are ISO strings there). */
interface ItemDetail {
  id: string;
  testTagId: string;
  description: string;
  equipmentClass?: string | null;
  applianceType?: string | null;
  make?: string | null;
  modelName?: string | null;
  serialNumber?: string | null;
  location?: string | null;
  testIntervalMonths?: number | null;
  testProfileId?: string | null;
  outletCount?: number | null;
  notes?: string | null;
  assetId?: string | null;
  bulkAssetId?: string | null;
  status?: string | null;
  isActive?: boolean | null;
  lastTestDate?: string | null;
  nextDueDate?: string | null;
  asset: { id: string; assetTag: string } | null;
  bulkAsset: { id: string; assetTag: string } | null;
  testProfile: { id: string; name: string } | null;
  testRecords: { result?: string | null }[];
  _count: { testRecords: number };
}

interface TestRow {
  id: string;
  testDate: number;
  result?: string | null;
  testerName?: string | null;
  testedBy?: { name: string | null } | null;
  failureNotes?: string | null;
  subTestRecords?: unknown[];
  [k: string]: unknown;
}

const PAGE = 10;
const ms = (iso: string | null | undefined): number | null => (iso ? Date.parse(iso) : null);
const dateOf = (iso: string | null | undefined): string | null => (iso ? formatDate(iso) : null);

function factsOf(item: ItemDetail) {
  return {
    status: item.status, isActive: item.isActive, nextDueDate: ms(item.nextDueDate), lastTestDate: ms(item.lastTestDate),
    testProfileId: item.testProfileId, lastResult: item.testRecords[0]?.result ?? null,
  };
}

/** A failed item has no next due date until it is repaired and retested (D52): say so rather than print a blank. */
function nextDueText(item: ItemDetail, word: TestTagWord): string | null {
  if (word.state === "FAILED" && item.nextDueDate == null) return "After repair";
  return dateOf(item.nextDueDate);
}

/** One test as a row: date, tester, result word, its readings and any failure note. */
function testRowOf(r: TestRow): RecordRow {
  const readings = testReadingWords(r);
  const subs = r.subTestRecords?.length ? `${r.subTestRecords.length} outlets` : null;
  return {
    id: r.id,
    title: formatDate(new Date(r.testDate)),
    meta: [r.testedBy?.name ?? r.testerName, ...readings, subs, r.failureNotes].filter(Boolean),
    status: r.result ? { label: testTagResultLabels[r.result] ?? r.result, intent: r.result === "PASS" ? "success" : r.result === "FAIL" ? "error" : "neutral" } : undefined,
  };
}

function Overview({ item, word, checks, health }: { item: ItemDetail; word: TestTagWord; checks: TestTagChecks; health: HealthItem[] }) {
  const last = item.testRecords[0];
  const sub = last ? `Last test: ${testTagResultLabels[last.result ?? ""] ?? last.result ?? "recorded"} · ${dateOf(item.lastTestDate) ?? ""}` : "Never tested";
  const link = item.asset ? <Link className="hover:underline" href={`/assets/registry/${item.asset.id}`}>{item.asset.assetTag}</Link> : item.bulkAsset ? <Link className="hover:underline" href={`/assets/registry/${item.bulkAsset.id}?type=bulk`}>{item.bulkAsset.assetTag}</Link> : null;
  return (
    <div className="flex flex-col gap-8">
      <Headline sub={sub}>{word.label}</Headline>
      {checks.closed ? (
        <p className="text-table-cell text-muted">Retired. Reactivate it to test it again.</p>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-caption text-muted">{checks.clear} of {checks.total} checks clear</p>
          <HealthRows items={health} allClear="Nothing needs a look." />
        </div>
      )}
      <div className="grid gap-8 md:grid-cols-3">
        <Facts title="Dates" facts={[{ label: "Last test", value: dateOf(item.lastTestDate) }, { label: "Next due", value: nextDueText(item, word) }, { label: "Interval", value: item.testIntervalMonths ? `${item.testIntervalMonths} months` : null }]} />
        <Facts title="Item" facts={[{ label: "Class", value: equipmentClassLabels[item.equipmentClass ?? ""] ?? item.equipmentClass }, { label: "Type", value: applianceTypeLabels[item.applianceType ?? ""] ?? item.applianceType }, { label: "Make", value: [item.make, item.modelName].filter(Boolean).join(" ") }, { label: "Serial", value: item.serialNumber }, { label: "Outlets", value: item.outletCount }]} />
        <Facts title="Place" facts={[{ label: "Location", value: item.location }, { label: "Linked to", value: link }, { label: "Profile", value: item.testProfile?.name }]} />
      </div>
      {item.notes ? <p className="max-w-prose whitespace-pre-wrap text-table-cell text-ink-2">{item.notes}</p> : null}
    </div>
  );
}

/** The Tests tab: newest first, ten at a time (`Show 25 more · n left`). */
function TestsTab({ orgId, id, total }: { orgId: string | undefined; id: string; total: number }) {
  const [limit, setLimit] = React.useState(PAGE);
  const page = useAuthedQuery(api.testTagRecords.recordsPage, orgId ? { orgId, testTagAssetId: id, page: 1, pageSize: limit } : "skip") as { records: TestRow[] } | undefined;
  if (!page) return <p className="py-6 text-table-cell text-muted">Loading tests…</p>;
  const left = Math.max(0, total - page.records.length);
  return (
    <div>
      <RecordRows noun="test" empty="No tests have been recorded yet." rows={page.records.map(testRowOf)} />
      {left > 0 ? <Button variant="ghost" size="sm" className="mt-1 text-muted" onClick={() => setLimit((l) => l + 25)}>Show {Math.min(25, left)} more · {left} left</Button> : null}
    </div>
  );
}

/** Retire (with its exact Undo), Reactivate (with its) and Delete, each toasted. */
function useRecordCommands(item: ItemDetail | null | undefined, onDeleted: () => void) {
  const writes = useTestTagWrites();
  const run = async (fn: () => Promise<void>, fallback: string) => {
    try { await fn(); } catch (e) { showError(e, { fallbackTitle: fallback }); }
  };
  return {
    retire: () => run(async () => {
      await writes.retire(item!.id);
      announceListWrite({ title: `Retired ${item!.testTagId}`, undoneTitle: `Reactivated ${item!.testTagId}`, performUndo: async () => void (await writes.undoRetire(item!.id)) });
    }, "Could not retire the item"),
    reactivate: () => run(async () => {
      await writes.reactivate(item!.id);
      announceListWrite({ title: `Reactivated ${item!.testTagId}`, undoneTitle: `Retired ${item!.testTagId} again`, performUndo: async () => void (await writes.undoReactivate(item!.id)) });
    }, "Could not reactivate the item"),
    remove: () => run(async () => {
      await writes.remove(item!.id);
      toast.success(`Deleted ${item!.testTagId}`);
      onDeleted();
    }, "Could not delete the item"),
  };
}

/**
 * The Test & tag record (UX Phase 14, 14b-4, §9n): header word (`18d overdue`, `Due in 5d`, `Passed`, `Failed`), Overview
 * (`n of m checks clear`, three fact columns), Tests (readings, newest first) and History, with `Record test` the one
 * primary and Edit the real sheet (D80). Retire and Reactivate each carry an exact Undo; Delete is offered only after
 * Retire. Next due is derived (last test + interval), never typed.
 */
export function TestTagRecord({ id, orgId }: { id: string; orgId: string | undefined }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const now = useStableNow();
  const canUpdate = useCanDo("testTag", "update");
  const canDelete = useCanDo("testTag", "delete");
  const item = useAuthedQuery(api.testTagAssets.detail, orgId ? { orgId, id } : "skip") as ItemDetail | null | undefined;
  const { data: org } = useOrganization(orgId);
  const dueSoonDays = (org as { settings?: OrgSettings } | null | undefined)?.settings?.testTag?.dueSoonThresholdDays || undefined;
  const cmd = useRecordCommands(item, () => router.push("/test-and-tag"));

  if (!item) return null; // the page owns loading and not-found
  const facts = factsOf(item);
  const word = testTagStateWord(facts, now, dueSoonDays);
  const checks = testTagChecks(facts, now, dueSoonDays);
  const retired = word.state === "RETIRED";
  const edit = () => {
    const q = new URLSearchParams(params.toString());
    q.set("edit", "1");
    router.push(`${pathname}?${q.toString()}`);
  };
  const recordTest = () => router.push(`/test-and-tag/quick-test?id=${encodeURIComponent(item.testTagId)}`);
  const goEdit = canUpdate && !retired ? edit : undefined;
  const fix = (f: "test" | "edit" | undefined): HealthItem["action"] => (f === "test" && canUpdate ? { label: "Record test", onSelect: recordTest } : f === "edit" && goEdit ? { label: "Edit", onSelect: goEdit } : undefined);
  const health: HealthItem[] = checks.items.filter((c) => c.tone !== "ok").map((c) => ({ key: c.key, tone: c.tone === "bad" ? "error" : c.tone === "warn" ? "warning" : "neutral", text: c.text, action: fix(c.fix) }));

  const tabs: RecordTab[] = [
    { value: "overview", label: "Overview", panel: <Overview item={item} word={word} checks={checks} health={health} /> },
    { value: "tests", label: "Tests", count: item._count.testRecords, panel: <TestsTab orgId={orgId} id={id} total={item._count.testRecords} /> },
    { value: "history", label: "History", panel: <ActivityTimeline entityType="testTagAsset" entityId={id} limit={25} /> },
  ];
  const meta = [item.testTagId, equipmentClassLabels[item.equipmentClass ?? ""], applianceTypeLabels[item.applianceType ?? ""], item.asset?.assetTag].filter(Boolean);

  return (
    <>
      <RecordShell
        crumb={{ label: "Test & tag", href: "/test-and-tag" }}
        title={item.description}
        status={{ label: word.label, intent: word.intent, outline: word.outline }}
        meta={meta}
        onEdit={goEdit}
        primary={canUpdate && !retired ? { label: "Record test", onSelect: recordTest } : undefined}
        menu={buildTestTagRecordActions({
          testTagId: item.testTagId,
          retired,
          onRetire: canUpdate ? () => void cmd.retire() : undefined,
          onReactivate: canUpdate ? () => void cmd.reactivate() : undefined,
          onDelete: canDelete ? () => void cmd.remove() : undefined,
        })}
        tabs={tabs}
        rail={<Facts title="At a glance" facts={[{ label: "Status", value: word.label }, { label: "Last test", value: dateOf(item.lastTestDate) }, { label: "Next due", value: nextDueText(item, word) }, { label: "Tests", value: item._count.testRecords }]} />}
      />
      <TestTagSheetHost item={testTagSheetInitialOf(item)} retired={retired} />
    </>
  );
}
