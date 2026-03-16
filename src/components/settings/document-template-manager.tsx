"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Copy,
  FileText,
  MoreHorizontal,
  Pencil,
  Sparkles,
  Star,
  StarOff,
  Trash2,
  Wand2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  duplicateSystemDefault,
  duplicateDocumentTemplate,
  deleteDocumentTemplate,
  setDefaultTemplate,
  unsetDefaultTemplate,
} from "@/server/document-templates";
import {
  DOCUMENT_TYPES,
  DOCUMENT_TYPE_LABELS,
} from "@/lib/validations/document-template";
import { Skeleton } from "@/components/ui/skeleton";

interface TemplateEntry {
  id: string;
  name: string;
  type: string;
  isDefault: boolean;
  isSystemDefault: boolean;
  isDraft: boolean;
  version: number;
  thumbnailUrl: string | null;
  publishedAt: string | Date | null;
  updatedAt: string | Date;
}

const DOC_TYPE_ICONS: Record<string, { letter: string; color: string }> = {
  quote: { letter: "Q", color: "from-teal-500/20 to-teal-600/5" },
  invoice: { letter: "I", color: "from-blue-500/20 to-blue-600/5" },
  "packing-list": { letter: "P", color: "from-violet-500/20 to-violet-600/5" },
  "return-sheet": { letter: "R", color: "from-amber-500/20 to-amber-600/5" },
  "delivery-docket": {
    letter: "D",
    color: "from-emerald-500/20 to-emerald-600/5",
  },
  "call-sheet": { letter: "C", color: "from-rose-500/20 to-rose-600/5" },
};

const DOC_TYPE_ACCENT: Record<string, string> = {
  quote: "text-teal-600 dark:text-teal-400",
  invoice: "text-blue-600 dark:text-blue-400",
  "packing-list": "text-violet-600 dark:text-violet-400",
  "return-sheet": "text-amber-600 dark:text-amber-400",
  "delivery-docket": "text-emerald-600 dark:text-emerald-400",
  "call-sheet": "text-rose-600 dark:text-rose-400",
};

