"use client";

import { useState } from "react";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { useServerQuery } from "@/hooks/use-server-query";
import { toast } from "sonner";
import {
  Copy,
  Loader2,
  MonitorPlay,
  Plus,
  Trash2,
  MapPin,
  Clock,
  Pencil,
  RefreshCw,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { DeleteDialog } from "@/components/ui/delete-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from "@/components/ui/dialog";
import { useCanDo } from "@/lib/use-permissions";
import { FadeIn } from "@/components/ui/motion";
import {
  getDisplayTokens,
  createDisplayToken,
  revokeDisplayToken,
  updateDisplayToken,
  regenerateDisplayToken,
} from "@/server/warehouse-display";
import { getLocations } from "@/server/locations";

interface DisplayToken {
  id: string;
  name: string;
  token: string;
  layout: string;
  locationId: string | null;
  location: { id: string; name: string } | null;
  createdBy: { name: string };
  lastAccessedAt: string | Date | null;
  createdAt: string | Date;
}

const LAYOUTS = [
  { value: "standard", label: "Standard", description: "Full dashboard with all sections" },
  { value: "compact", label: "Compact", description: "Dispatch + returns only, larger text" },
  { value: "dispatch-only", label: "Dispatch Only", description: "Today's dispatch with prep status" },
] as const;

function formatDate(date: string | Date | null) {
  if (!date) return "Never";
  return new Date(date).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getDisplayUrl(token: string) {
  const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
  return `${baseUrl}/warehouse/display/${token}`;
}

// ─── Layout Picker (shared between create & edit) ────────────────────────────

function LayoutPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="grid gap-2">
      {LAYOUTS.map((l) => (
        <label
          key={l.value}
          className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${
            value === l.value
              ? "border-primary bg-primary/5"
              : "hover:bg-bg-inset/50"
          }`}
        >
          <input
            type="radio"
            name="layout"
            value={l.value}
            checked={value === l.value}
            onChange={() => onChange(l.value)}
            className="mt-0.5"
          />
          <div>
            <div className="text-sm font-medium">{l.label}</div>
            <div className="text-xs text-fg-3">{l.description}</div>
          </div>
        </label>
      ))}
    </div>
  );
}

// ─── Location Select (shared) ────────────────────────────────────────────────

function LocationSelect({
  value,
  onChange,
  locations,
}: {
  value: string;
  onChange: (v: string) => void;
  locations: Array<{ id: string; name: string; type: string }>;
}) {
  return (
    <div className="space-y-2">
      <Label>Location (optional)</Label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <option value="">All locations</option>
        {locations
          .filter((l) => l.type === "WAREHOUSE")
          .map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
      </select>
      <p className="text-xs text-fg-3">
        Scope to a warehouse location to only show relevant projects.
      </p>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function DisplaySettingsPage() {
  const canEdit = useCanDo("orgSettings", "update");
  const [createOpen, setCreateOpen] = useState(false);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [editingToken, setEditingToken] = useState<DisplayToken | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<{ id: string; name: string } | null>(null);
  const [regenerateOpen, setRegenerateOpen] = useState(false);
  const [regeneratedUrl, setRegeneratedUrl] = useState<string | null>(null);

  // Create form state
  const [name, setName] = useState("");
  const [locationId, setLocationId] = useState("");
  const [layout, setLayout] = useState("standard");

  // Edit form state
  const [editName, setEditName] = useState("");
  const [editLocationId, setEditLocationId] = useState("");
  const [editLayout, setEditLayout] = useState("standard");

  const { data: tokens, isLoading, refetch } = useServerQuery({
    queryKey: ["display-tokens"],
    queryFn: getDisplayTokens,
  });

  const { data: locationsData } = useServerQuery({
    queryKey: ["locations-for-display"],
    queryFn: () => getLocations({ pageSize: 100, sortBy: "name" }),
  });

  const locations =
    (locationsData as { locations: Array<{ id: string; name: string; type: string }> })
      ?.locations ?? [];

  const invalidate = () => refetch();

  const createMutation = useServerMutation({
    mutationFn: createDisplayToken,
    onSuccess: (result) => {
      const data = result as { token: string; display: unknown };
      setNewToken(data.token);
      invalidate();
      toast.success("Display token created");
    },
    onError: (e) => toast.error(e.message),
  });

  const revokeMutation = useServerMutation({
    mutationFn: revokeDisplayToken,
    onSuccess: () => {
      invalidate();
      toast.success("Display token revoked");
    },
    onError: (e) => toast.error(e.message),
  });

  const updateMutation = useServerMutation({
    mutationFn: (data: { id: string; name: string; locationId: string | null; layout: string }) =>
      updateDisplayToken(data.id, {
        name: data.name,
        locationId: data.locationId,
        layout: data.layout,
      }),
    onSuccess: () => {
      setEditingToken(null);
      invalidate();
      toast.success("Display updated");
    },
    onError: (e) => toast.error(e.message),
  });

  const regenerateMutation = useServerMutation({
    mutationFn: regenerateDisplayToken,
    onSuccess: (result) => {
      const data = result as { token: string };
      const newUrl = getDisplayUrl(data.token);
      setRegeneratedUrl(newUrl);
      if (editingToken) {
        setEditingToken({ ...editingToken, token: data.token });
      }
      invalidate();
      toast.success("New URL generated");
    },
    onError: (e) => toast.error(e.message),
  });

  function handleCreate() {
    if (!name.trim()) {
      toast.error("Please enter a display name");
      return;
    }
    createMutation.mutate({
      name: name.trim(),
      locationId: locationId || null,
      layout,
    });
  }

  function handleCloseCreate() {
    setCreateOpen(false);
    setNewToken(null);
    setName("");
    setLocationId("");
    setLayout("standard");
  }

  function openEdit(t: DisplayToken) {
    setEditingToken(t);
    setEditName(t.name);
    setEditLocationId(t.locationId || "");
    setEditLayout(t.layout);
    setRegeneratedUrl(null);
  }

  function handleSaveEdit() {
    if (!editingToken || !editName.trim()) return;
    updateMutation.mutate({
      id: editingToken.id,
      name: editName.trim(),
      locationId: editLocationId || null,
      layout: editLayout,
    });
  }

  const tokenList = (tokens as unknown as DisplayToken[]) ?? [];

  return (
    <FadeIn>
    <div className="rounded-lg bg-bg-surface p-5 surface-ring sm:p-6">
      <div className="mb-4">
        <h3 className="t-heading text-fg flex items-center gap-2">
          <MonitorPlay className="h-4 w-4" />
          Warehouse Displays
        </h3>
        <p className="mt-0.5 text-[12px] text-fg-3">
          Create shareable URLs for wall-mounted TVs and monitors in your
          warehouse. Each display auto-refreshes and requires no login.
        </p>
      </div>
      <div className="space-y-6">
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-fg-3" />
          </div>
        ) : (
          <>
            {/* Existing tokens */}
            {tokenList.length > 0 && (
              <div className="space-y-3">
                {tokenList.map((t) => (
                  <div
                    key={t.id}
                    className="flex items-start justify-between gap-4 rounded-lg border p-4"
                  >
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <MonitorPlay className="h-4 w-4 text-fg-3 shrink-0" />
                        <span className="font-medium truncate">{t.name}</span>
                        <span className="text-xs text-fg-3 bg-bg-inset px-1.5 py-0.5 rounded">
                          {t.layout}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-3">
                        {t.location && (
                          <span className="flex items-center gap-1">
                            <MapPin className="h-3 w-3" />
                            {t.location.name}
                          </span>
                        )}
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          Last seen: {formatDate(t.lastAccessedAt)}
                        </span>
                        <span>Created by {t.createdBy.name}</span>
                      </div>
                    </div>
                    {canEdit && (
                      <div className="flex gap-1 shrink-0">
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={() => openEdit(t)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="outline"
                          size="icon"
                          className="text-destructive hover:text-destructive"
                          onClick={() => setRevokeTarget({ id: t.id, name: t.name })}
                          disabled={revokeMutation.isPending}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Create button */}
            {canEdit && (
              <Dialog
                open={createOpen}
                onOpenChange={(v) => {
                  if (!v) handleCloseCreate();
                  else setCreateOpen(true);
                }}
              >
                <DialogTrigger render={<Button variant="outline" />}>
                  <Plus className="mr-2 h-4 w-4" />
                  Add Display
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>
                      {newToken ? "Display URL Created" : "Add Warehouse Display"}
                    </DialogTitle>
                  </DialogHeader>

                  {newToken ? (
                    <div className="space-y-4">
                      <p className="text-sm text-fg-3">
                        Copy this URL and open it on your warehouse TV or
                        monitor. You can regenerate this URL later from the edit
                        menu.
                      </p>
                      <div className="flex gap-2">
                        <Input
                          readOnly
                          value={getDisplayUrl(newToken)}
                          className="font-mono text-xs"
                        />
                        <Button
                          variant="outline"
                          size="icon"
                          className="shrink-0"
                          onClick={() => {
                            navigator.clipboard.writeText(
                              getDisplayUrl(newToken)
                            );
                            toast.success("URL copied to clipboard");
                          }}
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                      </div>
                      <DialogClose render={<Button className="w-full" />}>
                        Done
                      </DialogClose>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="displayName">Display Name</Label>
                        <Input
                          id="displayName"
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          placeholder="Main Warehouse TV"
                        />
                      </div>

                      <LocationSelect
                        value={locationId}
                        onChange={setLocationId}
                        locations={locations}
                      />

                      <div className="space-y-2">
                        <Label>Layout</Label>
                        <LayoutPicker value={layout} onChange={setLayout} />
                      </div>

                      <div className="flex gap-2 justify-end">
                        <DialogClose render={<Button variant="outline" />}>
                          Cancel
                        </DialogClose>
                        <Button
                          onClick={handleCreate}
                          disabled={createMutation.isPending}
                        >
                          {createMutation.isPending && (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          )}
                          Create Display
                        </Button>
                      </div>
                    </div>
                  )}
                </DialogContent>
              </Dialog>
            )}

            {/* Edit dialog */}
            <Dialog
              open={!!editingToken}
              onOpenChange={(v) => {
                if (!v) {
                  setEditingToken(null);
                  setRegeneratedUrl(null);
                }
              }}
            >
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Edit Display</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="editDisplayName">Display Name</Label>
                    <Input
                      id="editDisplayName"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                    />
                  </div>

                  <LocationSelect
                    value={editLocationId}
                    onChange={setEditLocationId}
                    locations={locations}
                  />

                  <div className="space-y-2">
                    <Label>Layout</Label>
                    <LayoutPicker
                      value={editLayout}
                      onChange={setEditLayout}
                    />
                  </div>

                  {/* Display URL section */}
                  <div className="border-t pt-4 space-y-3">
                    <Label>Display URL</Label>
                    <div className="flex gap-2">
                      <Input
                        readOnly
                        value={
                          regeneratedUrl ||
                          (editingToken
                            ? getDisplayUrl(editingToken.token)
                            : "")
                        }
                        className="font-mono text-xs"
                      />
                      <Button
                        variant="outline"
                        size="icon"
                        className="shrink-0"
                        onClick={() => {
                          const url =
                            regeneratedUrl ||
                            (editingToken
                              ? getDisplayUrl(editingToken.token)
                              : "");
                          navigator.clipboard.writeText(url);
                          toast.success("URL copied to clipboard");
                        }}
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                    </div>
                    {regeneratedUrl && (
                      <p className="text-xs text-fg-3">
                        New URL generated. The previous URL no longer works.
                      </p>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        if (editingToken) setRegenerateOpen(true);
                      }}
                      disabled={regenerateMutation.isPending}
                    >
                      {regenerateMutation.isPending ? (
                        <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="mr-2 h-3.5 w-3.5" />
                      )}
                      Regenerate URL
                    </Button>
                  </div>

                  <div className="flex gap-2 justify-end border-t pt-4">
                    <Button
                      variant="outline"
                      onClick={() => {
                        setEditingToken(null);
                        setRegeneratedUrl(null);
                      }}
                    >
                      Cancel
                    </Button>
                    <Button
                      onClick={handleSaveEdit}
                      disabled={updateMutation.isPending}
                    >
                      {updateMutation.isPending && (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      )}
                      Save Changes
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </>
        )}
      </div>
      <DeleteDialog
        open={!!revokeTarget}
        onOpenChange={(open) => !open && setRevokeTarget(null)}
        title={`Revoke display "${revokeTarget?.name ?? ""}"?`}
        description="The screen using this display URL stops working immediately. You can create a new display token to replace it."
        confirmLabel="Revoke display"
        onConfirm={() => {
          if (revokeTarget) {
            revokeMutation.mutate(revokeTarget.id);
            setRevokeTarget(null);
          }
        }}
        pending={revokeMutation.isPending}
      />
      <DeleteDialog
        open={regenerateOpen}
        onOpenChange={setRegenerateOpen}
        title="Regenerate display URL?"
        description="The current URL stops working immediately. You'll need to update the screen that uses this display."
        confirmLabel="Regenerate URL"
        onConfirm={() => {
          if (editingToken) {
            regenerateMutation.mutate(editingToken.id);
            setRegenerateOpen(false);
          }
        }}
        pending={regenerateMutation.isPending}
      />
    </div>
    </FadeIn>
  );
}
