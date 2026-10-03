"use client";

import type { z } from "zod";
import { useMutation } from "convex/react";
import { createId } from "@paralleldrive/cuid2";
import { useSession, useActiveOrganization } from "@/lib/auth-client";
import { mapNativeWriteError } from "@/lib/native-writes";
import { computeLineTotal } from "@/hooks/use-native-line-item-writes";
import type { DiscountMode } from "@/lib/discount-mode";
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
  /** `null` or a non-positive value clears the discount. `%` is resolved per-item.
   *  The `mode` is ALSO persisted (as `discountMode`) so documents can print the
   *  discount the way it was entered (#1012). */
  discount?: { mode: DiscountMode; value: number } | null;
  /** `null`/empty clears the note. */
  notes?: string | null;
  isOptional?: boolean;
  /** T3 (#1091) — per-line tax rate override; `null` clears back to
   *  inheriting the project/org rate. See docs/designs/tax-model.md §3. */
  taxRate?: number | null;
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

/** The Convex `fields` payload addCustomNative expects — split out of `addCustom` below
 *  to keep its complexity down (R-3.6), mirroring `buildAddFields` above. `taxRate` is
 *  T3 (#1091)'s per-line override, see docs/designs/tax-model.md §3. */
function buildCustomAddFields(parsed: ParsedCustomLineItem, groupName: string | undefined, lineTotal: number | null) {
  return {
    description: parsed.description,
    quantity: parsed.quantity,
    unitPrice: parsed.unitPrice ?? undefined,
    pricingType: parsed.pricingType,
    duration: parsed.duration,
    discount: parsed.discount ?? undefined,
    discountMode: parsed.discountMode,
    taxRate: parsed.taxRate ?? undefined,
    notes: parsed.notes ?? undefined,
    isOptional: parsed.isOptional,
    categoryId: parsed.categoryId ?? undefined,
    groupId: parsed.groupId ?? undefined,
    groupName: groupName ?? undefined,
    lineTotal: lineTotal ?? undefined,
  };
}

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
    // #1012 — the entry shape rides with the resolved amount. The mutations
    // enforce "no amount, no mode" server-side, so no client-side guard here.
    discountMode: parsed.discountMode,
    // T3 (#1091) — per-line tax rate override; see docs/designs/tax-model.md §3.
    taxRate: parsed.taxRate ?? undefined,
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
  // #1012 — `discountMode` is set/cleared in lockstep with `discount` (it
  // describes that exact number, so it must never outlive it). patchNative
  // re-asserts the same invariant server-side.
  if (parsed.discount != null) set.discountMode = parsed.discountMode ?? "$";
  else clear.push("discountMode");
  setNum("lineTotal", lineTotal);
  // T3 (#1091) — blank clears the override back to inheriting the project/org
  // rate, same "empty means clear" convention every other optional numeric
  // override on this table already follows.
  setNum("taxRate", parsed.taxRate ?? null);
  setStr("groupName", parsed.groupName);
  setStr("notes", parsed.notes);
  setStr("subhireOrderNumber", parsed.subhireOrderNumber);
  setStr("xeroAccountCode", parsed.xeroAccountCode);
  setStr("xeroTaxType", parsed.xeroTaxType);

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
  const resyncProjectAccessoriesM = useMutation(api.lineItemWrites.resyncProjectAccessoriesNative);
  const resyncProjectKitsM = useMutation(api.lineItemWrites.resyncProjectKitsNative);
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
        /** #1221 follow-up — the version this new line lands on, defaulting
         *  to live (server-side) when omitted. */
        versionId?: string;
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
          versionId: opts.versionId,
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
      // #1221 follow-up — `versionId` (optional) is the version this new
      // line lands on, defaulting to live (server-side) when omitted.
      opts?: { groupName?: string; versionId?: string },
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
          fields: buildCustomAddFields(parsed, opts?.groupName, lineTotal),
          versionId: opts?.versionId,
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
        /** #1012 — how `discount` was entered; stored for document display. */
        discountMode?: DiscountMode;
        /** T3 (#1091) — per-line tax rate override, applied to the kit's
         *  PARENT line only; see docs/designs/tax-model.md §3. */
        taxRate?: number;
        groupName?: string;
        categoryId?: string;
        groupId?: string;
        kitLabel: string;
        /** #1221 follow-up — the version this new kit (parent + member
         *  children) lands on, defaulting to live (server-side) when omitted. */
        versionId?: string;
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
          discountMode: opts.discount != null ? opts.discountMode : undefined,
          taxRate: opts.taxRate ?? undefined,
          pricingMode: opts.pricingMode,
          groupName: opts.groupName || undefined,
          categoryId: opts.categoryId || undefined,
          groupId: opts.groupId || undefined,
          kitLabel: opts.kitLabel,
          versionId: opts.versionId,
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

    /** Re-run accessory expansion for every not-yet-deployed line against CURRENT
     *  catalog defaults (a model/asset accessory added after the line was created).
     *  PM-initiated per project — see `resyncProjectAccessoriesNative` for why this
     *  is never automatic. */
    resyncProjectAccessories: async (
      projectId: string,
    ): Promise<{ linesChecked: number; linesUpdated: number; childrenAdded: number; childrenRemoved: number }> => {
      try {
        return await resyncProjectAccessoriesM({
          projectId,
          organizationId: requireOrg(),
          actor: actor(),
          auditId: createId(),
          now: Date.now(),
        });
      } catch (e) {
        throw mapNativeWriteError(e);
      }
    },

    /** Re-run kit-membership expansion for every not-yet-deployed kit parent line
     *  against the kit's CURRENT `KitSerializedItem`/`KitBulkItem` membership (a
     *  member added/removed on the kit in the catalog AFTER it was already added
     *  to this job). PM-initiated per project — see `resyncProjectKitsNative` for
     *  why this is never automatic, and for how a newly-added member gets priced. */
    resyncProjectKits: async (
      projectId: string,
    ): Promise<{ linesChecked: number; linesUpdated: number; childrenAdded: number; childrenRemoved: number; unpricedChildrenAdded: number }> => {
      try {
        return await resyncProjectKitsM({
          projectId,
          organizationId: requireOrg(),
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

    /** Reveal (or re-hide) ONE line's own price inside a `pricingDisplay: "ROLLUP"`
     *  category — src/lib/category-pricing-display.ts. A minimal patch: nothing but
     *  the flag moves, and patchNative recomputes `lineTotal` from the line's own
     *  unchanged inputs, so this cannot shift a number. `false` is sent as a CLEAR
     *  (absent is the default reading) so "hidden" has exactly one representation.
     *  No-op on the document when the line's category is ITEMISED — the flag is
     *  never consulted there. */
    setPriceReveal: async (
      id: string,
      reveal: boolean,
      opts: { entityName: string },
    ): Promise<{ projectId: string }> => {
      try {
        return await patchM({
          id,
          orgId: requireOrg(),
          set: reveal ? { revealPriceInRollup: true, updatedAt: Date.now() } : { updatedAt: Date.now() },
          clear: reveal ? [] : ["revealPriceInRollup"],
          entityName: opts.entityName,
          allowOverbook: false,
          actor: actor(),
          auditId: createId(),
          emitSideEffects: true,
          now: Date.now(),
        });
      } catch (e) {
        throw mapNativeWriteError(e);
      }
    },

    /** Group child disclosure — list (or stop listing) this group member under
     *  its group's collapsed row on client-facing documents
     *  (src/lib/group-child-disclosure.ts). Same minimal-patch shape as
     *  `setPriceReveal`: nothing but the flag moves, and the disclosed row
     *  never prints a price, so this cannot change a number either. */
    setGroupChildDisclosure: async (
      id: string,
      disclosed: boolean,
      opts: { entityName: string },
    ): Promise<{ projectId: string }> => {
      try {
        return await patchM({
          id,
          orgId: requireOrg(),
          set: disclosed ? { showInGroupOnDocs: true, updatedAt: Date.now() } : { updatedAt: Date.now() },
          clear: disclosed ? [] : ["showInGroupOnDocs"],
          entityName: opts.entityName,
          allowOverbook: false,
          actor: actor(),
          auditId: createId(),
          emitSideEffects: true,
          now: Date.now(),
        });
      } catch (e) {
        throw mapNativeWriteError(e);
      }
    },

    /** Revenue-allocation opt-out (#1249) — "this gear earned nothing". The line
     *  takes no share of its group/kit bundle price and never counts toward
     *  model ROI (convex/lib/allocation.ts). Same minimal-patch shape as
     *  `setPriceReveal`/`setGroupChildDisclosure`: nothing but the flag moves.
     *
     *  It DOES change a number — `allocatedRevenue` on this line and its
     *  siblings — but only the internal attribution one; the project's totals,
     *  the invoice and every client-facing document are untouched, which is why
     *  it is not a `LOCKED_LINE_ITEM_FIELDS` money edit and stays available on a
     *  price-locked project. `patchNative`'s post-write recalc re-runs the
     *  allocation, so the sibling shares move in the same transaction. */
    setRoiExclusion: async (
      id: string,
      excluded: boolean,
      opts: { entityName: string },
    ): Promise<{ projectId: string }> => {
      try {
        return await patchM({
          id,
          orgId: requireOrg(),
          set: excluded ? { excludeFromRoi: true, updatedAt: Date.now() } : { updatedAt: Date.now() },
          clear: excluded ? [] : ["excludeFromRoi"],
          entityName: opts.entityName,
          allowOverbook: false,
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
     *  collab, atomic. Structural — never gated by pricingLocked (#1230). */
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
     *  `{ removed, skipped }` (children/cross-org rows counted as skipped).
     *  Structural — never gated by pricingLocked (#1230). */
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
     *  emit signal — reorder folds no collab event. Structural — never gated by
     *  pricingLocked (#1230). */
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
