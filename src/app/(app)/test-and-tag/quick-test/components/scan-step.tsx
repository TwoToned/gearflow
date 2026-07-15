"use client";

import { useRef, useEffect } from "react";
import { AssetTagInput } from "@/components/ui/asset-tag-input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Zap, AlertTriangle, RotateCcw } from "lucide-react";
import { lookupTestTagAsset, reactivateTestTagAsset } from "@/server/test-tag-assets";
import { useConvex } from "convex/react";
import { api } from "../../../../../../convex/_generated/api";
import { useActiveOrganization } from "@/lib/auth-client";
import { getLatestTestRecord } from "@/server/test-tag-records";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { getStatusColor } from "@/lib/status-colors";
import { testTagStatusLabels, equipmentClassLabels, applianceTypeLabels } from "@/lib/status-labels";
import type { WizardAction, WizardState, ProfileInfo } from "./wizard-reducer";

export function ScanStep({
  state,
  dispatch,
}: {
  state: WizardState;
  dispatch: React.Dispatch<WizardAction>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const convex = useConvex();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

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
        if (orgId) {
          profile = await convex.query(api.testProfiles.resolveForAsset, { orgId, testTagAssetId: asset.id }) as ProfileInfo | null;
        }
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

      {/* Retired asset block — left-edge accent notice (§ Notices/Alerts) */}
      {state.isRetired && state.asset && (
        <div className="rounded-[var(--r)] border-l-4 border-l-warn bg-card p-4 ring-1 ring-line shadow-[var(--sh-card)] space-y-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-warn" />
            <span className="font-medium text-ink">This asset is retired</span>
          </div>
          <p className="text-ui-text text-ink-2">
            Tag <span className="t-mono font-medium">{state.asset.testTagId}</span> — {state.asset.description}
          </p>
          <Button onClick={handleReactivate} variant="line" className="border-transparent text-warn hover:bg-warn-soft hover:text-warn">
            <RotateCcw className="mr-2 h-4 w-4" />
            Reactivate & test
          </Button>
        </div>
      )}

      {/* Asset info bar */}
      {state.asset && !state.isRetired && (
        <div className="rounded-[var(--r)] p-4 space-y-3 bg-card ring-1 ring-line shadow-[var(--sh-card)]">
          <div className="flex items-center justify-between">
            <div>
              <span className="t-mono font-medium text-ink text-lg">{state.asset.testTagId}</span>
              <p className="text-ui-text text-ink-2 mt-0.5">{state.asset.description}</p>
            </div>
            <div className="flex items-center gap-2">
              {state.asset.status && (
                <div className="flex items-center gap-1.5">
                  <div className={cn("w-2 h-2 rounded-full", getStatusColor("testTag", state.asset.status).dot)} />
                  <span className={cn("text-ui-text", getStatusColor("testTag", state.asset.status).text)}>
                    {testTagStatusLabels[state.asset.status] || state.asset.status}
                  </span>
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-x-4 gap-y-1 text-caption text-muted">
            <span>Class: {equipmentClassLabels[state.asset.equipmentClass] ?? state.asset.equipmentClass}</span>
            <span>Type: {applianceTypeLabels[state.asset.applianceType] ?? state.asset.applianceType}</span>
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
              <Badge status="neutral">
                {state.profile.name}
              </Badge>
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <Button onClick={() => dispatch({ type: "NEXT_STEP" })}>
              Start test
            </Button>
            {state.asset.lastTestDate && (
              <Button variant="line" onClick={handleQuickPass}>
                <Zap className="mr-2 h-4 w-4" />
                Quick pass
              </Button>
            )}
          </div>
        </div>
      )}

      {!state.asset && !state.scanInput && (
        <p className="text-ui-text text-muted text-center py-8">Scan a tag to begin testing</p>
      )}
    </div>
  );
}
