"use client";

import { useMemo, useState } from "react";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { useActiveOrganization } from "@/lib/auth-client";
import { useGroupTemplates } from "@/hooks/use-group-templates";
import { useGroupTemplateWrites } from "@/hooks/use-group-templates-writes";
import {
  Bookmark,
  Trash2,
  Pencil,
  Package,
  Box,
  ChevronDown,
  ChevronRight,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";

import { useCanDo } from "@/lib/use-permissions";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type TemplateItem = {
  id: string;
  modelId: string | null;
  kitId: string | null;
  quantity: number;
  sortOrder: number;
  model: { id: string; name: string } | null;
  kit: { id: string; name: string; assetTag: string } | null;
};

type Template = {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  items: TemplateItem[];
};

export default function GroupTemplatesSettingsPage() {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const canManage = useCanDo("project", "manage_line_items");

  const { data: templates = [], isLoading } = useGroupTemplates(orgId) as unknown as {
    data: Template[];
    isLoading: boolean;
  };

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [editTemplate, setEditTemplate] = useState<Template | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [deleteTemplate, setDeleteTemplate] = useState<Template | null>(null);

  const sorted = useMemo(
    () => [...templates].sort((a, b) => a.name.localeCompare(b.name)),
    [templates],
  );

  const templateWrites = useGroupTemplateWrites();

  const updateMut = useServerMutation({
    mutationFn: ({ id, name, description }: { id: string; name: string; description?: string }) =>
      templateWrites.updateTemplate(id, { name, description }),
    onSuccess: () => {
      toast.success("Template updated");
      setEditTemplate(null);
      setEditName("");
      setEditDescription("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMut = useServerMutation({
    mutationFn: (id: string) => templateWrites.deleteTemplate(id),
    onSuccess: () => {
      toast.success("Template deleted");
      setDeleteTemplate(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="t-subtitle text-fg">Group Templates</h2>
        <p className="text-sm text-fg-3 mt-1">
          Reusable equipment packages. Build a group in any project, then save it as a template to
          reuse across future projects. Templates hold model and kit items; free-text lines are skipped.
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12 text-fg-3">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : sorted.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-bg-inset/40 p-8 text-center">
          <Bookmark className="mx-auto h-8 w-8 text-fg-3" />
          <h3 className="mt-3 text-sm font-semibold text-fg">No templates yet</h3>
          <p className="mt-1 text-sm text-fg-3 max-w-md mx-auto">
            On any project&apos;s equipment tab, open a group&apos;s menu and choose
            &quot;Save as Template&quot; to make it reusable.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {sorted.map((t) => {
            const isOpen = expanded.has(t.id);
            return (
              <div
                key={t.id}
                className="rounded-lg border border-border bg-bg-elevated overflow-hidden"
              >
                <div className="flex items-center gap-3 p-3">
                  <button
                    type="button"
                    onClick={() => toggleExpanded(t.id)}
                    className="flex items-center gap-2 text-left flex-1 min-w-0"
                  >
                    {isOpen ? (
                      <ChevronDown className="h-4 w-4 shrink-0 text-fg-3" />
                    ) : (
                      <ChevronRight className="h-4 w-4 shrink-0 text-fg-3" />
                    )}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-fg truncate">{t.name}</span>
                        <Badge status="neutral" className="text-xs">
                          {t.items.length} item{t.items.length !== 1 ? "s" : ""}
                        </Badge>
                      </div>
                      {t.description && (
                        <p className="text-xs text-fg-3 mt-0.5 truncate">{t.description}</p>
                      )}
                    </div>
                  </button>
                  {canManage && (
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          setEditTemplate(t);
                          setEditName(t.name);
                          setEditDescription(t.description ?? "");
                        }}
                        aria-label="Edit template"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setDeleteTemplate(t)}
                        aria-label="Delete template"
                        className="text-[oklch(0.58_0.22_27)]"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  )}
                </div>
                {isOpen && (
                  <div className="border-t border-border bg-bg-inset/40 px-3 py-2">
                    {t.items.length === 0 ? (
                      <p className="text-xs text-fg-3 py-2">No items.</p>
                    ) : (
                      <ul className="space-y-1">
                        {t.items
                          .slice()
                          .sort((a, b) => a.sortOrder - b.sortOrder)
                          .map((item) => {
                            const isKit = item.kit != null;
                            const label = isKit
                              ? `${item.kit!.name} (${item.kit!.assetTag})`
                              : item.model?.name ?? "Unknown";
                            return (
                              <li
                                key={item.id}
                                className="flex items-center justify-between gap-2 py-1 text-sm"
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  {isKit ? (
                                    <Package className="h-3.5 w-3.5 shrink-0 text-fg-3" />
                                  ) : (
                                    <Box className="h-3.5 w-3.5 shrink-0 text-fg-3" />
                                  )}
                                  <span className="truncate">{label}</span>
                                  {isKit && (
                                    <Badge status="neutral" className="text-[10px]">
                                      Kit
                                    </Badge>
                                  )}
                                </div>
                                <span className="text-fg-3 shrink-0">×{item.quantity}</span>
                              </li>
                            );
                          })}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Edit template dialog */}
      <Dialog
        open={editTemplate != null}
        onOpenChange={(open) => {
          if (!open) {
            setEditTemplate(null);
            setEditName("");
            setEditDescription("");
          }
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Edit Template</DialogTitle>
            <DialogDescription>
              Rename or update the description. To change items, save a different group as a new template.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="line"
              onClick={() => {
                setEditTemplate(null);
                setEditName("");
                setEditDescription("");
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (editTemplate && editName.trim()) {
                  updateMut.mutate({
                    id: editTemplate.id,
                    name: editName.trim(),
                    description: editDescription.trim() || undefined,
                  });
                }
              }}
              disabled={!editName.trim() || updateMut.isPending}
            >
              {updateMut.isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm dialog */}
      <Dialog
        open={deleteTemplate != null}
        onOpenChange={(open) => {
          if (!open) setDeleteTemplate(null);
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-[oklch(0.75_0.15_70)]" />
              Delete Template
            </DialogTitle>
            <DialogDescription>
              Delete &quot;{deleteTemplate?.name}&quot;? Projects that already used this template
              keep their line items; only the template definition is removed.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="line" onClick={() => setDeleteTemplate(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                if (deleteTemplate) deleteMut.mutate(deleteTemplate.id);
              }}
              disabled={deleteMut.isPending}
            >
              {deleteMut.isPending ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
