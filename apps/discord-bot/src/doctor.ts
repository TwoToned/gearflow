/**
 * `npm run doctor` — green/red preflight checklist. Validates env + bootstrap
 * reachability + that GearFlow has enough config to actually run the bot.
 */
import { loadEnv } from "./env.js";
import { fetchBootstrap, BootstrapError } from "./bootstrap.js";

type Check = { label: string; run: () => Promise<boolean> | boolean };

const checks: Check[] = [
  { label: "GEARFLOW_BOT_BEARER set", run: () => !!process.env.GEARFLOW_BOT_BEARER },
  { label: "GEARFLOW_ORG_ID set", run: () => !!process.env.GEARFLOW_ORG_ID },
  {
    label: "GearFlow API reachable",
    run: async () => {
      const base = process.env.GEARFLOW_API_URL ?? "https://home.twotoned.com.au";
      try {
        const res = await fetch(`${base}/api/discord/v1/health`);
        return res.ok;
      } catch {
        return false;
      }
    },
  },
  {
    label: "Bootstrap returns a configured integration",
    run: async () => {
      try {
        const env = loadEnv();
        const boot = await fetchBootstrap(env);
        if (!boot.isEnabled) {
          console.log("   ↳ integration is disabled — enable it at GearFlow → Settings → Discord");
          return false;
        }
        const missing: string[] = [];
        if (!boot.discordBotToken) missing.push("bot token");
        if (!boot.discordApplicationId) missing.push("application id");
        if (!boot.guildId) missing.push("guild id");
        if (missing.length > 0) {
          console.log(`   ↳ missing: ${missing.join(", ")} — set at GearFlow → Settings → Discord`);
          return false;
        }
        console.log(
          `   ↳ guild=${boot.guildId}, category=${boot.projectCategoryId ?? "none"}, archive=${boot.archiveCategoryId ?? "none"}`,
        );
        return true;
      } catch (err) {
        if (err instanceof BootstrapError) console.log(`   ↳ ${err.message}`);
        else console.log(`   ↳ ${(err as Error).message}`);
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
