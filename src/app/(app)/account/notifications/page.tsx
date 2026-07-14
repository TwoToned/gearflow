"use client";

import { useEffect, useState } from "react";
import { useConvex, useConvexAuth, useMutation } from "convex/react";
import { createId } from "@paralleldrive/cuid2";
import { useServerQuery } from "@/hooks/use-server-query";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Loader2 } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { SectionHeader } from "@/components/layout/page-layouts";
import { FadeIn } from "@/components/ui/motion";
import { useSession } from "@/lib/auth-client";
import { api } from "../../../../../convex/_generated/api";
import {
  NOTIFICATION_PREFERENCE_DEFAULTS,
  NOTIFICATION_PREFERENCE_LABELS,
  notificationPreferenceSchema,
  type NotificationPreferenceValues,
} from "@/lib/validations/notification-preferences";

const PREF_KEYS = Object.keys(
  NOTIFICATION_PREFERENCE_LABELS,
) as (keyof NotificationPreferenceValues)[];

export default function NotificationPreferencesPage() {
  const [values, setValues] = useState<NotificationPreferenceValues>({
    ...NOTIFICATION_PREFERENCE_DEFAULTS,
  });
  const [hydrated, setHydrated] = useState(false);

  const convex = useConvex();
  const { isAuthenticated } = useConvexAuth();
  const { data: session } = useSession();
  const upsertMine = useMutation(api.userNotificationPreferences.upsertMine);

  // Settings read+write island: single reader, single writer, no other consumer or
  // SSE key, no liveness need → a one-shot native query (browser-direct, keyed on the
  // verified token subject) + refetch on save is data-identical to the old server
  // action. Gated on Convex auth so it doesn't fire before the user token is set.
  const query = useServerQuery({
    queryKey: ["notification-preferences"],
    queryFn: () => convex.query(api.userNotificationPreferences.mine, {}),
    enabled: isAuthenticated,
  });

  useEffect(() => {
    if (query.data && !hydrated) {
      setValues(query.data);
      setHydrated(true);
    }
  }, [query.data, hydrated]);

  const saveMutation = useServerMutation({
    mutationFn: async (
      next: NotificationPreferenceValues,
    ): Promise<NotificationPreferenceValues> => {
      // Match the deleted server action's validation before the browser-direct write.
      const parsed = notificationPreferenceSchema.parse(next);
      await upsertMine({
        id: createId(),
        prefs: parsed,
        actor: {
          userId: session?.user.id ?? "",
          userName: session?.user.name ?? "",
        },
        auditId: createId(),
        now: Date.now(),
      });
      return parsed;
    },
    onSuccess: (saved) => {
      setValues(saved);
      query.refetch();
      toast.success("Notification preferences saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleToggle = (key: keyof NotificationPreferenceValues, next: boolean) => {
    setValues((prev) => ({ ...prev, [key]: next }));
  };

  return (
    <FadeIn className="space-y-8 max-w-2xl">
      <PageHeader
        title="Notification Preferences"
        description="Choose which in-app notifications also email you. The bell icon always shows everything."
      />

      <section>
        <SectionHeader label="Email Notifications" />
        <div className="mt-4 space-y-2">
          {query.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-fg-3">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading preferences...
            </div>
          ) : (
            PREF_KEYS.map((key) => {
              const meta = NOTIFICATION_PREFERENCE_LABELS[key];
              const id = `pref-${key}`;
              return (
                <div
                  key={key}
                  className="flex items-start justify-between gap-4 rounded-md border p-3"
                >
                  <div className="flex-1 min-w-0">
                    <Label htmlFor={id} className="text-sm font-medium">
                      {meta.label}
                    </Label>
                    <p className="text-xs text-fg-3 mt-0.5">{meta.description}</p>
                  </div>
                  <Switch
                    id={id}
                    checked={values[key]}
                    onCheckedChange={(next) => handleToggle(key, Boolean(next))}
                  />
                </div>
              );
            })
          )}
        </div>
        <div className="mt-4 flex justify-end">
          <Button
            onClick={() => saveMutation.mutate(values)}
            disabled={saveMutation.isPending || !hydrated}
          >
            {saveMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving...
              </>
            ) : (
              "Save Preferences"
            )}
          </Button>
        </div>
      </section>
    </FadeIn>
  );
}
