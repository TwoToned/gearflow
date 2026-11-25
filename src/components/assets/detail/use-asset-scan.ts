"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { useScanLookup } from "@/hooks/use-scan-lookup";
import { useScanTarget } from "@/components/scanner/scan-target";

/**
 * What a scan MEANS on the asset page (spec §9d.3): the same tag just confirms it (no
 * write: `Last scan` is read from records that already exist), a different tag opens
 * that asset, an unknown tag says so. Registered as the page's `ScanTarget`, so the
 * phone bar's global Scan lands here too; `scan` is also what the in-page camera calls.
 * One camera, the shell's: this hook never opens one.
 */
export function useAssetScan(assetTag: string) {
  const router = useRouter();
  const { state, run, reset } = useScanLookup();
  const [last, setLast] = useState<string | null>(null);

  const scan = (value: string) => {
    const v = value.trim();
    if (!v) return;
    if (v.toLowerCase() === assetTag.toLowerCase()) {
      toast.success(`That's ${assetTag}`);
      return;
    }
    setLast(v);
    void run(v);
  };
  useScanTarget(scan);

  useEffect(() => {
    if (state.status === "found" && last === state.value) {
      reset();
      setLast(null);
      router.push(state.url);
    } else if (state.status === "notFound" && last === state.value) {
      toast.error(`No asset or kit is tagged "${state.value}"`);
      reset();
      setLast(null);
    } else if ((state.status === "error" || state.status === "noPermission") && last === state.value) {
      toast.error(state.status === "noPermission" ? "You can't look up tags" : "Couldn't look that tag up");
      reset();
      setLast(null);
    }
  }, [state, last, reset, router]);

  return { scan };
}
