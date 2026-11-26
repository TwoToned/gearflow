import { deriveTestTagState, DEFAULT_DUE_SOON_DAYS } from "../../convex/lib/testTagListState";
import type { ColorIntent } from "@/lib/status-colors";

/**
 * A Test & tag item's DERIVED words and checks (UX Phase 14, 14b-4, §9n.2): the header word (`18d overdue`, `Due in 5d`,
 * `Passed`, `Failed`), the Overview's `n of m checks clear`, and a test row's readings line. Nothing here is stored:
 * the state is THE list's own rule (`convex/lib/testTagListState.ts`), so the page and the list cannot disagree. A check
 * whose input has not arrived is `not checked`, never a pass. Pure: the page and the tests read it.
 */
const DAY_MS = 86_400_000;

export interface TestTagItemFacts {
  status?: string | null;
  isActive?: boolean | null;
  nextDueDate?: number | null;
  lastTestDate?: number | null;
  testProfileId?: string | null;
  /** The latest test's overall result, or `null` when it has never been tested. */
  lastResult?: string | null;
}

export interface TestTagWord {
  label: string;
  intent: ColorIntent;
  /** A retired item: an outline dot. */
  outline?: boolean;
  state: ReturnType<typeof deriveTestTagState>;
}

const days = (ms: number) => Math.max(1, Math.round(ms / DAY_MS));

/** The header word: the list's state plus how far overdue / how soon due. */
export function testTagStateWord(item: TestTagItemFacts, now: number, dueSoonDays: number = DEFAULT_DUE_SOON_DAYS): TestTagWord {
  const state = deriveTestTagState(item, now, dueSoonDays);
  const next = item.nextDueDate ?? null;
  switch (state) {
    case "RETIRED": return { state, label: "Retired", intent: "neutral", outline: true };
    case "FAILED": return { state, label: "Failed", intent: "error" };
    case "OVERDUE": return { state, label: next != null ? `${days(now - next)}d overdue` : "Overdue", intent: "error" };
    case "DUE":
      if (item.lastTestDate == null) return { state, label: "Not yet tested", intent: "warning" };
      return { state, label: next != null ? `Due in ${days(next - now)}d` : "Due", intent: "warning" };
    default: return { state, label: "Passed", intent: "success" };
  }
}

export type TestTagCheckFix = "test" | "edit";
export interface TestTagCheck {
  key: "current" | "result" | "profile";
  tone: "ok" | "warn" | "bad" | "unknown";
  text: string;
  fix?: TestTagCheckFix;
}
export interface TestTagChecks {
  items: TestTagCheck[];
  total: number;
  clear: number;
  /** A retired item runs no checks. */
  closed: boolean;
}

/** `n of m checks clear`: tested inside its interval, the last test passed, a test profile is set. */
export function testTagChecks(item: TestTagItemFacts, now: number, dueSoonDays: number = DEFAULT_DUE_SOON_DAYS): TestTagChecks {
  const word = testTagStateWord(item, now, dueSoonDays);
  if (word.state === "RETIRED") return { items: [], total: 0, clear: 0, closed: true };
  const tested = item.lastTestDate != null;
  const items: TestTagCheck[] = [
    word.state === "PASSED"
      ? { key: "current", tone: "ok", text: "Tested and within its interval" }
      : { key: "current", tone: "bad", text: tested ? `Test ${word.label.toLowerCase()}` : "Never tested", fix: "test" },
    !tested
      ? { key: "result", tone: "unknown", text: "Last test: not checked", fix: "test" }
      : item.lastResult === "FAIL" || word.state === "FAILED"
        ? { key: "result", tone: "bad", text: "The last test failed", fix: "test" }
        : { key: "result", tone: "ok", text: "The last test passed" },
    item.testProfileId
      ? { key: "profile", tone: "ok", text: "A test profile is set" }
      : { key: "profile", tone: "warn", text: "No test profile", fix: "edit" },
  ];
  return { items, total: items.length, clear: items.filter((c) => c.tone === "ok").length, closed: false };
}

/** The readings of one test record as short words (`Earth 0.12 Ω`), only the ones that were recorded. */
export function testReadingWords(r: Record<string, unknown>): string[] {
  const out: string[] = [];
  const add = (label: string, key: string, unit: string) => {
    const n = r[key];
    if (typeof n === "number") out.push(`${label} ${n} ${unit}`);
  };
  add("Earth", "earthContinuityReading", "Ω");
  add("Insulation", "insulationReading", "MΩ");
  add("Leakage", "leakageCurrentReading", "mA");
  add("RCD trip", "rcdTripTimeReading", "ms");
  add("RCD current", "rcdTripCurrentReading", "mA");
  add("Microwave", "microwaveLeakageReading", "mW/cm²");
  return out;
}
