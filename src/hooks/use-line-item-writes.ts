"use client";

import type { z } from "zod";
import { useMutation } from "convex/react";
import { createId } from "@paralleldrive/cuid2";
import { useSession, useActiveOrganization } from "@/lib/auth-client";
import { mapNativeWriteError } from "@/lib/native-writes";
import { computeLineTotal } from "@/hooks/use-native-line-item-writes";
import {
  lineItemSchema,
  customLineItemSchema,
} from "@/lib/validations/line-item";
import { api } from "../../convex/_generated/api";

/** The `.parse()` OUTPUT (Zod defaults applied, coerced numbers concrete) — the exact
 *  shape the consumers pass in, and what the server actions parse to before building
 *  their Convex payloads. */
type ParsedLineItem = z.output<typeof lineItemSchema>;
type ParsedCustomLineItem = z.output<typeof customLineItemSchema>;

/**
 * A shared value to apply to every selected line item in a bulk edit. Mirrors the shape
 * of the deleted `updateLineItemsBatch` server-action interface (src/server/line-items.ts)
 * — moved here so the browser-direct bulk edit and its consumers share one source of truth.
 */
export interface BulkLineItemPatch {
  pricingType?: "PER_DAY" | "PER_WEEK" | "FLAT" | "PER_HOUR" | "OPTIMIZED";
  /** `null` or a non-positive value clears the discount. `%` is resolved per-item. */
  discount?: { mode: "$" | "%"; value: number } | null;
  /** `null`/empty clears the note. */
  notes?: string | null;
  isOptional?: boolean;
}

/** The durable per-line accessory selection (issue #794) — mirrors
 *  `projectLineItems.accessoryPlan` (convex/schema.ts). Absent/undefined on `add`
 *  means template behaviour: every model DEFAULT, no OPTIONALs. */
export interface AccessoryPlanInput {
  excluded: string[];
  added: { bulkAssetId: string; quantityPerParent?: number }[];
  /** Required override reason per deselected DEFAULT (issue #794 follow-up). */
  excludedReasons?: { bulkAssetId: string; reason: string }[];
}

/**
 * Browser-direct LINE-ITEM writes (Phase 3 — the flag-gated, default-OFF twin of the
 * add/update/remove/reorder line-item server actions in src/server/line-items.ts).
 *
 * Each `api.lineItemWrites.*` mutation folds the FULL money orchestration —
 * availability enforcement, merge-dedup, auto-pricing, accessory expansion, the
 * in-transaction recalcProjectTotals, and audit — plus the collab/webhook side-effects
 * (gated on `emitSideEffects: true` / `emitActivity: true`, passed below) into ONE
 * transaction. The org default tax rate is resolved IN-mutation from orgSettings (the
 * source of truth), so the client never supplies it. The client mints entity + audit
 * cuids and supplies actor/orgId/now, exactly as use-project-groups-writes.ts does.
 *
 * `enabled` requires a resolved org + session; consumers guard the submit on it so the
 * write never fires before auth/org resolve (there is no server-action fallback).
 *
 * Security at the Convex boundary (mutations called with the USER token):
 * assertWritesEnabled + enforceBrowserWriteLimit + requireOrgPermission + resolveActor
 * (audit identity pinned to the verified token) + assertProjectInOrg / assertRefInOrg
 * (by_cuid is a GLOBAL index — every referenced row is org-validated in-mutation).
 */

/** The Convex `fields` payload addLineItemSmartNative expects — built EXACTLY as the
 *  server's addLineItem does (src/server/line-items.ts ~81-100). lineTotal is NOT
 *  passed: the mutation recomputes it after auto-pricing (the client is never trusted). */
