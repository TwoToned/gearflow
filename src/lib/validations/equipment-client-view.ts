import { z } from "zod";

// ─── Equipment tab · Client view (UX 2b) ────────────────────────────────────
//
// The trust boundary of `getEquipmentClientView` (src/server/
// equipment-client-view.ts): a browser-supplied project id and the optional
// viewed version. Whether either belongs to the caller's org is checked
// server-side against the rows themselves, not here.

const idField = z.string().trim().min(1).max(64);

export const equipmentClientViewArgsSchema = z.object({
  projectId: idField,
  /** The viewed (non-live) version; absent = the live version. */
  versionId: idField.optional(),
});

export type EquipmentClientViewArgs = z.input<typeof equipmentClientViewArgsSchema>;
