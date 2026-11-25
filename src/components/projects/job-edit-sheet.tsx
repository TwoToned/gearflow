"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useForm, type UseFormReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { FormSheet } from "@/components/ui/form-sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useCanDo, useCurrentRole } from "@/lib/use-permissions";
import { DateMoveImpactDialog } from "@/components/projects/date-move-impact-dialog";
import {
  ProjectFields, projectFormDefaults, useProjectFieldsState, type EditableProject,
} from "@/components/projects/project-fields";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { useDateMoveGate } from "@/hooks/use-date-move-gate";
import { useProjectDetail } from "@/hooks/use-project-detail";
import { useProjectWrites } from "@/hooks/use-native-project-writes";
import { useProjectManagerWrites } from "@/hooks/use-project-managers-writes";
import { useActiveOrganization } from "@/lib/auth-client";
import { projectSchema, type ProjectFormValues } from "@/lib/validations/project";
import { buildProjectUpdate, changedGroups } from "@/lib/project-edit-patch";
import { resolveWindowMs } from "@/lib/project-form-dates";
import { JOB_EDIT_PARAM, jobEditCloseHref } from "@/lib/job-edit-url";

/**
 * The job edit sheet (UX Phase 9, D22): `?edit=1` on the record opens it from
 * Overview `Edit`, the header, and the readiness fixes. Same `ProjectFields` as
 * the wizard, all sections open and titled. Status is not a field: it moves
 * through the header stepper's gates.
 *
 * One `Save changes`, disabled until something changed; the footer says what.
 * Save sends only the CHANGED fields through the one update mutation (so a
 * pricing-locked job never has an untouched locked field in the payload), and
 * the #1227 date-move gate runs only when the gear window moved on a Confirmed
 * or later job. Hosted once by the job page.
 */
export function JobEditSheet({ projectId }: { projectId: string }) {
  const searchParams = useSearchParams();
  const requested = searchParams.get(JOB_EDIT_PARAM) === "1";
  const { isLoading } = useCurrentRole();
  const allowed = useCanDo("project", "update");
  const close = useCloseSheet();
  // A `?edit=1` link without the right to edit says so and drops the param, never a silent nothing.
  const refused = requested && !isLoading && !allowed;
  useEffect(() => {
    if (!refused) return;
    toast.error("You can't edit this job");
    close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refused]);
  if (!requested || !allowed) return null;
  return <LoadedSheet projectId={projectId} />;
}

function useCloseSheet() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  return () => router.replace(jobEditCloseHref(pathname, searchParams));
}

function LoadedSheet({ projectId }: { projectId: string }) {
  const close = useCloseSheet();
  const { data: project, isLoading } = useProjectDetail(projectId);
  if (project) return <EditForm key={projectId} project={project as unknown as EditableProject} close={close} />;
  return (
    <FormSheet open onOpenChange={(o) => !o && close()} title="Edit job" primaryLabel="Save changes" primaryDisabled onSubmit={() => {}}>
      {isLoading ? <Skeleton className="h-40 w-full" /> : <p className="text-ui-text text-muted">Job not found.</p>}
    </FormSheet>
  );
}

function EditForm({ project, close }: { project: EditableProject; close: () => void }) {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const isTemplate = project.isTemplate ?? false;
  const projectWrites = useProjectWrites(orgId);
  const managerWrites = useProjectManagerWrites();

  const form = useForm<ProjectFormValues>({
    resolver: zodResolver(projectSchema),
    defaultValues: projectFormDefaults(project),
  });
  const state = useProjectFieldsState({ form, project, orgId, isTemplate });
  const { managerIds, initialManagerIds } = state;
  const managersChanged = managerSetChanged(initialManagerIds, managerIds);

  const before = form.formState.defaultValues as ProjectFormValues;
  const watched = form.watch();
  const summary = describeChanges(before, watched, managersChanged);
  // `isDirty` compares to the defaults, so reverting a field turns it off again; the
  // summary can be empty while a field is dirty-but-invalid, so it is not the source.
  const dirty = form.formState.isDirty || managersChanged;

  const mutation = useServerMutation({
    mutationFn: async (data: ProjectFormValues) => {
      const result = await projectWrites.update(project.id, data, isTemplate, before);
      // Only when the set changed: setProjectManagers needs project:manage.
      if (managersChanged) await managerWrites.set(project.id, managerIds);
      return result;
    },
    onSuccess: () => {
      toast.success(`${isTemplate ? "Template" : "Job"} updated: ${summary.join(", ")}`);
      close();
    },
    onError: (e) => reportSaveError(form, e),
  });

  const gate = useDateMoveGate<ProjectFormValues>(
    orgId, project.id, project.status ?? undefined, resolveWindowMs(project), (data) => mutation.mutate(data),
  );
  const submit = form.handleSubmit((d) => gate.requestSave(resolveWindowMs(d), d));

  return (
    <>
      <FormSheet
        open
        onOpenChange={(o) => !o && close()}
        title={isTemplate ? "Edit template" : "Edit job"}
        description="Saving checks the new dates against gear on other jobs."
        primaryLabel="Save changes"
        primaryDisabled={!dirty}
        submitting={mutation.isPending || gate.checking}
        dirty={dirty}
        onSubmit={() => submit()}
        footerStart={dirty ? <span className="text-caption text-muted">{summary.join(", ")} changed</span> : null}
      >
        <div className="space-y-8">
          <Section title="Job">
            <ProjectFields form={form} state={state} sections={["job", "schedule"]} />
          </Section>
          <Section title="Where">
            <ProjectFields form={form} state={state} sections={["where"]} />
          </Section>
          {!isTemplate && (
            <Section title="Money">
              <ProjectFields form={form} state={state} sections={["money"]} />
            </Section>
          )}
        </div>
      </FormSheet>
      <GateDialog gate={gate} pending={mutation.isPending} />
    </>
  );
}

function GateDialog({ gate, pending }: { gate: ReturnType<typeof useDateMoveGate<ProjectFormValues>>; pending: boolean }) {
  return (
    <DateMoveImpactDialog
      open={!!gate.pending}
      rows={gate.pending?.rows ?? []}
      pending={pending}
      onConfirm={gate.confirmPending}
      onCancel={gate.cancelPending}
    />
  );
}

/** A field-tagged error (e.g. duplicate job code) lands on its input; anything else toasts. */
function reportSaveError(form: UseFormReturn<ProjectFormValues>, e: Error) {
  const field = (e as { field?: string }).field;
  if (!field) return void toast.error(e.message);
  form.setError(field as "projectNumber", { type: "server", message: e.message });
  form.setFocus(field as "projectNumber");
}

function managerSetChanged(initial: string[], now: string[]): boolean {
  return now.length !== initial.length || now.some((id) => !initial.includes(id));
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <h3 className="t-overline text-muted">{title}</h3>
      {children}
    </section>
  );
}

/** The words for what Save would change; empty when nothing would (Save stays disabled). */
function describeChanges(before: ProjectFormValues, now: ProjectFormValues, managersChanged: boolean): string[] {
  const a = projectSchema.safeParse(before);
  const b = projectSchema.safeParse(now);
  const groups = a.success && b.success ? changedGroups(buildProjectUpdate(b.data, { before: a.data, now: 0 })) : [];
  return managersChanged ? [...groups, "managers"] : groups;
}
