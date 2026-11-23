"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "../../../convex/_generated/api";
import { CHECK_CONDITION_VALUE, conditionWord, type CheckConditionValue, type StoredAssetCondition } from "../../../convex/lib/assetCondition";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { useCheckRecordWrites } from "@/hooks/use-check-record-writes";
import {
  checkBlocker,
  checkFailCount,
  checksPayload,
  checkStatesDirty,
  passAllStates,
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
  // Any fail forces and locks Damaged (D50; the server forces it too).
  const condition: CheckConditionValue = failCount > 0 ? "DAMAGED" : (draft.current.condition ?? preselectFor(asset));
  const blocker = items ? checkBlocker(items, draft.current.states, draft.photoUploading) : "Loading check items";
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
    canPassAll: canPassAllFor(items, draft.current.states),
    passAll: () => items && draft.passAll(items),
    blocker,
    dirty: draft.dirty,
    saving: save.saving,
    save: save.save,
    /** Forget the answers (a confirmed discard). */
    discard: draft.reset,
  };
}

/** The word the asset's stored condition reads as, as the value a check submits (Q5). */
function preselectFor(asset: ScanAsset | null): CheckConditionValue {
  return CHECK_CONDITION_VALUE[conditionWord(asset?.condition as StoredAssetCondition | null | undefined)];
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

  /** Pass all, with its own Undo (the list as it was). */
  const passAll = (items: CheckItemData[]) => {
    const before = current;
    setDraft({ ...current, states: passAllStates(items, current.states) });
    announceListWrite({ title: "All pass/fail items marked Pass", undoneTitle: "Pass all undone", performUndo: async () => setDraft(before) });
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
    dirty: checkStatesDirty(current.states) || current.condition !== null || current.notes !== "",
  };
}

type Draft = ReturnType<typeof useCheckDraft>;

/**
 * The awaited save. It makes ONE undo closure (`announceListWrite`), handed unchanged
 * to the toast and to the Last scans row; it reverses the save on the server and,
 * when nothing else is loaded, puts the draft back. A check with photos can't be
 * undone server-side (its files predate the save), so it offers no Undo at all.
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

  const announce = (asset: ScanAsset, auditId: string, snapshot: CheckDraft, reversible: boolean) => {
    const tag = asset.assetTag;
    const performUndo = async () => {
      await writes.undoAdHocCheck(auditId);
      s.markUndone(auditId);
      if (tagRef.current) return;
      s.draft.restore(snapshot);
      s.reload(tag);
    };
    return announceListWrite({
      title: s.failCount > 0 ? `Saved check on ${tag} · ${s.failCount} failed` : `Saved check on ${tag}`,
      undoneTitle: `Check on ${tag} undone`,
      performUndo: reversible ? performUndo : undefined,
    });
  };

  const save = async ({ keepOpen }: { keepOpen: boolean }) => {
    const { asset, items } = s;
    if (!asset || !items || s.blocker || saving) return;
    const snapshot = s.draft.current;
    const checks = checksPayload(items, snapshot.states);
    setSaving(true);
    try {
      const res = await writes.saveAdHocCheck({ assetId: asset.id, checks, condition: s.condition, notes: snapshot.notes.trim() || undefined });
      s.play("success");
      const undo = announce(asset, res.auditId, snapshot, !checks.some((c) => (c.photos?.length ?? 0) > 0));
      s.addLastScan({
        id: res.auditId, mode: "check", tag: asset.assetTag, name: asset.modelName, verdict: s.failCount > 0 ? "failed" : "clean",
        at: Date.now(), assetId: asset.id, undo,
      });
      s.draft.reset();
      if (!keepOpen) s.finishScan();
    } catch (e) {
      s.play("error");
      showError(e, { fallbackTitle: "Couldn't save the check" });
    } finally {
      setSaving(false);
    }
  };

  return { saving, save };
}

/** The model's check items, live (stable args, so the subscription settles). */
function useCheckItemsFor(orgId: string | undefined, modelId: string | null): CheckItemData[] | undefined {
  const rows = useAuthedQuery(api.modelCheckItems.assignmentsForModel, orgId && modelId ? { orgId, modelId } : "skip");
  return rows as unknown as CheckItemData[] | undefined;
}
