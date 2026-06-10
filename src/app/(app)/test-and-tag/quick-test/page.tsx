"use client";

import { useReducer, useEffect, useCallback, Suspense, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerQuery } from "@/hooks/use-server-query";

import { toast } from "sonner";
import Link from "next/link";
import { ArrowLeft, Volume2, VolumeX, ChevronDown, ChevronUp } from "lucide-react";

import { createTestTagRecord } from "@/server/test-tag-records";
import { lookupTestTagAsset } from "@/server/test-tag-assets";
import { updateTestTagAsset } from "@/server/test-tag-assets";
import { resolveTestProfile } from "@/server/test-tag-profiles";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RequirePermission } from "@/components/auth/require-permission";
import { useActiveOrganization, useSession } from "@/lib/auth-client";
import { getMembers } from "@/server/settings";

import { wizardReducer, initialWizardState, type WizardStep, type WizardState, type ProfileInfo } from "./components/wizard-reducer";
import { ScanStep } from "./components/scan-step";
import { VisualStep } from "./components/visual-step";
import { ElectricalStep } from "./components/electrical-step";
import { SubTestStep } from "./components/sub-test-step";
import { ResultStep } from "./components/result-step";

// ─── Audio ──────────────────────────────────────────────────────────────────

function playBeep(success: boolean) {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = success ? 800 : 300;
    gain.gain.value = 0.1;
    osc.start();
    osc.stop(ctx.currentTime + (success ? 0.15 : 0.4));
  } catch {
    /* ignore if audio not available */
  }
}

// ─── Step Labels ────────────────────────────────────────────────────────────

const STEP_CONFIG: { key: WizardStep; label: string }[] = [
  { key: "scan", label: "Scan" },
  { key: "visual", label: "Visual" },
  { key: "electrical", label: "Electrical" },
  { key: "subtests", label: "Sub-Tests" },
  { key: "result", label: "Result" },
];

// ─── Main Page ──────────────────────────────────────────────────────────────

