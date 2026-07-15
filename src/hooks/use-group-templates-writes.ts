"use client";

import { useMutation } from "convex/react";
import { createId } from "@paralleldrive/cuid2";
import { useSession, useActiveOrganization } from "@/lib/auth-client";
import { api } from "../../convex/_generated/api";

/**
 * Browser-direct GROUP-TEMPLATE writes (Phase 3 — replaces the saveGroupAsTemplate /
 * updateGroupTemplate / deleteGroupTemplate / applyGroupTemplate server actions in
 * src/server/group-templates.ts). Each guarded `api.groupTemplatesWrites.*` mutation
 * folds permission + validation + audit (+ apply's group/line expansion + recalc)
 * into ONE transaction. Reads are reactive subscriptions (use-group-templates.ts), so
 * callers don't refetch a shared store on success.
 */

/** Minimal template item shape needed to mint the right number of line/kit ids. */
type ApplyTemplateItem = { modelId: string | null; kitId: string | null; quantity: number };

export function useGroupTemplateWrites() {
  const { data: session } = useSession();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const saveM = useMutation(api.groupTemplatesWrites.saveGroupAsTemplateNative);
  const updateM = useMutation(api.groupTemplatesWrites.updateTemplateNative);
  const deleteM = useMutation(api.groupTemplatesWrites.deleteTemplateNative);
  const applyM = useMutation(api.groupTemplatesWrites.applyNative);

  const actor = () => ({
    userId: session?.user.id ?? "",
    userName: session?.user.name ?? "",
  });
  const requireOrg = (): string => {
    if (!orgId) throw new Error("No active organization");
    return orgId;
  };

  return {
    saveGroupAsTemplate: async (
      groupId: string,
      name: string,
      description?: string,
    ): Promise<{ id: string; name: string }> => {
      const res = await saveM({
        templateId: createId(),
        orgId: requireOrg(),
        groupId,
        name,
        description: description || undefined,
        now: Date.now(),
        actor: actor(),
        auditId: createId(),
      });
      return { id: res.id, name };
    },

    updateTemplate: async (
      templateId: string,
      data: { name?: string; description?: string },
    ): Promise<void> => {
      await updateM({
        templateId,
        orgId: requireOrg(),
        name: data.name,
        description: data.description,
        now: Date.now(),
        actor: actor(),
        auditId: createId(),
      });
    },

    deleteTemplate: async (templateId: string): Promise<void> => {
      await deleteM({
        templateId,
        orgId: requireOrg(),
        now: Date.now(),
        actor: actor(),
        auditId: createId(),
      });
    },

    applyTemplate: async (args: {
      templateId: string;
      projectId: string;
      categoryId: string;
      title: string;
      items: ApplyTemplateItem[];
    }): Promise<{ groupId: string; kitWarnings: string[] }> => {
      // Mint one id per model item + one id per kit UNIT (flattened in item order).
      const modelLineIds = args.items.filter((it) => it.modelId).map(() => createId());
      const kitLineIds: string[] = [];
      for (const it of args.items) {
        if (!it.kitId) continue;
        for (let u = 0; u < it.quantity; u++) kitLineIds.push(createId());
      }
      return applyM({
        templateId: args.templateId,
        orgId: requireOrg(),
        projectId: args.projectId,
        categoryId: args.categoryId || undefined,
        title: args.title,
        groupId: createId(),
        modelLineIds,
        kitLineIds,
        now: Date.now(),
        actor: actor(),
        auditId: createId(),
      });
    },
  };
}
