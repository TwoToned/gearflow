"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";

import { CategorySheet } from "@/components/assets/category/category-sheet";
import type { CategorySheetInitial } from "@/lib/category-sheet";
import { useCurrentRole } from "@/lib/use-permissions";

/**
 * Opens the Category Edit sheet from `?edit=1` on the record, so the menus, the `E` key and any deep link land in ONE
 * place. Closing removes the param (replace, so Back does not reopen it). A caller without `model:update` (the category
 * resource) never sees it open: the param is dropped with a toast once their permissions have ARRIVED (an unloaded set is
 * "not known yet", never "no").
 */
export function CategorySheetHost({ category, excludedParentIds }: { category: CategorySheetInitial | null; excludedParentIds: string[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { permissions } = useCurrentRole();
  const wanted = params.get("edit") === "1";
  const allowed = permissions ? (permissions.model?.includes("update") ?? false) : null;
  const open = wanted && allowed === true && !!category;

  const dropParam = React.useCallback(() => {
    const q = new URLSearchParams(params.toString());
    q.delete("edit");
    const qs = q.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }, [params, router, pathname]);

  React.useEffect(() => {
    if (!wanted || allowed !== false) return;
    toast.error("You don't have permission to edit categories.");
    dropParam();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per arrival of the unwanted param
  }, [wanted, allowed]);

  if (!category) return null;
  return <CategorySheet open={open} onOpenChange={(next) => !next && dropParam()} category={category} excludedParentIds={excludedParentIds} />;
}
