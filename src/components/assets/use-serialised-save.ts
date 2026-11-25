"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { UseFormReturn } from "react-hook-form";
import { ConvexError } from "convex/values";
import { toast } from "sonner";

import { useAssetWrites } from "@/hooks/use-asset-writes";
import { announceListWrite } from "@/lib/list-write-toast";
import { showError } from "@/lib/show-error";
import { peekNextAssetTags } from "@/server/settings";
import type { AssetFormValues } from "@/lib/validations/asset";

/** The text of a thrown write error (a ConvexError's payload may be a string or `{ message }`). */
export function errorText(e: unknown): string {
  if (e instanceof ConvexError) {
    const d = e.data as string | { message?: string } | undefined;
    return typeof d === "string" ? d : (d?.message ?? "");
  }
  return e instanceof Error ? e.message : "";
}

/** `Save and add another` keeps model, location, condition, status and purchase context; the tag advances, the serial and name clear. */
function nextAfterAdd(v: AssetFormValues, nextTag: string): AssetFormValues {
  return { ...v, assetTag: nextTag, serialNumber: "", customName: "", barcode: undefined };
}

export interface SerialisedSaveArgs {
  editing: boolean;
  /** The record being edited. */
  id?: string;
  form: UseFormReturn<AssetFormValues>;
  tagTaken: (tag: string) => Promise<string | null>;
  setTaken: (msg: string | null) => void;
  /** The org's first model, for the activation hand-off (offered, never forced). */
  milestone: { active: boolean; firstModelId?: string | null };
  onClose: () => void;
  onSaved?: (r: { id: string; again?: boolean }) => void;
}

/**
 * The asset sheet's ONE save (create or edit). Edit toasts what changed with the exact
 * Undo (`undoUpdate`, from the edit's own audit row); create's Undo removes exactly the
 * unit it made. `again` keeps the sheet open on a fresh sibling. A duplicate tag is the
 * tag field's own error; anything else is a toast.
 */
export function useSerialisedSave(a: SerialisedSaveArgs) {
  const router = useRouter();
  const writes = useAssetWrites();
  const [saving, setSaving] = useState(false);

  const saveEdit = async (data: AssetFormValues) => {
    const r = await writes.update(a.id!, data);
    announceListWrite({
      title: r.undoable ? `Saved ${data.assetTag}` : `Nothing changed on ${data.assetTag}`,
      undoneTitle: `Restored ${data.assetTag}`,
      performUndo: r.undoable ? async () => void (await writes.undoUpdate(a.id!, r.auditId)) : undefined,
    });
    a.onSaved?.({ id: a.id! });
    a.onClose();
  };

  const toastCreated = (id: string, data: AssetFormValues) => {
    const handoff = a.milestone.active && !!data.modelId && data.modelId === a.milestone.firstModelId;
    if (handoff) {
      toast.success(`Created ${data.assetTag}`, { action: { label: "Create your first job", onClick: () => router.push("/projects/new") } });
      return;
    }
    announceListWrite({ title: `Created ${data.assetTag}`, undoneTitle: `Removed ${data.assetTag}`, performUndo: async () => void (await writes.remove(id)) });
  };

  const saveCreate = async (data: AssetFormValues, again: boolean) => {
    const { id } = await writes.create(data);
    toastCreated(id, data);
    a.onSaved?.({ id, again });
    if (!again) return a.onClose();
    const [tag] = await peekNextAssetTags(1).catch(() => [""]);
    a.form.reset(nextAfterAdd(data, tag), { keepDefaultValues: false });
  };

  const fail = (e: unknown, data: AssetFormValues) => {
    if (/already (used|exists)|DUPLICATE_ASSET_TAG/i.test(errorText(e)) || (e instanceof ConvexError && (e.data as { code?: string })?.code === "DUPLICATE_ASSET_TAG")) {
      a.setTaken(`${data.assetTag} is already used by another asset`);
      return;
    }
    showError(e, { fallbackTitle: a.editing ? "Couldn't save the asset" : "Couldn't create the asset" });
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
