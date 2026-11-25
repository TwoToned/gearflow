"use client";

import { useMutation } from "convex/react";
import { createId } from "@paralleldrive/cuid2";
import { useActiveOrganization, useSession } from "@/lib/auth-client";
import { mapNativeWriteError } from "@/lib/native-writes";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { useProjectWrites } from "@/hooks/use-native-project-writes";
import { api } from "../../convex/_generated/api";

/** The org's job templates (`projects.listTemplates`: newest updated first, gear line counts). `archived` lists the archived ones. */
export function useTemplates(orgId: string | undefined, archived = false) {
  return useAuthedQuery(api.projects.listTemplates, orgId ? { orgId, archived } : "skip");
}

export type TemplateRow = NonNullable<ReturnType<typeof useTemplates>>["templates"][number];

/**
 * Template writes (UX Phase 9, D23), all browser-direct and guarded server-side:
 * archive with an exact Undo (the audit ids come back from the archive), apply onto a wizard
 * draft with its own exact Undo, and the real delete of an ALREADY-archived template (no Undo).
 */
export function useTemplateWrites() {
  const { data: session } = useSession();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const archiveM = useMutation(api.projectTemplateWrites.archiveTemplatesNative);
  const unarchiveM = useMutation(api.projectTemplateWrites.unarchiveTemplatesNative);
  const applyM = useMutation(api.projectTemplateWrites.applyTemplateNative);
  const undoApplyM = useMutation(api.projectTemplateWrites.undoApplyTemplateNative);
  const projectWrites = useProjectWrites(orgId);

  const actor = () => ({ userId: session?.user.id ?? "", userName: session?.user.name ?? "" });
  const guard = async <T,>(run: (org: string) => Promise<T>): Promise<T> => {
    if (!orgId || !session?.user) throw new Error("Not ready");
    try {
      return await run(orgId);
    } catch (e) {
      throw mapNativeWriteError(e);
    }
  };

  return {
    archive: (ids: string[]) => guard((org) => archiveM({ orgId: org, ids, actor: actor(), auditId: createId(), now: Date.now() })),
    unarchive: (items: { id: string; auditId: string }[]) => guard((org) => unarchiveM({ orgId: org, items, actor: actor(), now: Date.now() })),
    /** Returns the audit id the Undo needs. */
    apply: async (draftId: string, templateId: string) => {
      const auditId = createId();
      const r = await guard((org) => applyM({ orgId: org, draftId, templateId, actor: actor(), auditId, now: Date.now() }));
      return { ...r, auditId };
    },
    undoApply: (projectId: string, applyAuditId: string) => guard((org) => undoApplyM({ orgId: org, projectId, applyAuditId, actor: actor(), now: Date.now() })),
    /** The real delete; the server refuses a template that is not archived. */
    deleteForever: (id: string) => projectWrites.deleteTemplate(id),
  };
}
