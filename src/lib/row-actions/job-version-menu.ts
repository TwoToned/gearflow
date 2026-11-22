import { GitBranch } from "lucide-react";

import type { ActionItem } from "@/lib/primitives/types";

/**
 * The job header's version menu as ONE `ActionItem` with one level of children
 * (spec §6b, D92: the version lives in ⋯ and under `V`, never as a chip).
 *
 * Contract with Phase 8 (Packing + Versions): this is the shape the header ⋯
 * mounts. Phase 8 fills the same shape (`useVersionMenuItem`) once its Versions
 * tab lands. The header never mounts a version component. `V` is a callback the
 * header owns (`onOpenVersions`), so the panel → tab move is one line.
 *
 * Pure: the caller resolves permissions; an action that does not apply is
 * ABSENT (principle 2).
 */
export interface VersionMenuVersion {
  id: string;
  number: number;
  label?: string;
  isLive: boolean;
  contentState: "ready" | "missing";
}

export interface VersionMenuState {
  versions: readonly VersionMenuVersion[];
  liveVersion: VersionMenuVersion | null;
  /** The version on screen (`?v=`), or null for live. */
  viewingNumber: number | null;
  /** `invoice:publish` — the switcher's gate for New version. */
  canPublish: boolean;
}

export interface VersionMenuHandlers {
  /** `null` switches back to live. */
  view: (number: number | null) => void;
  /** New version from the version on screen. */
  createFrom: (fromVersionId: string) => void;
  /** Opens Compare: the version on screen against live, or the newest draft. */
  compare: (bNumber: number | null) => void;
  /** `Manage versions…` and the `V` key. */
  manage: () => void;
}

function stateWord(v: VersionMenuVersion): string {
  if (v.isLive) return "Live";
  return v.contentState === "missing" ? "No content" : "Draft";
}

/** `v3 · Live · Hilton revision` (+ `· viewing` on the one on screen). */
function versionLabel(v: VersionMenuVersion, onScreen: boolean): string {
  return [`v${v.number}`, stateWord(v), v.label, onScreen ? "viewing" : null].filter(Boolean).join(" · ");
}

function versionVerbs(state: VersionMenuState, onScreen: VersionMenuVersion | null, h: VersionMenuHandlers): ActionItem[] {
  const verbs: ActionItem[] = [];
  if (state.canPublish && onScreen) {
    verbs.push({ key: "version-new", label: `New version from v${onScreen.number}`, group: "organise", onSelect: () => h.createFrom(onScreen.id) });
  }
  if (state.versions.length > 1) {
    const b = state.viewingNumber ?? state.versions.find((v) => !v.isLive)?.number ?? null;
    verbs.push({ key: "version-compare", label: "Compare", group: "organise", onSelect: () => h.compare(b) });
  }
  verbs.push({ key: "version-manage", label: "Manage versions…", kbd: "V", group: "organise", onSelect: h.manage });
  return verbs;
}

export function buildVersionMenuItem(state: VersionMenuState, h: VersionMenuHandlers): ActionItem | null {
  const { versions, liveVersion, viewingNumber } = state;
  if (versions.length === 0) return null;
  const onScreen = (viewingNumber != null ? versions.find((v) => v.number === viewingNumber) : null) ?? liveVersion;

  const children: ActionItem[] = [
    ...versions.map((v): ActionItem => ({
      key: `version-${v.id}`,
      label: versionLabel(v, v.id === onScreen?.id),
      group: "organise",
      onSelect: () => h.view(v.isLive ? null : v.number),
    })),
    ...versionVerbs(state, onScreen, h),
  ];

  return {
    key: "versions",
    label: onScreen ? `Version ${versionLabel(onScreen, false)}` : "Versions",
    group: "organise",
    icon: GitBranch,
    onSelect: h.manage,
    children,
  };
}
