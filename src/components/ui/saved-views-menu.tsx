"use client";

import { useEffect, useRef, useState } from "react";
import { useServerQuery } from "@/hooks/use-server-query";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { toast } from "sonner";
import { BookmarkPlus, Check, Star, Trash2, ChevronDown, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { useActiveOrganization } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuGroup,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  getSavedViews,
  createSavedView,
  updateSavedView,
  deleteSavedView,
  setDefaultSavedView,
} from "@/server/saved-views";
import type { SavedTableView, SavedViewConfig } from "@/lib/saved-views";

interface Props {
  /** Logical list id — must match the useTablePreferences tableId. */
  tableId: string;
  /** The current filters/sort/columns/pageSize to capture on "Save current view". */
  currentConfig: SavedViewConfig;
  /** Restore a saved (or default) view's config into the live table. */
  applyConfig: (config: SavedViewConfig) => void;
  /** Reset the table to its built-in defaults ("No view"). */
  onResetPreferences?: () => void;
}

/** Shallow-equal two view configs to decide if the active view is "dirty". */
function sameConfig(a: SavedViewConfig, b: SavedViewConfig): boolean {
  return (
    JSON.stringify(a.filters ?? {}) === JSON.stringify(b.filters ?? {}) &&
    (a.sortBy ?? "") === (b.sortBy ?? "") &&
    (a.sortOrder ?? "") === (b.sortOrder ?? "") &&
    JSON.stringify(a.columnVisibility ?? {}) === JSON.stringify(b.columnVisibility ?? {}) &&
    (a.pageSize ?? 0) === (b.pageSize ?? 0)
  );
}

