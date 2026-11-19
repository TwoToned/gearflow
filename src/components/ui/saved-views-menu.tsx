"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { useSavedTableViews } from "@/hooks/use-back-office";
import { mapSavedView, filterAndSortSavedViews } from "@/lib/saved-views-filter";
import { toast } from "sonner";
import { BookmarkPlus, Check, Star, Trash2, ChevronDown, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { useActiveOrganization, useSession } from "@/lib/auth-client";
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
import { useSavedViewWrites } from "@/hooks/use-saved-views-writes";
import type { SavedTableView, SavedViewConfig } from "@/lib/saved-views";

/** A view as the menu shows it. Built-ins are never stored: no star, no delete. */
interface MenuView {
  id: string;
  name: string;
  config: SavedViewConfig;
  isDefault: boolean;
  builtIn?: boolean;
}

/**
 * URL-state lists (D11): a view's `config` is the list's query string and applying it is
 * a navigation. `normalize` converts a stored row on READ (legacy `{filters, sortBy}`
 * rows become `{ query }`, no backfill); a default applies only when `isPristine`
 * (the URL carries no list params).
 */
export interface SavedViewsUrlMode {
  normalize: (config: SavedViewConfig) => SavedViewConfig;
  builtIns: { id: string; name: string; config: SavedViewConfig }[];
  isPristine: boolean;
}

interface Props {
  /** Logical list id — must match the useTablePreferences tableId. */
  tableId: string;
  /** The current filters/sort/columns/pageSize to capture on "Save current view". */
  currentConfig: SavedViewConfig;
  /** Restore a saved (or default) view's config into the live table. */
  applyConfig: (config: SavedViewConfig) => void;
  /** Reset the table to its built-in defaults ("No view"). */
  onResetPreferences?: () => void;
  urlMode?: SavedViewsUrlMode;
}

/** Shallow-equal two view configs to decide if the active view is "dirty". */
function sameConfig(a: SavedViewConfig, b: SavedViewConfig): boolean {
  return (
    JSON.stringify(a.filters ?? {}) === JSON.stringify(b.filters ?? {}) &&
    (a.sortBy ?? "") === (b.sortBy ?? "") &&
    (a.sortOrder ?? "") === (b.sortOrder ?? "") &&
    JSON.stringify(a.columnVisibility ?? {}) === JSON.stringify(b.columnVisibility ?? {}) &&
    (a.pageSize ?? 0) === (b.pageSize ?? 0) &&
    (a.query ?? "") === (b.query ?? "")
  );
}

function useStoredViews(tableId: string, normalize?: (c: SavedViewConfig) => SavedViewConfig) {
  // Scope the cache key to the active org so a multi-org user who switches orgs
  // never sees/applies the previous org's views from a stale cache entry.
  const { data: activeOrg } = useActiveOrganization();
  const { data: session } = useSession();
  const userId = session?.user.id;
  // Derived from the reactive Convex savedTableViews subscription (default-first, name-asc).
  const docs = useSavedTableViews(activeOrg?.id);
  const views = useMemo<MenuView[]>(
    () =>
      docs && userId
        ? filterAndSortSavedViews(docs.map(mapSavedView), userId, tableId).map((v) => ({
            id: v.id,
            name: v.name,
            isDefault: v.isDefault,
            config: normalize ? normalize(v.config) : v.config,
          }))
        : [],
    [docs, userId, tableId, normalize],
  );
  return { views, isLoading: docs === undefined };
}

/** Apply the default view once, on first load, and only if the list is pristine. */
function useAutoApplyDefault(
  views: MenuView[],
  isLoading: boolean,
  pristine: boolean,
  apply: (v: MenuView) => void,
) {
  const done = useRef(false);
  useEffect(() => {
    if (done.current || isLoading) return;
    done.current = true;
    const def = views.find((v) => v.isDefault);
    if (def && pristine) apply(def);
    // Runs once, after views resolve; pristine/apply are read at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, views]);
}

function ViewRow({
  view,
  active,
  onApply,
  onToggleDefault,
  onDelete,
}: {
  view: MenuView;
  active: boolean;
  onApply: () => void;
  onToggleDefault: () => void;
  onDelete: () => void;
}) {
  return (
    <DropdownMenuItem className="flex items-center gap-2" onClick={onApply}>
      <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
        {active && <Check className="h-3.5 w-3.5 text-primary" />}
      </span>
      <span className="flex-1 truncate">{view.name}</span>
      {!view.builtIn && (
        <>
          <button
            type="button"
            title={view.isDefault ? "Default view — click to unset" : "Set as default"}
            className="rounded p-0.5 hover:bg-accent"
            onClick={(e) => {
              e.stopPropagation();
              onToggleDefault();
            }}
          >
            <Star className={cn("h-3.5 w-3.5", view.isDefault ? "fill-amber-400 text-amber-400" : "text-fg-3")} />
          </button>
          <button
            type="button"
            title="Delete view"
            className="rounded p-0.5 text-fg-3 hover:bg-destructive/10 hover:text-destructive"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </>
      )}
    </DropdownMenuItem>
  );
}

function SaveViewDialog({
  open,
  onOpenChange,
  pending,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pending: boolean;
  onSave: (name: string, makeDefault: boolean) => void;
}) {
  const [name, setName] = useState("");
  const [makeDefault, setMakeDefault] = useState(false);
  const submit = () => {
    if (name.trim()) onSave(name.trim(), makeDefault);
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setName("");
          setMakeDefault(false);
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Save current view</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Input
            autoFocus
            placeholder="View name (e.g. Overdue jobs)"
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
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
          <Button variant="line" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!name.trim() || pending}>
            {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save view
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function useViewMutations(tableId: string, onSaved: (view: SavedTableView) => void, onDeleted: (id: string) => void) {
  const writes = useSavedViewWrites();
  const createMut = useServerMutation({
    mutationFn: (vars: { name: string; config: SavedViewConfig; isDefault: boolean }) =>
      writes.create({ tableId, ...vars }) as unknown as Promise<SavedTableView>,
    onSuccess: (view: SavedTableView) => {
      onSaved(view);
      toast.success(`View "${view.name}" saved`);
    },
    onError: (e: Error) => toast.error(e.message || "Could not save view"),
  });
  const updateMut = useServerMutation({
    mutationFn: (vars: { id: string; config: SavedViewConfig }) => writes.update(vars.id, vars.config),
    onSuccess: () => toast.success("View updated"),
    onError: (e: Error) => toast.error(e.message || "Could not update view"),
  });
  const deleteMut = useServerMutation({
    mutationFn: (id: string) => writes.remove(id),
    onSuccess: (_d, id) => {
      onDeleted(id);
      toast.success("View deleted");
    },
    onError: (e: Error) => toast.error(e.message || "Could not delete view"),
  });
  const defaultMut = useServerMutation({
    mutationFn: (id: string | null) => writes.setDefault(tableId, id),
    onError: (e: Error) => toast.error(e.message || "Could not set default"),
  });
  return { createMut, updateMut, deleteMut, defaultMut };
}

export function SavedViewsMenu({ tableId, currentConfig, applyConfig, onResetPreferences, urlMode }: Props) {
  const { views, isLoading } = useStoredViews(tableId, urlMode?.normalize);
  const builtIns = urlMode?.builtIns;

  // Which view is "active" (last applied). In URL mode the URL is the truth, so a view whose
  // query equals the current one is active even after a reload; null = custom.
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);

  const all = useMemo<MenuView[]>(
    () => [...(builtIns ?? []).map((b) => ({ ...b, isDefault: false, builtIn: true })), ...views],
    [builtIns, views],
  );
  const byId = all.find((v) => v.id === activeViewId) ?? null;
  const byMatch = urlMode && !byId ? all.find((v) => sameConfig(v.config, currentConfig)) ?? null : null;
  const activeView = byId ?? byMatch;
  const isDirty = byId ? !sameConfig(byId.config, currentConfig) : false;

  function apply(view: MenuView) {
    applyConfig(view.config);
    setActiveViewId(view.id);
  }

  // Never clobber a filter set the user arrived with (a deep link, an in-progress refinement).
  const pristine = urlMode ? urlMode.isPristine : Object.keys(currentConfig.filters ?? {}).length === 0;
  useAutoApplyDefault(views, isLoading, pristine, apply);

  const { createMut, updateMut, deleteMut, defaultMut } = useViewMutations(
    tableId,
    (view) => {
      setActiveViewId(view.id);
      setSaveOpen(false);
    },
    (id) => {
      if (activeViewId === id) setActiveViewId(null);
    },
  );

  const label = activeView ? `${activeView.name}${isDirty ? " *" : ""}` : "Views";

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="line" size="sm" className="h-11 gap-1.5 text-xs sm:h-8">
            <BookmarkPlus className="h-3.5 w-3.5" />
            <span className="max-w-[140px] truncate">{label}</span>
            <ChevronDown className="h-3.5 w-3.5 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-60">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Saved views</DropdownMenuLabel>
          </DropdownMenuGroup>
          {isLoading ? (
            <div className="flex items-center gap-2 px-2 py-2 text-xs text-fg-3">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
            </div>
          ) : all.length === 0 ? (
            <p className="px-2 py-2 text-xs text-fg-3">No saved views yet.</p>
          ) : (
            <DropdownMenuGroup>
              {all.map((view) => (
                <ViewRow
                  key={view.id}
                  view={view}
                  active={activeView?.id === view.id}
                  onApply={() => apply(view)}
                  onToggleDefault={() => defaultMut.mutate(view.isDefault ? null : view.id)}
                  onDelete={() => deleteMut.mutate(view.id)}
                />
              ))}
            </DropdownMenuGroup>
          )}

          <DropdownMenuSeparator />
          {byId && !byId.builtIn && isDirty && (
            <DropdownMenuItem onClick={() => updateMut.mutate({ id: byId.id, config: currentConfig })}>
              Update &ldquo;{byId.name}&rdquo;
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={() => setSaveOpen(true)}>
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

      <SaveViewDialog
        open={saveOpen}
        onOpenChange={setSaveOpen}
        pending={createMut.isPending}
        onSave={(name, isDefault) => createMut.mutate({ name, config: currentConfig, isDefault })}
      />
    </>
  );
}
