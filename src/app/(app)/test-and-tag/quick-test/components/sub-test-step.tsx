"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Minus } from "lucide-react";
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
          <h3 className="font-medium text-fg-1">Sub-Tests</h3>
          <p className="text-sm text-fg-3">
            Test each {subTestLabel.toLowerCase()} individually
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Label className="text-xs text-fg-3">{subTestLabel}s:</Label>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={() => dispatch({ type: "SET_OUTLET_COUNT", count: state.outletCount - 1 })}
              disabled={state.outletCount <= 1}
            >
              <Minus className="h-4 w-4" />
            </Button>
            <span className="w-8 text-center font-mono text-sm">{state.outletCount}</span>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={() => dispatch({ type: "SET_OUTLET_COUNT", count: state.outletCount + 1 })}
              disabled={state.outletCount >= 50}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Sub-test rows — flat, separated by border */}
      <div className="border rounded-lg divide-y">
        {state.subTests.map((st, idx) => (
          <div key={idx} className="flex items-center gap-4 px-4 py-3 min-h-[48px]">
            <span className="text-sm font-medium text-fg-2 w-20 shrink-0">{st.label}</span>

            <div className="flex items-center gap-3 flex-wrap flex-1">
              {showEarth && (
                <div className="flex items-center gap-1">
                  <Label className="text-xs text-fg-3 w-12">Earth:</Label>
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
                  <span className="text-xs text-fg-3">Ω</span>
                </div>
              )}

              {showInsulation && (
                <div className="flex items-center gap-1">
                  <Label className="text-xs text-fg-3 w-12">Insul:</Label>
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
                  <span className="text-xs text-fg-3">MΩ</span>
                </div>
              )}

              {showLeakage && (
                <div className="flex items-center gap-1">
                  <Label className="text-xs text-fg-3 w-14">Leakage:</Label>
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
                  <span className="text-xs text-fg-3">mA</span>
                </div>
              )}
            </div>

            {/* Result dot */}
            <div className="flex items-center gap-1 shrink-0">
              <div className={`w-2.5 h-2.5 rounded-full ${st.result === "PASS" ? "bg-teal-500" : "bg-red-500"}`} />
              <span className={`text-xs font-medium ${st.result === "PASS" ? "text-teal-600" : "text-red-600"}`}>
                {st.result}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Add button */}
      <Button
        variant="ghost"
        size="sm"
        className="text-fg-3 hover:text-fg-2"
        onClick={() => dispatch({ type: "ADD_SUBTEST" })}
      >
        <Plus className="mr-2 h-4 w-4" />
        Add {subTestLabel}
      </Button>

      {/* Summary */}
      <div className="flex items-center gap-2">
        <span className={`text-sm font-medium ${passCount === state.subTests.length ? "text-teal-600" : "text-red-600"}`}>
          {passCount}/{state.subTests.length} PASS
        </span>
      </div>

      <div className="flex justify-between pt-2">
        <Button variant="outline" onClick={() => dispatch({ type: "PREV_STEP" })}>Back</Button>
        <Button onClick={() => dispatch({ type: "NEXT_STEP" })}>
          Next: Result
        </Button>
      </div>
    </div>
  );
}
