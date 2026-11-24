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

function exportedActions(file: string): { name: string; body: string }[] {
  const text = readFileSync(join(SERVER, file), "utf8");
  if (!/^\s*["']use server["']/.test(text)) return [];
  const parts = text.split(/^export async function /m).slice(1);
  return parts.map((p) => ({ name: p.match(/^(\w+)/)![1], body: p }));
}

const files = readdirSync(SERVER).filter((f) => f.endsWith(".ts"));

describe("\"use server\" actions that send email or push are gated", () => {
  it("every exported sender calls a gate, or is a known non-crew follow-up", () => {
    const ungated = files.flatMap((f) =>
      exportedActions(f)
        .filter((a) => SENDS.test(a.body) && !GATES.test(a.body) && !KNOWN_UNGATED.has(`${f}:${a.name}`))
        .map((a) => `${f}:${a.name}`),
    );
    expect(ungated).toEqual([]);
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
