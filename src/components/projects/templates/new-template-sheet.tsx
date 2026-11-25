"use client";

import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { FormSheet } from "@/components/ui/form-sheet";
import { useActiveOrganization } from "@/lib/auth-client";
import { useProjectWrites } from "@/hooks/use-native-project-writes";
import { useProjectManagerWrites } from "@/hooks/use-project-managers-writes";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { projectSchema, type ProjectFormValues } from "@/lib/validations/project";
import { ProjectFields, projectFormDefaults, useProjectFieldsState } from "@/components/projects/project-fields";

/**
 * `New template…` (UX Phase 9, D23): the shared `ProjectFields` job block (name, type, tags,
 * description, client, managers) in a sheet, no code, discount or dates. It creates the template
 * through the ordinary create and opens its page, where gear is added on the Equipment tab.
 */
export function NewTemplateSheet({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const writes = useProjectWrites(orgId);
  const managerWrites = useProjectManagerWrites();
  const form = useForm<ProjectFormValues>({ resolver: zodResolver(projectSchema), defaultValues: projectFormDefaults() });
  const state = useProjectFieldsState({ form, orgId, isTemplate: true, prefillCode: false });

  const create = useServerMutation({
    mutationFn: async (data: ProjectFormValues) => {
      const result = await writes.create({ ...data, isTemplate: true });
      if (state.managerIds.length > 0) await managerWrites.set(result.id, state.managerIds);
      return result;
    },
    onSuccess: (result) => {
      toast.success("Template created");
      onClose();
      router.push(`/projects/${result.id}`);
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <FormSheet
      open
      onOpenChange={(o) => !o && onClose()}
      title="New template"
      description="Name it, then add the gear on its page."
      primaryLabel="Create template"
      submitting={create.isPending}
      dirty={form.formState.isDirty}
      onSubmit={() => form.handleSubmit((d) => create.mutate(d))()}
      size="narrow"
    >
      <ProjectFields form={form} state={state} sections={["job"]} />
    </FormSheet>
  );
}
