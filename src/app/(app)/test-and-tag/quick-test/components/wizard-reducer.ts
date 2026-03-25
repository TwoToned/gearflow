import type { VisualCheck, ElectricalTest, ProfileThresholds } from "@/lib/test-profiles/seed-data";

// ─── Types ──────────────────────────────────────────────────────────────────

export type WizardStep = "scan" | "visual" | "electrical" | "subtests" | "result";

export type SubTestState = {
  label: string;
  sortOrder: number;
  earthContinuityReading: number | null;
  insulationReading: number | null;
  leakageCurrentReading: number | null;
  polarityResult: "PASS" | "FAIL" | "NOT_APPLICABLE";
  result: "PASS" | "FAIL";
  notes: string;
};

export type TestTagAssetInfo = {
  id: string;
  testTagId: string;
  description: string;
  equipmentClass: string;
  applianceType: string;
  status: string;
  testIntervalMonths: number;
  make?: string | null;
  modelName?: string | null;
  serialNumber?: string | null;
  location?: string | null;
  outletCount?: number | null;
  testProfileId?: string | null;
  lastTestDate?: string | null;
  nextDueDate?: string | null;
};

export type ProfileInfo = {
  id: string;
  name: string;
  equipmentClass: string;
  applianceType: string;
  visualChecks: VisualCheck[];
  electricalTests: ElectricalTest[];
  thresholds: ProfileThresholds;
  requiresSubTests: boolean;
  defaultSubTestCount: number;
  subTestLabel: string;
};

export type SessionLogEntry = {
  testTagId: string;
  description: string;
  result: "PASS" | "FAIL";
  testDate: Date;
};

export type WizardState = {
  step: WizardStep;
  scanInput: string;
  asset: TestTagAssetInfo | null;
  profile: ProfileInfo | null;
  isRetired: boolean;

  // Session
  sessionTesterId: string;
  sessionTesterName: string;

  // Visual
  visualChecks: Record<string, boolean>;
  visualNotes: string;
  visualResult: "PASS" | "FAIL";

  // Electrical
  earthContinuityReading: number | null;
  insulationReading: number | null;
  insulationTestVoltage: number | null;
  leakageCurrentReading: number | null;
  polarityResult: "PASS" | "FAIL" | "NOT_APPLICABLE";
  rcdTripTimeReading: number | null;
  rcdTripCurrentReading: number | null;
  rcdPushButtonResult: "PASS" | "FAIL" | "NOT_APPLICABLE";
  microwaveLeakageReading: number | null;
  testMethod: "INSULATION_RESISTANCE" | "LEAKAGE_CURRENT" | "BOTH";
  electricalResult: "PASS" | "FAIL";

  // Sub-tests
  subTests: SubTestState[];
  outletCount: number;

  // Result
  overallResult: "PASS" | "FAIL";
  failureAction: string;
  failureNotes: string;
  nextDueDate: string;

  // Session log
  sessionLog: SessionLogEntry[];
  isSaving: boolean;
  isQuickPass: boolean;
};

// ─── Actions ────────────────────────────────────────────────────────────────

export type WizardAction =
  | { type: "SET_SCAN_INPUT"; value: string }
  | { type: "SET_ASSET"; asset: TestTagAssetInfo; profile: ProfileInfo | null }
  | { type: "SET_RETIRED"; isRetired: boolean }
  | { type: "SET_PROFILE"; profile: ProfileInfo }
  | { type: "SET_SESSION_TESTER"; id: string; name: string }
  | { type: "GO_TO_STEP"; step: WizardStep }
  | { type: "NEXT_STEP" }
  | { type: "PREV_STEP" }
  | { type: "TOGGLE_VISUAL_CHECK"; key: string }
  | { type: "PASS_ALL_VISUAL" }
  | { type: "SET_VISUAL_NOTES"; value: string }
  | { type: "SET_VISUAL_RESULT"; result: "PASS" | "FAIL" }
  | { type: "SET_ELECTRICAL_READING"; key: string; value: number | null }
  | { type: "SET_POLARITY_RESULT"; result: "PASS" | "FAIL" | "NOT_APPLICABLE" }
  | { type: "SET_RCD_PUSH_BUTTON"; result: "PASS" | "FAIL" | "NOT_APPLICABLE" }
  | { type: "SET_TEST_METHOD"; method: "INSULATION_RESISTANCE" | "LEAKAGE_CURRENT" | "BOTH" }
  | { type: "SET_ELECTRICAL_RESULT"; result: "PASS" | "FAIL" }
  | { type: "SET_OUTLET_COUNT"; count: number }
  | { type: "UPDATE_SUBTEST"; index: number; data: Partial<SubTestState> }
  | { type: "ADD_SUBTEST" }
  | { type: "REMOVE_SUBTEST"; index: number }
  | { type: "SET_OVERALL_RESULT"; result: "PASS" | "FAIL" }
  | { type: "SET_FAILURE_ACTION"; action: string }
  | { type: "SET_FAILURE_NOTES"; notes: string }
  | { type: "SET_NEXT_DUE_DATE"; date: string }
  | { type: "SET_SAVING"; isSaving: boolean }
  | { type: "QUICK_PASS"; previousRecord: Record<string, unknown> }
  | { type: "RECORD_SAVED"; entry: SessionLogEntry }
  | { type: "RESET_FOR_NEXT" };

