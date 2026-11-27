import type { SettingsStatusKey } from "@/lib/settings-registry";
import type { StatusValue } from "@/lib/primitives/types";

/**
 * The index rows' status words (spec §9k.2) — DERIVED on read from the facts
 * that already own them, never stored. A `null` input is "not loaded yet":
 * the row prints no word rather than a guess.
 */
export interface SettingsStatusInputs {
  team: { members: number; invitations: number } | null;
  xero: { connected: boolean } | null;
  mira: { hasApiKey: boolean; writeAccessEnabled: boolean } | null;
}

const NOT_SET_UP: StatusValue = { label: "Not set up", intent: "neutral", outline: true };

function teamStatus(t: SettingsStatusInputs["team"]): StatusValue | null {
  if (!t) return null;
  const members = `${t.members} ${t.members === 1 ? "member" : "members"}`;
  return { label: t.invitations > 0 ? `${members} · ${t.invitations} invited` : members, intent: "neutral" };
}

function xeroStatus(x: SettingsStatusInputs["xero"]): StatusValue | null {
  if (!x) return null;
  return x.connected ? { label: "Connected", intent: "success" } : NOT_SET_UP;
}

function miraStatus(m: SettingsStatusInputs["mira"]): StatusValue | null {
  if (!m) return null;
  if (!m.hasApiKey) return NOT_SET_UP;
  return m.writeAccessEnabled
    ? { label: "On · can write", intent: "warning" }
    : { label: "On · read-only", intent: "success" };
}

export function settingsStatus(key: SettingsStatusKey, inputs: SettingsStatusInputs): StatusValue | null {
  if (key === "team") return teamStatus(inputs.team);
  if (key === "xero") return xeroStatus(inputs.xero);
  return miraStatus(inputs.mira);
}
