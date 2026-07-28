"use client";

import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { useSession } from "@/lib/auth-client";
import { useServerQuery } from "@/hooks/use-server-query";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { getMentionableMembers } from "@/server/org-members";
import { createApiKey } from "@/server/api-keys";
import { apiKeyCreateSchema, type ApiKeyCreateFormValues } from "@/lib/validations/api-key";
import { API_KEY_PRESETS, findApiKeyPreset } from "@/lib/api-key-presets";
import { rolePermissions } from "../../../convex/lib/permissionsCore";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ComboboxPicker, MultiComboboxPicker } from "@/components/ui/combobox-picker";

// Every scope offered by the explicit picker — the OWNER role's full action
// ceiling (permissionsCore.ts), which is the widest a key can ever be granted
// (assertScopesWithinActor bounds a mint to ≤ the minting actor's own scopes
// regardless of what's listed here), plus the two personal-scope strings.
const ALL_SCOPE_OPTIONS = [
  ...Object.entries(rolePermissions.owner).flatMap(([resource, actions]) =>
    (actions ?? []).map((action) => `${resource}:${action}`),
  ),
  "self:read",
  "self:write",
  // Not an RBAC action — a privileged extra scope (src/lib/api/privileged-args.ts)
  // that softens the in-mutation overbooking check. In no preset (decision 7);
  // offered here only because the explicit picker is exactly where a "no, I
  // really do want this key to be able to overbook" grant belongs.
  "project:allow_overbook",
].sort();

export function CreateApiKeyDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (token: string, name: string) => void;
}) {
  const { data: session } = useSession();
  const { data: members, isLoading: membersLoading } = useServerQuery({
    queryKey: ["mentionable-members"],
    queryFn: () => getMentionableMembers(),
    enabled: open,
  });

  const [presetId, setPresetId] = useState<string>("read_only_agent");

  const form = useForm<ApiKeyCreateFormValues>({
    resolver: zodResolver(apiKeyCreateSchema),
    defaultValues: {
      name: "",
      actingUserId: "",
      scopes: findApiKeyPreset("read_only_agent")?.scopes ?? [],
      expiresAt: "",
      noFinancials: findApiKeyPreset("read_only_agent")?.noFinancialsDefault ?? true,
    },
  });

  // Reset to a clean form (including re-applying the currently selected
  // preset and defaulting the acting user to the creator, per design §14)
  // every time the dialog opens, so a previous session's values don't leak
  // into the next key.
  useEffect(() => {
    if (!open) return;
    const preset = findApiKeyPreset(presetId);
    form.reset({
      name: "",
      actingUserId: session?.user?.id ?? "",
      scopes: preset?.scopes ?? [],
      expiresAt: "",
      noFinancials: preset?.noFinancialsDefault ?? true,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally only re-runs on open
  }, [open]);

  const memberOptions = useMemo(
    () =>
      (members ?? []).map((m: { userId: string; name: string }) => ({
        value: m.userId,
        label: m.name,
      })),
    [members],
  );

  const createMutation = useServerMutation({
    mutationFn: (data: ApiKeyCreateFormValues) =>
      createApiKey({
        name: data.name,
        actingUserId: data.actingUserId,
        scopes: data.scopes ?? [],
        expiresAt: data.expiresAt || null,
        noFinancials: data.noFinancials,
      }),
    onSuccess: (res, variables) => {
      toast.success(`API key "${variables.name}" created`);
      onCreated(res.token, variables.name);
    },
    onError: (e) => toast.error(e.message),
  });

  function applyPreset(id: string) {
    setPresetId(id);
    const preset = findApiKeyPreset(id);
    if (!preset) return;
    form.setValue("scopes", [...preset.scopes]);
    form.setValue("noFinancials", preset.noFinancialsDefault);
  }

  const scopes = form.watch("scopes") ?? [];
  const actingUserId = form.watch("actingUserId");
  const noFinancials = form.watch("noFinancials");

  function onSubmit(data: ApiKeyCreateFormValues) {
    createMutation.mutate(data);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create API key</DialogTitle>
        </DialogHeader>

        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input {...form.register("name")} placeholder="e.g. Claude Code, nightly sync" />
            {form.formState.errors.name && (
              <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Acting user</Label>
            <ComboboxPicker
              value={actingUserId}
              onChange={(v) => form.setValue("actingUserId", v)}
              options={memberOptions}
              placeholder={membersLoading ? "Loading members…" : "Select who this key acts as…"}
              searchPlaceholder="Search members…"
            />
            <p className="text-xs text-fg-3">
              Effective permission is this member&apos;s live role intersected with the key&apos;s scopes below.
            </p>
            {form.formState.errors.actingUserId && (
              <p className="text-xs text-destructive">{form.formState.errors.actingUserId.message}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Expiry (optional)</Label>
            <Input type="date" {...form.register("expiresAt")} />
          </div>

          <div className="space-y-1.5">
            <Label>Scope preset</Label>
            <Select value={presetId} onValueChange={applyPreset}>
              <SelectTrigger>
                <SelectValue>
                  {API_KEY_PRESETS.find((p) => p.id === presetId)?.label ?? "Custom"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {API_KEY_PRESETS.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-fg-3">
              {API_KEY_PRESETS.find((p) => p.id === presetId)?.description}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label>Scopes ({scopes.length} selected)</Label>
            <MultiComboboxPicker
              values={scopes}
              onChange={(v) => form.setValue("scopes", v)}
              options={ALL_SCOPE_OPTIONS.map((s) => ({ value: s, label: s }))}
              placeholder="Add or remove scopes…"
              searchPlaceholder="Search scopes…"
            />
            <p className="text-xs text-fg-3">
              Delete, warehouse check-out/check-in, and org administration are never granted here —
              those stay explicit, single-scope opt-ins.
            </p>
          </div>

          <div className="flex items-center justify-between rounded-md border border-border p-3">
            <div>
              <Label htmlFor="no-financials">No financials</Label>
              <p className="text-xs text-fg-3">
                Force-redacts cost/margin data for this key, regardless of the acting user&apos;s role.
              </p>
            </div>
            <Switch
              id="no-financials"
              checked={noFinancials}
              onCheckedChange={(checked) => form.setValue("noFinancials", checked)}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="line" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={createMutation.isPending}>
              {createMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create key
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
