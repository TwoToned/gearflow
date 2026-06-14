"use client";

import type { ReactNode } from "react";
import { useEditLock } from "@/hooks/use-collaboration";
import { LockedEditorOverlay } from "./locked-editor-overlay";

/**
 * Wraps a record edit form with a collaboration edit lock (Phase 6). While
 * another user is editing the same record, the form is shown read-only (greyed
 * + pointer-events disabled) behind a LockedEditorOverlay banner; a stale lock
 * can be taken over. The lock is record-level: targetType/targetId mirror the
 * entity. The server-side revision check stays the source of truth on save.
 */
export function EditLockGate({
  entityType,
  entityId,
  children,
}: {
  entityType: string;
  entityId: string;
  children: ReactNode;
}) {
  const { lockState, isLocked, isStale, takeover } = useEditLock({
    entityType,
    entityId,
    targetType: entityType,
    targetId: entityId,
    active: true,
  });

  return (
    <>
      <LockedEditorOverlay
        lockState={lockState}
        onTakeover={isStale ? () => void takeover() : undefined}
      />
      <div className={isLocked ? "pointer-events-none opacity-60" : undefined}>
        {children}
      </div>
    </>
  );
}
