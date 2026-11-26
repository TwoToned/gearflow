"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";

import { TestTagSheet } from "@/components/test-tag/test-tag-sheet";
import type { TestTagSheetInitial } from "@/lib/test-tag-sheet";
import { useCurrentRole } from "@/lib/use-permissions";

/**
 * Opens the Test & tag Edit sheet from `?edit=1` on the record, so the menus, the `E` key and any deep link land in ONE
 * place. Closing removes the param (replace, so Back does not reopen it). A caller without `testTag:update` never sees
 * it open: the param is dropped with a toast once their permissions have ARRIVED (an unloaded set is "not known yet").
 * A retired item is not edited (Reactivate first), so the sheet does not open for one either.
 */
export function TestTagSheetHost({ item, retired }: { item: TestTagSheetInitial | null; retired: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { permissions } = useCurrentRole();
  const wanted = params.get("edit") === "1";
  const allowed = permissions ? (permissions.testTag?.includes("update") ?? false) : null;
  const open = wanted && allowed === true && !retired && !!item;

  const dropParam = React.useCallback(() => {
    const q = new URLSearchParams(params.toString());
    q.delete("edit");
    const qs = q.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }, [params, router, pathname]);

  React.useEffect(() => {
    if (!wanted) return;
    if (allowed === false) toast.error("You don't have permission to edit test & tag items.");
    else if (allowed === true && retired && item) toast.error("A retired item can't be edited. Reactivate it first.");
    else return;
    dropParam();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per arrival of the unwanted param
  }, [wanted, allowed, retired, !!item]);

  if (!item) return null;
  return <TestTagSheet open={open} onOpenChange={(next) => !next && dropParam()} item={item} />;
}
