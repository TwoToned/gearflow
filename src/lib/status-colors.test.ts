import { describe, it, expect } from "vitest";
import {
  getStatusIntent,
  getStatusColor,
  intentStyles,
  type ColorIntent,
  type StatusCategory,
} from "./status-colors";

describe("status-colors", () => {
  // ─── getStatusIntent ───────────────────────────────────────────────

  describe("getStatusIntent", () => {
    it("returns correct intent for known asset statuses", () => {
      expect(getStatusIntent("asset", "AVAILABLE")).toBe("success");
      expect(getStatusIntent("asset", "CHECKED_OUT")).toBe("primary");
      expect(getStatusIntent("asset", "IN_MAINTENANCE")).toBe("warning");
      expect(getStatusIntent("asset", "RESERVED")).toBe("info");
      expect(getStatusIntent("asset", "RETIRED")).toBe("neutral");
      expect(getStatusIntent("asset", "LOST")).toBe("error");
    });

    it("returns correct intent for known project statuses", () => {
      expect(getStatusIntent("project", "CONFIRMED")).toBe("success");
      expect(getStatusIntent("project", "DRAFT")).toBe("neutral");
      expect(getStatusIntent("project", "CANCELLED")).toBe("error");
      expect(getStatusIntent("project", "CHECKED_OUT")).toBe("primary");
    });

    it("returns correct intent for maintenance statuses", () => {
      expect(getStatusIntent("maintenance", "COMPLETED")).toBe("success");
      // DESIGN §1: active work-in-progress reads as live red (primary).
      expect(getStatusIntent("maintenance", "IN_PROGRESS")).toBe("primary");
      expect(getStatusIntent("maintenance", "AWAITING_PARTS")).toBe("warning");
      expect(getStatusIntent("maintenance", "QA")).toBe("warning");
      expect(getStatusIntent("maintenance", "SCHEDULED")).toBe("info");
      expect(getStatusIntent("maintenance", "CANCELLED")).toBe("error");
      // Work-order result category (added with the maintenance polish).
      expect(getStatusIntent("maintenanceResult", "PASS")).toBe("success");
      expect(getStatusIntent("maintenanceResult", "FAIL")).toBe("error");
      expect(getStatusIntent("maintenanceResult", "CONDITIONAL")).toBe("warning");
    });

    it("returns 'neutral' for unknown status values", () => {
      expect(getStatusIntent("asset", "NONEXISTENT_STATUS")).toBe("neutral");
      expect(getStatusIntent("project", "MADE_UP")).toBe("neutral");
    });

    it("returns 'neutral' for unknown category", () => {
      // @ts-expect-error testing invalid category
      expect(getStatusIntent("invalidCategory", "AVAILABLE")).toBe("neutral");
    });

    it("covers all color intents across categories", () => {
      const allIntents = new Set<ColorIntent>();
      // Collect intents from various known statuses
      const testCases: [string, string][] = [
        ["asset", "AVAILABLE"],       // success
        ["asset", "IN_MAINTENANCE"],  // warning
        ["asset", "LOST"],            // error
        ["asset", "RESERVED"],        // info
        ["asset", "RETIRED"],         // neutral
        ["project", "CHECKED_OUT"],   // primary
      ];
      for (const [cat, val] of testCases) {
        allIntents.add(getStatusIntent(cat as StatusCategory, val));
      }
      expect(allIntents.size).toBe(6);
    });
  });

  // ─── getStatusColor ────────────────────────────────────────────────

  describe("getStatusColor", () => {
    it("returns full style object for a known status", () => {
      const styles = getStatusColor("asset", "AVAILABLE");
      expect(styles).toEqual(intentStyles.success);
      expect(styles.dot).toBe("bg-ok");
      expect(styles.text).toBe("text-ok");
      expect(styles.pill).toContain("bg-ok-soft");
      expect(styles.bg).toBe("bg-ok-soft");
    });

    it("returns neutral styles for unknown status", () => {
      const styles = getStatusColor("asset", "UNKNOWN_VALUE");
      expect(styles).toEqual(intentStyles.neutral);
    });

    it("returns correct styles for each intent type", () => {
      // success
      expect(getStatusColor("asset", "AVAILABLE").text).toBe("text-ok");
      // primary
      expect(getStatusColor("asset", "CHECKED_OUT").text).toBe("text-red");
      // error
      expect(getStatusColor("asset", "LOST").text).toBe("text-t-out");
      // warning
      expect(getStatusColor("asset", "IN_MAINTENANCE").text).toBe("text-warn");
      // info
      expect(getStatusColor("asset", "RESERVED").text).toBe("text-blue");
    });
  });

  // ─── intentStyles ──────────────────────────────────────────────────

  describe("intentStyles", () => {
    it("has all 6 intent keys", () => {
      const intents: ColorIntent[] = ["success", "warning", "error", "info", "neutral", "primary"];
      for (const intent of intents) {
        expect(intentStyles[intent]).toBeDefined();
        expect(intentStyles[intent].dot).toBeDefined();
        expect(intentStyles[intent].text).toBeDefined();
        expect(intentStyles[intent].pill).toBeDefined();
        expect(intentStyles[intent].bg).toBeDefined();
      }
    });

    it("all style values are non-empty strings", () => {
      for (const [, styles] of Object.entries(intentStyles)) {
        expect(styles.dot.length).toBeGreaterThan(0);
        expect(styles.text.length).toBeGreaterThan(0);
        expect(styles.pill.length).toBeGreaterThan(0);
        expect(styles.bg.length).toBeGreaterThan(0);
      }
    });
  });
});
