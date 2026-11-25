"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { ActionMenu } from "@/components/ui/action-menu";
import { useTemplates, useTemplateWrites, type TemplateRow } from "@/hooks/use-templates";
import { templatesHref } from "@/lib/templates-url";
import type { ActionMenuSpec } from "@/lib/primitives/types";
import { cn, focusRing } from "@/lib/utils";

/**
 * `Start from template ▾` (UX Phase 9, D23) on wizard step one: a filter word that reads its
 * value (`Template: Gala dinner`). Picking one applies it onto the draft (`applyTemplateNative`:
 * its gear, tags, type, description and discount, only where the draft has none; dates are not
 * copied) with an exact Undo. Before the job is named there is no draft yet: the pick waits and
 * applies the moment the draft exists. `Start from scratch` undoes it (the server refuses if the
 * gear was edited since). `/projects/new?template=<id>` is the same pick, from `Use for a new job`.
 */
interface Picked { id: string; name?: string }

export function useTemplateApply(
  draftId: string | undefined,
  adopt: (values: Record<string, unknown>) => void,
  flush: () => Promise<unknown>,
) {
  const writes = useTemplateWrites();
  const [picked, setPicked] = useState<Picked | null>(null);
  const [applied, setApplied] = useState<{ auditId: string } | null>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    if (!draftId || !picked || applied || inFlight.current) return;
    inFlight.current = true;
    // Save what the user typed first: the server merges onto the saved draft, so nothing typed is lost.
    flush().then(() => writes.apply(draftId, picked.id))
      .then(({ auditId, lineCount, applied: filled }) => {
        adopt(filled);
        setApplied({ auditId });
        toast.success(`Started from ${picked.name ?? "the template"}${lineCount ? `: ${lineCount} line${lineCount === 1 ? "" : "s"} added` : ""}`, {
          action: { label: "Undo", onClick: () => void clear(draftId, auditId) },
        });
      })
      .catch((e: Error) => {
        toast.error(e.message);
        setPicked(null);
      })
      .finally(() => { inFlight.current = false; });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId, picked, applied]);

  /** The exact Undo; on a refusal (gear edited since, window passed) the template stays and the server's words are shown. */
  const clear = async (id: string, auditId: string) => {
    try {
      await flush();
      const { restored } = await writes.undoApply(id, auditId);
      adopt(restored);
      setApplied(null);
      setPicked(null);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return {
    picked,
    pick: (t: Picked) => { if (!picked) setPicked(t); },
    scratch: () => {
      if (applied && draftId) void clear(draftId, applied.auditId);
      else setPicked(null);
    },
  };
}

function menuFor(
  templates: TemplateRow[], picked: Picked | null, on: { pick: (t: TemplateRow) => void; scratch: () => void; manage: () => void; create: () => void },
): ActionMenuSpec {
  const recent = templates.slice(0, 5).map((t) => ({
    key: `t-${t.id}`, label: `${t.name} · ${t.lineCount} line${t.lineCount === 1 ? "" : "s"}`, group: "edit" as const, onSelect: () => on.pick(t),
  }));
  return {
    items: [
      ...(picked ? [] : recent),
      ...(picked ? [{ key: "scratch", label: "Start from scratch", group: "organise" as const, onSelect: on.scratch }] : []),
      { key: "manage", label: "Manage templates…", group: "organise" as const, onSelect: on.manage },
      { key: "new", label: "New template…", group: "organise" as const, onSelect: on.create },
    ],
  };
}

export function StartFromTemplate({
  orgId, picked, onPick, onScratch,
}: { orgId: string | undefined; picked: Picked | null; onPick: (t: Picked) => void; onScratch: () => void }) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const result = useTemplates(orgId);
  const templates = result?.templates ?? [];
  const name = picked ? picked.name ?? templates.find((t) => t.id === picked.id)?.name ?? "…" : null;
  const spec = menuFor(templates, picked, {
    pick: (t) => onPick({ id: t.id, name: t.name }),
    scratch: onScratch,
    manage: () => router.push(templatesHref(pathname, search)),
    create: () => router.push(templatesHref(pathname, search, "new")),
  });
  return (
    <ActionMenu
      spec={spec}
      label="Start from template"
      trigger={
        <button type="button" className={cn("inline-flex min-h-11 items-center gap-1 text-table-cell text-ink-2 hover:text-ink md:min-h-8", focusRing)}>
          {name ? <>Template: <span className="font-medium text-ink">{name}</span></> : "Start from template"}
          <ChevronDown className="size-4" aria-hidden />
        </button>
      }
    />
  );
}
