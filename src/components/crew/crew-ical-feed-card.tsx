"use client";

import { useState } from "react";
import { CalendarSync, Copy, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { CanDo } from "@/components/auth/permission-gate";
import { Button } from "@/components/ui/button";
import { DeleteDialog } from "@/components/ui/delete-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { useServerQuery } from "@/hooks/use-server-query";
import { disableIcalFeed, enableIcalFeed, getIcalSettings, regenerateIcalToken, setIcalIncludeTentative } from "@/server/crew-calendar";

/**
 * The crew member's iCal feed (the record's Calendar tab). The feed URL embeds
 * `icalToken`, a bearer secret for the public, unauthenticated calendar route,
 * so the token comes ONLY from `crew.memberDetail` — through the one member-row
 * boundary (`convex/lib/crewMemberRedaction.ts`): the member themself or a
 * `crew:update` caller on a user session gets it, everyone else gets it absent.
 * No token, no link: a plain `crew:read` viewer sees whether a feed is on, never
 * its URL. `getIcalSettings` carries only the on/off and tentative switches.
 */
export interface CrewIcalFeedCardProps {
  memberId: string;
  /** `memberDetail`'s `icalToken`, absent unless the server says this caller may hold it. */
  feedToken: string | undefined;
  /** Re-read the member after a write that mints or changes the token. */
  onTokenChanged: () => void;
}

const feedUrl = (token: string) => `${typeof window !== "undefined" ? window.location.origin : ""}/api/crew/calendar/${token}`;

function useFeedWrites(memberId: string, refetch: () => void, onTokenChanged: () => void) {
  const both = () => {
    refetch();
    onTokenChanged();
  };
  const enable = useServerMutation({
    mutationFn: () => enableIcalFeed(memberId),
    onSuccess: () => { toast.success("iCal feed enabled"); both(); },
    onError: (e) => toast.error(e.message),
  });
  const disable = useServerMutation({
    mutationFn: () => disableIcalFeed(memberId),
    onSuccess: () => { toast.success("iCal feed disabled"); both(); },
    onError: (e) => toast.error(e.message),
  });
  const regenerate = useServerMutation({
    mutationFn: () => regenerateIcalToken(memberId),
    onSuccess: () => { toast.success("iCal token regenerated — old URL is now invalid"); both(); },
    onError: (e) => toast.error(e.message),
  });
  const tentative = useServerMutation({
    mutationFn: (include: boolean) => setIcalIncludeTentative(memberId, include),
    onSuccess: (_data, include) => {
      toast.success(include ? "Pending assignments will now show on the feed" : "Pending assignments hidden from the feed");
      refetch();
    },
    onError: (e) => toast.error(e.message),
  });
  return { enable, disable, regenerate, tentative };
}

function FeedLink({ token }: { token: string }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-caption text-muted">Feed URL</Label>
      <div className="flex gap-2">
        <Input readOnly aria-label="Feed URL" value={feedUrl(token)} className="font-mono text-caption" />
        <Button
          variant="line"
          size="icon"
          aria-label="Copy feed URL"
          onClick={() => {
            navigator.clipboard.writeText(feedUrl(token));
            toast.success("Feed URL copied to clipboard");
          }}
        >
          <Copy className="size-5" />
        </Button>
      </div>
    </div>
  );
}

export function CrewIcalFeedCard({ memberId, feedToken, onTokenChanged }: CrewIcalFeedCardProps) {
  const { data: settings, refetch } = useServerQuery({ queryKey: ["crew-ical", memberId], queryFn: () => getIcalSettings(memberId) });
  const w = useFeedWrites(memberId, refetch, onTokenChanged);
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);
  const enabled = !!settings?.icalEnabled;
  return (
    <div className="rounded-[var(--r-lg)] bg-card p-5 ring-1 ring-line shadow-[var(--sh-card)] sm:p-6">
      <h3 className="text-card-title font-bold text-ink flex items-center gap-2 mb-4">
        <CalendarSync className="h-4 w-4" />
        iCal feed
      </h3>
      <div className="space-y-4">
        <p className="text-ui-text text-muted">
          Enable an iCal feed URL that can be subscribed to from Google Calendar, Apple Calendar, Outlook, or any calendar app. The feed
          includes all confirmed assignments.
        </p>
        {enabled ? (
          <div className="space-y-3">
            {feedToken ? (
              <FeedLink token={feedToken} />
            ) : (
              <p className="text-caption text-muted" data-testid="ical-feed-on">
                The feed is on. Only this crew member and people who manage crew can see its URL.
              </p>
            )}
            <div className="flex items-start justify-between gap-4 rounded-[var(--r)] border border-line p-3">
              <div className="space-y-1">
                <Label htmlFor="icalIncludeTentative" className="text-ui-text">Include pending assignments</Label>
                <p className="text-caption text-muted">
                  Off: feed shows confirmed/accepted assignments only. On: assignments still awaiting an offer or response also appear, marked
                  tentative.
                </p>
              </div>
              <CanDo resource="crew" action="update">
                <Switch
                  id="icalIncludeTentative"
                  checked={settings?.icalIncludeTentative ?? false}
                  onCheckedChange={(checked) => w.tentative.mutate(checked)}
                  disabled={w.tentative.isPending}
                />
              </CanDo>
            </div>
            <CanDo resource="crew" action="update">
              <div className="flex gap-2">
                <Button variant="line" size="sm" onClick={() => setConfirmRegenerate(true)} loading={w.regenerate.isPending}>
                  <RefreshCw className="size-5" />
                  Regenerate URL
                </Button>
                <Button variant="line" size="sm" className="text-warn hover:bg-warn-soft" onClick={() => w.disable.mutate()} loading={w.disable.isPending}>
                  Disable feed
                </Button>
              </div>
            </CanDo>
          </div>
        ) : (
          <CanDo resource="crew" action="update">
            <Button variant="line" onClick={() => w.enable.mutate()} loading={w.enable.isPending}>
              <CalendarSync className="size-5" />
              Enable iCal feed
            </Button>
          </CanDo>
        )}
      </div>
      <DeleteDialog
        open={confirmRegenerate}
        onOpenChange={setConfirmRegenerate}
        title="Regenerate self-service token?"
        description="The current self-service URL stops working immediately. You'll need to send the new URL to this crew member."
        confirmLabel="Regenerate token"
        onConfirm={() => {
          w.regenerate.mutate();
          setConfirmRegenerate(false);
        }}
        pending={w.regenerate.isPending}
      />
    </div>
  );
}
