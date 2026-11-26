"use client";

import { useCallback, useEffect } from "react";
import { toast } from "sonner";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useConvex, useConvexAuth } from "convex/react";

import { api } from "../../../convex/_generated/api";
import { useActiveOrganization } from "@/lib/auth-client";
import { useServerQuery } from "@/hooks/use-server-query";
import { useCanDo } from "@/lib/use-permissions";
import { modelToFormValues } from "@/lib/model-edit-values";
import { ModelSheet } from "./model-sheet";

/**
 * `<ModelSheetHost />` (UX Phase 12, Q-12): the ONE mount point for the model create and
 * edit sheet, driven by the URL so any page can open it with a plain link:
 * `?new-model=1` creates, `?edit-model=<id>` edits. It is mounted once, in the assets
 * layout, so every page under `/assets` (the models list, a model's page, the registry)
 * gets it without owning a copy. The old `/assets/models/new` and `[id]/edit` routes
 * redirect here. Closing drops the param and keeps the rest of the URL.
 */
const NEW_MODEL_PARAM = "new-model";
const EDIT_MODEL_PARAM = "edit-model";
/** Fired on `window` after an edit saves (`detail` = the model id): a page holding a one-shot read of that model refetches. */
export const MODEL_SAVED_EVENT = "rvlt:model-saved";

function useCloseSheet() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  return useCallback(() => {
    const next = new URLSearchParams(params.toString());
    next.delete(NEW_MODEL_PARAM);
    next.delete(EDIT_MODEL_PARAM);
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [router, pathname, params]);
}

function EditHost({ id, onClose }: { id: string; onClose: () => void }) {
  const orgId = useActiveOrganization().data?.id;
  const convex = useConvex();
  const { isAuthenticated } = useConvexAuth();
  const { data: model, isLoading, error } = useServerQuery({
    queryKey: ["model", orgId, id, isAuthenticated],
    queryFn: () => convex.query(api.models.detail, { id }),
    enabled: !!orgId && isAuthenticated,
  });
  // An unknown (or another organisation's) id: say so once and drop the param, never an empty sheet.
  const missing = !isLoading && (!!error || model === null);
  useEffect(() => {
    if (!missing) return;
    toast.error("Model not found");
    onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per missing id
  }, [missing]);
  if (!model) return null;
  // The asset-type lock counts only ACTIVE units, the same rule `updateNative` enforces.
  const active = <T extends { isActive?: boolean | null }>(rows: T[]) => rows.filter((r) => r.isActive !== false).length;
  return (
    <ModelSheet
      key={model.id}
      mode="edit"
      values={modelToFormValues(model)}
      stock={{ assets: active(model.assets), bulk: active(model.bulkAssets) }}
      onClose={onClose}
      onSaved={(r) => window.dispatchEvent(new CustomEvent(MODEL_SAVED_EVENT, { detail: r.id }))}
    />
  );
}

export function ModelSheetHost() {
  const params = useSearchParams();
  const router = useRouter();
  const close = useCloseSheet();
  const canCreate = useCanDo("model", "create");
  const canUpdate = useCanDo("model", "update");
  const editId = params.get(EDIT_MODEL_PARAM);
  if (editId && canUpdate) return <EditHost id={editId} onClose={close} />;
  if (params.get(NEW_MODEL_PARAM) && canCreate) {
    return <ModelSheet mode="create" onClose={close} onSaved={(r) => router.push(`/assets/models/${r.id}`)} />;
  }
  return null;
}