function QuickTestContent() {
  const queryClient = useQueryClient();
  const { data: activeOrg } = useActiveOrganization();
  const { data: session } = useSession();
  const orgId = activeOrg?.id;
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [sessionLogExpanded, setSessionLogExpanded] = useState(false);

  const [state, dispatch] = useReducer(wizardReducer, initialWizardState);

  // Set default session tester from logged-in user
  useEffect(() => {
    if (session?.user && !state.sessionTesterId) {
      dispatch({
        type: "SET_SESSION_TESTER",
        id: session.user.id,
        name: session.user.name || session.user.email || "",
      });
    }
  }, [session?.user]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-load asset when ?id= is provided (e.g. from "Record Test" button)
  const searchParams = useSearchParams();
  const preloadId = searchParams.get("id");
  const preloadedRef = useRef(false);

  useEffect(() => {
    if (!preloadId || preloadedRef.current) return;
    preloadedRef.current = true;

    (async () => {
      try {
        const asset = await lookupTestTagAsset(preloadId);
        if (!asset) {
          toast.error(`No asset found for tag "${preloadId}"`);
          return;
        }
        let profile: ProfileInfo | null = null;
        try {
          profile = await resolveTestProfile(asset.id) as ProfileInfo | null;
        } catch {
          // No profile — user will select
        }
        dispatch({
          type: "SET_ASSET",
          asset: asset as WizardState["asset"] & Record<string, unknown>,
          profile,
        });
      } catch (e) {
        toast.error((e as Error).message);
      }
    })();
  }, [preloadId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch org members for tester picker
  const { data: members } = useServerQuery({
    queryKey: ["members", orgId],
    queryFn: getMembers,
    enabled: !!orgId,
  });

  const memberList = (members || []) as { id: string; userId: string; user: { id: string; name: string; email: string; image?: string } }[];

  // Keyboard: Ctrl+Enter to save, Escape to go back to scan
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "Enter" && state.step === "result") {
        e.preventDefault();
        handleSave();
      }
      if (e.key === "Escape") {
        e.preventDefault();
        dispatch({ type: "RESET_FOR_NEXT" });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [state.step, state.asset]); // eslint-disable-line react-hooks/exhaustive-deps

  // Determine visible steps
  const visibleSteps = STEP_CONFIG.filter(s => {
    if (s.key === "subtests" && !state.profile?.requiresSubTests) return false;
    return true;
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!state.asset) throw new Error("No asset loaded");

      const subTests = state.subTests.map(st => ({
        label: st.label,
        sortOrder: st.sortOrder,
        result: st.result,
        earthContinuityResult: st.earthContinuityReading !== null ? (st.result as "PASS" | "FAIL") : ("NOT_APPLICABLE" as const),
        earthContinuityReading: st.earthContinuityReading,
        insulationResult: st.insulationReading !== null ? (st.result as "PASS" | "FAIL") : ("NOT_APPLICABLE" as const),
        insulationReading: st.insulationReading,
        leakageCurrentResult: st.leakageCurrentReading !== null ? (st.result as "PASS" | "FAIL") : ("NOT_APPLICABLE" as const),
        leakageCurrentReading: st.leakageCurrentReading,
        polarityResult: st.polarityResult,
        notes: st.notes || undefined,
      }));

      return createTestTagRecord({
        testTagAssetId: state.asset.id,
        testProfileId: state.profile?.id,
        testDate: new Date(),
        testedById: state.sessionTesterId || undefined,
        testerName: state.sessionTesterName,
        result: state.overallResult,
        visualInspectionResult: state.visualResult,
        visualCordCondition: state.visualChecks.cordCondition ?? undefined,
        visualPlugCondition: state.visualChecks.plugCondition ?? undefined,
        visualHousingCondition: state.visualChecks.housingCondition ?? undefined,
        visualSwitchCondition: state.visualChecks.switchCondition ?? undefined,
        visualVentsUnobstructed: state.visualChecks.ventsUnobstructed ?? undefined,
        visualCordGrip: state.visualChecks.cordGrip ?? undefined,
        visualEarthPin: state.visualChecks.earthPin ?? undefined,
        visualMarkingsLegible: state.visualChecks.markingsLegible ?? undefined,
        visualNoModifications: state.visualChecks.noModifications ?? undefined,
        visualNotes: state.visualNotes || undefined,
        equipmentClassTested: (state.profile?.equipmentClass as "CLASS_I") || "CLASS_I",
        testMethod: state.testMethod,
        earthContinuityResult: state.earthContinuityReading !== null ? (state.electricalResult as "PASS" | "FAIL") : "NOT_APPLICABLE",
        earthContinuityReading: state.earthContinuityReading ?? undefined,
        insulationResult: state.insulationReading !== null ? (state.electricalResult as "PASS" | "FAIL") : "NOT_APPLICABLE",
        insulationReading: state.insulationReading ?? undefined,
        insulationTestVoltage: state.insulationTestVoltage ?? undefined,
        leakageCurrentResult: state.leakageCurrentReading !== null ? (state.electricalResult as "PASS" | "FAIL") : "NOT_APPLICABLE",
        leakageCurrentReading: state.leakageCurrentReading ?? undefined,
        polarityResult: state.polarityResult,
        rcdTripTimeResult: state.rcdTripTimeReading !== null ? "PASS" : "NOT_APPLICABLE",
        rcdTripTimeReading: state.rcdTripTimeReading ?? undefined,
        failureAction: state.failureAction as "NONE" | "REPAIRED" | "REMOVED_FROM_SERVICE" | "DISPOSED" | "REFERRED_TO_ELECTRICIAN",
        failureNotes: state.failureNotes || undefined,
        nextDueDate: new Date(state.nextDueDate),
        subTests: subTests.length > 0 ? subTests : undefined,
        outletCount: state.outletCount > 1 ? state.outletCount : undefined,
      });
    },
    onSuccess: () => {
      if (audioEnabled) playBeep(state.overallResult === "PASS");
      toast.success(`${state.overallResult} — ${state.asset?.testTagId}`);
      dispatch({
        type: "RECORD_SAVED",
        entry: {
          testTagId: state.asset!.testTagId,
          description: state.asset!.description,
          result: state.overallResult,
          testDate: new Date(),
        },
      });
      queryClient.invalidateQueries({ queryKey: ["testTagAssets"] });
      queryClient.invalidateQueries({ queryKey: ["testTagDashboard"] });
    },
    onError: (e) => {
      if (audioEnabled) playBeep(false);
      toast.error(e.message);
      dispatch({ type: "SET_SAVING", isSaving: false });
    },
  });

  const handleSave = () => {
    dispatch({ type: "SET_SAVING", isSaving: true });
    saveMutation.mutate();
  };

  const handleSaveAndPrint = () => {
    dispatch({ type: "SET_SAVING", isSaving: true });
    saveMutation.mutate(undefined, {
      onSuccess: () => {
        // Open print dialog for label
        setTimeout(() => window.print(), 500);
      },
    });
  };

  const handleNextAfterSave = () => {
    dispatch({ type: "RESET_FOR_NEXT" });
  };

  return (
    <div className="flex flex-col lg:flex-row gap-6 min-h-[calc(100vh-120px)]">
      {/* Main wizard area */}
      <div className="flex-1 max-w-2xl mx-auto w-full">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Link href="/test-and-tag">
              <Button variant="ghost" size="sm">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <h1 className="text-lg font-semibold text-fg-1">Quick Test</h1>
          </div>
          <div className="flex items-center gap-2">
            {/* Session tester picker */}
            <Select
              value={state.sessionTesterId}
              onValueChange={(v) => {
                const member = memberList.find(m => m.user.id === v);
                if (member) {
                  dispatch({ type: "SET_SESSION_TESTER", id: member.user.id, name: member.user.name || member.user.email });
                }
              }}
            >
              <SelectTrigger className="w-48">
                <SelectValue>
                  {state.sessionTesterName || "Select tester..."}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {memberList.map((m) => (
                  <SelectItem key={m.user.id} value={m.user.id}>
                    {m.user.name || m.user.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Audio toggle */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setAudioEnabled(!audioEnabled)}
              className="h-9 w-9 p-0"
              title={audioEnabled ? "Disable audio" : "Enable audio"}
            >
              {audioEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
            </Button>
          </div>
        </div>

        {/* Step indicator — minimal tab style */}
        {state.asset && !state.isRetired && (
          <div className="flex gap-6 border-b mb-6" role="tablist">
            {visibleSteps.map((s) => (
              <button
                key={s.key}
                role="tab"
                aria-selected={state.step === s.key}
                className={`pb-2 text-sm font-medium border-b-2 transition-colors ${
                  state.step === s.key
                    ? "border-teal-500 text-teal-600"
                    : "border-transparent text-fg-3 hover:text-fg-2"
                }`}
                onClick={() => dispatch({ type: "GO_TO_STEP", step: s.key })}
              >
                {s.label}
              </button>
            ))}
          </div>
        )}

        {/* Step content */}
        <div>
          {state.step === "scan" && <ScanStep state={state} dispatch={dispatch} />}
          {state.step === "visual" && <VisualStep state={state} dispatch={dispatch} />}
          {state.step === "electrical" && <ElectricalStep state={state} dispatch={dispatch} />}
          {state.step === "subtests" && <SubTestStep state={state} dispatch={dispatch} />}
          {state.step === "result" && (
            <ResultStep
              state={state}
              dispatch={dispatch}
              onSave={() => {
                handleSave();
                // After save, reset for next
                setTimeout(handleNextAfterSave, 500);
              }}
              onSaveAndPrint={handleSaveAndPrint}
            />
          )}
        </div>
      </div>

      {/* Session log — desktop sidebar / tablet bottom bar */}
      {state.sessionLog.length > 0 && (
        <>
          {/* Desktop sidebar */}
          <div className="hidden lg:block w-72 border-l pl-6">
            <h3 className="text-sm font-medium text-fg-1 mb-3">Session Log</h3>
            <div className="space-y-2">
              {state.sessionLog.map((entry, i) => (
                <div key={i} className="flex items-center justify-between py-1.5">
                  <div>
                    <span className="font-mono text-sm text-fg-2">{entry.testTagId}</span>
                    <p className="text-xs text-fg-3 truncate max-w-[180px]">{entry.description}</p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className={`w-2 h-2 rounded-full ${entry.result === "PASS" ? "bg-teal-500" : "bg-red-500"}`} />
                    <span className={`text-xs ${entry.result === "PASS" ? "text-teal-600" : "text-red-600"}`}>
                      {entry.result}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Tablet/mobile bottom bar */}
          <div className="lg:hidden fixed bottom-0 left-0 right-0 bg-surface border-t p-3 z-10">
            <button
              className="flex items-center justify-between w-full"
              onClick={() => setSessionLogExpanded(!sessionLogExpanded)}
            >
              <span className="text-sm text-fg-2">
                Session: {state.sessionLog.length} tested · {state.sessionLog.filter(e => e.result === "PASS").length} pass · {state.sessionLog.filter(e => e.result === "FAIL").length} fail
              </span>
              {sessionLogExpanded ? <ChevronDown className="h-4 w-4 text-fg-3" /> : <ChevronUp className="h-4 w-4 text-fg-3" />}
            </button>
            {sessionLogExpanded && (
              <div className="mt-2 max-h-48 overflow-y-auto space-y-1">
                {state.sessionLog.map((entry, i) => (
                  <div key={i} className="flex items-center justify-between py-1">
                    <span className="font-mono text-xs text-fg-2">{entry.testTagId}</span>
                    <div className="flex items-center gap-1">
                      <div className={`w-2 h-2 rounded-full ${entry.result === "PASS" ? "bg-teal-500" : "bg-red-500"}`} />
                      <span className={`text-xs ${entry.result === "PASS" ? "text-teal-600" : "text-red-600"}`}>
                        {entry.result}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default function QuickTestPage() {
  return (
    <RequirePermission resource="testTag" action="create">
      <Suspense fallback={<div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-500" /></div>}>
        <QuickTestContent />
      </Suspense>
    </RequirePermission>
  );
}
