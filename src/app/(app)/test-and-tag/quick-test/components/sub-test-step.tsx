"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { evaluateReading } from "@/lib/test-tag/calculate-result";
import type { WizardAction, WizardState } from "./wizard-reducer";

export function SubTestStep({
  state,
  dispatch,
}: {
  state: WizardState;
  dispatch: React.Dispatch<WizardAction>;
}) {
  const thresholds = state.profile?.thresholds || {};
  const enabledTests = (state.profile?.electricalTests || []).filter(t => t.enabled);
  const showEarth = enabledTests.some(t => t.key === "earthContinuity");
  const showInsulation = enabledTests.some(t => t.key === "insulationResistance");
  const showLeakage = enabledTests.some(t => t.key === "leakageCurrent");
  const subTestLabel = state.profile?.subTestLabel || "Outlet";

  // Auto-calculate sub-test results
  useEffect(() => {
    state.subTests.forEach((st, idx) => {
      let result: "PASS" | "FAIL" = "PASS";

      if (showEarth && st.earthContinuityReading !== null && thresholds.earthMax) {
        if (evaluateReading(st.earthContinuityReading, thresholds.earthMax, "lt") === "FAIL") result = "FAIL";
      }
      if (showInsulation && st.insulationReading !== null && thresholds.insulationMin) {
        if (evaluateReading(st.insulationReading, thresholds.insulationMin, "gte") === "FAIL") result = "FAIL";
      }
      if (showLeakage && st.leakageCurrentReading !== null && thresholds.leakageMax) {
        if (evaluateReading(st.leakageCurrentReading, thresholds.leakageMax, "lte") === "FAIL") result = "FAIL";
      }

      if (result !== st.result) {
        dispatch({ type: "UPDATE_SUBTEST", index: idx, data: { result } });
      }
    });
  }, [state.subTests.map(st => `${st.earthContinuityReading}-${st.insulationReading}-${st.leakageCurrentReading}`).join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  const passCount = state.subTests.filter(st => st.result === "PASS").length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="t-heading text-ink">Sub-tests</h3>
          <p className="text-ui-text text-muted">
            Test each {subTestLabel.toLowerCase()} individually
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Label className="text-caption text-muted">{subTestLabel}s:</Label>
          <div className="flex items-center gap-1">
            <Button
              variant="line"
              size="icon"
              aria-label={`Remove ${subTestLabel.toLowerCase()}`}
              onClick={() => dispatch({ type: "SET_OUTLET_COUNT", count: state.outletCount - 1 })}
              disabled={state.outletCount <= 1}
            >
              <Minus className="h-4 w-4" />
            </Button>
            <span className="w-8 text-center t-mono text-ui-text text-ink t-data">{state.outletCount}</span>
            <Button
              variant="line"
              size="icon"
              aria-label={`Add ${subTestLabel.toLowerCase()}`}
              onClick={() => dispatch({ type: "SET_OUTLET_COUNT", count: state.outletCount + 1 })}
              disabled={state.outletCount >= 50}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Sub-test rows — flat, separated by border */}
      <div className="rounded-[var(--r)] ring-1 ring-line divide-y divide-line">
        {state.subTests.map((st, idx) => (
          <div key={idx} className="flex items-center gap-4 px-4 py-3 min-h-12">
            <span className="text-ui-text font-medium text-ink-2 w-20 shrink-0">{st.label}</span>

            <div className="flex items-center gap-3 flex-wrap flex-1">
              {showEarth && (
                <div className="flex items-center gap-1">
                  <Label className="text-caption text-muted w-12">Earth:</Label>
                  <Input
                    type="number"
                    step="0.01"
                    inputMode="decimal"
                    className="w-20 h-10 text-center font-mono text-sm"
                    value={st.earthContinuityReading ?? ""}
                    onChange={(e) => {
                      const v = e.target.value === "" ? null : parseFloat(e.target.value);
                      dispatch({ type: "UPDATE_SUBTEST", index: idx, data: { earthContinuityReading: v } });
                    }}
                    placeholder="—"
                  />
                  <span className="text-caption text-muted">Ω</span>
                </div>
              )}

              {showInsulation && (
                <div className="flex items-center gap-1">
                  <Label className="text-caption text-muted w-12">Insul:</Label>
                  <Input
                    type="number"
                    step="0.01"
                    inputMode="decimal"
                    className="w-20 h-10 text-center font-mono text-sm"
                    value={st.insulationReading ?? ""}
                    onChange={(e) => {
                      const v = e.target.value === "" ? null : parseFloat(e.target.value);
                      dispatch({ type: "UPDATE_SUBTEST", index: idx, data: { insulationReading: v } });
                    }}
                    placeholder="—"
                  />
                  <span className="text-caption text-muted">MΩ</span>
                </div>
              )}

              {showLeakage && (
                <div className="flex items-center gap-1">
                  <Label className="text-caption text-muted w-14">Leakage:</Label>
                  <Input
                    type="number"
                    step="0.01"
                    inputMode="decimal"
                    className="w-20 h-10 text-center font-mono text-sm"
                    value={st.leakageCurrentReading ?? ""}
                    onChange={(e) => {
                      const v = e.target.value === "" ? null : parseFloat(e.target.value);
                      dispatch({ type: "UPDATE_SUBTEST", index: idx, data: { leakageCurrentReading: v } });
                    }}
                    placeholder="—"
                  />
                  <span className="text-caption text-muted">mA</span>
                </div>
              )}
            </div>

            {/* Result dot */}
            <div className="flex items-center gap-1 shrink-0">
              <div className={cn("w-2.5 h-2.5 rounded-full", st.result === "PASS" ? "bg-ok" : "bg-t-out")} />
              <span className={cn("text-caption font-medium", st.result === "PASS" ? "text-ok" : "text-t-out")}>
                {st.result === "PASS" ? "Pass" : "Fail"}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Add button */}
      <Button
        variant="ghost"
        size="sm"
        onClick={() => dispatch({ type: "ADD_SUBTEST" })}
      >
        <Plus className="mr-2 h-4 w-4" />
        Add {subTestLabel.toLowerCase()}
      </Button>

      {/* Summary */}
      <div className="flex items-center gap-2">
        <span className={cn("text-ui-text font-medium t-data", passCount === state.subTests.length ? "text-ok" : "text-t-out")}>
          {passCount}/{state.subTests.length} pass
        </span>
      </div>

      <div className="flex justify-between pt-2">
        <Button variant="line" onClick={() => dispatch({ type: "PREV_STEP" })}>Back</Button>
        <Button onClick={() => dispatch({ type: "NEXT_STEP" })}>
          Next: result
        </Button>
      </div>
    </div>
  );
}
