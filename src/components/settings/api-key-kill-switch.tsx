"use client";

import { useState } from "react";
import { ShieldAlert } from "lucide-react";
import { toast } from "sonner";

import { useServerMutation } from "@/hooks/use-server-mutation";
import { setOrgApiKillSwitch } from "@/server/api-keys";
import { formatDate } from "@/lib/formatters";
import { SettingsCard, FormSection } from "@/components/layout/page-layouts";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

/**
 * Org-wide API kill switch (design §14). When on, EVERY key for this org is
 * rejected instantly (ApiKeyAuthError ORG_KILL_SWITCH), regardless of
 * per-key state — the blast-radius containment lever for "something is
 * writing to my org and I don't know why."
 */
export function KillSwitchCard({
  orgId,
  apiKillSwitchAt,
  onToggled,
}: {
  orgId: string | undefined;
  apiKillSwitchAt: Date | string | null;
  onToggled: () => void;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const enabled = !!apiKillSwitchAt;

  const mutation = useServerMutation({
    mutationFn: (next: boolean) => setOrgApiKillSwitch(next),
    onSuccess: (_res, next) => {
      toast.success(
        next
          ? "API access disabled for every key in this org"
          : "API access re-enabled",
      );
      onToggled();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <SettingsCard className={enabled ? "border border-t-out/30" : undefined}>
      <FormSection
        title="Emergency kill switch"
        description="Instantly disables every API key for this org — the next request any of them makes fails with ORG_KILL_SWITCH, no matter which key or scope it holds."
      >
        <div className="sm:col-span-2 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-sm">
            <ShieldAlert className={enabled ? "h-4 w-4 text-t-out" : "h-4 w-4 text-fg-3"} />
            {enabled ? (
              <span className="text-t-out font-medium">
                API access disabled{apiKillSwitchAt ? ` since ${formatDate(apiKillSwitchAt)}` : ""}
              </span>
            ) : (
              <span className="text-fg-3">API access enabled</span>
            )}
          </div>
          <Button
            type="button"
            variant={enabled ? "primary" : "line"}
            className={enabled ? undefined : "border-t-out text-t-out hover:bg-out-soft"}
            disabled={!orgId || mutation.isPending}
            onClick={() => (enabled ? mutation.mutate(false) : setConfirmOpen(true))}
          >
            {enabled ? "Re-enable API access" : "Disable all API access"}
          </Button>
        </div>
      </FormSection>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Disable API access for this org?</DialogTitle>
            <DialogDescription>
              This instantly disables <strong>every</strong> API key for this organization — every
              agent, integration, and MCP client using one will start failing immediately. Existing UI
              sessions are unaffected. You can re-enable it at any time.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="line" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={() => {
                mutation.mutate(true);
                setConfirmOpen(false);
              }}
            >
              Disable all API access
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsCard>
  );
}
