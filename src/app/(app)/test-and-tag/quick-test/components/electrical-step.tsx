"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { evaluateReading } from "@/lib/test-tag/calculate-result";
import type { ElectricalTest } from "@/lib/test-profiles/seed-data";
import type { WizardAction, WizardState } from "./wizard-reducer";

const READING_KEYS: Record<string, keyof WizardState> = {
  earthContinuity: "earthContinuityReading",
  insulationResistance: "insulationReading",
  leakageCurrent: "leakageCurrentReading",
  rcdTripTime: "rcdTripTimeReading",
  rcdTripCurrent: "rcdTripCurrentReading",
  microwaveLeakage: "microwaveLeakageReading",
};

const PASS_FAIL_LABELS: Record<string, string> = {
  PASS: "Pass",
  FAIL: "Fail",
  NOT_APPLICABLE: "N/A",
};

export function ElectricalStep({
  state,
  dispatch,
}: {
  state: WizardState;
  dispatch: React.Dispatch<WizardAction>;
}) {
  const enabledTests = (state.profile?.electricalTests || []).filter(t => t.enabled);
  const thresholds = state.profile?.thresholds || {};

  // Auto-calculate electrical result
  useEffect(() => {
    let result: "PASS" | "FAIL" = "PASS";

    for (const test of enabledTests) {
      if (test.key === "polarity") {
        if (state.polarityResult === "FAIL") { result = "FAIL"; break; }
        continue;
      }
      if (test.key === "rcdPushButton") {
        if (state.rcdPushButtonResult === "FAIL") { result = "FAIL"; break; }
        continue;
      }

      const readingKey = READING_KEYS[test.key];
      const value = readingKey ? (state[readingKey] as number | null) : null;
      if (value !== null && test.threshold !== null && test.operator) {
        const testResult = evaluateReading(value, test.threshold, test.operator);
        if (testResult === "FAIL") { result = "FAIL"; break; }
      }
    }

    if (result !== state.electricalResult) {
      dispatch({ type: "SET_ELECTRICAL_RESULT", result });
    }
  }, [
    state.earthContinuityReading, state.insulationReading,
    state.leakageCurrentReading, state.rcdTripTimeReading,
    state.rcdTripCurrentReading, state.microwaveLeakageReading,
    state.polarityResult, state.rcdPushButtonResult,
  ]); // eslint-disable-line react-hooks/exhaustive-deps

  const getReadingValue = (test: ElectricalTest): number | null => {
    const key = READING_KEYS[test.key];
    return key ? (state[key] as number | null) : null;
  };

  const getReadingResult = (test: ElectricalTest): "PASS" | "FAIL" | "NOT_APPLICABLE" => {
    if (test.key === "polarity") return state.polarityResult;
    if (test.key === "rcdPushButton") return state.rcdPushButtonResult;
    const value = getReadingValue(test);
    if (value === null || test.threshold === null || !test.operator) return "NOT_APPLICABLE";
    return evaluateReading(value, test.threshold, test.operator);
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="font-medium text-fg-1">Electrical Tests</h3>
        <p className="text-sm text-fg-3">Enter readings for each test. Pass/fail is calculated automatically.</p>
      </div>

      {/* Test method selector */}
      <div className="space-y-2">
        <Label className="text-xs text-fg-3">Test Method</Label>
        <Select value={state.testMethod} onValueChange={(v) => dispatch({ type: "SET_TEST_METHOD", method: v as WizardState["testMethod"] })}>
          <SelectTrigger className="w-64">
            <SelectValue>
              {state.testMethod === "INSULATION_RESISTANCE" ? "Insulation Resistance" :
               state.testMethod === "LEAKAGE_CURRENT" ? "Leakage Current" : "Both"}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="INSULATION_RESISTANCE">Insulation Resistance</SelectItem>
            <SelectItem value="LEAKAGE_CURRENT">Leakage Current</SelectItem>
            <SelectItem value="BOTH">Both</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-3">
        {enabledTests.map((test) => {
          // Polarity and RCD push-button are manual pass/fail selectors
          if (test.key === "polarity") {
            return (
              <div key={test.key} className="flex items-center gap-4 py-2 border-b border-border last:border-0 min-h-[48px]">
                <span className="text-sm text-fg-2 w-48">{test.label}</span>
                <Select
                  value={state.polarityResult}
                  onValueChange={(v) => dispatch({ type: "SET_POLARITY_RESULT", result: v as "PASS" | "FAIL" | "NOT_APPLICABLE" })}
                >
                  <SelectTrigger className="w-32 h-12">
                    <SelectValue>{PASS_FAIL_LABELS[state.polarityResult]}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PASS">Pass</SelectItem>
                    <SelectItem value="FAIL">Fail</SelectItem>
                    <SelectItem value="NOT_APPLICABLE">N/A</SelectItem>
                  </SelectContent>
                </Select>
                <ResultDot result={state.polarityResult} />
              </div>
            );
          }

          if (test.key === "rcdPushButton") {
            return (
              <div key={test.key} className="flex items-center gap-4 py-2 border-b border-border last:border-0 min-h-[48px]">
                <span className="text-sm text-fg-2 w-48">{test.label}</span>
                <Select
                  value={state.rcdPushButtonResult}
                  onValueChange={(v) => dispatch({ type: "SET_RCD_PUSH_BUTTON", result: v as "PASS" | "FAIL" | "NOT_APPLICABLE" })}
                >
                  <SelectTrigger className="w-32 h-12">
                    <SelectValue>{PASS_FAIL_LABELS[state.rcdPushButtonResult]}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PASS">Pass</SelectItem>
                    <SelectItem value="FAIL">Fail</SelectItem>
                    <SelectItem value="NOT_APPLICABLE">N/A</SelectItem>
                  </SelectContent>
                </Select>
                <ResultDot result={state.rcdPushButtonResult} />
              </div>
            );
          }

          // Numeric reading tests
          const value = getReadingValue(test);
          const result = getReadingResult(test);

          return (
            <div key={test.key} className="flex items-center gap-4 py-2 border-b border-border last:border-0 min-h-[48px]">
              <span className="text-sm text-fg-2 w-48">{test.label}</span>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  step="0.01"
                  inputMode="decimal"
                  className="w-28 h-12 text-center font-mono"
                  value={value ?? ""}
                  onChange={(e) => {
                    const v = e.target.value === "" ? null : parseFloat(e.target.value);
                    dispatch({ type: "SET_ELECTRICAL_READING", key: test.key, value: v });
                  }}
                  placeholder="—"
                />
                <span className="text-xs text-fg-3 w-16">{test.unit}</span>
              </div>
              {test.threshold !== null && (
                <span className="text-xs text-fg-3">
                  {test.operator === "lt" && "<"}{test.operator === "lte" && "≤"}{test.operator === "gte" && "≥"}{test.operator === "gt" && ">"}{" "}
                  {test.threshold} {test.unit}
                </span>
              )}
              <ResultDot result={result} />
            </div>
          );
        })}
      </div>

      {/* Result indicator */}
      <div className="flex items-center gap-2">
        <div className={`w-2.5 h-2.5 rounded-full ${state.electricalResult === "PASS" ? "bg-teal-500" : "bg-red-500"}`} />
        <span className={`text-sm font-medium ${state.electricalResult === "PASS" ? "text-teal-600" : "text-red-600"}`}>
          Electrical: {state.electricalResult}
        </span>
      </div>

      <div className="flex justify-between pt-2">
        <Button variant="outline" onClick={() => dispatch({ type: "PREV_STEP" })}>Back</Button>
        <Button onClick={() => dispatch({ type: "NEXT_STEP" })}>
          Next: {state.profile?.requiresSubTests ? "Sub-Tests" : "Result"}
        </Button>
      </div>
    </div>
  );
}

function ResultDot({ result }: { result: "PASS" | "FAIL" | "NOT_APPLICABLE" }) {
  if (result === "NOT_APPLICABLE") return <div className="w-2.5 h-2.5 rounded-full bg-gray-300" />;
  return (
    <div className="flex items-center gap-1">
      <div className={`w-2.5 h-2.5 rounded-full ${result === "PASS" ? "bg-teal-500" : "bg-red-500"}`} />
      <span className={`text-xs ${result === "PASS" ? "text-teal-600" : "text-red-600"}`} aria-label={`${result}`}>
        {result}
      </span>
    </div>
  );
}
