"use client";

import { useMutation } from "convex/react";
import { logger } from "@/lib/logger";
import type { FunctionArgs } from "convex/server";
import { ConvexError } from "convex/values";
import { createId } from "@paralleldrive/cuid2";
import { useSession } from "@/lib/auth-client";
import { mapNativeWriteError } from "@/lib/native-writes";
// Concrete-module imports only (NOT the "@/lib/validations" or "@/server/projects"
// barrels) — this file is imported by client components, and pulling in a barrel
// that also re-exports server-only code trips Turbopack's scope-hoist merge
// (`EcmascriptModuleContent::new_merged failed`). See the CLAUDE.md composition note.
import { UserFacingError } from "@/lib/errors/user-facing-error";
import { projectSchema, type ProjectFormValues } from "@/lib/validations/project";
import { datePartsInTimezone } from "@/lib/project-number";
import {
  getProjectNumberConfig,
  peekNextTemplateCode,
  checkProjectNumberAvailable,
} from "@/server/projects";
import { useLocations } from "@/hooks/use-locations";
import { api } from "../../convex/_generated/api";

/**
 * Native OPTIMISTIC client write for the three project notes fields (crewNotes /
 * internalNotes / clientNotes) — Phase 3 browser-direct, the project mirror of
 * use-native-kit-writes.ts. Swaps the `updateProjectNotes` server-action call for a
 * direct `useMutation(api.projectWrites.updateNotesNative).withOptimisticUpdate(...)`.
 *
 * The project detail page reads via the native reconstruction
 * (`useNativeProjectDetail` → `reconstructProjectDetail(projectDetail.bundle, …)`),
 * where the notes live on `detail.project`. The optimistic patch therefore rewrites
 * that field on the underlying `projectDetail.bundle` query so the reconstruction
 * re-renders instantly, then reconciles to the server result (rolls back on failure).
 *
 * Security at the Convex boundary (mutation called with the USER token):
 * `assertWritesEnabled(project)` + `enforceBrowserWriteLimit` + `requireOrgPermission`
 * + `resolveActor` (audit identity pinned to the verified token).
 */
type NotesField = "crewNotes" | "internalNotes" | "clientNotes";

export function useOptimisticProjectNotes(projectId: string, orgId: string | undefined) {
  const { data: session } = useSession();

  const mutate = useMutation(api.projectWrites.updateNotesNative).withOptimisticUpdate(
    (localStore, args) => {
      if (!orgId) return;
      const current = localStore.getQuery(api.projectDetail.bundle, { projectId, orgId });
      // `undefined` = still loading; `null` = not found/permitted — nothing to patch.
      if (!current) return;
      localStore.setQuery(
        api.projectDetail.bundle,
        { projectId, orgId },
        {
          ...current,
          project: { ...current.project, [args.field]: args.notes ?? undefined },
        },
      );
    },
  );

  const enabled = !!orgId && !!session?.user;

  /** Optimistic notes save for one field. Resolves once the server confirms; rolls back on failure. */
  const save = async (field: NotesField, notes: string): Promise<void> => {
    if (!orgId || !session?.user) return;
    await mutate({
      id: projectId,
      orgId,
      field,
      notes: notes || null,
      actor: { userId: session.user.id, userName: session.user.name ?? "" },
      auditId: createId(),
      now: Date.now(),
    });
  };

  return { enabled, save };
}

/**
 * Native browser-direct project STATUS write — Phase 3.
 * Swaps the `updateProjectStatus` server action for a direct
 * `useMutation(api.projectWrites.updateStatusNative)`, passing `emitSideEffects: true`
 * so the mutation folds the `project.status_changed` webhook in-transaction.
 *
 * The board/detail views read status via reactive `useQuery`, so the transition
 * re-renders on its own — no optimistic patch needed here. ConvexError codes map back
 * to the same UserFacingError toasts via `mapNativeWriteError`.
 *
 * Security at the Convex boundary (USER token): assertWritesEnabled(project) +
 * enforceBrowserWriteLimit + requireOrgPermission(project, update) + resolveActor
 * (audit identity pinned to the verified token).
 */
type StatusArg = FunctionArgs<typeof api.projectWrites.updateStatusNative>["status"];

export function useNativeProjectStatus(orgId: string | undefined) {
  const { data: session } = useSession();
  const mutate = useMutation(api.projectWrites.updateStatusNative);

  const enabled = !!orgId && !!session?.user;

  /** Change a project's status browser-direct. Resolves once the server confirms. */
  const updateStatus = async (projectId: string, status: string): Promise<void> => {
    if (!orgId || !session?.user) throw new Error("Not ready");
    try {
      await mutate({
        id: projectId,
        orgId,
        status: status as StatusArg,
        emitSideEffects: true,
        actor: { userId: session.user.id, userName: session.user.name ?? "" },
        auditId: createId(),
        now: Date.now(),
      });
    } catch (e) {
      throw mapNativeWriteError(e);
    }
  };

  return { enabled, updateStatus };
}

