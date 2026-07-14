"use client";

import { useMutation } from "convex/react";
import { createId } from "@paralleldrive/cuid2";
import { useSession, useActiveOrganization } from "@/lib/auth-client";
import { api } from "../../convex/_generated/api";
import {
  customFieldDefinitionSchema,
  customFieldDefinitionUpdateSchema,
  type CustomFieldDefinitionInput,
  type CustomFieldDefinitionUpdateInput,
} from "@/lib/validations/custom-field";

/**
 * Browser-direct CUSTOM-FIELD-DEFINITION writes (Phase 3 — replaces the
 * createCustomFieldDefinition/updateCustomFieldDefinition/deleteCustomFieldDefinition
 * server actions). Each calls the guarded `api.customFieldDefinitionsWrites.*` mutation
 * directly with the caller-minted id/auditId/now + the verified actor. The settings
 * page's `useServerMutation` wrappers stay for the loading/toast/onSuccess UX; only the
 * `mutationFn` changes to call these. The list (useCustomFieldDefinitions) subscribes to
 * Convex, so each write pushes a live update — no invalidation needed.
 */
export function useCustomFieldWrites() {
  const { data: session } = useSession();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const createM = useMutation(api.customFieldDefinitionsWrites.createNative);
  const updateM = useMutation(api.customFieldDefinitionsWrites.updateNative);
  const removeM = useMutation(api.customFieldDefinitionsWrites.removeNative);

  const actor = () => ({
    userId: session?.user.id ?? "",
    userName: session?.user.name ?? "",
  });
  const requireOrg = (): string => {
    if (!orgId) throw new Error("No active organization");
    return orgId;
  };

  return {
    create: async (data: CustomFieldDefinitionInput): Promise<{ id: string }> => {
      const org = requireOrg();
      // Match the deleted server action's validation + defaults (label/key length,
      // key regex, SELECT-needs-options, defaults). The dialog's zodResolver already
      // validates the main form; parse here guards any other caller.
      const parsed = customFieldDefinitionSchema.parse(data);
      const id = createId();
      const now = Date.now();
      await createM({
        id,
        organizationId: org,
        entityType: parsed.entityType,
        label: parsed.label,
        fieldKey: parsed.fieldKey,
        fieldType: parsed.fieldType,
        // Non-SELECT fields carry no options (matches the deleted action).
        options: parsed.fieldType === "SELECT" ? parsed.options : [],
        required: parsed.required,
        helpText: parsed.helpText || undefined,
        sortOrder: parsed.sortOrder,
        isActive: parsed.isActive,
        createdAt: now,
        actor: actor(),
        auditId: createId(),
      });
      return { id };
    },
    update: async (
      id: string,
      data: CustomFieldDefinitionUpdateInput,
    ): Promise<{ id: string }> => {
      const org = requireOrg();
      const parsed = customFieldDefinitionUpdateSchema.parse(data);
      await updateM({
        id,
        orgId: org,
        label: parsed.label,
        fieldType: parsed.fieldType,
        options: parsed.fieldType === "SELECT" ? parsed.options : [],
        required: parsed.required,
        helpText: parsed.helpText || undefined,
        sortOrder: parsed.sortOrder,
        isActive: parsed.isActive,
        actor: actor(),
        auditId: createId(),
        now: Date.now(),
      });
      return { id };
    },
    remove: async (id: string): Promise<{ ok: boolean }> => {
      const org = requireOrg();
      return await removeM({
        id,
        orgId: org,
        actor: actor(),
        auditId: createId(),
        now: Date.now(),
      });
    },
  };
}
