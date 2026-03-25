/**
 * AS/NZS 3760:2022 default test profiles.
 * Used by the seed action to populate a new org's profiles.
 */

export type VisualCheck = {
  key: string;
  label: string;
  enabled: boolean;
};

export type ElectricalTest = {
  key: string;
  label: string;
  threshold: number | null;
  operator: "lt" | "lte" | "gt" | "gte" | null; // lt = less than, gte = greater than or equal
  unit: string;
  enabled: boolean;
};

export type ProfileThresholds = {
  earthMax?: number;        // Ω — PASS if reading < this
  insulationMin?: number;   // MΩ — PASS if reading ≥ this
  leakageMax?: number;      // mA — PASS if reading ≤ this
  rcdTripTimeMax?: number;  // ms — PASS if reading ≤ this
  rcdTripCurrentMin?: number; // mA
  rcdTripCurrentMax?: number; // mA
  microwaveLeakageMax?: number; // mW/cm²
};

export type SeedProfile = {
  name: string;
  equipmentClass: "CLASS_I" | "CLASS_II" | "CLASS_II_DOUBLE_INSULATED" | "LEAD_CORD_ASSEMBLY";
  applianceType: "APPLIANCE" | "CORD_SET" | "EXTENSION_LEAD" | "POWER_BOARD" | "RCD_PORTABLE" | "RCD_FIXED" | "THREE_PHASE" | "MICROWAVE" | "OTHER";
  visualChecks: VisualCheck[];
  electricalTests: ElectricalTest[];
  thresholds: ProfileThresholds;
  requiresSubTests: boolean;
  defaultSubTestCount: number;
  subTestLabel: string;
};

// ─── Standard Visual Checks ─────────────────────────────────────────────────

const STANDARD_VISUAL_CHECKS: VisualCheck[] = [
  { key: "cordCondition", label: "Cord condition (no cuts, abrasion, or damage)", enabled: true },
  { key: "plugCondition", label: "Plug condition (pins straight, no damage)", enabled: true },
  { key: "housingCondition", label: "Housing/enclosure intact (no cracks or damage)", enabled: true },
  { key: "switchCondition", label: "Switches operate correctly", enabled: true },
  { key: "ventsUnobstructed", label: "Ventilation openings unobstructed", enabled: true },
  { key: "cordGrip", label: "Cord grip/strain relief secure", enabled: true },
  { key: "earthPin", label: "Earth pin present and correct length", enabled: true },
  { key: "markingsLegible", label: "Markings and labels legible", enabled: true },
  { key: "noModifications", label: "No unauthorised modifications", enabled: true },
];

const CLASS_II_VISUAL_CHECKS: VisualCheck[] = STANDARD_VISUAL_CHECKS.map(c =>
  c.key === "earthPin" ? { ...c, enabled: false } : c
);

// ─── Standard Electrical Tests ──────────────────────────────────────────────

const classIElectrical: ElectricalTest[] = [
  { key: "earthContinuity", label: "Earth Continuity", threshold: 1.0, operator: "lt", unit: "Ω", enabled: true },
  { key: "insulationResistance", label: "Insulation Resistance", threshold: 1.0, operator: "gte", unit: "MΩ", enabled: true },
  { key: "leakageCurrent", label: "Leakage Current", threshold: 5.0, operator: "lte", unit: "mA", enabled: false },
  { key: "polarity", label: "Polarity", threshold: null, operator: null, unit: "", enabled: false },
];

const classIWithPolarity: ElectricalTest[] = classIElectrical.map(t =>
  t.key === "polarity" ? { ...t, enabled: true } : t
);

const classIIElectrical: ElectricalTest[] = [
  { key: "earthContinuity", label: "Earth Continuity", threshold: null, operator: null, unit: "Ω", enabled: false },
  { key: "insulationResistance", label: "Insulation Resistance", threshold: 1.0, operator: "gte", unit: "MΩ", enabled: true },
  { key: "leakageCurrent", label: "Leakage Current", threshold: 5.0, operator: "lte", unit: "mA", enabled: false },
  { key: "polarity", label: "Polarity", threshold: null, operator: null, unit: "", enabled: false },
];

const classIIDIElectrical: ElectricalTest[] = [
  { key: "earthContinuity", label: "Earth Continuity", threshold: null, operator: null, unit: "Ω", enabled: false },
  { key: "insulationResistance", label: "Insulation Resistance", threshold: 2.0, operator: "gte", unit: "MΩ", enabled: true },
  { key: "leakageCurrent", label: "Leakage Current", threshold: 5.0, operator: "lte", unit: "mA", enabled: false },
  { key: "polarity", label: "Polarity", threshold: null, operator: null, unit: "", enabled: false },
];

const rcdTests: ElectricalTest[] = [
  { key: "rcdTripTime", label: "RCD Trip Time", threshold: 300, operator: "lte", unit: "ms", enabled: true },
  { key: "rcdTripCurrent", label: "RCD Trip Current", threshold: 30, operator: "lte", unit: "mA", enabled: true },
  { key: "rcdPushButton", label: "RCD Push-Button Test", threshold: null, operator: null, unit: "", enabled: true },
];

const microwaveTests: ElectricalTest[] = [
  ...classIElectrical.map(t =>
    t.key === "leakageCurrent" ? { ...t, enabled: true } : t
  ),
  { key: "microwaveLeakage", label: "Microwave Radiation Leakage", threshold: 5.0, operator: "lte", unit: "mW/cm²", enabled: true },
];

// ─── Seed Profiles ──────────────────────────────────────────────────────────

