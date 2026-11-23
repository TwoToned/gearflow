"use client";

import { useEffect, useRef, useState } from "react";
import { useConvex } from "convex/react";
import type { FunctionReturnType } from "convex/server";

import { api } from "../../../convex/_generated/api";
import { useTestTagWrites } from "@/hooks/use-test-tag-writes";
import { useSession } from "@/lib/auth-client";
import { announceListWrite } from "@/lib/list-write-toast";
import type { LastScan } from "@/lib/scan-page";
import type { ScanFeedbackKind } from "@/lib/scan-feedback";
import { showError } from "@/lib/show-error";
import {
  emptyTtDraft,
  passAllVisual,
  prefillFromRecord,
  revertPassAllVisual,
  ttBlocker,
  ttDraftDirty,
  ttFailureReason,
  ttPayload,
  ttResult,
  type TtDraft,
  type TtProfile,
} from "@/lib/tt-draft";

export type TestCardData = FunctionReturnType<typeof api.scanLookup.testCard>;
type TtItem = NonNullable<TestCardData["tt"]>;

export interface PrintLabel {
  testTagId: string;
  result: "PASS" | "FAIL";
  testDate: number;
  nextDueDate: number;
  testerName: string;
}

interface TtModeDeps {
  orgId: string | undefined;
  card: TestCardData | undefined;
  tag: string | null;
  play: (kind: ScanFeedbackKind) => void;
  addLastScan: (entry: LastScan) => void;
  markUndone: (id: string) => void;
  finishScan: () => void;
  reload: (tag: string) => void;
}

/** The register item the card can test: an active item with a profile-less or profiled test. */
export function testableItem(card: TestCardData | undefined): TtItem | null {
  if (!card?.tt || (card.kind !== "asset" && card.kind !== "ttOnly")) return null;
  return card.tt.isActive && card.tt.status !== "RETIRED" ? card.tt : null;
}

/** Tested by — sticks for the session (spec §9i.2); defaults to the signed-in user. */
function useTester() {
  const { data: session } = useSession();
  const [chosen, setChosen] = useState<{ id: string; name: string } | null>(null);
  const self = session?.user ? { id: session.user.id, name: session.user.name ?? "" } : null;
  return { tester: chosen ?? self, setTester: setChosen };
}

/**
 * Test & tag mode's form and save (spec §9i.2, §9i.4). Like Check mode: the answers
 * are keyed to the loaded item, `Save` AWAITS `recordTest` before clearing (F1), and
 * the save's ONE undo closure goes to the toast and the Last scans row.
 */
type Tester = { id: string; name: string };

function blockerFor(item: TtItem | null, tester: Tester | null, draft: TtDraft, profile: TtProfile | null): string | null {
  if (!item) return "Nothing to test";
  return tester ? ttBlocker(draft, profile) : "Choose who tested it";
}

/** The draft for this item: the stored one when it belongs to it, else a fresh one. */
function draftFor(draft: TtDraft, item: TtItem | null, profile: TtProfile | null): TtDraft {
  const id = item?.id ?? null;
  return draft.forTtId === id ? draft : emptyTtDraft(id, profile, item?.outletCount ?? null);
}

function recordArgs(item: TtItem, profile: TtProfile | null, tester: Tester, testDate: number, draft: TtDraft) {
  return {
    testTagAssetId: item.id, testProfileId: profile?.id, testDate: new Date(testDate), testedById: tester.id, testerName: tester.name,
    equipmentClassTested: (item.equipmentClass ?? undefined) as "CLASS_I" | undefined,
    ...ttPayload(draft, profile),
  } as Parameters<ReturnType<typeof useTestTagWrites>["recordTest"]>[0];
}

