import { hueHoverBg, hueHoverText, hueSoftBg, hueText } from "@/components/layout/nav-icons";
import type { NavHue } from "@/lib/nav";

export const NAV_FOCUS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red focus-visible:ring-offset-2 focus-visible:ring-offset-paper";

/** Active row = a hue tint (never a red fill). A hue-less row (More group, Settings) tints neutral. */
export function navTone(hue: NavHue | null, active: boolean, idle = "text-ink-2"): string {
  if (!hue) return active ? "bg-elev text-ink" : `${idle} hover:bg-elev hover:text-ink`;
  return active
    ? `${hueSoftBg[hue]} ${hueText[hue]} shadow-[var(--sh-card)]`
    : `${idle} ${hueHoverBg[hue]} ${hueHoverText[hue]}`;
}

export function navHueText(hue: NavHue | null): string {
  return hue ? hueText[hue] : "text-muted";
}