// ─── Step Ordering ──────────────────────────────────────────────────────────

function getSteps(profile: ProfileInfo | null): WizardStep[] {
  const steps: WizardStep[] = ["scan", "visual", "electrical"];
  if (profile?.requiresSubTests) steps.push("subtests");
  steps.push("result");
  return steps;
}

function nextStep(current: WizardStep, profile: ProfileInfo | null): WizardStep {
  const steps = getSteps(profile);
  const idx = steps.indexOf(current);
  return idx < steps.length - 1 ? steps[idx + 1] : current;
}

function prevStep(current: WizardStep, profile: ProfileInfo | null): WizardStep {
  const steps = getSteps(profile);
  const idx = steps.indexOf(current);
  return idx > 0 ? steps[idx - 1] : current;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function createSubTests(count: number, label: string): SubTestState[] {
  return Array.from({ length: count }, (_, i) => ({
    label: label === "Phase"
      ? ["L1-L2", "L2-L3", "L1-L3"][i] || `Phase ${i + 1}`
      : `${label} ${i + 1}`,
    sortOrder: i,
    earthContinuityReading: null,
    insulationReading: null,
    leakageCurrentReading: null,
    polarityResult: "NOT_APPLICABLE" as const,
    result: "PASS" as const,
    notes: "",
  }));
}

function calculateNextDueDate(intervalMonths: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() + intervalMonths);
  return d.toISOString().split("T")[0];
}

// ─── Initial State ──────────────────────────────────────────────────────────

export const initialWizardState: WizardState = {
  step: "scan",
  scanInput: "",
  asset: null,
  profile: null,
  isRetired: false,
  sessionTesterId: "",
  sessionTesterName: "",
  visualChecks: {},
  visualNotes: "",
  visualResult: "PASS",
  earthContinuityReading: null,
  insulationReading: null,
  insulationTestVoltage: null,
  leakageCurrentReading: null,
  polarityResult: "NOT_APPLICABLE",
  rcdTripTimeReading: null,
  rcdTripCurrentReading: null,
  rcdPushButtonResult: "NOT_APPLICABLE",
  microwaveLeakageReading: null,
  testMethod: "INSULATION_RESISTANCE",
  electricalResult: "PASS",
  subTests: [],
  outletCount: 1,
  overallResult: "PASS",
  failureAction: "NONE",
  failureNotes: "",
  nextDueDate: calculateNextDueDate(3),
  sessionLog: [],
  isSaving: false,
  isQuickPass: false,
};

// ─── Reducer ────────────────────────────────────────────────────────────────

