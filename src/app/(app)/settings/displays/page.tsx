"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Copy,
  Loader2,
  MonitorPlay,
  Plus,
  Trash2,
  MapPin,
  Clock,
} from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
import {
  getDisplayTokens,
  createDisplayToken,
  revokeDisplayToken,
} from "@/server/warehouse-display";
import { getLocations } from "@/server/locations";

interface DisplayToken {
  id: string;
  name: string;
  layout: string;
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

export default function DisplaySettingsPage() {
  const queryClient = useQueryClient();
  const canEdit = useCanDo("orgSettings", "update");
  const [open, setOpen] = useState(false);
  const [newToken, setNewToken] = useState<string | null>(null);

  // Form state
  const [name, setName] = useState("");
  const [locationId, setLocationId] = useState("");
  const [layout, setLayout] = useState("standard");

  const { data: tokens, isLoading } = useQuery({
    queryKey: ["display-tokens"],
    queryFn: getDisplayTokens,
  });

  const { data: locationsData } = useQuery({
    queryKey: ["locations-for-display"],
    queryFn: () => getLocations({ pageSize: 100, sortBy: "name" }),
  });

  const locations = (locationsData as { locations: Array<{ id: string; name: string; type: string }> })?.locations ?? [];

  const createMutation = useMutation({
    mutationFn: createDisplayToken,
    onSuccess: (result) => {
      const data = result as { token: string; display: unknown };
      setNewToken(data.token);
      queryClient.invalidateQueries({ queryKey: ["display-tokens"] });
      toast.success("Display token created");
    },
    onError: (e) => toast.error(e.message),
  });

  const revokeMutation = useMutation({
    mutationFn: revokeDisplayToken,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["display-tokens"] });
      toast.success("Display token revoked");
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

  function handleCloseDialog() {
    setOpen(false);
    setNewToken(null);
    setName("");
    setLocationId("");
    setLayout("standard");
  }

  function getDisplayUrl(token: string) {
    const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
    return `${baseUrl}/warehouse/display/${token}`;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MonitorPlay className="h-5 w-5" />
          Warehouse Displays
        </CardTitle>
        <CardDescription>
          Create shareable URLs for wall-mounted TVs and monitors in your
          warehouse. Each display auto-refreshes and requires no login.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            {/* Existing tokens */}
            {tokens && (tokens as unknown as DisplayToken[]).length > 0 && (
              <div className="space-y-3">
                {(tokens as unknown as DisplayToken[]).map((t) => (
                  <div
                    key={t.id}
                    className="flex items-start justify-between gap-4 rounded-lg border p-4"
                  >
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <MonitorPlay className="h-4 w-4 text-muted-foreground shrink-0" />
                        <span className="font-medium truncate">{t.name}</span>
                        <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                          {t.layout}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
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
                      <Button
                        variant="outline"
                        size="icon"
                        className="shrink-0 text-destructive hover:text-destructive"
                        onClick={() => {
                          if (confirm(`Revoke display "${t.name}"? The screen will stop working.`))
                            revokeMutation.mutate(t.id);
                        }}
                        disabled={revokeMutation.isPending}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Create button */}
            {canEdit && (
              <Dialog open={open} onOpenChange={(v) => { if (!v) handleCloseDialog(); else setOpen(true); }}>
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
                      <p className="text-sm text-muted-foreground">
                        Copy this URL and open it on your warehouse TV or monitor.
                        This URL will only be shown once.
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
                            navigator.clipboard.writeText(getDisplayUrl(newToken));
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

                      <div className="space-y-2">
                        <Label htmlFor="displayLocation">Location (optional)</Label>
                        <select
                          id="displayLocation"
                          value={locationId}
                          onChange={(e) => setLocationId(e.target.value)}
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
                        <p className="text-xs text-muted-foreground">
                          Scope to a warehouse location to only show relevant projects.
                        </p>
                      </div>

                      <div className="space-y-2">
                        <Label>Layout</Label>
                        <div className="grid gap-2">
                          {LAYOUTS.map((l) => (
                            <label
                              key={l.value}
                              className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${
                                layout === l.value
                                  ? "border-primary bg-primary/5"
                                  : "hover:bg-muted/50"
                              }`}
                            >
                              <input
                                type="radio"
                                name="layout"
                                value={l.value}
                                checked={layout === l.value}
                                onChange={() => setLayout(l.value)}
                                className="mt-0.5"
                              />
                              <div>
                                <div className="text-sm font-medium">{l.label}</div>
                                <div className="text-xs text-muted-foreground">
                                  {l.description}
                                </div>
                              </div>
                            </label>
                          ))}
                        </div>
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
          </>
        )}
      </CardContent>
    </Card>
  );
}