export function useTtMode(d: TtModeDeps) {
  const item = testableItem(d.card);
  const profile = (d.card?.profile ?? null) as TtProfile | null;
  const writes = useTestTagWrites();
  const convex = useConvex();
  const { tester, setTester } = useTester();
  const [draft, setDraft] = useState<TtDraft>(() => emptyTtDraft(null, null, null));
  const [saving, setSaving] = useState(false);
  const [label, setLabel] = useState<PrintLabel | null>(null);
  const current = draftFor(draft, item, profile);
  const tagRef = useRef(d.tag);
  useEffect(() => {
    tagRef.current = d.tag;
  });
  // Print once the label for the saved record is mounted (fixes F7: it printed the page).
  useEffect(() => {
    if (!label) return;
    window.print();
    setLabel(null);
  }, [label]);

  const edit = (fn: (prev: TtDraft) => TtDraft) => setDraft(() => fn(current));

  /**
   * Pass all ticks every visual check, with its own exact Undo (review SF5): it puts
   * back only the keys it ticked, only while they still read ticked and the draft is
   * still this item's. Later ticks, fails, readings and notes survive.
   */
  const passAllVisualChecks = () => {
    if (!item) return;
    const forId = item.id;
    const { draft: next, changed } = passAllVisual(current, profile);
    setDraft(next);
    announceListWrite({
      title: "Every visual check ticked",
      undoneTitle: "Visual ticks restored",
      performUndo: async () => setDraft((prev) => (prev.forTtId === forId ? revertPassAllVisual(prev, changed) : prev)),
    });
  };
  const blocker = blockerFor(item, tester, current, profile);
  const result = item ? ttResult(current, profile) : null;

  /** The ONE undo closure for this save, handed to the toast and the Last scans row. */
  const announce = (it: TtItem, res: { id: string; result: "PASS" | "FAIL" }, snapshot: TtDraft, tag: string) =>
    announceListWrite({
      title: `${res.result === "PASS" ? "Pass" : "Fail"} saved for ${it.testTagId}`,
      undoneTitle: `Test on ${it.testTagId} undone`,
      performUndo: async () => {
        await writes.undoRecordTest(res.id);
        d.markUndone(res.id);
        if (tagRef.current) return;
        setDraft(snapshot);
        d.reload(tag);
      },
    });

  /** The tone, and the Last scans row carrying the save's undo. */
  const logSaved = (it: TtItem, res: { id: string; result: "PASS" | "FAIL" }, tag: string, undo: (() => Promise<void>) | undefined, reason: string) => {
    const passed = res.result === "PASS";
    d.play(passed ? "success" : "error");
    d.addLastScan({ id: res.id, mode: "tt", tag, name: it.description, verdict: passed ? "clean" : "failed", at: Date.now(), assetId: it.assetId, undo, reason });
  };

  /** Resolves `true` once saved (the caret's follow-ups wait for it), `false` otherwise. */
  const save = async ({ keepOpen, print }: { keepOpen: boolean; print?: boolean }): Promise<boolean> => {
    if (!item || !tester || blocker || saving) return false;
    const snapshot = current;
    const testDate = Date.now();
    const tag = d.tag ?? item.testTagId;
    setSaving(true);
    try {
      const res = await writes.recordTest(recordArgs(item, profile, tester, testDate, snapshot));
      logSaved(item, res, tag, announce(item, res, snapshot, tag), ttFailureReason(snapshot, profile));
      if (print) setLabel({ testTagId: item.testTagId, result: res.result, testDate, nextDueDate: res.nextDueDate, testerName: tester.name });
      // Clear only what is still this item's; a scan that landed mid-save keeps its item (SF3).
      setDraft((prev) => (prev.forTtId === item.id ? emptyTtDraft(null, null, null) : prev));
      if (!keepOpen && tagRef.current === d.tag) d.finishScan();
      return true;
    } catch (e) {
      d.play("error");
      showError(e, { fallbackTitle: "Couldn't save the test" });
      return false;
    } finally {
      setSaving(false);
    }
  };

  /** Quick pass: the last record's answers, for review — never a blind PASS (F4). */
  const quickPass = async () => {
    if (!item || !d.orgId) return;
    try {
      const latest = await convex.query(api.testTagRecords.latestForAsset, { orgId: d.orgId, testTagAssetId: item.id });
      if (!latest) return showError(new Error("No previous test: complete the full test"), { fallbackTitle: "No previous test" });
      setDraft(prefillFromRecord(current, latest as Record<string, unknown>, profile));
    } catch (e) {
      showError(e, { fallbackTitle: "Couldn't load the last test" });
    }
  };

  return {
    item, profile, draft: current, edit, passAllVisual: passAllVisualChecks, tester, setTester, blocker, result, saving, save, quickPass, label,
    /** What failed, in words — a maintenance job's prefill. */
    failureReason: ttFailureReason(current, profile),
    // A save in flight carries the answers: they are not "unsaved" any more (SF3).
    dirty: !!item && !saving && ttDraftDirty(current),
    discard: () => setDraft(emptyTtDraft(null, null, null)),
  };
}
