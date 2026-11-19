"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useConvex, useQuery } from "convex/react";
import { useServerQuery } from "@/hooks/use-server-query";
import type { ContainerChoice } from "@/lib/warehouse-container-choice";
import type { LineItem } from "@/components/warehouse/warehouse-types";
import { api as convexApi } from "../../../../convex/_generated/api";
import type { WarehouseWrites } from "./job-types";

type ContainerAsset = { value: string; label: string; assetId?: string; assetTag?: string; modelId?: string };

/** Case options: case-category assets first, then every prepContainer label already on a line. */
function buildContainerOptions(lineItems: LineItem[], caseAssets: ContainerAsset[] | undefined): ContainerAsset[] {
  const seen = new Set<string>();
  const options: ContainerAsset[] = [];
  for (const asset of caseAssets ?? []) {
    if (seen.has(asset.value)) continue;
    seen.add(asset.value);
    options.push(asset);
  }
  for (const li of lineItems) {
    if (!li.prepContainer || seen.has(li.prepContainer)) continue;
    seen.add(li.prepContainer);
    options.push({ value: li.prepContainer, label: li.prepContainer });
  }
  return options.sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * The packer's active case. `selectedContainer` (a label) is the legacy widen-step field kept in sync
 * for unmigrated readers; `activeContainerId` (#1296) is the real container written through alongside.
 * Tri-state (warehouse-container-choice.ts): `undefined` = not chosen (the PM's plan applies), `null` =
 * Loose, string = a case. `ensureContainerIfNeeded` lazily puts a container ASSET on the job when it is
 * first prepped into (the pre-rail mechanism, kept: `selectedContainer` still comes from a container label).
 */
export function useCaseSelection(deps: {
  projectId: string; orgId: string | undefined; authed: boolean; lineItems: LineItem[]; warehouseWrites: WarehouseWrites;
}) {
  const { projectId, orgId, authed, lineItems, warehouseWrites } = deps;
  const wConvex = useConvex();
  const [selectedContainer, setSelectedContainer] = useState<string>("");
  const [activeContainerId, setActiveContainerId] = useState<ContainerChoice>(undefined);
  const [newContainerSheetOpen, setNewContainerSheetOpen] = useState(false);
  const realContainers = useQuery(convexApi.projectContainers.listForProject, orgId ? { orgId, projectId } : "skip") ?? [];
  const containerLabelById = useMemo(() => new Map(realContainers.map((c) => [c.id, c.label])), [realContainers]);
  const handleSelectContainer = useCallback((id: ContainerChoice) => {
    setActiveContainerId(id);
    setSelectedContainer(id ? realContainers.find((c) => c.id === id)?.label ?? "" : "");
  }, [realContainers]);
  const handleContainerCreated = useCallback((container: { id: string; label: string }) => {
    setActiveContainerId(container.id);
    setSelectedContainer(container.label);
    setNewContainerSheetOpen(false);
  }, []);

  const { data: caseAssets } = useServerQuery({
    queryKey: ["containerAssets", orgId],
    queryFn: () => wConvex.query(convexApi.categories.containerAssetSearch, { orgId: orgId as string, query: "" }),
    enabled: !!orgId && authed,
  });
  const containerOptions = useMemo(() => buildContainerOptions(lineItems, caseAssets as ContainerAsset[] | undefined), [lineItems, caseAssets]);
  const selectedContainerAsset = useMemo(
    () => (selectedContainer ? containerOptions.find((o) => o.value === selectedContainer && o.assetId) || null : null),
    [selectedContainer, containerOptions],
  );
  // Refs so callers defined before this render's values settle can still read the latest.
  const assetRef = useRef(selectedContainerAsset);
  assetRef.current = selectedContainerAsset;
  const containerRef = useRef(selectedContainer);
  containerRef.current = selectedContainer;
  const ensureContainerIfNeeded = useCallback(async () => {
    const asset = assetRef.current;
    if (asset?.assetId && asset.modelId) {
      await warehouseWrites.ensureContainerOnProject(projectId, asset.assetId, asset.modelId, containerRef.current);
    }
  }, [projectId, warehouseWrites]);

  return {
    selectedContainer, activeContainerId, newContainerSheetOpen, setNewContainerSheetOpen,
    realContainers, containerLabelById, handleSelectContainer, handleContainerCreated, ensureContainerIfNeeded,
  };
}
export type CaseSelection = ReturnType<typeof useCaseSelection>;
