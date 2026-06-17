"use client";

import { useRef, useEffect } from "react";
import { AssetTagInput } from "@/components/ui/asset-tag-input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Zap, AlertTriangle, RotateCcw } from "lucide-react";
import { lookupTestTagAsset, reactivateTestTagAsset } from "@/server/test-tag-assets";
import { resolveTestProfile } from "@/server/test-tag-profiles";
import { getLatestTestRecord } from "@/server/test-tag-records";
import { toast } from "sonner";
import type { WizardAction, WizardState, ProfileInfo } from "./wizard-reducer";

const STATUS_LABELS: Record<string, { label: string; className: string }> = {
  NOT_YET_TESTED: { label: "Not Yet Tested", className: "text-fg-3" },
  CURRENT: { label: "Current", className: "text-teal-600" },
  DUE_SOON: { label: "Due Soon", className: "text-amber-600" },
  OVERDUE: { label: "Overdue", className: "text-red-600" },
  FAILED: { label: "Failed", className: "text-red-600" },
  RETIRED: { label: "Retired", className: "text-fg-3" },
};

export function ScanStep({
  state,
  dispatch,
}: {
  state: WizardState;
  dispatch: React.Dispatch<WizardAction>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleScan = async (value: string) => {
    dispatch({ type: "SET_SCAN_INPUT", value });
    if (!value.trim()) return;

    try {
      const asset = await lookupTestTagAsset(value.trim());
      if (!asset) {
        toast.error(`No asset found for tag "${value.trim()}"`);
        return;
      }

      // Resolve profile
      let profile: ProfileInfo | null = null;
      try {
        profile = await resolveTestProfile(asset.id) as ProfileInfo | null;
      } catch {
        // No profile found — user will need to select one
      }

      dispatch({
        type: "SET_ASSET",
        asset: asset as WizardState["asset"]  & Record<string, unknown>,
        profile,
      });
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const handleReactivate = async () => {
    if (!state.asset) return;
    try {
      await reactivateTestTagAsset(state.asset.id);
      dispatch({ type: "SET_RETIRED", isRetired: false });
      toast.success("Asset reactivated");
      // Re-lookup to get fresh data
      handleScan(state.asset.testTagId);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const handleQuickPass = async () => {
    if (!state.asset) return;
    try {
      const latest = await getLatestTestRecord(state.asset.id);
      if (latest) {
        dispatch({ type: "QUICK_PASS", previousRecord: latest as Record<string, unknown> });
      } else {
        toast.info("No previous test record — complete the full test");
      }
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <AssetTagInput
          ref={inputRef}
          value={state.scanInput}
          onChange={(e) => dispatch({ type: "SET_SCAN_INPUT", value: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleScan(state.scanInput);
          }}
          placeholder="Scan or type a tag ID..."
          className="h-12 text-lg font-mono"
        />
      </div>

      {/* Retired asset block */}
      {state.isRetired && state.asset && (
        <div className="border border-amber-200 bg-amber-50 rounded-lg p-4 space-y-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-600" />
            <span className="font-medium text-amber-900">This asset is retired</span>
          </div>
          <p className="text-sm text-amber-700">
            Tag <span className="font-mono font-medium">{state.asset.testTagId}</span> — {state.asset.description}
          </p>
          <Button onClick={handleReactivate} variant="outline" className="border-amber-300 text-amber-700 hover:bg-amber-100">
            <RotateCcw className="mr-2 h-4 w-4" />
            Reactivate & Test
          </Button>
        </div>
      )}

      {/* Asset info bar */}
      {state.asset && !state.isRetired && (
        <div className="border rounded-lg p-4 space-y-3 bg-surface">
          <div className="flex items-center justify-between">
            <div>
              <span className="font-mono font-medium text-fg-1 text-lg">{state.asset.testTagId}</span>
              <p className="text-sm text-fg-2 mt-0.5">{state.asset.description}</p>
            </div>
            <div className="flex items-center gap-2">
              {state.asset.status && (
                <div className="flex items-center gap-1.5">
                  <div className={`w-2 h-2 rounded-full ${
                    state.asset.status === "CURRENT" ? "bg-teal-500" :
                    state.asset.status === "DUE_SOON" ? "bg-amber-500" :
                    state.asset.status === "OVERDUE" || state.asset.status === "FAILED" ? "bg-red-500" :
                    "bg-gray-400"
                  }`} />
                  <span className={`text-sm ${STATUS_LABELS[state.asset.status]?.className || "text-fg-3"}`}>
                    {STATUS_LABELS[state.asset.status]?.label || state.asset.status}
                  </span>
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-3">
            <span>Class: {state.asset.equipmentClass.replace(/_/g, " ")}</span>
            <span>Type: {state.asset.applianceType.replace(/_/g, " ")}</span>
            {state.asset.make && <span>Make: {state.asset.make}</span>}
            {state.asset.lastTestDate && (
              <span>Last tested: {new Date(state.asset.lastTestDate).toLocaleDateString()}</span>
            )}
            {state.asset.nextDueDate && (
              <span>Next due: {new Date(state.asset.nextDueDate).toLocaleDateString()}</span>
            )}
          </div>

          {state.profile && (
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-teal-600 border-teal-200 bg-teal-50">
                {state.profile.name}
              </Badge>
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <Button onClick={() => dispatch({ type: "NEXT_STEP" })}>
              Start Test
            </Button>
            {state.asset.lastTestDate && (
              <Button variant="outline" onClick={handleQuickPass}>
                <Zap className="mr-2 h-4 w-4" />
                Quick Pass
              </Button>
            )}
          </div>
        </div>
      )}

      {!state.asset && !state.scanInput && (
        <p className="text-sm text-fg-3 text-center py-8">Scan a tag to begin testing</p>
      )}
    </div>
  );
}