export const SEED_PROFILES: SeedProfile[] = [
  {
    name: "Class I Appliance",
    equipmentClass: "CLASS_I",
    applianceType: "APPLIANCE",
    visualChecks: STANDARD_VISUAL_CHECKS,
    electricalTests: classIElectrical,
    thresholds: { earthMax: 1.0, insulationMin: 1.0, leakageMax: 5.0 },
    requiresSubTests: false,
    defaultSubTestCount: 1,
    subTestLabel: "Outlet",
  },
  {
    name: "Class I Cord Set",
    equipmentClass: "CLASS_I",
    applianceType: "CORD_SET",
    visualChecks: STANDARD_VISUAL_CHECKS,
    electricalTests: classIWithPolarity,
    thresholds: { earthMax: 1.0, insulationMin: 1.0, leakageMax: 5.0 },
    requiresSubTests: false,
    defaultSubTestCount: 1,
    subTestLabel: "Outlet",
  },
  {
    name: "Class I Extension Lead",
    equipmentClass: "CLASS_I",
    applianceType: "EXTENSION_LEAD",
    visualChecks: STANDARD_VISUAL_CHECKS,
    electricalTests: classIWithPolarity,
    thresholds: { earthMax: 1.0, insulationMin: 1.0, leakageMax: 5.0 },
    requiresSubTests: false,
    defaultSubTestCount: 1,
    subTestLabel: "Outlet",
  },
  {
    name: "Class I Power Board",
    equipmentClass: "CLASS_I",
    applianceType: "POWER_BOARD",
    visualChecks: STANDARD_VISUAL_CHECKS,
    electricalTests: classIWithPolarity,
    thresholds: { earthMax: 1.0, insulationMin: 1.0, leakageMax: 5.0 },
    requiresSubTests: true,
    defaultSubTestCount: 4,
    subTestLabel: "Outlet",
  },
  {
    name: "Class II Appliance",
    equipmentClass: "CLASS_II",
    applianceType: "APPLIANCE",
    visualChecks: CLASS_II_VISUAL_CHECKS,
    electricalTests: classIIElectrical,
    thresholds: { insulationMin: 1.0, leakageMax: 5.0 },
    requiresSubTests: false,
    defaultSubTestCount: 1,
    subTestLabel: "Outlet",
  },
  {
    name: "Class II Double Insulated",
    equipmentClass: "CLASS_II_DOUBLE_INSULATED",
    applianceType: "APPLIANCE",
    visualChecks: CLASS_II_VISUAL_CHECKS,
    electricalTests: classIIDIElectrical,
    thresholds: { insulationMin: 2.0, leakageMax: 5.0 },
    requiresSubTests: false,
    defaultSubTestCount: 1,
    subTestLabel: "Outlet",
  },
  {
    name: "Lead / Cord Assembly",
    equipmentClass: "LEAD_CORD_ASSEMBLY",
    applianceType: "CORD_SET",
    visualChecks: STANDARD_VISUAL_CHECKS,
    electricalTests: classIWithPolarity,
    thresholds: { earthMax: 1.0, insulationMin: 1.0, leakageMax: 5.0 },
    requiresSubTests: false,
    defaultSubTestCount: 1,
    subTestLabel: "Outlet",
  },
  {
    name: "RCD Portable",
    equipmentClass: "CLASS_I",
    applianceType: "RCD_PORTABLE",
    visualChecks: STANDARD_VISUAL_CHECKS,
    electricalTests: [...classIElectrical, ...rcdTests],
    thresholds: { earthMax: 1.0, insulationMin: 1.0, leakageMax: 5.0, rcdTripTimeMax: 300, rcdTripCurrentMax: 30 },
    requiresSubTests: false,
    defaultSubTestCount: 1,
    subTestLabel: "Outlet",
  },
  {
    name: "RCD Fixed",
    equipmentClass: "CLASS_I",
    applianceType: "RCD_FIXED",
    visualChecks: STANDARD_VISUAL_CHECKS.map(c => ({ ...c, enabled: ["switchCondition", "markingsLegible", "noModifications"].includes(c.key) })),
    electricalTests: rcdTests,
    thresholds: { rcdTripTimeMax: 300, rcdTripCurrentMax: 30 },
    requiresSubTests: false,
    defaultSubTestCount: 1,
    subTestLabel: "Outlet",
  },
  {
    name: "RCD Power Board",
    equipmentClass: "CLASS_I",
    applianceType: "POWER_BOARD",
    visualChecks: STANDARD_VISUAL_CHECKS,
    electricalTests: [...classIWithPolarity, ...rcdTests],
    thresholds: { earthMax: 1.0, insulationMin: 1.0, leakageMax: 5.0, rcdTripTimeMax: 300, rcdTripCurrentMax: 30 },
    requiresSubTests: true,
    defaultSubTestCount: 4,
    subTestLabel: "Outlet",
  },
  {
    name: "Three-Phase Equipment",
    equipmentClass: "CLASS_I",
    applianceType: "THREE_PHASE",
    visualChecks: STANDARD_VISUAL_CHECKS,
    electricalTests: classIElectrical,
    thresholds: { earthMax: 1.0, insulationMin: 1.0, leakageMax: 5.0 },
    requiresSubTests: true,
    defaultSubTestCount: 3,
    subTestLabel: "Phase",
  },
  {
    name: "Microwave Oven",
    equipmentClass: "CLASS_I",
    applianceType: "MICROWAVE",
    visualChecks: STANDARD_VISUAL_CHECKS,
    electricalTests: microwaveTests,
    thresholds: { earthMax: 1.0, insulationMin: 1.0, leakageMax: 5.0, microwaveLeakageMax: 5.0 },
    requiresSubTests: false,
    defaultSubTestCount: 1,
    subTestLabel: "Outlet",
  },
];
