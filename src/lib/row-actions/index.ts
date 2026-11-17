/**
 * Per-row-kind `ActionMenuSpec` builders (spec §5.2). One pure function per
 * kind; the project and the warehouse share the gear one. Builders import no
 * React components and never emit a disabled item: an action that does not
 * apply is absent.
 */
export { buildGearLineActions } from "./gear-line";
export type { GearLineActionRow, GearLineActionCtx } from "./gear-line";
export { groupActionItems, itemForShortcut } from "./group-items";
