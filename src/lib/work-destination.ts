/**
 * The composer's destination line (work-layer v2 §4.1) — "where will this
 * land if I press Add?", as words.
 *
 * Pulled out of `WorkComposer` because it is the sentence the whole fix turns
 * on: the vanishing quick-add shipped because nothing in the UI ever said
 * where a row would go, so "nowhere" looked exactly like "somewhere". Copy
 * that load-bearing deserves a test, and a plain module can have one.
 */

/** Not exported: the shape is an implementation detail of the one function
 *  below, and an exported type nobody imports is dead code (R-4.2). */
interface WorkDestinationInput {
  /** Scoped to a job, or personal. */
  hasProject: boolean;
  ownerKind: "user" | "crew" | "nobody";
  /** True when the owner is the signed-in user. */
  isMe: boolean;
  /** Display name for a non-self owner. */
  ownerName: string;
  /** Project scope: the stage's label, or null for "no stage". */
  stageLabel?: string | null;
  /** Personal scope: the due preset's label, e.g. "Today". */
  dueLabel?: string;
}

export interface WorkDestination {
  text: string;
  /** True when the row would satisfy no reader: nobody to show it to, and no
   *  job to hang it on. The composer disables Add on this. */
  blocked: boolean;
}

export function describeWorkDestination(input: WorkDestinationInput): WorkDestination {
  if (!input.hasProject && input.ownerKind === "nobody") {
    return {
      text: "Nobody owns this and it has no job — it would land nowhere. Pick an owner.",
      blocked: true,
    };
  }

  const who = whoseList(input);
  const when = input.hasProject ? (input.stageLabel ?? "no stage") : (input.dueLabel ?? "").toLowerCase();
  return { text: `Lands in ${who} · ${when}`, blocked: false };
}

function whoseList(input: WorkDestinationInput): string {
  if (input.ownerKind === "nobody") return "this job's work list";
  if (input.isMe) return "your work list";
  return `${input.ownerName}’s work list`;
}
