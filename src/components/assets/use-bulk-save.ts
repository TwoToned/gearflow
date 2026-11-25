"use client";

import { useState } from "react";
import type { UseFormReturn } from "react-hook-form";

import { useBulkAssetWrites } from "@/hooks/use-bulk-asset-writes";
import { announceListWrite } from "@/lib/list-write-toast";
import { showError } from "@/lib/show-error";
import { peekNextAssetTags } from "@/server/settings";
import type { BulkAssetFormValues } from "@/lib/validations/asset";
import { errorText } from "./use-serialised-save";

export interface BulkSaveArgs {
  editing: boolean;
  id?: string;
  form: UseFormReturn<BulkAssetFormValues>;
  tagTaken: (tag: string) => Promise<string | null>;
  setTaken: (msg: string | null) => void;
  onClose: () => void;
  onSaved?: (r: { id: string; again?: boolean }) => void;
}

/** The bulk-stock sheet's ONE save, with the same toasts and exact Undos as a serialised unit. */
export function useBulkSave(a: BulkSaveArgs) {
  const writes = useBulkAssetWrites();
  const [saving, setSaving] = useState(false);

  const saveEdit = async (data: BulkAssetFormValues) => {
    const r = await writes.update(a.id!, data);
    announceListWrite({
      title: r.undoable ? `Saved ${data.assetTag}` : `Nothing changed on ${data.assetTag}`,
      undoneTitle: `Restored ${data.assetTag}`,
      performUndo: r.undoable ? async () => void (await writes.undoUpdate(a.id!, r.auditId)) : undefined,
    });
    a.onSaved?.({ id: a.id! });
    a.onClose();
  };

  const saveCreate = async (data: BulkAssetFormValues, again: boolean) => {
    const { id } = await writes.create(data);
    announceListWrite({ title: `Created ${data.assetTag}`, undoneTitle: `Removed ${data.assetTag}`, performUndo: async () => void (await writes.remove(id)) });
    a.onSaved?.({ id, again });
    if (!again) return a.onClose();
    const [tag] = await peekNextAssetTags(1).catch(() => [""]);
    a.form.reset({ ...data, assetTag: tag, totalQuantity: undefined }, { keepDefaultValues: false });
  };

  const fail = (e: unknown, data: BulkAssetFormValues) => {
    if (/already exists/i.test(errorText(e))) return a.setTaken(`${data.assetTag} is already used by another asset`);
    showError(e, { fallbackTitle: a.editing ? "Couldn't save the stock" : "Couldn't create the stock" });
  };

  const save = (again: boolean) =>
    a.form.handleSubmit(async (data) => {
      const clash = await a.tagTaken(data.assetTag);
      a.setTaken(clash);
      if (clash) return;
      setSaving(true);
      try {
        await (a.editing ? saveEdit(data) : saveCreate(data, again));
      } catch (e) {
        fail(e, data);
      } finally {
        setSaving(false);
      }
    })();

  return { saving, save };
}