export function wizardReducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case "SET_SCAN_INPUT":
      return { ...state, scanInput: action.value };

    case "SET_ASSET": {
      const profile = action.profile;
      const subTestCount = action.asset.outletCount || profile?.defaultSubTestCount || 1;
      const subTests = profile?.requiresSubTests
        ? createSubTests(subTestCount, profile.subTestLabel)
        : [];

      return {
        ...state,
        asset: action.asset,
        profile,
        isRetired: action.asset.status === "RETIRED",
        step: action.asset.status === "RETIRED" ? "scan" : "visual",
        outletCount: subTestCount,
        subTests,
        nextDueDate: calculateNextDueDate(action.asset.testIntervalMonths),
        visualChecks: {},
        visualNotes: "",
        visualResult: "PASS",
        earthContinuityReading: null,
        insulationReading: null,
        insulationTestVoltage: null,
        leakageCurrentReading: null,
        polarityResult: "NOT_APPLICABLE",
        rcdTripTimeReading: null,
        rcdTripCurrentReading: null,
        rcdPushButtonResult: "NOT_APPLICABLE",
        microwaveLeakageReading: null,
        electricalResult: "PASS",
        overallResult: "PASS",
        failureAction: "NONE",
        failureNotes: "",
        isQuickPass: false,
      };
    }

    case "SET_RETIRED":
      return { ...state, isRetired: action.isRetired };

    case "SET_PROFILE": {
      const profile = action.profile;
      const subTestCount = state.asset?.outletCount || profile.defaultSubTestCount;
      const subTests = profile.requiresSubTests
        ? createSubTests(subTestCount, profile.subTestLabel)
        : [];
      return { ...state, profile, subTests, outletCount: subTestCount };
    }

    case "SET_SESSION_TESTER":
      return { ...state, sessionTesterId: action.id, sessionTesterName: action.name };

    case "GO_TO_STEP":
      return { ...state, step: action.step };

    case "NEXT_STEP":
      return { ...state, step: nextStep(state.step, state.profile) };

    case "PREV_STEP":
      return { ...state, step: prevStep(state.step, state.profile) };

    case "TOGGLE_VISUAL_CHECK":
      return {
        ...state,
        visualChecks: {
          ...state.visualChecks,
          [action.key]: !state.visualChecks[action.key],
        },
      };

    case "PASS_ALL_VISUAL": {
      const enabledKeys = (state.profile?.visualChecks || [])
        .filter(c => c.enabled)
        .map(c => c.key);
      const all: Record<string, boolean> = {};
      for (const key of enabledKeys) all[key] = true;
      return { ...state, visualChecks: all, visualResult: "PASS" };
    }

    case "SET_VISUAL_NOTES":
      return { ...state, visualNotes: action.value };

    case "SET_VISUAL_RESULT":
      return { ...state, visualResult: action.result };

    case "SET_ELECTRICAL_READING": {
      const key = action.key;
      const mappings: Record<string, keyof WizardState> = {
        earthContinuity: "earthContinuityReading",
        insulationResistance: "insulationReading",
        leakageCurrent: "leakageCurrentReading",
        rcdTripTime: "rcdTripTimeReading",
        rcdTripCurrent: "rcdTripCurrentReading",
        microwaveLeakage: "microwaveLeakageReading",
        insulationTestVoltage: "insulationTestVoltage",
      };
      const stateKey = mappings[key];
      if (!stateKey) return state;
      return { ...state, [stateKey]: action.value };
    }

    case "SET_POLARITY_RESULT":
      return { ...state, polarityResult: action.result };

    case "SET_RCD_PUSH_BUTTON":
      return { ...state, rcdPushButtonResult: action.result };

    case "SET_TEST_METHOD":
      return { ...state, testMethod: action.method };

    case "SET_ELECTRICAL_RESULT":
      return { ...state, electricalResult: action.result };

    case "SET_OUTLET_COUNT": {
      const count = Math.max(1, Math.min(50, action.count));
      const label = state.profile?.subTestLabel || "Outlet";
      return {
        ...state,
        outletCount: count,
        subTests: createSubTests(count, label),
      };
    }

    case "UPDATE_SUBTEST":
      return {
        ...state,
        subTests: state.subTests.map((st, i) =>
          i === action.index ? { ...st, ...action.data } : st
        ),
      };

    case "ADD_SUBTEST": {
      const label = state.profile?.subTestLabel || "Outlet";
      const newIdx = state.subTests.length;
      return {
        ...state,
        outletCount: state.outletCount + 1,
        subTests: [
          ...state.subTests,
          {
            label: `${label} ${newIdx + 1}`,
            sortOrder: newIdx,
            earthContinuityReading: null,
            insulationReading: null,
            leakageCurrentReading: null,
            polarityResult: "NOT_APPLICABLE",
            result: "PASS",
            notes: "",
          },
        ],
      };
    }

    case "REMOVE_SUBTEST":
      return {
        ...state,
        outletCount: Math.max(1, state.outletCount - 1),
        subTests: state.subTests.filter((_, i) => i !== action.index),
      };

    case "SET_OVERALL_RESULT":
      return { ...state, overallResult: action.result };

    case "SET_FAILURE_ACTION":
      return { ...state, failureAction: action.action };

    case "SET_FAILURE_NOTES":
      return { ...state, failureNotes: action.notes };

    case "SET_NEXT_DUE_DATE":
      return { ...state, nextDueDate: action.date };

    case "SET_SAVING":
      return { ...state, isSaving: action.isSaving };

    case "QUICK_PASS":
      return { ...state, isQuickPass: true, step: "result" };

    case "RECORD_SAVED":
      return {
        ...state,
        sessionLog: [action.entry, ...state.sessionLog],
        isSaving: false,
      };

    case "RESET_FOR_NEXT":
      return {
        ...initialWizardState,
        sessionTesterId: state.sessionTesterId,
        sessionTesterName: state.sessionTesterName,
        sessionLog: state.sessionLog,
        step: "scan",
      };

    default:
      return state;
  }
}
