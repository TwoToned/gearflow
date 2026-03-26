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
  DialogFooter,
} from "@/components/ui/dialog";
import { Loader2, Printer, ArrowRight, Wrench, XCircle, Archive } from "lucide-react";
import { calculateOverallResult } from "@/lib/test-tag/calculate-result";
import type { WizardAction, WizardState } from "./wizard-reducer";

const FAILURE_ACTIONS = [
  { value: "NONE", label: "No action" },
  { value: "REPAIRED", label: "Repaired" },
  { value: "REMOVED_FROM_SERVICE", label: "Removed from service" },
  { value: "DISPOSED", label: "Disposed / Retired" },
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
        <h3 className="font-medium text-fg-1">Test Result</h3>
        <p className="text-sm text-fg-3">Review the overall result and save</p>
      </div>

      {/* Overall result pill */}
      <div
        className={`rounded-lg p-6 text-center ${
          state.overallResult === "PASS"
            ? "bg-teal-500/8 border border-teal-200"
            : "bg-red-500/8 border border-red-200"
        }`}
        role="alert"
      >
        <span className={`text-3xl font-bold ${
          state.overallResult === "PASS" ? "text-teal-600" : "text-red-600"
        }`}>
          {state.overallResult}
        </span>
      </div>

      {/* Breakdown */}
      <div className="space-y-2 border rounded-lg p-4">
        <div className="flex items-center gap-2">
          <div className={`w-2.5 h-2.5 rounded-full ${state.visualResult === "PASS" ? "bg-teal-500" : "bg-red-500"}`} />
          <span className="text-sm text-fg-2">Visual Inspection: <strong>{state.visualResult}</strong></span>
        </div>
        <div className="flex items-center gap-2">
          <div className={`w-2.5 h-2.5 rounded-full ${state.electricalResult === "PASS" ? "bg-teal-500" : "bg-red-500"}`} />
          <span className="text-sm text-fg-2">Electrical Tests: <strong>{state.electricalResult}</strong></span>
        </div>
        {state.subTests.length > 0 && (
          <div className="flex items-center gap-2">
            <div className={`w-2.5 h-2.5 rounded-full ${
              state.subTests.every(st => st.result === "PASS") ? "bg-teal-500" : "bg-red-500"
            }`} />
            <span className="text-sm text-fg-2">
              Sub-Tests: <strong>{state.subTests.filter(st => st.result === "PASS").length}/{state.subTests.length} PASS</strong>
            </span>
          </div>
        )}
      </div>

      {/* Failure details */}
      {state.overallResult === "FAIL" && (
        <div className="space-y-3 border border-red-200 rounded-lg p-4 bg-red-50/50">
          <div className="space-y-2">
            <Label className="text-sm font-medium text-red-700">Failure Action</Label>
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
            <Label className="text-sm font-medium text-red-700">Failure Notes</Label>
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
        <Label className="text-xs text-fg-3">Next Test Due Date</Label>
        <Input
          type="date"
          value={state.nextDueDate}
          onChange={(e) => dispatch({ type: "SET_NEXT_DUE_DATE", date: e.target.value })}
          className="w-48"
        />
      </div>

      {/* Actions */}
      <div className="flex justify-between pt-4">
        <Button variant="outline" onClick={() => dispatch({ type: "PREV_STEP" })}>Back</Button>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={onSave}
            disabled={state.isSaving}
          >
            {state.isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            <ArrowRight className="mr-2 h-4 w-4" />
            Save & Next
          </Button>
          <Button
            onClick={onSaveAndPrint}
            disabled={state.isSaving}
          >
            {state.isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            <Printer className="mr-2 h-4 w-4" />
            Save & Print Label
          </Button>
        </div>
      </div>

      {/* Fail workflow dialog */}
      <Dialog open={showFailDialog} onOpenChange={setShowFailDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-red-600">Test Failed — What would you like to do?</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-4">
            <Button
              variant="outline"
              className="w-full justify-start h-12"
              onClick={() => {
                dispatch({ type: "SET_FAILURE_ACTION", action: "REFERRED_TO_ELECTRICIAN" });
                setShowFailDialog(false);
              }}
            >
              <Wrench className="mr-3 h-5 w-5 text-amber-500" />
              Create Maintenance Record
            </Button>
            <Button
              variant="outline"
              className="w-full justify-start h-12"
              onClick={() => {
                dispatch({ type: "SET_FAILURE_ACTION", action: "REMOVED_FROM_SERVICE" });
                setShowFailDialog(false);
              }}
            >
              <XCircle className="mr-3 h-5 w-5 text-red-500" />
              Mark Out of Service
            </Button>
            <Button
              variant="outline"
              className="w-full justify-start h-12"
              onClick={() => {
                dispatch({ type: "SET_FAILURE_ACTION", action: "DISPOSED" });
                setShowFailDialog(false);
              }}
            >
              <Archive className="mr-3 h-5 w-5 text-fg-3" />
              Retire Asset
            </Button>
            <Button
              variant="ghost"
              className="w-full justify-start h-12 text-fg-3"
              onClick={() => {
                setShowFailDialog(false);
              }}
            >
              Save Without Action
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
