"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  CalendarSync,
  Copy,
  Loader2,
  RefreshCw,
  Briefcase,
  Truck,
  Wrench,
  Users,
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
import { useCanDo } from "@/lib/use-permissions";
import {
  getOrgIcalSettings,
  enableOrgIcalFeed,
  disableOrgIcalFeed,
  regenerateOrgIcalToken,
} from "@/server/org-calendar";

const FEEDS = [
  {
    key: "projects",
    label: "Projects",
    description: "All projects from quoting onwards with load-in through load-out dates.",
    icon: Briefcase,
  },
  {
    key: "services",
    label: "Services",
    description: "All scheduled services — deliveries, pickups, bump-in/out, labour.",
    icon: Truck,
  },
  {
    key: "maintenance",
    label: "Maintenance",
    description: "Scheduled and in-progress maintenance tasks with due dates.",
    icon: Wrench,
  },
  {
    key: "crew",
    label: "Crew Overview",
    description: "All confirmed crew assignments across every project.",
    icon: Users,
  },
] as const;

function FeedUrl({ token, feedKey }: { token: string; feedKey: string }) {
  const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
  const url = `${baseUrl}/api/calendar/${token}/${feedKey}.ics`;

  return (
    <div className="flex gap-2">
      <Input readOnly value={url} className="font-mono text-xs" />
      <Button
        variant="outline"
        size="icon"
        className="shrink-0"
        onClick={() => {
          navigator.clipboard.writeText(url);
          toast.success("Feed URL copied");
        }}
      >
        <Copy className="h-4 w-4" />
      </Button>
    </div>
  );
}

export default function CalendarSettingsPage() {
  const queryClient = useQueryClient();
  const canEdit = useCanDo("orgSettings", "update");

  const { data: icalSettings, isLoading } = useQuery({
    queryKey: ["org-ical-settings"],
    queryFn: getOrgIcalSettings,
  });

  const enableMutation = useMutation({
    mutationFn: enableOrgIcalFeed,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["org-ical-settings"] });
      toast.success("Calendar feeds enabled");
    },
    onError: (e) => toast.error(e.message),
  });

  const disableMutation = useMutation({
    mutationFn: disableOrgIcalFeed,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["org-ical-settings"] });
      toast.success("Calendar feeds disabled");
    },
    onError: (e) => toast.error(e.message),
  });

  const regenerateMutation = useMutation({
    mutationFn: regenerateOrgIcalToken,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["org-ical-settings"] });
      toast.success("Calendar feed URLs regenerated");
    },
    onError: (e) => toast.error(e.message),
  });

  const enabled = icalSettings?.icalEnabled && icalSettings?.icalToken;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarSync className="h-5 w-5" />
          Calendar Feeds
        </CardTitle>
        <CardDescription>
          Subscribe to iCal feeds from Google Calendar, Apple Calendar, Outlook,
          or any calendar app. All feeds share a single token — regenerating
          invalidates all URLs.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : enabled ? (
          <>
            <div className="space-y-4">
              {FEEDS.map((feed) => (
                <div key={feed.key} className="space-y-1.5">
                  <Label className="flex items-center gap-1.5 text-sm font-medium">
                    <feed.icon className="h-3.5 w-3.5 text-muted-foreground" />
                    {feed.label}
                  </Label>
                  <p className="text-xs text-muted-foreground mb-1">
                    {feed.description}
                  </p>
                  <FeedUrl
                    token={icalSettings.icalToken!}
                    feedKey={feed.key}
                  />
                </div>
              ))}
            </div>

            {canEdit && (
              <div className="flex gap-2 pt-2 border-t">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (
                      confirm(
                        "Regenerate token? All existing feed URLs will stop working."
                      )
                    )
                      regenerateMutation.mutate();
                  }}
                  disabled={regenerateMutation.isPending}
                >
                  <RefreshCw className="mr-2 h-3.5 w-3.5" />
                  Regenerate URLs
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-destructive"
                  onClick={() => disableMutation.mutate()}
                  disabled={disableMutation.isPending}
                >
                  Disable Feeds
                </Button>
              </div>
            )}
          </>
        ) : (
          canEdit && (
            <Button
              variant="outline"
              onClick={() => enableMutation.mutate()}
              disabled={enableMutation.isPending}
            >
              {enableMutation.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              <CalendarSync className="mr-2 h-4 w-4" />
              Enable Calendar Feeds
            </Button>
          )
        )}
      </CardContent>
    </Card>
  );
}