/**
 * Map a ConvexError thrown by createNative/updateNative/duplicateNative/
 * saveAsTemplateNative/deleteNative back to the rich UserFacingError the deleted
 * server actions (`createProject`/`updateProject`/`duplicateProject`/
 * `saveAsTemplate`/`deleteProject` in src/server/projects.ts) used to throw, so the
 * toast/inline-field UX is byte-for-byte identical whether the write ran on the
 * legacy server-action path or browser-direct. Handles NOT_FOUND (source/target
 * gone), DUPLICATE_PROJECT_CODE (number clash on duplicate/saveAsTemplate — create's
 * own clash comes back as a `{created:false}` RETURN value, handled inline in
 * `create()`, not through this mapper) and DELETE_GUARD (not-cancelled / template).
 * Anything else falls through to the shared `mapNativeWriteError`.
 */
function mapProjectWriteError(e: unknown, isTemplate = false): unknown {
  if (
    e instanceof ConvexError &&
    e.data &&
    typeof e.data === "object" &&
    "code" in e.data &&
    typeof (e.data as { code: unknown }).code === "string"
  ) {
    const code = (e.data as { code: string }).code;
    const message =
      typeof (e.data as { message?: unknown }).message === "string"
        ? (e.data as { message: string }).message
        : undefined;
    if (code === "NOT_FOUND") {
      return new UserFacingError({
        code: "NOT_FOUND",
        title: "Project not found",
        message: "This project was deleted or moved. Refresh the page to see the latest state.",
      });
    }
    if (code === "DUPLICATE_PROJECT_CODE") {
      return new UserFacingError({
        code,
        title: isTemplate ? "Template code already in use" : "Project code already in use",
        message: message ?? `A ${isTemplate ? "template" : "project"} with that code already exists.`,
        field: "projectNumber",
      });
    }
    if (code === "DELETE_GUARD") {
      return new UserFacingError({
        code,
        title: "Cannot delete this project",
        message: message ?? "Only cancelled projects can be deleted.",
        hint: "Set the project status to Cancelled first, then try again.",
      });
    }
  }
  return mapNativeWriteError(e);
}

/**
 * Native browser-direct project WRITE hook — Phase 3 (Slice A: archive + template
 * delete) + Phase 3 Slice B (create/update/duplicate/saveAsTemplate/remove, the
 * former `createProject`/`updateProject`/`duplicateProject`/`saveAsTemplate`/
 * `deleteProject` server actions in src/server/projects.ts, now calling the SAME
 * already-prod-hardened `*Native` mutations directly with the user's token instead
 * of relaying through a service-token server action). Status has its own dedicated
 * `useNativeProjectStatus` (both consumers already use it); notes has
 * `useOptimisticProjectNotes`. Each method mints a client cuid for the audit row,
 * pins the actor to the verified session, and passes `now: Date.now()`.
 *
 * Security at the Convex boundary (USER token): assertWritesEnabled(project) +
 * enforceBrowserWriteLimit + requireOrgPermission(project, create|update|delete) +
 * resolveActor (audit identity pinned to the verified token). ConvexError codes
 * map back to the same UserFacingError toasts via `mapProjectWriteError`.
 *
 * `create`/`saveAsTemplate` need the org's auto-number config / next template code
 * — small READ-ONLY server actions stay in place for these (`getProjectNumberConfig`,
 * `peekNextTemplateCode`, `checkProjectNumberAvailable`, all in src/server/projects.ts)
 * exactly like the pre-existing `peekNextProjectNumber` kept read. `duplicate`/
 * `saveAsTemplate` money: `orgDefaultTaxRate` is resolved IN-MUTATION from the
 * `orgSettings` mirror (`duplicateNative`/`saveAsTemplateNative` — hardened alongside
 * this slice; a client-supplied value is accepted-but-ignored for expand-contract
 * back-compat only). `remove` resolves `defaultLocationId` from the already-
 * client-readable `useLocations(orgId)` reactive list (same source `getDefaultLocation`
 * used to read server-side).
 */