function buildAddFields(parsed: ParsedLineItem) {
  return {
    type: parsed.type,
    // WS11 (#950) — set only on `type: "SALE"` lines, never inferred.
    saleMode: parsed.saleMode,
    modelId: parsed.modelId || undefined,
    assetId: parsed.assetId || undefined,
    bulkAssetId: parsed.bulkAssetId || undefined,
    description: parsed.description || undefined,
    quantity: parsed.quantity,
    unitPrice: parsed.unitPrice ?? undefined,
    pricingType: parsed.pricingType,
    duration: parsed.duration ?? undefined,
    discount: parsed.discount ?? undefined,
    groupName: parsed.groupName || undefined,
    notes: parsed.notes || undefined,
    isOptional: parsed.isOptional,
    showSubhireOnDocs: parsed.showSubhireOnDocs,
    supplierId: parsed.supplierId || undefined,
    subhireOrderNumber: parsed.subhireOrderNumber || undefined,
    categoryId: parsed.categoryId || undefined,
    groupId: parsed.groupId || undefined,
  };
}

/** patch `set` builder — a client-side byte-parity port of updateLineItem's set/clear
 *  building (src/server/line-items.ts ~712-773). Given a Zod-parsed LineItemFormValues,
 *  returns the exact `{ set, clear }` the server hands to patchLineItem/patchNative.
 *  Empty scalars are CLEARED; association fields are only touched when explicitly
 *  provided (undefined ⇒ keep existing). Exported so equipment-tab builds it and passes
 *  it to `update()`. */
export function buildLineItemSetClear(parsed: ParsedLineItem): {
  set: Record<string, unknown>;
  clear: string[];
} {
  const lineTotal = computeLineTotal(
    parsed.unitPrice,
    parsed.quantity,
    parsed.duration,
    parsed.discount,
  );

  const set: Record<string, unknown> = {
    type: parsed.type,
    quantity: parsed.quantity,
    pricingType: parsed.pricingType,
    duration: parsed.duration,
    isOptional: parsed.isOptional,
    showSubhireOnDocs: parsed.showSubhireOnDocs,
    updatedAt: Date.now(),
  };
  const clear: string[] = [];

  const setStr = (key: string, value: string | null | undefined) => {
    if (value === undefined || value === null || value === "") clear.push(key);
    else set[key] = value;
  };
  const setNum = (key: string, value: number | null | undefined) => {
    if (value === undefined || value === null) clear.push(key);
    else set[key] = value;
  };

  setStr("description", parsed.description);
  setNum("unitPrice", parsed.unitPrice ?? null);
  setNum("discount", parsed.discount ?? null);
  setNum("lineTotal", lineTotal);
  setStr("groupName", parsed.groupName);
  setStr("notes", parsed.notes);
  setStr("subhireOrderNumber", parsed.subhireOrderNumber);

  if (parsed.modelId !== undefined) setStr("modelId", parsed.modelId);
  if (parsed.assetId !== undefined) setStr("assetId", parsed.assetId);
  if (parsed.bulkAssetId !== undefined) setStr("bulkAssetId", parsed.bulkAssetId);
  if (parsed.supplierId !== undefined) setStr("supplierId", parsed.supplierId);

  return { set, clear };
}

