"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Printer, ArrowRight, Wrench, XCircle, Archive } from "lucide-react";
import { cn } from "@/lib/utils";
import { calculateOverallResult } from "@/lib/test-tag/calculate-result";
import type { WizardAction, WizardState } from "./wizard-reducer";

const FAILURE_ACTIONS = [
  { value: "NONE", label: "No action" },
  { value: "REPAIRED", label: "Repaired" },
  { value: "REMOVED_FROM_SERVICE", label: "Removed from service" },
  { value: "DISPOSED", label: "Disposed / retired" },
  { value: "REFERRED_TO_ELECTRICIAN", label: "Referred to electrician" },
];

export function ResultStep({
  state,
  dispatch,
  onSave,
  onSaveAndPrint,
}: {
  state: WizardState;
  dispatch: React.Dispatch<WizardAction>;
  onSave: () => void;
  onSaveAndPrint: () => void;
}) {
  const [showFailDialog, setShowFailDialog] = useState(false);

  // Auto-calculate overall result
  useEffect(() => {
    const subTestResults = state.subTests.map(st => st.result);
    const result = calculateOverallResult(state.visualResult, state.electricalResult, subTestResults);
    if (result !== state.overallResult) {
      dispatch({ type: "SET_OVERALL_RESULT", result });
    }
  }, [state.visualResult, state.electricalResult, state.subTests]); // eslint-disable-line react-hooks/exhaustive-deps

  // Show fail dialog when result changes to FAIL
  useEffect(() => {
    if (state.overallResult === "FAIL" && state.failureAction === "NONE") {
      setShowFailDialog(true);
    }
  }, [state.overallResult]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-6">
      <div>
        <h3 className="t-heading text-ink">Test result</h3>
        <p className="text-ui-text text-muted">Review the overall result and save</p>
      </div>

      {/* Overall result pill */}
      <div
        className={cn(
          "rounded-[var(--r)] p-6 text-center ring-1",
          state.overallResult === "PASS"
            ? "bg-ok-soft ring-ok/30"
            : "bg-out-soft ring-t-out/30",
        )}
        role="status"
      >
        <span className={cn(
          "t-display",
          state.overallResult === "PASS" ? "text-ok" : "text-t-out",
        )}>
          {state.overallResult === "PASS" ? "Pass" : "Fail"}
        </span>
      </div>

      {/* Breakdown */}
      <div className="space-y-2 ring-1 ring-line rounded-[var(--r)] p-4">
        <div className="flex items-center gap-2">
          <div className={cn("w-2.5 h-2.5 rounded-full", state.visualResult === "PASS" ? "bg-ok" : "bg-t-out")} />
          <span className="text-ui-text text-ink-2">Visual inspection: <strong className="text-ink">{state.visualResult === "PASS" ? "Pass" : "Fail"}</strong></span>
        </div>
        <div className="flex items-center gap-2">
          <div className={cn("w-2.5 h-2.5 rounded-full", state.electricalResult === "PASS" ? "bg-ok" : "bg-t-out")} />
          <span className="text-ui-text text-ink-2">Electrical tests: <strong className="text-ink">{state.electricalResult === "PASS" ? "Pass" : "Fail"}</strong></span>
        </div>
        {state.subTests.length > 0 && (
          <div className="flex items-center gap-2">
            <div className={cn("w-2.5 h-2.5 rounded-full",
              state.subTests.every(st => st.result === "PASS") ? "bg-ok" : "bg-t-out",
            )} />
            <span className="text-ui-text text-ink-2">
              Sub-tests: <strong className="text-ink t-data">{state.subTests.filter(st => st.result === "PASS").length}/{state.subTests.length} pass</strong>
            </span>
          </div>
        )}
      </div>

      {/* Failure details — left-edge alert notice, plain copy (§9 no personality) */}
      {state.overallResult === "FAIL" && (
        <div className="space-y-3 border-l-4 border-l-t-out bg-card ring-1 ring-line rounded-[var(--r)] p-4">
          <div className="space-y-2">
            <Label className="text-ui-text font-medium text-t-out">Failure action</Label>
            <Select value={state.failureAction} onValueChange={(v) => { if (v) dispatch({ type: "SET_FAILURE_ACTION", action: v }); }}>
              <SelectTrigger>
                <SelectValue>
                  {FAILURE_ACTIONS.find(a => a.value === state.failureAction)?.label || "Select action..."}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {FAILURE_ACTIONS.map(a => (
                  <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label className="text-ui-text font-medium text-t-out">Failure notes</Label>
            <Textarea
              value={state.failureNotes}
              onChange={(e) => dispatch({ type: "SET_FAILURE_NOTES", notes: e.target.value })}
              placeholder="Describe the failure..."
              className="min-h-[60px]"
            />
          </div>
        </div>
      )}

      {/* Next due date */}
      <div className="space-y-2">
        <Label className="text-caption text-muted">Next test due date</Label>
        <Input
          type="date"
          value={state.nextDueDate}
          onChange={(e) => dispatch({ type: "SET_NEXT_DUE_DATE", date: e.target.value })}
          className="w-48"
        />
      </div>

      {/* Actions */}
      <div className="flex justify-between pt-4">
        <Button variant="line" onClick={() => dispatch({ type: "PREV_STEP" })}>Back</Button>
        <div className="flex gap-2">
          <Button
            variant="line"
            onClick={onSave}
            loading={state.isSaving}
          >
            <ArrowRight className="mr-2 h-4 w-4" />
            Save & next
          </Button>
          <Button
            onClick={onSaveAndPrint}
            loading={state.isSaving}
          >
            <Printer className="mr-2 h-4 w-4" />
            Save & print label
          </Button>
        </div>
      </div>

      {/* Fail workflow dialog */}
      <Dialog open={showFailDialog} onOpenChange={setShowFailDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-t-out">Test failed — what would you like to do?</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-4">
            <Button
              variant="line"
              className="w-full justify-start h-12"
              onClick={() => {
                dispatch({ type: "SET_FAILURE_ACTION", action: "REFERRED_TO_ELECTRICIAN" });
                setShowFailDialog(false);
              }}
            >
              <Wrench className="mr-3 h-5 w-5 text-warn" />
              Create maintenance record
            </Button>
            <Button
              variant="line"
              className="w-full justify-start h-12"
              onClick={() => {
                dispatch({ type: "SET_FAILURE_ACTION", action: "REMOVED_FROM_SERVICE" });
                setShowFailDialog(false);
              }}
            >
              <XCircle className="mr-3 h-5 w-5 text-t-out" />
              Mark out of service
            </Button>
            <Button
              variant="line"
              className="w-full justify-start h-12"
              onClick={() => {
                dispatch({ type: "SET_FAILURE_ACTION", action: "DISPOSED" });
                setShowFailDialog(false);
              }}
            >
              <Archive className="mr-3 h-5 w-5 text-muted" />
              Retire asset
            </Button>
            <Button
              variant="ghost"
              className="w-full justify-start h-12"
              onClick={() => {
                setShowFailDialog(false);
              }}
            >
              Save without action
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
