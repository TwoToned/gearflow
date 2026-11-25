"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { UseFormReturn } from "react-hook-form";
import { toast } from "sonner";
import { createId } from "@paralleldrive/cuid2";
import { useProjectWrites } from "@/hooks/use-native-project-writes";
import { useProjectManagerWrites } from "@/hooks/use-project-managers-writes";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useProject } from "@/hooks/use-projects";
import { projectSchema, type ProjectFormValues } from "@/lib/validations/project";
import { projectFormDefaults } from "@/components/projects/project-fields";

/**
 * The wizard's draft (D24). The job row is written the first time it has a name,
 * through the ordinary create (an Enquiry; the number is allocated IN the create
 * mutation when the org auto-numbers), and kept in step with diff updates after
 * that. `Create job` finishes this same row; nothing here ever duplicates it.
 *
 * Single-flight: every write goes through one promise chain, so a double fire or
 * a retry after a dropped connection can never create a second row. Drafts wait
 * (no error) while the org needs a typed code and there isn't one yet.
 */
export type DraftPhase = "none" | "saving" | "saved" | "error";

const DEBOUNCE_MS = 800;

const hasName = (v: ProjectFormValues) => !!v.name?.trim();

export function useJobDraft({
  form, orgId, managerIds,
}: {
  form: UseFormReturn<ProjectFormValues>;
  orgId: string | undefined;
  managerIds: string[];
}) {
  const writes = useProjectWrites(orgId);
  const managerWrites = useProjectManagerWrites();
  const [phase, setPhase] = useState<DraftPhase>("none");
  const [draftId, setDraftId] = useState<string | undefined>();
  const idRef = useRef<string | undefined>(undefined);
  // Minted ONCE per draft and sent with every create: a retry after a lost response
  // then returns the row already made (server: same id + same create audit row).
  const mintedRef = useRef({ id: createId(), auditId: createId() });
  const savedRef = useRef<ProjectFormValues | undefined>(undefined);
  const savedManagersRef = useRef<string[]>([]);
  const chain = useRef<Promise<unknown>>(Promise.resolve());

  const doc = useProject(draftId);
  const number = doc?.projectNumber;

  // The allocated number lands in the field (never marks the form dirty, and the
  // next diff must not re-send it).
  useEffect(() => {
    if (number && !form.getValues("projectNumber")) {
      form.setValue("projectNumber", number);
      if (savedRef.current) savedRef.current = { ...savedRef.current, projectNumber: number };
    }
  }, [number, form]);

  const writeOnce = useCallback(async (): Promise<string | undefined> => {
    const values = form.getValues();
    if (!hasName(values) || !projectSchema.safeParse(values).success) return idRef.current;
    if (!idRef.current) {
      const created = await writes.create({ ...values, status: "ENQUIRY", isTemplate: false }, mintedRef.current);
      idRef.current = created.id;
      setDraftId(created.id);
    } else if (savedRef.current) {
      await writes.update(idRef.current, values, false, savedRef.current);
    }
    savedRef.current = { ...values };
    const managersChanged =
      managerIds.length !== savedManagersRef.current.length ||
      managerIds.some((id) => !savedManagersRef.current.includes(id));
    if (managersChanged) {
      await managerWrites.set(idRef.current, managerIds);
      savedManagersRef.current = [...managerIds];
    }
    return idRef.current;
  }, [form, writes, managerWrites, managerIds]);

  /** Write now (after any in-flight write). Resolves to the draft id, or undefined while there is no draft yet. */
  const flush = useCallback((): Promise<string | undefined> => {
    const run = chain.current.then(async () => {
      if (!hasName(form.getValues())) return undefined;
      setPhase("saving");
      try {
        const id = await writeOnce();
        setPhase(id ? "saved" : "none");
        return id;
      } catch (e) {
        return reportDraftError(e, form, setPhase);
      }
    });
    chain.current = run.catch(() => undefined);
    return run;
  }, [form, writeOnce]);

  // Keep the draft in step: debounced on every change, never per keystroke.
  const watched = JSON.stringify([form.watch(), managerIds]);
  const settled = useDebouncedValue(watched, DEBOUNCE_MS);
  useEffect(() => {
    if (orgId) void flush();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settled, orgId]);

  /** Forget the draft row (after Discard) so the next valid name starts a fresh one. */
  const forget = useCallback(() => {
    idRef.current = undefined;
    savedRef.current = undefined;
    savedManagersRef.current = [];
    mintedRef.current = { id: createId(), auditId: createId() };
    setDraftId(undefined);
    setPhase("none");
  }, []);

  /**
   * Take values the SERVER wrote onto the draft (a template apply or its Undo) into the form AND the saved
   * baseline, so the next autosave diff does not see them as the user's edit and send the stale form value over
   * them. `null` means the draft has none (the field's own default). A field edited since the last save is skipped.
   */
  const adopt = useCallback((values: Record<string, unknown>) => {
    const defaults = projectFormDefaults();
    const taken: Record<string, unknown> = {};
    const saved = savedRef.current as Record<string, unknown> | undefined;
    const current = form.getValues() as Record<string, unknown>;
    for (const [key, value] of Object.entries(values)) {
      // A field the user edited since the last save is theirs: never overwrite it with the server's value.
      if (saved && JSON.stringify(current[key]) !== JSON.stringify(saved[key])) continue;
      taken[key] = value ?? (defaults as Record<string, unknown>)[key];
      form.setValue(key as keyof ProjectFormValues, taken[key] as never, { shouldDirty: false });
    }
    if (savedRef.current) savedRef.current = { ...savedRef.current, ...taken } as ProjectFormValues;
  }, [form]);

  /** The audit id the draft's create carried (read at click time; the server proves authorship with it). */
  const createAuditId = useCallback(() => mintedRef.current.auditId, []);

  return { phase, draftId, number, flush, forget, adopt, createAuditId };
}

/** A code the org must type (no auto-number) is "not yet", not an error; a duplicate code lands on its field. */
function reportDraftError(
  e: unknown,
  form: UseFormReturn<ProjectFormValues>,
  setPhase: (p: DraftPhase) => void,
): undefined {
  const err = e as { code?: string; field?: string; message?: string };
  if (err.code === "MISSING_PROJECT_CODE") {
    setPhase("none");
    return undefined;
  }
  setPhase("error");
  if (err.field) form.setError(err.field as "projectNumber", { type: "server", message: err.message ?? "" });
  else toast.error(err.message ?? "Couldn't save the draft");
  return undefined;
}
