"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "../../../convex/_generated/api";
import { CHECK_CONDITION_VALUE, conditionWord, type CheckConditionValue, type StoredAssetCondition } from "../../../convex/lib/assetCondition";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { useCheckRecordWrites } from "@/hooks/use-check-record-writes";
import {
  checkBlocker,
  checkFailCount,
  checkFailureReason,
  checksPayload,
  checkStatesDirty,
  passAllStates,
  passAllTargets,
  revertPassAll,
  type CheckItemData,
  type CheckState,
  type CheckStates,
} from "@/lib/check-item-state";
import { announceListWrite } from "@/lib/list-write-toast";
import type { LastScan, ScanCardData } from "@/lib/scan-page";
import { showError } from "@/lib/show-error";
import type { ScanFeedbackKind } from "@/lib/scan-feedback";

const BLANK: CheckState = { result: null, value: "", notes: "", photos: [] };

/** One asset's unsaved check: answers, the chosen condition word (null = untouched), notes. */
interface CheckDraft {
  /** The asset the answers belong to; a draft for another asset reads as empty. */
  forAssetId: string | null;
  states: CheckStates;
  condition: CheckConditionValue | null;
  notes: string;
}

const EMPTY_DRAFT: CheckDraft = { forAssetId: null, states: {}, condition: null, notes: "" };

type ScanAsset = NonNullable<ScanCardData["asset"]>;

interface CheckModeDeps {
  orgId: string | undefined;
  card: ScanCardData | undefined;
  tag: string | null;
  play: (kind: ScanFeedbackKind) => void;
  addLastScan: (entry: LastScan) => void;
  markUndone: (id: string) => void;
  /** Drop the loaded tag after a save (no discard prompt: the answers are saved). */
  finishScan: () => void;
  /** Put a tag back (an Undo restoring its draft while nothing else is loaded). */
  reload: (tag: string) => void;
}

/**
 * Check mode's form and save (spec §9i.2, §9i.4). The answers live here, keyed to
 * the loaded asset; `Save` AWAITS the mutation and only then clears the card (the
 * card and its answers stay put while pending and after an error, fixing F1).
 */
export function useCheckMode(d: CheckModeDeps) {
  const asset = d.card?.kind === "asset" ? d.card.asset : null;
  const items = useCheckItemsFor(d.orgId, asset?.modelId ?? null);
  const draft = useCheckDraft(asset?.id ?? null);
  const failCount = checkFailCount(draft.current.states);
  const condition = conditionFor(failCount, draft.current.condition, asset);
  const blocker = blockerFor(items, draft.current.states, draft.photoUploading);
  const save = useCheckSave({ ...d, asset, items, draft, condition, failCount, blocker });

  return {
    items,
    states: draft.current.states,
    update: draft.update,
    onFailPhotoUploadingChange: draft.onFailPhotoUploadingChange,
    condition,
    conditionLocked: failCount > 0,
    setCondition: (c: CheckConditionValue) => draft.patch({ condition: c }),
    notes: draft.current.notes,
    setNotes: (n: string) => draft.patch({ notes: n }),
    failCount,
    /** The failed items in words — a maintenance job's prefill. */
    failureReason: checkFailureReason(items ?? [], draft.current.states),
    canPassAll: canPassAllFor(items, draft.current.states),
    passAll: () => draft.passAll(items),
    blocker,
    // A save in flight carries the answers: they are not "unsaved" any more (SF3).
    dirty: draft.dirty && !save.saving,
    saving: save.saving,
    save: save.save,
    /** Forget the answers (a confirmed discard). */
    discard: draft.reset,
  };
}

/** Any fail forces and locks Damaged (D50; the server forces it too); else the chosen word, else the stored one. */
function conditionFor(failCount: number, chosen: CheckConditionValue | null, asset: ScanAsset | null): CheckConditionValue {
  if (failCount > 0) return "DAMAGED";
  return chosen ?? preselectFor(asset);
}

/** The word the asset's stored condition reads as, as the value a check submits (Q5). */
function preselectFor(asset: ScanAsset | null): CheckConditionValue {
  return CHECK_CONDITION_VALUE[conditionWord(asset?.condition as StoredAssetCondition | null | undefined)];
}

function blockerFor(items: CheckItemData[] | undefined, states: CheckStates, photoUploading: boolean): string | null {
  return items ? checkBlocker(items, states, photoUploading) : "Loading check items";
}

function canPassAllFor(items: CheckItemData[] | undefined, states: CheckStates): boolean {
  return !!items?.some((i) => i.checkItem.type === "PASS_FAIL" && !states[i.checkItem.id]?.result);
}

