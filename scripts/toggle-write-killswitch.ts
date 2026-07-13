/**
 * Flip the browser-direct mutation KILL-SWITCH (convex/systemFlags.ts +
 * convex/lib/writeGuard.ts). When on, every browser-direct (public) mutation that
 * calls `assertWritesEnabled` rejects instantly — blast-radius containment for an
 * abusive/runaway client, with no redeploy. Server-routed (service) writes are NOT
 * affected. Run inside the app container (has the prod Convex service token):
 *
 *   docker exec <app> npx tsx scripts/toggle-write-killswitch.ts on  "reason here"
 *   docker exec <app> npx tsx scripts/toggle-write-killswitch.ts on  "reason" asset dashboard   # domain-scoped
 *   docker exec <app> npx tsx scripts/toggle-write-killswitch.ts off
 *   docker exec <app> npx tsx scripts/toggle-write-killswitch.ts status
 */
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../convex/_generated/api";

async function main() {
  const [cmd, reason, ...domains] = process.argv.slice(2);
  const convex = await getConvexClient();

  if (cmd === "status") {
    const flags = await convex.query(api.systemFlags.getFlags, {});
    console.log(JSON.stringify(flags ?? { writesDisabled: false, note: "no row → writes enabled" }, null, 2));
    return;
  }
  if (cmd !== "on" && cmd !== "off") {
    console.error('Usage: toggle-write-killswitch.ts <on|off|status> [reason] [domain...]');
    process.exit(2);
  }

  const row = await convex.mutation(api.systemFlags.setWrites, {
    disabled: cmd === "on",
    reason: reason || undefined,
    domains: domains.length ? domains : undefined,
    now: Date.now(),
  });
  console.log(`Write kill-switch ${cmd === "on" ? "ENABLED" : "disabled"}.`);
  console.log(JSON.stringify(row, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
