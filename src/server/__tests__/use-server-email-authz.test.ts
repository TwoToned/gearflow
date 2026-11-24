// @vitest-environment node
//
// An exported function in a `"use server"` file is a server action: any
// browser session can call it with any arguments. One that SENDS email or push
// must therefore gate itself (`requirePermission` / `getOrgContext` / a site
// admin or token check) — or not be an action at all. UX Phase 15 moved the
// three ungated crew senders (`notifyPositionFilled`, `sendCrewOfferNudges`,
// `sendCrewCallTimeReminders`) and the ungated `buildAssignmentEmailData` to
// plain server-only modules under src/lib, which only server routes import.
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const SERVER = join(process.cwd(), "src/server");

/** Sends an email or a push, directly or through the crew email helpers. */
const SENDS = /\b(sendEmail|deliverSideEffectEmail|sendWebPush|sendPush\w*|notifyPositionFilled|buildAssignmentEmailData|sendCrewOfferNudges|sendCrewCallTimeReminders)\s*\(/;
/** Gates the caller before acting. */
const GATES = /\b(requirePermission|getOrgContext|requireOrganization|requireSiteAdmin|requireSession|getSession|assertSiteAdmin)\s*\(/;

/**
 * Pre-existing, NON-crew senders with no session gate: cron sweeps (the cron
 * routes check CRON_SECRET) and a token-bearer link. Logged as follow-ups in
 * PR #1402 — they want the same move to a plain module. A crew sender may
 * never be added here.
 */
const KNOWN_UNGATED = new Set([
  "notification-email-sender.ts:sendNotificationEmails",
  "notification-email-sender.ts:pruneStaleNotificationEmailLogs",
  "org-dormancy.ts:runOrgDormancySweep",
  "org-dormancy.ts:reactivateOrganizationByToken",
  "test-tag-reminders.ts:recalculateAllTestTagStatuses",
  "test-tag-reminders.ts:sendTestTagReminderDigests",
]);

/**
 * Every TOP-LEVEL function in a `"use server"` file, each with its own body
 * (from its declaration to the next top-level declaration), so a local helper
 * after an export is never read as part of it. Declarations recognised:
 * `[export] [async] function name(` and `[export] const name = [async] (`.
 */
function topLevelFunctions(text: string): { name: string; exported: boolean; body: string }[] {
  const decl = /^(export\s+)?(?:(?:async\s+)?function\s+(\w+)|const\s+(\w+)\s*=\s*(?:async\s*)?\()/gm;
  const starts = [...text.matchAll(decl)].map((m) => ({ index: m.index!, name: (m[2] ?? m[3])!, exported: !!m[1] }));
  return starts.map((s, i) => ({ ...s, body: text.slice(s.index, starts[i + 1]?.index ?? text.length) }));
}

/**
 * A module-local CALL GRAPH: a function sends if its own body does, or it calls
 * a local function that sends; it is gated if its own body gates, or it calls a
 * local function that gates. Limit (noted): a send or a gate reached through an
 * IMPORTED helper is seen only when that helper's name is in `SENDS` / `GATES`.
 */
function exportedActions(file: string): { name: string; body: string; sends: boolean; gated: boolean }[] {
  const text = readFileSync(join(SERVER, file), "utf8");
  if (!/^\s*["']use server["']/.test(text)) return [];
  const fns = topLevelFunctions(text);
  const names = new Set(fns.map((f) => f.name));
  const calls = new Map(fns.map((f) => [f.name, [...names].filter((n) => n !== f.name && new RegExp(`\\b${n}\\s*\\(`).test(f.body))]));
  const reach = (start: string, own: (name: string) => boolean): boolean => {
    const seen = new Set<string>();
    const stack = [start];
    while (stack.length) {
      const n = stack.pop()!;
      if (seen.has(n)) continue;
      seen.add(n);
      if (own(n)) return true;
      stack.push(...(calls.get(n) ?? []));
    }
    return false;
  };
  const bodyOf = new Map(fns.map((f) => [f.name, f.body]));
  return fns
    .filter((f) => f.exported)
    .map((f) => ({
      name: f.name,
      body: f.body,
      sends: reach(f.name, (n) => SENDS.test(bodyOf.get(n)!)),
      gated: reach(f.name, (n) => GATES.test(bodyOf.get(n)!)),
    }));
}

const files = readdirSync(SERVER).filter((f) => f.endsWith(".ts"));

describe("\"use server\" actions that send email or push are gated", () => {
  it("every exported sender calls a gate, or is a known non-crew follow-up", () => {
    const ungated = files.flatMap((f) =>
      exportedActions(f)
        .filter((a) => a.sends && !a.gated && !KNOWN_UNGATED.has(`${f}:${a.name}`))
        .map((a) => `${f}:${a.name}`),
    );
    expect(ungated).toEqual([]);
  });

  it("the scan sees a send reached through a LOCAL helper (call graph), and scopes each body to its own function", () => {
    // Sanity on the real tree: a known gated crew sender is read as sending AND gated.
    const offers = exportedActions("crew-communication.ts").find((a) => a.name === "sendCrewOffers")!;
    expect(offers.sends).toBe(true);
    expect(offers.gated).toBe(true);
    // A known cron sender that sends through a local helper is still read as sending.
    const digest = exportedActions("notification-email-sender.ts").find((a) => a.name === "sendNotificationEmails")!;
    expect(digest.sends).toBe(true);
    expect(digest.gated).toBe(false);
  });

  it("the crew senders with no authz are not server actions any more", () => {
    const actions = new Set(files.flatMap((f) => exportedActions(f).map((a) => a.name)));
    for (const name of ["notifyPositionFilled", "sendCrewOfferNudges", "sendCrewCallTimeReminders", "buildAssignmentEmailData"]) {
      expect(actions.has(name), name).toBe(false);
    }
  });

  it("no crew module is on the ungated list", () => {
    expect([...KNOWN_UNGATED].filter((k) => k.startsWith("crew"))).toEqual([]);
  });

  it("the moved modules are plain server-only code, never actions", () => {
    for (const f of ["crew-time-nudges.ts", "crew-position-filled.ts", "crew-assignment-email-data.ts"]) {
      const text = readFileSync(join(process.cwd(), "src/lib", f), "utf8");
      expect(text.startsWith('import "server-only";'), f).toBe(true);
      expect(text, f).not.toMatch(/^\s*["']use server["'];?\s*$/m); // no directive (a doc mention is fine)
    }
  });
});
