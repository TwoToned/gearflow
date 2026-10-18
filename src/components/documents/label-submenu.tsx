"use client";

/**
 * "Print one label" submenu for the Documents menus — an "All …" entry plus one
 * entry per label the job would actually print. The list comes from the API's
 * `list=1` mode, which runs the same builders as the PDF, so the menu can never
 * offer a label that won't print (and the client holds no second copy of "which
 * lines are kits / loose items"). Fetched when the submenu first opens.
 */
import { useEffect, useState } from "react";
import {
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import type { LabelIndexEntry } from "@/lib/pdfme/container-labels";

type LabelApiType = "container-label" | "kit-label" | "item-label";

type LoadState = { status: "idle" | "loading" | "error" } | { status: "ready"; labels: LabelIndexEntry[] };

/** What a finished fetch left behind, tagged with the request it answered so a
 *  stale answer is never shown for a different project/type. */
type Settled = { key: string; labels: LabelIndexEntry[] | null };

function useLabelIndex(projectId: string, apiType: LabelApiType, enabled: boolean): LoadState {
  const key = `${projectId}:${apiType}`;
  const [settled, setSettled] = useState<Settled | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    fetch(`/api/documents/${projectId}?type=${apiType}&list=1`, { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((body: { labels: LabelIndexEntry[] }) => setSettled({ key, labels: body.labels }))
      .catch((err: unknown) => {
        if ((err as { name?: string })?.name !== "AbortError") setSettled({ key, labels: null });
      });
    return () => controller.abort();
  }, [projectId, apiType, enabled, key]);
  if (!enabled) return { status: "idle" };
  if (settled?.key !== key) return { status: "loading" };
  return settled.labels ? { status: "ready", labels: settled.labels } : { status: "error" };
}

const openLabel = (projectId: string, apiType: LabelApiType, labelId?: string) =>
  window.open(`/api/documents/${projectId}?type=${apiType}${labelId ? `&labelId=${encodeURIComponent(labelId)}` : ""}`, "_blank");

export function LabelSubmenu({
  projectId,
  apiType,
  label,
  allLabel,
  emptyLabel,
}: {
  projectId: string;
  apiType: LabelApiType;
  /** Trigger text, e.g. "Kit labels". */
  label: string;
  /** First entry, e.g. "All kits". */
  allLabel: string;
  /** Shown when the job has nothing to label, e.g. "No kits on this job". */
  emptyLabel: string;
}) {
  const [opened, setOpened] = useState(false);
  const state = useLabelIndex(projectId, apiType, opened);
  return (
    <DropdownMenuSub onOpenChange={(open) => open && setOpened(true)}>
      <DropdownMenuSubTrigger>{label}</DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        {state.status === "ready" && state.labels.length === 0 ? (
          <DropdownMenuItem disabled>{emptyLabel}</DropdownMenuItem>
        ) : (
          <DropdownMenuItem onClick={() => openLabel(projectId, apiType)}>{allLabel}</DropdownMenuItem>
        )}
        {state.status === "loading" ? <DropdownMenuItem disabled>Loading…</DropdownMenuItem> : null}
        {state.status === "error" ? <DropdownMenuItem disabled>Couldn’t load labels</DropdownMenuItem> : null}
        {state.status === "ready"
          ? state.labels.map((l) => (
              <DropdownMenuItem key={l.id} onClick={() => openLabel(projectId, apiType, l.id)}>
                {l.title}
                {l.tag ? <span className="ml-2 t-mono text-ink-2">{l.tag}</span> : null}
              </DropdownMenuItem>
            ))
          : null}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