export function useLineItemWrites() {
  const { data: session } = useSession();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const addM = useMutation(api.lineItemWrites.addLineItemSmartNative);
  const updateAccessoryPlanM = useMutation(api.lineItemWrites.updateAccessoryPlanNative);
  const addCustomM = useMutation(api.lineItemWrites.addCustomNative);
  const addKitM = useMutation(api.lineItemWrites.addKitNative);
  const patchM = useMutation(api.lineItemWrites.patchNative);
  const removeM = useMutation(api.lineItemWrites.removeNative);
  const removeManyM = useMutation(api.lineItemWrites.removeManyNative);
  const patchManyM = useMutation(api.lineItemWrites.patchManyNative);
  const reorderM = useMutation(api.lineItemWrites.reorderNative);
  const unsellM = useMutation(api.lineItemWrites.unsellLineItemNative);

  const actor = () => ({
    userId: session?.user.id ?? "",
    userName: session?.user.name ?? "",
  });
  const requireOrg = (): string => {
    if (!orgId) throw new Error("No active organization");
    return orgId;
  };

  const enabled = !!orgId && !!session?.user;

  return {
    enabled,

    /** Smart add — availability + merge-dedup + auto-pricing + accessory expansion +
     *  recalc + audit + collab/webhook, all atomic. Returns `{ id, merged }`. */
    add: async (
      projectId: string,
      parsed: ParsedLineItem,
      opts: {
        allowOverbook: boolean;
        forceSeparate: boolean;
        includeAccessories: boolean;
        accessoryPlan?: AccessoryPlanInput;
      },
    ): Promise<{ id: string; merged: boolean; saleWarning?: string }> => {
      try {
        return await addM({
          id: createId(),
          organizationId: requireOrg(),
          projectId,
          fields: buildAddFields(parsed),
          allowOverbook: opts.allowOverbook,
          forceSeparate: opts.forceSeparate,
          includeAccessories: opts.includeAccessories,
          accessoryPlan: opts.accessoryPlan,
          actor: actor(),
          auditId: createId(),
          emitSideEffects: true,
          now: Date.now(),
        });
      } catch (e) {
        throw mapNativeWriteError(e);
      }
    },

    /** Custom (non-inventory) item add. `groupName` is resolved from groupId by the
     *  caller (which has the group list locally); the server resolved it via a Convex
     *  round-trip. Custom lineTotal is computed here (server does the same). */
    addCustom: async (
      projectId: string,
      parsed: ParsedCustomLineItem,
      opts?: { groupName?: string },
    ): Promise<{ id: string }> => {
      const lineTotal = computeLineTotal(
        parsed.unitPrice,
        parsed.quantity,
        parsed.duration,
        parsed.discount,
      );
      try {
        return await addCustomM({
          id: createId(),
          organizationId: requireOrg(),
          projectId,
          fields: {
            description: parsed.description,
            quantity: parsed.quantity,
            unitPrice: parsed.unitPrice ?? undefined,
            pricingType: parsed.pricingType,
            duration: parsed.duration,
            discount: parsed.discount ?? undefined,
            notes: parsed.notes ?? undefined,
            isOptional: parsed.isOptional,
            categoryId: parsed.categoryId ?? undefined,
            groupId: parsed.groupId ?? undefined,
            groupName: opts?.groupName ?? undefined,
            lineTotal: lineTotal ?? undefined,
          },
          actor: actor(),
          auditId: createId(),
          emitSideEffects: true,
          now: Date.now(),
        });
      } catch (e) {
        throw mapNativeWriteError(e);
      }
    },

    /** Kit add — parent + expanded member children + recalc + audit, atomic. The
     *  "kit_added" collab is gated on emitActivity (NOT emitSideEffects). */
    addKit: async (
      projectId: string,
      kitId: string,
      opts: {
        pricingMode: "KIT_PRICE" | "ITEMIZED";
        unitPrice?: number;
        discount?: number;
        groupName?: string;
        categoryId?: string;
        groupId?: string;
        kitLabel: string;
      },
    ): Promise<{ id: string }> => {
      try {
        return await addKitM({
          id: createId(),
          organizationId: requireOrg(),
          projectId,
          kitId,
          unitPrice: opts.unitPrice ?? undefined,
          discount: opts.discount ?? undefined,
          pricingMode: opts.pricingMode,
          groupName: opts.groupName || undefined,
          categoryId: opts.categoryId || undefined,
          groupId: opts.groupId || undefined,
          kitLabel: opts.kitLabel,
          emitActivity: true,
          actor: actor(),
          auditId: createId(),
          now: Date.now(),
        });
      } catch (e) {
        throw mapNativeWriteError(e);
      }
    },

    /** Post-add "Edit accessories" (issue #794) — reconciles child lines to the new
     *  plan; throws if the line has already deployed (server-enforced lock). */
    updateAccessoryPlan: async (id: string, plan: AccessoryPlanInput): Promise<{ ok: boolean }> => {
      try {
        return await updateAccessoryPlanM({
          id,
          organizationId: requireOrg(),
          accessoryPlan: plan,
          actor: actor(),
          auditId: createId(),
          now: Date.now(),
        });
      } catch (e) {
        throw mapNativeWriteError(e);
      }
    },

    /** Patch an existing line — RBAC + availability re-check (on qty increase) + patch/
     *  clear + recalc + audit + collab, atomic. Caller pre-builds set/clear via
     *  buildLineItemSetClear. NOTE: no baseUpdatedAt / stale-revision guard (patchNative
     *  doesn't take one) — edit locks remain the first line of defence. */
    update: async (
      id: string,
      set: Record<string, unknown>,
      clear: string[],
      opts: { entityName: string; allowOverbook: boolean },
    ): Promise<{ projectId: string }> => {
      try {
        return await patchM({
          id,
          orgId: requireOrg(),
          set,
          clear,
          entityName: opts.entityName,
          allowOverbook: opts.allowOverbook,
          actor: actor(),
          auditId: createId(),
          emitSideEffects: true,
          now: Date.now(),
        });
      } catch (e) {
        throw mapNativeWriteError(e);
      }
    },

    /** Remove a line — child-guard + cascade (children + units) + recalc + audit +
     *  collab, atomic. */
    remove: async (id: string): Promise<{ projectId: string }> => {
      try {
        return await removeM({
          id,
          orgId: requireOrg(),
          actor: actor(),
          auditId: createId(),
          emitSideEffects: true,
          now: Date.now(),
        });
      } catch (e) {
        throw mapNativeWriteError(e);
      }
    },

    /** WS11 (#950) — reverse a FROM_RENTAL_STOCK sale: the sold asset returns to
     *  AVAILABLE (or a bulk decrement is restored). The line item itself is
     *  untouched — pair with `remove(id)` to also delete it if the sale is being
     *  undone entirely. */
    unsell: async (id: string): Promise<{ projectId: string }> => {
      try {
        return await unsellM({
          id,
          orgId: requireOrg(),
          actor: actor(),
          auditId: createId(),
          now: Date.now(),
        });
      } catch (e) {
        throw mapNativeWriteError(e);
      }
    },

    /** Bulk remove — one atomic backend-local pass: child-guard + cascade (children +
     *  units) per row + ONE aggregate DELETE audit + recalc-per-project. Returns
     *  `{ removed, skipped }` (children/cross-org rows counted as skipped). */
    removeMany: async (ids: string[]): Promise<{ removed: number; skipped: number }> => {
      if (!enabled) throw new Error("Not ready — try again in a moment.");
      try {
        return await removeManyM({
          ids,
          orgId: requireOrg(),
          actor: actor(),
          auditId: createId(),
          now: Date.now(),
        });
      } catch (e) {
        throw mapNativeWriteError(e);
      }
    },

    /** Bulk edit shared fields (pricing type / discount / notes / optional) across the
     *  selection, one atomic pass. The %/lineTotal recompute runs in-mutation off each
     *  row's OWN money fields. Returns `{ updated, skipped }`. */
    updateMany: async (
      ids: string[],
      patch: BulkLineItemPatch,
    ): Promise<{ updated: number; skipped: number }> => {
      if (!enabled) throw new Error("Not ready — try again in a moment.");
      try {
        return await patchManyM({
          ids,
          orgId: requireOrg(),
          patch,
          actor: actor(),
          auditId: createId(),
          now: Date.now(),
        });
      } catch (e) {
        throw mapNativeWriteError(e);
      }
    },

    /** Reorder line items (+ optional per-row groupName change). Builds the same
     *  `items` payload as reorderLineItems (src/server/line-items.ts ~1350-1361). No
     *  emit signal — reorder folds no collab event. */
    reorder: async (
      _projectId: string,
      itemIds: string[],
      groupUpdates?: { id: string; groupName: string | null }[],
    ): Promise<{ ok: boolean }> => {
      const groupNameById = new Map((groupUpdates ?? []).map((g) => [g.id, g.groupName]));
      const orderedSet = new Set(itemIds);
      const items: { id: string; sortOrder: number; groupName?: string }[] = itemIds.map(
        (id, index) => ({
          id,
          sortOrder: index,
          ...(groupNameById.has(id) ? { groupName: groupNameById.get(id) || undefined } : {}),
        }),
      );
      let extraSort = itemIds.length;
      for (const { id, groupName } of groupUpdates ?? []) {
        if (orderedSet.has(id)) continue;
        items.push({ id, sortOrder: extraSort++, groupName: groupName || undefined });
      }
      return reorderM({ orgId: requireOrg(), items, now: Date.now() });
    },
  };
}
