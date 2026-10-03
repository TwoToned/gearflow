/**
 * Who a work row is for, and the people a composer can choose from.
 *
 * Its own module so `work-composer.tsx` and `composer-chips.tsx` can both
 * import it without importing each other — one definition of the owner shape
 * and one of its label (R-3.1), not a copy on each side.
 */

export interface WorkComposerAssignees {
  users: { id: string; name: string; image?: string | null }[];
  crew: { id: string; firstName: string; lastName: string }[];
}

export type WorkComposerOwner =
  | { kind: "user"; id: string }
  | { kind: "crew"; id: string }
  | { kind: "nobody" };

/** The owner's display name. "Me" for the signed-in user, because a chip that
 *  says your own name back to you is noise. */
export function ownerLabel(
  owner: WorkComposerOwner,
  assignees: WorkComposerAssignees | undefined,
  meId: string | undefined,
): string {
  if (owner.kind === "nobody") return "Nobody";
  if (owner.kind === "crew") {
    const c = assignees?.crew.find((x) => x.id === owner.id);
    return c ? `${c.firstName} ${c.lastName}`.trim() : "Crew";
  }
  if (owner.id === meId) return "Me";
  return assignees?.users.find((u) => u.id === owner.id)?.name ?? "Someone";
}