/** The draft for one asset, and the edits a form makes to it. */
function useCheckDraft(assetId: string | null) {
  const [draft, setDraft] = useState<CheckDraft>(EMPTY_DRAFT);
  const [uploading, setUploading] = useState<Record<string, boolean>>({});
  const current = draft.forAssetId === assetId ? draft : { ...EMPTY_DRAFT, forAssetId: assetId };

  const update = useCallback(
    (checkItemId: string, updates: Partial<CheckState>) =>
      setDraft((prev) => {
        const base = prev.forAssetId === assetId ? prev : { ...EMPTY_DRAFT, forAssetId: assetId };
        return { ...base, states: { ...base.states, [checkItemId]: { ...BLANK, ...base.states[checkItemId], ...updates } } };
      }),
    [assetId],
  );
  const onFailPhotoUploadingChange = useCallback((id: string, isUploading: boolean) => {
    setUploading((prev) => ({ ...prev, [id]: isUploading }));
  }, []);

  /**
   * Pass all, with its own exact Undo (review SF5): it un-answers only the items Pass
   * all answered, only while they still read Pass and the draft is still this asset's.
   */
  const passAll = (items: CheckItemData[] | undefined) => {
    if (!items) return;
    const ids = passAllTargets(items, current.states);
    setDraft({ ...current, states: passAllStates(items, current.states) });
    announceListWrite({
      title: "All pass/fail items marked Pass",
      undoneTitle: "Pass all undone",
      performUndo: async () =>
        setDraft((prev) => (prev.forAssetId === assetId ? { ...prev, states: revertPassAll(prev.states, ids) } : prev)),
    });
  };

  return {
    current,
    update,
    onFailPhotoUploadingChange,
    photoUploading: Object.values(uploading).some(Boolean),
    patch: (p: Partial<CheckDraft>) => setDraft({ ...current, ...p }),
    passAll,
    restore: setDraft,
    reset: () => setDraft(EMPTY_DRAFT),
    /** After a save: forget the answers only if they are still that asset's (review SF3). */
    resetIfFor: (id: string) => setDraft((prev) => (prev.forAssetId === id ? EMPTY_DRAFT : prev)),
    dirty: checkStatesDirty(current.states) || current.condition !== null || current.notes !== "",
  };
}

type Draft = ReturnType<typeof useCheckDraft>;

/**
 * The awaited save. It makes ONE undo closure (`announceListWrite`), handed unchanged
 * to the toast and to the Last scans row; it reverses the save on the server (deleting
 * the photo files the save proved it owns) and, when nothing else is loaded, puts the
 * draft back without its photos. While it is in flight the answers no longer count as
 * unsaved, so a scan loads the next item at once; when it lands it clears only what is
 * still the saved asset's (review SF3).
 */
function useCheckSave(s: CheckModeDeps & {
  asset: ScanAsset | null;
  items: CheckItemData[] | undefined;
  draft: Draft;
  condition: CheckConditionValue;
  failCount: number;
  blocker: string | null;
}) {
  const writes = useCheckRecordWrites();
  const [saving, setSaving] = useState(false);
  // The latest loaded tag, read by an Undo that fires after the page moved on.
  const tagRef = useRef(s.tag);
  useEffect(() => {
    tagRef.current = s.tag;
  });

  const announce = (asset: ScanAsset, auditId: string, snapshot: CheckDraft) => {
    const tag = asset.assetTag;
    const hadPhotos = Object.values(snapshot.states).some((st) => st.photos.length > 0);
    const performUndo = async () => {
      await writes.undoAdHocCheck(auditId);
      s.markUndone(auditId);
      if (!tagRef.current) {
        // The Undo deleted the photos' files with the records (overseer ruling), so the
        // draft comes back without them — a FAIL then asks for its photo again.
        s.draft.restore(withoutPhotos(snapshot));
        s.reload(tag);
      }
      return hadPhotos ? "Undone · photos need re-adding" : undefined;
    };
    return announceListWrite({
      title: s.failCount > 0 ? `Saved check on ${tag} · ${s.failCount} failed` : `Saved check on ${tag}`,
      undoneTitle: `Check on ${tag} undone`,
      performUndo,
    });
  };

  /** Resolves `true` once saved (the caret's follow-ups wait for it), `false` otherwise. */
  const save = async ({ keepOpen }: { keepOpen: boolean }): Promise<boolean> => {
    const { asset, items } = s;
    if (!asset || !items || s.blocker || saving) return false;
    const snapshot = s.draft.current;
    const savedTag = s.tag;
    const checks = checksPayload(items, snapshot.states);
    setSaving(true);
    try {
      const res = await writes.saveAdHocCheck({ assetId: asset.id, checks, condition: s.condition, notes: snapshot.notes.trim() || undefined });
      s.play("success");
      const undo = announce(asset, res.auditId, snapshot);
      s.addLastScan({
        id: res.auditId, mode: "check", tag: asset.assetTag, name: asset.modelName, verdict: s.failCount > 0 ? "failed" : "clean",
        at: Date.now(), assetId: asset.id, undo, reason: checkFailureReason(items, snapshot.states),
      });
      s.draft.resetIfFor(asset.id);
      // A scan that landed mid-save already loaded the next item: leave it be.
      if (!keepOpen && tagRef.current === savedTag) s.finishScan();
      return true;
    } catch (e) {
      s.play("error");
      showError(e, { fallbackTitle: "Couldn't save the check" });
      return false;
    } finally {
      setSaving(false);
    }
  };

  return { saving, save };
}

function withoutPhotos(d: CheckDraft): CheckDraft {
  return { ...d, states: Object.fromEntries(Object.entries(d.states).map(([id, st]) => [id, { ...st, photos: [] }])) };
}

/** The model's check items, live (stable args, so the subscription settles). */
function useCheckItemsFor(orgId: string | undefined, modelId: string | null): CheckItemData[] | undefined {
  const rows = useAuthedQuery(api.modelCheckItems.assignmentsForModel, orgId && modelId ? { orgId, modelId } : "skip");
  return rows as unknown as CheckItemData[] | undefined;
}
