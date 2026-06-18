"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
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
          <h3 className="t-heading text-ink">Visual inspection</h3>
          <p className="text-ui-text text-muted">Check each item and confirm it passes</p>
        </div>
        <Button
          variant="line"
          size="sm"
          aria-pressed={allPassed}
          onClick={() => dispatch({ type: "PASS_ALL_VISUAL" })}
          className={allPassed ? "border-transparent text-ok bg-ok-soft hover:bg-ok-soft hover:text-ok" : ""}
        >
          <Check className="mr-2 h-4 w-4" />
          Pass all
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-1">
        {enabledChecks.map((check) => (
          <label
            key={check.key}
            className="flex items-center gap-3 p-3 rounded-[var(--r)] hover:bg-elev cursor-pointer min-h-11"
          >
            <Checkbox
              checked={!!state.visualChecks[check.key]}
              onCheckedChange={() => dispatch({ type: "TOGGLE_VISUAL_CHECK", key: check.key })}
            />
            <span className="text-ui-text text-ink-2">{check.label}</span>
          </label>
        ))}
      </div>

      <div className="space-y-2">
        <Label className="text-caption text-muted">Visual inspection notes (optional)</Label>
        <Textarea
          value={state.visualNotes}
          onChange={(e) => dispatch({ type: "SET_VISUAL_NOTES", value: e.target.value })}
          placeholder="Any observations..."
          className="min-h-[60px]"
        />
      </div>

      {/* Result indicator */}
      <div className="flex items-center gap-2">
        <div className={cn("w-2.5 h-2.5 rounded-full", state.visualResult === "PASS" ? "bg-ok" : "bg-t-out")} />
        <span className={cn("text-ui-text font-medium", state.visualResult === "PASS" ? "text-ok" : "text-t-out")}>
          Visual: {state.visualResult === "PASS" ? "Pass" : "Fail"}
        </span>
        <span className="text-caption text-muted ml-2 t-data">
          {Object.values(state.visualChecks).filter(Boolean).length}/{enabledChecks.length} passed
        </span>
      </div>

      <div className="flex justify-between pt-2">
        <Button variant="line" onClick={() => dispatch({ type: "PREV_STEP" })}>Back</Button>
        <Button onClick={() => dispatch({ type: "NEXT_STEP" })}>
          Next: electrical
        </Button>
      </div>
    </div>
  );
}
