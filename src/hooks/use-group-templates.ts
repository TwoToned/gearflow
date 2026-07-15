"use client";

import { useMemo } from "react";
import { useAuthedQuery } from "./use-authed-query";
import { api } from "../../convex/_generated/api";

/**
 * Reactive group-templates read (Phase 3 — browser-direct). Replaces the
 * shared-server-action store (getGroupTemplates) with live Convex subscriptions:
 * parents (`groupTemplates.list`) + items (`groupTemplateItems.list`) + the org's
 * model/kit maps (already browser-readable), composed client-side into the same
 * shape the old server read returned (parents name-sorted, each with an `items`
 * array carrying the model/kit joins). Writers go through
 * `api.groupTemplatesWrites.*` mutations, so the subscription auto-updates —
 * `refreshGroupTemplates` is now a no-op kept for call-site compatibility.
 */

export type GroupTemplateItemView = {
  id: string;
  organizationId: string;
  templateId: string;
  modelId: string | null;
  kitId: string | null;
  quantity: number;
  sortOrder: number;
  model: { id: string; name: string; dailyRate: number | null; weeklyRate: number | null } | null;
  kit: { id: string; name: string; assetTag: string | null } | null;
};

export type GroupTemplateView = {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  createdAt: number | null;
  updatedAt: number | null;
  items: GroupTemplateItemView[];
};

export function useGroupTemplates(orgId: string | undefined): {
  data: GroupTemplateView[];
  isLoading: boolean;
} {
  const arg = orgId ? { orgId } : "skip";
  const parents = useAuthedQuery(api.groupTemplates.list, arg);
  const items = useAuthedQuery(api.groupTemplateItems.list, arg);
  const models = useAuthedQuery(api.models.list, arg);
  const kits = useAuthedQuery(api.kits.list, arg);

  const isLoading =
    orgId != null &&
    (parents === undefined || items === undefined || models === undefined || kits === undefined);

  const data = useMemo<GroupTemplateView[]>(() => {
    if (!parents || !items || !models || !kits) return [];
    const modelMap = new Map(models.map((m) => [m.id, m]));
    const kitMap = new Map(kits.map((k) => [k.id, k]));
    const parentIds = new Set(parents.map((p) => p.id));

    const itemsByTemplate = new Map<string, GroupTemplateItemView[]>();
    for (const it of items) {
      if (!parentIds.has(it.templateId)) continue;
      const m = it.modelId ? modelMap.get(it.modelId) : undefined;
      const k = it.kitId ? kitMap.get(it.kitId) : undefined;
      const mapped: GroupTemplateItemView = {
        id: it.id,
        organizationId: it.organizationId,
        templateId: it.templateId,
        modelId: it.modelId ?? null,
        kitId: it.kitId ?? null,
        quantity: it.quantity ?? 1,
        sortOrder: it.sortOrder ?? 0,
        model: m
          ? { id: m.id, name: m.name, dailyRate: m.dailyRate ?? null, weeklyRate: m.weeklyRate ?? null }
          : null,
        kit: k ? { id: k.id, name: k.name, assetTag: k.assetTag ?? null } : null,
      };
      const list = itemsByTemplate.get(it.templateId);
      if (list) list.push(mapped);
      else itemsByTemplate.set(it.templateId, [mapped]);
    }
    for (const list of itemsByTemplate.values()) list.sort((a, b) => a.sortOrder - b.sortOrder);

    return [...parents]
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((p) => ({
        id: p.id,
        organizationId: p.organizationId,
        name: p.name,
        description: p.description ?? null,
        createdAt: p.createdAt ?? null,
        updatedAt: p.updatedAt ?? null,
        items: itemsByTemplate.get(p.id) ?? [],
      }));
  }, [parents, items, models, kits]);

  return { data, isLoading };
}

/** No-op — group-template reads are now reactive subscriptions (kept for call sites). */
export function refreshGroupTemplates(_orgId?: string): void {
  // reactive: nothing to refresh
}
