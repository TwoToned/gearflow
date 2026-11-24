/**
 * The crew roles' display order: `sortOrder`, then name. ONE definition
 * (R-3.1): the roles sheet lists by it and `crewRolesWrites.moveNative`
 * renumbers by it, so a Move up always moves the row the user saw above.
 * Plain module, so `src/` imports it too.
 */
export function compareRoleOrder(a: { sortOrder?: number | null; name: string }, b: { sortOrder?: number | null; name: string }): number {
  return (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name);
}
