"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Check } from "lucide-react";
import { calculateVisualResult } from "@/lib/test-tag/calculate-result";
import type { WizardAction, WizardState } from "./wizard-reducer";

export function VisualStep({
  state,
  dispatch,
}: {
  state: WizardState;
  dispatch: React.Dispatch<WizardAction>;
}) {
  const enabledChecks = (state.profile?.visualChecks || []).filter(c => c.enabled);
  const allPassed = enabledChecks.every(c => state.visualChecks[c.key]);

  // Auto-calculate visual result
  useEffect(() => {
    const checks = enabledChecks.map(c => ({ key: c.key, passed: !!state.visualChecks[c.key] }));
    const enabledKeys = enabledChecks.map(c => c.key);
    const result = calculateVisualResult(checks, enabledKeys);
    if (result !== state.visualResult) {
      dispatch({ type: "SET_VISUAL_RESULT", result });
    }
  }, [state.visualChecks]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keyboard shortcut: Ctrl+Shift+P to pass all
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === "P") {
        e.preventDefault();
        dispatch({ type: "PASS_ALL_VISUAL" });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [dispatch]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-medium text-fg-1">Visual Inspection</h3>
          <p className="text-sm text-fg-3">Check each item and confirm it passes</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => dispatch({ type: "PASS_ALL_VISUAL" })}
          className={allPassed ? "border-teal-300 text-teal-700 bg-teal-50" : ""}
        >
          <Check className="mr-2 h-4 w-4" />
          Pass All
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-1">
        {enabledChecks.map((check) => (
          <label
            key={check.key}
            className="flex items-center gap-3 p-3 rounded-md hover:bg-surface-hover cursor-pointer min-h-[44px]"
          >
            <Checkbox
              checked={!!state.visualChecks[check.key]}
              onCheckedChange={() => dispatch({ type: "TOGGLE_VISUAL_CHECK", key: check.key })}
            />
            <span className="text-sm text-fg-2">{check.label}</span>
          </label>
        ))}
      </div>

      <div className="space-y-2">
        <Label className="text-xs text-fg-3">Visual Inspection Notes (optional)</Label>
        <Textarea
          value={state.visualNotes}
          onChange={(e) => dispatch({ type: "SET_VISUAL_NOTES", value: e.target.value })}
          placeholder="Any observations..."
          className="min-h-[60px]"
        />
      </div>

      {/* Result indicator */}
      <div className="flex items-center gap-2">
        <div className={`w-2.5 h-2.5 rounded-full ${state.visualResult === "PASS" ? "bg-teal-500" : "bg-red-500"}`} />
        <span className={`text-sm font-medium ${state.visualResult === "PASS" ? "text-teal-600" : "text-red-600"}`}>
          Visual: {state.visualResult}
        </span>
        <span className="text-xs text-fg-3 ml-2">
          {Object.values(state.visualChecks).filter(Boolean).length}/{enabledChecks.length} passed
        </span>
      </div>

      <div className="flex justify-between pt-2">
        <Button variant="outline" onClick={() => dispatch({ type: "PREV_STEP" })}>Back</Button>
        <Button onClick={() => dispatch({ type: "NEXT_STEP" })}>
          Next: Electrical
        </Button>
      </div>
    </div>
  );
}