export function DocumentTemplateManager({
  templates,
  isLoading,
}: {
  templates: TemplateEntry[];
  isLoading: boolean;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [deleteTarget, setDeleteTarget] = useState<TemplateEntry | null>(null);

  const customiseMutation = useMutation({
    mutationFn: (type: string) => duplicateSystemDefault(type),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["document-templates"] });
      router.push(`/template-designer/${result.id}`);
    },
    onError: () => toast.error("Failed to create custom template"),
  });

  const duplicateMutation = useMutation({
    mutationFn: (id: string) => duplicateDocumentTemplate(id),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["document-templates"] });
      router.push(`/template-designer/${result.id}`);
    },
    onError: () => toast.error("Failed to duplicate template"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteDocumentTemplate(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["document-templates"] });
      toast.success("Template deleted");
      setDeleteTarget(null);
    },
    onError: () => toast.error("Failed to delete template"),
  });

  const setDefaultMutation = useMutation({
    mutationFn: (id: string) => setDefaultTemplate(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["document-templates"] });
      toast.success("Default template updated");
    },
    onError: (err) =>
      toast.error(
        err instanceof Error ? err.message : "Failed to set default"
      ),
  });

  const unsetDefaultMutation = useMutation({
    mutationFn: (id: string) => unsetDefaultTemplate(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["document-templates"] });
      toast.success("Reverted to system default");
    },
    onError: () => toast.error("Failed to unset default"),
  });

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-20 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  // Group templates by type
  const byType = new Map<string, TemplateEntry[]>();
  for (const type of DOCUMENT_TYPES) {
    byType.set(type, []);
  }
  for (const t of templates) {
    const list = byType.get(t.type);
    if (list) list.push(t);
  }

  return (
    <>
      <Tabs defaultValue={DOCUMENT_TYPES[0]}>
        <TabsList className="flex-wrap h-auto gap-1 bg-muted/50 p-1">
          {DOCUMENT_TYPES.map((type) => {
            const customs = (byType.get(type) || []).filter(
              (e) => !e.isSystemDefault
            );
            return (
              <TabsTrigger
                key={type}
                value={type}
                className="text-xs gap-1.5 data-[state=active]:bg-background data-[state=active]:shadow-sm"
              >
                {DOCUMENT_TYPE_LABELS[type]}
                {customs.length > 0 && (
                  <span className="text-[9px] font-medium bg-primary/10 text-primary rounded-full px-1.5 py-0.5 leading-none">
                    {customs.length}
                  </span>
                )}
              </TabsTrigger>
            );
          })}
        </TabsList>

        {DOCUMENT_TYPES.map((type) => {
          const entries = byType.get(type) || [];
          const systemDefault = entries.find((e) => e.isSystemDefault);
          const customs = entries.filter((e) => !e.isSystemDefault);

          return (
            <TabsContent key={type} value={type} className="mt-4 space-y-3">
              {/* System default */}
              {systemDefault && (
                <TemplateCard
                  template={systemDefault}
                  onCustomise={() => customiseMutation.mutate(type)}
                  isCustomising={customiseMutation.isPending}
                />
              )}

              {/* Custom templates */}
              {customs.map((t) => (
                <TemplateCard
                  key={t.id}
                  template={t}
                  onEdit={() => router.push(`/template-designer/${t.id}`)}
                  onDuplicate={() => duplicateMutation.mutate(t.id)}
                  onDelete={() => setDeleteTarget(t)}
                  onSetDefault={
                    !t.isDefault && !t.isDraft
                      ? () => setDefaultMutation.mutate(t.id)
                      : undefined
                  }
                  onUnsetDefault={
                    t.isDefault
                      ? () => unsetDefaultMutation.mutate(t.id)
                      : undefined
                  }
                />
              ))}

              {customs.length === 0 && (
                <div className="flex items-center gap-3 rounded-lg border border-dashed border-border/60 bg-muted/20 p-4">
                  <Sparkles className="h-4 w-4 text-muted-foreground/50 shrink-0" />
                  <p className="text-sm text-muted-foreground">
                    No custom templates yet. Click{" "}
                    <span className="font-medium text-foreground">
                      Customise
                    </span>{" "}
                    above to create one from the system default.
                  </p>
                </div>
              )}
            </TabsContent>
          );
        })}
      </Tabs>

      {/* Delete confirmation */}
      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Template</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete &ldquo;{deleteTarget?.name}
              &rdquo;? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() =>
                deleteTarget && deleteMutation.mutate(deleteTarget.id)
              }
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function TemplateCard({
  template,
  onCustomise,
  isCustomising,
  onEdit,
  onDuplicate,
  onDelete,
  onSetDefault,
  onUnsetDefault,
}: {
  template: TemplateEntry;
  onCustomise?: () => void;
  isCustomising?: boolean;
  onEdit?: () => void;
  onDuplicate?: () => void;
  onDelete?: () => void;
  onSetDefault?: () => void;
  onUnsetDefault?: () => void;
}) {
  const isSystem = template.isSystemDefault;
  const icon = DOC_TYPE_ICONS[template.type] || {
    letter: "?",
    color: "from-gray-500/20 to-gray-600/5",
  };
  const accentColor = DOC_TYPE_ACCENT[template.type] || "text-foreground";

  return (
    <div className="group relative flex items-center gap-4 rounded-xl border border-border/50 bg-card p-4 transition-all hover:border-border hover:shadow-sm">
      {/* Icon */}
      <div
        className={`flex h-12 w-10 shrink-0 items-center justify-center rounded-lg bg-gradient-to-b ${icon.color} border border-border/30`}
      >
        <span className={`text-base font-bold ${accentColor}`}>
          {icon.letter}
        </span>
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm truncate">{template.name}</span>
          {template.isDefault && (
            <Badge
              variant="default"
              className="text-[9px] font-semibold tracking-wide uppercase px-1.5 py-0"
            >
              Default
            </Badge>
          )}
          {isSystem && (
            <Badge
              variant="outline"
              className="text-[9px] font-medium tracking-wide uppercase border-border/50 text-muted-foreground px-1.5 py-0"
            >
              System
            </Badge>
          )}
          {!isSystem && template.isDraft && (
            <Badge className="text-[9px] font-medium tracking-wide uppercase bg-amber-500/10 text-amber-600 dark:text-amber-400 border-0 px-1.5 py-0">
              Draft
            </Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">
          {isSystem ? (
            "Built-in template included with the system"
          ) : (
            <>
              v{template.version}
              {template.publishedAt &&
                ` \u00b7 Published ${new Date(template.publishedAt).toLocaleDateString()}`}
            </>
          )}
        </p>
      </div>

      {/* Actions */}
      {isSystem ? (
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5 border-primary/20 text-primary hover:bg-primary/5 hover:border-primary/40 transition-all"
          onClick={onCustomise}
          disabled={isCustomising}
        >
          <Wand2 className="h-3.5 w-3.5" />
          {isCustomising ? "Creating..." : "Customise"}
        </Button>
      ) : (
        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={onEdit}
          >
            <Pencil className="h-3 w-3" />
            Edit
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-foreground"
                />
              }
            >
              <MoreHorizontal className="h-4 w-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuGroup>
                <DropdownMenuLabel>Actions</DropdownMenuLabel>
                <DropdownMenuItem onClick={onDuplicate}>
                  <Copy className="h-4 w-4 mr-2" />
                  Duplicate
                </DropdownMenuItem>
                {onSetDefault && (
                  <DropdownMenuItem onClick={onSetDefault}>
                    <Star className="h-4 w-4 mr-2" />
                    Set as Default
                  </DropdownMenuItem>
                )}
                {onUnsetDefault && (
                  <DropdownMenuItem onClick={onUnsetDefault}>
                    <StarOff className="h-4 w-4 mr-2" />
                    Revert to System Default
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={onDelete}
                  className="text-destructive"
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </div>
  );
}