export function SavedViewsMenu({ tableId, currentConfig, applyConfig, onResetPreferences }: Props) {
  // Scope the cache key to the active org so a multi-org user who switches orgs
  // never sees/applies the previous org's views from a stale cache entry
  // (server queries are org-scoped, but the client cache must be too).
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const queryKey = ["saved-views", orgId, tableId];

  const { data: views = [], isLoading, refetch } = useServerQuery({
    queryKey,
    queryFn: () => getSavedViews(tableId) as unknown as Promise<SavedTableView[]>,
  });

  // Which saved view is currently "active" (last applied). Null = no view / custom.
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [makeDefault, setMakeDefault] = useState(false);

  // Auto-apply the default view once on first load — only when the table is in a
  // pristine state (no active filters), so we never clobber a filter set the user
  // arrived with (e.g. a deep link or an in-progress refinement).
  const autoAppliedRef = useRef(false);
  useEffect(() => {
    if (autoAppliedRef.current || isLoading) return;
    const def = views.find((v) => v.isDefault);
    const noActiveFilters = Object.keys(currentConfig.filters ?? {}).length === 0;
    if (def && noActiveFilters) {
      applyConfig(def.config);
      setActiveViewId(def.id);
    }
    autoAppliedRef.current = true;
    // Intentionally run only after views resolve; currentConfig is read once here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, views]);

  const invalidate = () => refetch();

  const createMut = useServerMutation({
    mutationFn: (vars: { name: string; config: SavedViewConfig; isDefault: boolean }) =>
      createSavedView({ tableId, ...vars }) as unknown as Promise<SavedTableView>,
    onSuccess: (view: SavedTableView) => {
      invalidate();
      setActiveViewId(view.id);
      setSaveOpen(false);
      setNewName("");
      setMakeDefault(false);
      toast.success(`View "${view.name}" saved`);
    },
    onError: (e: Error) => toast.error(e.message || "Could not save view"),
  });

  const updateMut = useServerMutation({
    mutationFn: (vars: { id: string; config: SavedViewConfig }) =>
      updateSavedView(vars.id, { config: vars.config }),
    onSuccess: () => {
      invalidate();
      toast.success("View updated");
    },
    onError: (e: Error) => toast.error(e.message || "Could not update view"),
  });

  const deleteMut = useServerMutation({
    mutationFn: (id: string) => deleteSavedView(id),
    onSuccess: (_d, id) => {
      invalidate();
      if (activeViewId === id) setActiveViewId(null);
      toast.success("View deleted");
    },
    onError: (e: Error) => toast.error(e.message || "Could not delete view"),
  });

  const defaultMut = useServerMutation({
    mutationFn: (id: string | null) => setDefaultSavedView(tableId, id),
    onSuccess: () => invalidate(),
    onError: (e: Error) => toast.error(e.message || "Could not set default"),
  });

  const activeView = views.find((v) => v.id === activeViewId) ?? null;
  const isDirty = activeView ? !sameConfig(activeView.config, currentConfig) : false;

  function apply(view: SavedTableView) {
    applyConfig(view.config);
    setActiveViewId(view.id);
  }

  function handleSave() {
    const name = newName.trim();
    if (!name) return;
    createMut.mutate({ name, config: currentConfig, isDefault: makeDefault });
  }

  const label = activeView ? `${activeView.name}${isDirty ? " *" : ""}` : "Views";

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
              <BookmarkPlus className="h-3.5 w-3.5" />
              <span className="max-w-[140px] truncate">{label}</span>
              <ChevronDown className="h-3.5 w-3.5 opacity-60" />
            </Button>
          }
        >
          {label}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-60">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Saved views</DropdownMenuLabel>
          </DropdownMenuGroup>
          {isLoading ? (
            <div className="flex items-center gap-2 px-2 py-2 text-xs text-fg-3">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
            </div>
          ) : views.length === 0 ? (
            <p className="px-2 py-2 text-xs text-fg-3">No saved views yet.</p>
          ) : (
            <DropdownMenuGroup>
              {views.map((view) => (
                <DropdownMenuItem
                  key={view.id}
                  className="flex items-center gap-2"
                  onClick={() => apply(view)}
                >
                  <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
                    {activeViewId === view.id && <Check className="h-3.5 w-3.5 text-primary" />}
                  </span>
                  <span className="flex-1 truncate">{view.name}</span>
                  <button
                    type="button"
                    title={view.isDefault ? "Default view — click to unset" : "Set as default"}
                    className="rounded p-0.5 hover:bg-accent"
                    onClick={(e) => {
                      e.stopPropagation();
                      defaultMut.mutate(view.isDefault ? null : view.id);
                    }}
                  >
                    <Star
                      className={cn(
                        "h-3.5 w-3.5",
                        view.isDefault ? "fill-amber-400 text-amber-400" : "text-fg-3",
                      )}
                    />
                  </button>
                  <button
                    type="button"
                    title="Delete view"
                    className="rounded p-0.5 text-fg-3 hover:bg-destructive/10 hover:text-destructive"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteMut.mutate(view.id);
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          )}

          <DropdownMenuSeparator />
          {activeView && isDirty && (
            <DropdownMenuItem
              onClick={() => updateMut.mutate({ id: activeView.id, config: currentConfig })}
            >
              Update &ldquo;{activeView.name}&rdquo;
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            onClick={() => {
              setNewName("");
              setMakeDefault(false);
              setSaveOpen(true);
            }}
          >
            <BookmarkPlus className="mr-2 h-3.5 w-3.5" />
            Save current view…
          </DropdownMenuItem>
          {(activeViewId || onResetPreferences) && (
            <DropdownMenuItem
              onClick={() => {
                setActiveViewId(null);
                onResetPreferences?.();
              }}
            >
              Clear view
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Save current view</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              autoFocus
              placeholder="View name (e.g. Overdue projects)"
              value={newName}
              maxLength={60}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSave();
              }}
            />
            <label className="flex items-center gap-2 text-sm text-fg-2">
              <input
                type="checkbox"
                checked={makeDefault}
                onChange={(e) => setMakeDefault(e.target.checked)}
                className="h-4 w-4 rounded border-input"
              />
              Make this my default view for this list
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={!newName.trim() || createMut.isPending}>
              {createMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save view
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
