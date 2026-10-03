import { describe, test, expect } from "vitest";
import {
  AUTO_STATUS_KEYS,
  AUTO_STATUS_LABELS,
  autoStatusToast,
  isAutoStatusEnabled,
} from "./project-status-automation";

describe("isAutoStatusEnabled", () => {
  test("absent settings mean ON — a pre-#1160 org needs no backfill", () => {
    for (const key of AUTO_STATUS_KEYS) {
      expect(isAutoStatusEnabled(undefined, key)).toBe(true);
      expect(isAutoStatusEnabled({}, key)).toBe(true);
    }
  });

  test("only an explicit `false` disables, and only that one key", () => {
    expect(isAutoStatusEnabled({ quoteSent: false }, "quoteSent")).toBe(false);
    expect(isAutoStatusEnabled({ quoteSent: false }, "allReturned")).toBe(true);
    expect(isAutoStatusEnabled({ quoteSent: true }, "quoteSent")).toBe(true);
  });
});

describe("AUTO_STATUS_LABELS", () => {
  test("every key has copy — an unlabelled switch is an unshippable switch", () => {
    for (const key of AUTO_STATUS_KEYS) {
      expect(AUTO_STATUS_LABELS[key].title.length).toBeGreaterThan(0);
      expect(AUTO_STATUS_LABELS[key].moves.length).toBeGreaterThan(0);
      expect(AUTO_STATUS_LABELS[key].detail.length).toBeGreaterThan(0);
    }
  });
});

describe("autoStatusToast", () => {
  test("covers every status the rules can produce", () => {
    for (const status of ["QUOTED", "AWAITING_PAYMENT", "CONFIRMED", "PREPPING", "CHECKED_OUT", "RETURNED"]) {
      expect(autoStatusToast(status)).not.toBeNull();
    }
  });

  test("nothing to announce reads as null, never a half-written toast", () => {
    expect(autoStatusToast(null)).toBeNull();
    expect(autoStatusToast(undefined)).toBeNull();
    // A status no rule can produce — ENQUIRY is only ever a starting point.
    expect(autoStatusToast("ENQUIRY")).toBeNull();
  });
});

describe("rule/toast coverage", () => {
  // The rule table lives server-side (convex/lib/projectAutoStatus.ts) and can't
  // be imported here, but its four SETTING keys are mirrored in AUTO_STATUS_KEYS
  // and `convex/projectAutoStatus.test.ts` pins that. What this guards is the
  // other half: a rule whose target status has no toast copy would advance a job
  // silently, which is the one thing the whole feature exists to avoid.
  test("every status a rule can target has toast copy", () => {
    const TARGETS = ["QUOTED", "AWAITING_PAYMENT", "CONFIRMED", "PREPPING", "CHECKED_OUT", "RETURNED"];
    for (const status of TARGETS) {
      const copy = autoStatusToast(status);
      expect(copy).not.toBeNull();
      expect(copy!.title.length).toBeGreaterThan(0);
      expect(copy!.description.length).toBeGreaterThan(0);
    }
  });
});
