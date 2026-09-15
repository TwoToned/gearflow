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
    for (const status of ["QUOTED", "PREPPING", "CHECKED_OUT", "RETURNED"]) {
      expect(autoStatusToast(status)).not.toBeNull();
    }
  });

  test("nothing to announce reads as null, never a half-written toast", () => {
    expect(autoStatusToast(null)).toBeNull();
    expect(autoStatusToast(undefined)).toBeNull();
    expect(autoStatusToast("CONFIRMED")).toBeNull();
  });
});