export function useProjectWrites(orgId: string | undefined) {
  const { data: session } = useSession();
  const archiveM = useMutation(api.projectWrites.archiveNative);
  const deleteTemplateM = useMutation(api.projectWrites.deleteTemplateNative);
  const createM = useMutation(api.projectWrites.createNative);
  const updateM = useMutation(api.projectWrites.updateNative);
  const duplicateM = useMutation(api.projectWrites.duplicateNative);
  const saveAsTemplateM = useMutation(api.projectWrites.saveAsTemplateNative);
  const deleteM = useMutation(api.projectWrites.deleteNative);
  const recalcM = useMutation(api.lineItemWrites.recalcNative);

  const locations = useLocations(orgId);

  const enabled = !!orgId && !!session?.user;

  /** Cancel (archive) a project browser-direct. Resolves once the server confirms. */
  const archive = async (projectId: string): Promise<void> => {
    if (!orgId || !session?.user) throw new Error("Not ready");
    try {
      await archiveM({
        id: projectId,
        orgId,
        actor: { userId: session.user.id, userName: session.user.name ?? "" },
        auditId: createId(),
        now: Date.now(),
      });
    } catch (e) {
      throw mapNativeWriteError(e);
    }
  };

  /** Delete a project TEMPLATE browser-direct (full cascade runs in-mutation). */
  const deleteTemplate = async (templateId: string): Promise<void> => {
    if (!orgId || !session?.user) throw new Error("Not ready");
    try {
      await deleteTemplateM({
        id: templateId,
        orgId,
        actor: { userId: session.user.id, userName: session.user.name ?? "" },
        now: Date.now(),
      });
    } catch (e) {
      throw mapNativeWriteError(e);
    }
  };

  /**
   * Create a project (or template) browser-direct — the former `createProject`.
   * Zod-validates the form data (mirrors the server's `projectSchema.parse`), then
   * either allocates an auto number IN-mutation (`autoNumber` config) or passes a
   * manual/template number directly. A manual/template number clash comes back as
   * `{created:false}` (auto retries internally in `createNative`, so a single call
   * suffices) — mirrors the server's hard-duplicate throw exactly, no client retry.
   */
  const create = async (
    data: ProjectFormValues & { isTemplate?: boolean },
  ): Promise<{ id: string }> => {
    if (!orgId || !session?.user) throw new Error("Not ready");
    const parsed = projectSchema.parse(data);
    const isTemplate = data.isTemplate ?? false;

    // Auto project-number config only matters on the non-template blank-code path
    // (mirrors the server's `useAutoNumber` derivation) — skip the read otherwise.
    const autoConfig =
      !isTemplate && !parsed.projectNumber ? await getProjectNumberConfig() : null;
    const useAutoNumber = !isTemplate && !parsed.projectNumber && !!autoConfig;

    if (!isTemplate && !parsed.projectNumber && !useAutoNumber) {
      throw new UserFacingError({
        code: "MISSING_PROJECT_CODE",
        title: "Project code is required",
        message: "Enter a project code (e.g. P-2024-001) before saving.",
        field: "projectNumber",
      });
    }

    // Templates without an explicit code get a template code (pre-mutation is fine
    // — no shared counter). Auto project numbers are allocated INSIDE createNative
    // so the sequence bump and the create commit (or roll back) together.
    const templateNumber =
      isTemplate && !parsed.projectNumber ? await peekNextTemplateCode() : null;

    const id = createId();
    const now = new Date();
    const baseArgs = {
      id,
      organizationId: orgId,
      isTemplate,
      name: parsed.name,
      clientId: parsed.clientId || undefined,
      status: parsed.status,
      type: parsed.type,
      description: parsed.description || undefined,
      locationId: parsed.locationId || undefined,
      siteContactName: parsed.siteContactName || undefined,
      siteContactPhone: parsed.siteContactPhone || undefined,
      siteContactEmail: parsed.siteContactEmail || undefined,
      loadInDate: parsed.loadInDate?.getTime(),
      loadInTime: parsed.loadInTime || undefined,
      eventStartDate: parsed.eventStartDate?.getTime(),
      eventStartTime: parsed.eventStartTime || undefined,
      eventEndDate: parsed.eventEndDate?.getTime(),
      eventEndTime: parsed.eventEndTime || undefined,
      loadOutDate: parsed.loadOutDate?.getTime(),
      loadOutTime: parsed.loadOutTime || undefined,
      rentalStartDate: parsed.rentalStartDate?.getTime(),
      rentalEndDate: parsed.rentalEndDate?.getTime(),
      crewNotes: parsed.crewNotes || undefined,
      internalNotes: parsed.internalNotes || undefined,
      clientNotes: parsed.clientNotes || undefined,
      billingWeeksOverride: parsed.billingWeeksOverride ?? undefined,
      billingDaysOverride: parsed.billingDaysOverride ?? undefined,
      taxRate: parsed.taxRate ?? undefined,
      discountPercent: parsed.discountPercent ?? undefined,
      depositPercent: parsed.depositPercent ?? undefined,
      depositPaid: parsed.depositPaid ?? undefined,
      invoicedTotal: parsed.invoicedTotal ?? undefined,
      tags: parsed.tags,
      createdAt: now.getTime(),
      updatedAt: now.getTime(),
    };

    try {
      const created = await createM({
        ...baseArgs,
        ...(useAutoNumber
          ? {
              autoNumber: {
                format: autoConfig!.format,
                reset: autoConfig!.reset,
                padding: autoConfig!.padding,
                parts: datePartsInTimezone(now, autoConfig!.timezone),
              },
            }
          : { projectNumber: templateNumber ?? parsed.projectNumber! }),
        actor: { userId: session.user.id, userName: session.user.name ?? "" },
        auditId: createId(),
      });
      // A manual/template number clash is a hard duplicate (auto retries in-mutation).
      if (!created.created) {
        throw new UserFacingError({
          code: "DUPLICATE_PROJECT_CODE",
          title: "Project code already in use",
          message: `A ${isTemplate ? "template" : "project"} with code "${templateNumber ?? parsed.projectNumber}" already exists.`,
          field: "projectNumber",
        });
      }
      return { id: created.id };
    } catch (e) {
      if (e instanceof UserFacingError) throw e;
      throw mapProjectWriteError(e, isTemplate);
    }
  };

  /**
   * Update a project browser-direct — the former `updateProject`. Zod-validates,
   * then re-checks the (possibly edited) project code isn't taken by a sibling —
   * `updateNative` does NOT re-check uniqueness itself (only `createNative` does),
   * so this backstop (reusing the same kept `checkProjectNumberAvailable` read the
   * wizard already calls up-front for the inline field error) has to stay client-side.
   * The blocked-forward-status blocking-comments gate now runs INSIDE `updateNative`
   * itself, so it needs no client replication. Best-effort recalc mirrors the
   * server's non-fatal try/catch when `taxRate` changes.
   */
  const update = async (
    id: string,
    data: ProjectFormValues,
    isTemplate = false,
  ): Promise<{ id: string }> => {
    if (!orgId || !session?.user) throw new Error("Not ready");
    const parsed = projectSchema.parse(data);

    if (parsed.projectNumber) {
      const { available } = await checkProjectNumberAvailable(parsed.projectNumber, id);
      if (!available) {
        throw new UserFacingError({
          code: "DUPLICATE_PROJECT_CODE",
          title: "Project code already in use",
          message: `A ${isTemplate ? "template" : "project"} with code "${parsed.projectNumber}" already exists.`,
          field: "projectNumber",
        });
      }
    }

    const set: Record<string, unknown> = {
      projectNumber: parsed.projectNumber,
      name: parsed.name,
      status: parsed.status,
      type: parsed.type,
      tags: parsed.tags,
      updatedAt: Date.now(),
    };
    const clear: string[] = [];
    const setOrClear = (key: string, value: unknown) => {
      if (value === null || value === undefined || value === "") clear.push(key);
      else set[key] = value;
    };
    setOrClear("clientId", parsed.clientId || null);
    setOrClear("description", parsed.description || null);
    setOrClear("locationId", parsed.locationId || null);
    setOrClear("siteContactName", parsed.siteContactName || null);
    setOrClear("siteContactPhone", parsed.siteContactPhone || null);
    setOrClear("siteContactEmail", parsed.siteContactEmail || null);
    setOrClear("loadInDate", parsed.loadInDate?.getTime() ?? null);
    setOrClear("loadInTime", parsed.loadInTime || null);
    setOrClear("eventStartDate", parsed.eventStartDate?.getTime() ?? null);
    setOrClear("eventStartTime", parsed.eventStartTime || null);
    setOrClear("eventEndDate", parsed.eventEndDate?.getTime() ?? null);
    setOrClear("eventEndTime", parsed.eventEndTime || null);
    setOrClear("loadOutDate", parsed.loadOutDate?.getTime() ?? null);
    setOrClear("loadOutTime", parsed.loadOutTime || null);
    setOrClear("rentalStartDate", parsed.rentalStartDate?.getTime() ?? null);
    setOrClear("rentalEndDate", parsed.rentalEndDate?.getTime() ?? null);
    // #943: absent = derived billing summary; a set value is the manual override
    // (0 is a legitimate override — e.g. "0 weeks" — so use `!= null`, not `||`,
    // unlike the retired defaultRentalPeriod/Quantity fields this replaces).
    setOrClear("billingWeeksOverride", parsed.billingWeeksOverride ?? null);
    setOrClear("billingDaysOverride", parsed.billingDaysOverride ?? null);
    setOrClear("taxRate", parsed.taxRate ?? null);
    setOrClear("crewNotes", parsed.crewNotes || null);
    setOrClear("internalNotes", parsed.internalNotes || null);
    setOrClear("clientNotes", parsed.clientNotes || null);
    setOrClear("discountPercent", parsed.discountPercent ?? null);
    setOrClear("depositPercent", parsed.depositPercent ?? null);
    setOrClear("depositPaid", parsed.depositPaid ?? null);
    setOrClear("invoicedTotal", parsed.invoicedTotal ?? null);

    try {
      await updateM({
        id,
        orgId,
        set,
        clear,
        actor: { userId: session.user.id, userName: session.user.name ?? "" },
        auditId: createId(),
        now: Date.now(),
      });
    } catch (e) {
      throw mapProjectWriteError(e, isTemplate);
    }

    // Recalculate totals if tax rate changed. Best-effort: the project patch already
    // committed, so a transient recalc failure must not reject an otherwise-successful
    // update. Totals are derived and self-heal on the next line-item write / recalc.
    if (parsed.taxRate !== undefined) {
      try {
        await recalcM({ projectId: id, orgId, now: Date.now() });
      } catch (e) {
        logger.error("post-update recalc failed (non-fatal)", { error: e });
      }
    }

    return { id };
  };

  /**
   * Duplicate a project browser-direct — the former `duplicateProject`. The entire
   * deep-copy (categories → groups → line items → PMs → recalc) runs in ONE atomic
   * mutation. Org default tax rate is resolved IN-MUTATION from `orgSettings` — not
   * sent from here.
   */
  const duplicate = async (
    sourceId: string,
    newProjectNumber: string,
    newName: string,
  ): Promise<{ id: string }> => {
    if (!orgId || !session?.user) throw new Error("Not ready");
    const newProjectId = createId();
    try {
      const result = await duplicateM({
        sourceId,
        newId: newProjectId,
        newProjectNumber,
        newName,
        orgId,
        now: Date.now(),
        actor: { userId: session.user.id, userName: session.user.name ?? "" },
        auditId: createId(),
      });
      return { id: result.id };
    } catch (e) {
      throw mapProjectWriteError(e, false);
    }
  };

  /**
   * Snapshot a project as a TEMPLATE browser-direct — the former `saveAsTemplate`.
   * `templateNumber` comes from the kept `peekNextTemplateCode` read (mirrors the
   * server's inline `generateTemplateCode` call). Org default tax rate is resolved
   * IN-MUTATION from `orgSettings` — not sent from here.
   */
  const saveAsTemplate = async (
    projectId: string,
    templateName: string,
  ): Promise<{ id: string }> => {
    if (!orgId || !session?.user) throw new Error("Not ready");
    const templateId = createId();
    const templateNumber = await peekNextTemplateCode();
    try {
      const result = await saveAsTemplateM({
        sourceId: projectId,
        newId: templateId,
        templateNumber,
        templateName,
        orgId,
        now: Date.now(),
        actor: { userId: session.user.id, userName: session.user.name ?? "" },
      });
      return { id: result.id };
    } catch (e) {
      throw mapProjectWriteError(e, true);
    }
  };

  /**
   * Delete a project browser-direct — the former `deleteProject`. The full 8-step
   * cascade (free checked-out assets/kits, cascade lines/crew/managers/tasks/
   * services/grouping, purge the revenue rollup, then the row) runs atomically
   * INSIDE `deleteNative`, including the CANCELLED + non-template re-checks — this
   * only resolves `defaultLocationId` (mirrors the server's `getDefaultLocation`)
   * from the already-subscribed `useLocations` list. Returns the freed asset/kit
   * counts `deleteNative` computes in-mutation (never trusted from the client).
   */
  const remove = async (id: string): Promise<{ freedAssets: number; freedKits: number }> => {
    if (!orgId || !session?.user) throw new Error("Not ready");
    const defaultLocationId = locations?.find((l) => l.isDefault)?.id ?? null;
    try {
      const result = await deleteM({
        id,
        orgId,
        defaultLocationId,
        actor: { userId: session.user.id, userName: session.user.name ?? "" },
        auditId: createId(),
        now: Date.now(),
      });
      return { freedAssets: result.freedAssets, freedKits: result.freedKits };
    } catch (e) {
      throw mapProjectWriteError(e);
    }
  };

  return { enabled, archive, deleteTemplate, create, update, duplicate, saveAsTemplate, remove };
}
