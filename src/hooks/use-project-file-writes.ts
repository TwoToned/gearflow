"use client";

import { useMutation } from "convex/react";
import { useActiveOrganization } from "@/lib/auth-client";
import { useMediaWrites } from "@/hooks/use-media-writes";
import { api } from "../../convex/_generated/api";
import type { FileCategory } from "@/lib/file-category";

/**
 * Browser-direct writes for a JOB's files (UX Phase 10): add / remove (the shared media
 * set), plus the two this phase adds: change category and rename. A removal deletes the
 * stored file, so it is a confirmed hard delete with NO Undo (an Undo never deletes or
 * "restores" stored bytes).
 */
export function useProjectFileWrites(projectId: string) {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const media = useMediaWrites("project");
  const setTypeM = useMutation(api.mediaWrites.setTypeNative);
  const renameM = useMutation(api.mediaWrites.renameNative);
  const removeManyM = useMutation(api.mediaWrites.removeManyNative);
  const requireOrg = (): string => {
    if (!orgId) throw new Error("No active organization");
    return orgId;
  };
  return {
    add: (fileId: string, type: FileCategory) => media.add({ parentId: projectId, fileId, type }),
    remove: (mediaId: string) => media.remove(mediaId),
    /** ONE mutation for the bulk bar: reports the rows it skipped (not found), never silently. */
    removeMany: (mediaIds: string[]) => removeManyM({ kind: "project", orgId: requireOrg(), mediaIds }),
    setType: (mediaIds: string[], type: FileCategory) => setTypeM({ orgId: requireOrg(), projectId, mediaIds, type, now: Date.now() }),
    rename: (mediaId: string, displayName: string) => renameM({ orgId: requireOrg(), projectId, mediaId, displayName, now: Date.now() }),
  };
}
