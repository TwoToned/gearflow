"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ActionMenu } from "@/components/ui/action-menu";
import { BulkBar } from "@/components/ui/bulk-bar";
import { BulkDeleteDialog } from "@/components/ui/bulk-delete-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useActiveOrganization } from "@/lib/auth-client";
import { useCanDo } from "@/lib/use-permissions";
import { useRowSelection } from "@/lib/primitives/use-row-selection";
import { buildTemplateBulkActions, buildTemplateRowActions } from "@/lib/row-actions/template";
import { PROJECT_TYPE_LABELS } from "@/lib/project-type-labels";
import { useTemplates, useTemplateWrites, type TemplateRow } from "@/hooks/use-templates";
import { cn, focusRing } from "@/lib/utils";

/**
 * Manage templates (UX Phase 9, D23): the ONE place templates are listed, used, edited and
 * deleted (the old templates page, its phone-card copy and its per-row buttons are gone).
 * Always-on checkboxes with shift range, a row ⋯, a bulk `Delete n`. Delete ARCHIVES, with an
 * exact Undo; the Archived tab is where `Restore` (with its own Undo) and the real, final delete (no Undo) live.
 */
export function ManageTemplatesDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const [archived, setArchived] = useState(false);
  const result = useTemplates(orgId, archived);
  const rows = result?.templates ?? [];
  const writes = useTemplateWrites();
  const canCreate = useCanDo("project", "create");
  const canUpdate = useCanDo("project", "update");
  const canDelete = useCanDo("project", "delete");
  const selection = useRowSelection(rows.map((r) => r.id));
  const [confirmIds, setConfirmIds] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);

  const close = () => onOpenChange(false);
  const archive = async (ids: string[]) => {
    try {
      const { archived: done } = await writes.archive(ids);
      selection.clear();
      toast.success(`Deleted ${done.length} template${done.length === 1 ? "" : "s"}`, done.length === 0 ? undefined : {
        action: {
          label: "Undo",
          onClick: async () => {
            try {
              await writes.unarchive(done);
              toast.success("Restored");
            } catch (e) {
              toast.error((e as Error).message);
            }
          },
        },
      });
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const restore = async (ids: string[]) => {
    try {
      const { restored } = await writes.restore(ids);
      selection.clear();
      toast.success(`Restored ${restored.length} template${restored.length === 1 ? "" : "s"}`, restored.length === 0 ? undefined : {
        action: {
          label: "Undo",
          onClick: async () => {
            try {
              await writes.unrestore(restored);
              toast.success("Archived again");
            } catch (e) {
              toast.error((e as Error).message);
            }
          },
        },
      });
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const deleteForever = async (ids: string[]) => {
    setBusy(true);
    try {
      for (const id of ids) await writes.deleteForever(id);
      selection.clear();
      toast.success(`Deleted ${ids.length} template${ids.length === 1 ? "" : "s"} for good`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
      setConfirmIds(null);
    }
  };
  const ctxFor = (r: TemplateRow) => ({
    onUse: canCreate ? () => { close(); router.push(`/projects/new?template=${r.id}`); } : undefined,
    onEdit: canUpdate ? () => { close(); router.push(`/projects/${r.id}?edit=1`); } : undefined,
    onArchive: canDelete ? () => void archive([r.id]) : undefined,
    onRestore: canDelete ? () => void restore([r.id]) : undefined,
    onDeleteForever: canDelete ? () => void deleteForever([r.id]) : undefined,
  });

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Manage templates</DialogTitle>
            <DialogDescription>
              {archived ? "Archived templates. Restore one, or delete it forever." : "Reusable jobs with their gear. Start a job from one, edit it, or delete it."}
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-center gap-4 border-b border-line text-table-cell">
            {[[false, "Templates"], [true, "Archived"]].map(([isArchived, label]) => (
              <button
                key={String(isArchived)}
                type="button"
                aria-pressed={archived === isArchived}
                onClick={() => { setArchived(isArchived as boolean); selection.clear(); }}
                className={cn("min-h-11 border-b-2 px-0.5 md:min-h-9", archived === isArchived ? "border-red font-semibold text-ink" : "border-transparent text-ink-2", focusRing)}
              >
                {label as string}
              </button>
            ))}
            <span className="ml-auto" />
            {canCreate && !archived && (
              <Button type="button" variant="line" size="sm" onClick={() => { close(); router.push("/projects?templates=new"); }}>New template…</Button>
            )}
          </div>

          {result === undefined ? (
            <div className="space-y-2" aria-busy="true"><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /></div>
          ) : rows.length === 0 ? (
            <p className="py-8 text-center text-ui-text text-muted">
              {archived ? "Nothing archived." : "No templates yet. Save a job as a template, or choose New template…."}
            </p>
          ) : (
            <ul className="divide-y divide-line" aria-label={archived ? "Archived templates" : "Templates"}>
              {rows.map((r) => (
                <li key={r.id} className="flex min-h-14 items-center gap-3 py-2">
                  <input
                    type="checkbox" aria-label={`Select ${r.name}`} checked={selection.isSelected(r.id)}
                    onChange={() => undefined}
                    onClick={(e) => selection.toggle(r.id, { shift: e.shiftKey })}
                    className="size-[22px] shrink-0 md:size-4"
                  />
                  <div className="min-w-0 flex-1">
                    <Link href={`/projects/${r.id}`} onClick={close} className={cn("block truncate text-ui-text font-medium text-ink hover:underline", focusRing)}>{r.name}</Link>
                    <p className="truncate text-caption text-muted">
                      <span className="font-mono">{r.number}</span>
                      {r.type ? ` · ${PROJECT_TYPE_LABELS[r.type] ?? r.type}` : ""}
                      {r.clientName ? ` · ${r.clientName}` : ""}
                    </p>
                  </div>
                  <span className="font-mono text-table-cell text-ink-2">{r.lineCount} line{r.lineCount === 1 ? "" : "s"}</span>
                  <ActionMenu spec={buildTemplateRowActions({ name: r.name, archived }, ctxFor(r))} label={`Actions for ${r.name}`} />
                </li>
              ))}
            </ul>
          )}
          {result?.truncated && <p className="t-micro text-muted">Showing the {rows.length} most recently updated of {result.total}.</p>}

          <BulkBar
            noun="template"
            inDialog
            selection={selection}
            actions={buildTemplateBulkActions(archived, {
              onArchive: canDelete ? () => void archive([...selection.selected]) : undefined,
              onRestore: canDelete ? () => void restore([...selection.selected]) : undefined,
              onDeleteForever: canDelete ? () => setConfirmIds([...selection.selected]) : undefined,
            })}
          />
        </DialogContent>
      </Dialog>
      <BulkDeleteDialog
        open={confirmIds != null}
        onOpenChange={(o) => !o && setConfirmIds(null)}
        title="Delete templates forever"
        description="The selected archived templates and their gear lines are removed for good. Jobs already created from them are not affected."
        count={confirmIds?.length ?? 0}
        itemLabel="template"
        pending={busy}
        onConfirm={() => void deleteForever(confirmIds ?? [])}
      />
    </>
  );
}
