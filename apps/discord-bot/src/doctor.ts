/**
 * `npm run doctor` — green/red preflight checklist so operators don't spelunk the
 * Developer Portal. Checks env, bot token validity, guild membership, and GearFlow
 * API reachability. SCAFFOLD — extend checks as wiring lands.
 */
const checks: { label: string; run: () => Promise<boolean> | boolean }[] = [
  { label: "DISCORD_BOT_TOKEN set", run: () => !!process.env.DISCORD_BOT_TOKEN },
  { label: "DISCORD_APPLICATION_ID set", run: () => !!process.env.DISCORD_APPLICATION_ID },
  { label: "DISCORD_GUILD_ID set", run: () => !!process.env.DISCORD_GUILD_ID },
  { label: "GEARFLOW_API_URL set", run: () => !!process.env.GEARFLOW_API_URL },
  { label: "GEARFLOW_DISCORD_SIGNING_SECRET set", run: () => !!process.env.GEARFLOW_DISCORD_SIGNING_SECRET },
  { label: "GEARFLOW_ORG_ID set", run: () => !!process.env.GEARFLOW_ORG_ID },
  { label: "GEARFLOW_BOT_BEARER set", run: () => !!process.env.GEARFLOW_BOT_BEARER },
  {
    label: "GearFlow API reachable",
    run: async () => {
      const base = process.env.GEARFLOW_API_URL;
      if (!base) return false;
      try {
        const res = await fetch(`${base}/api/discord/v1/health`);
        return res.ok || res.status === 401; // 401 = reachable but unsigned, still "up"
      } catch {
        return false;
      }
    },
  },
];

async function main(): Promise<void> {
  let ok = true;
  for (const c of checks) {
    const pass = await c.run();
    ok = ok && pass;
    console.log(`${pass ? "✅" : "❌"} ${c.label}`);
  }
  console.log(ok ? "\nAll checks passed." : "\nSome checks failed — see README.");
  process.exit(ok ? 0 : 1);
}

main();
