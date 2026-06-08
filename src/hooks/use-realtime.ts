"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useActiveOrganization } from "@/lib/auth-client";
import type { RealtimeEvent, RealtimeEventType } from "@/lib/events";

function getInvalidationKeys(
  type: RealtimeEventType,
  event: RealtimeEvent
): (string | undefined)[][] {
  const { orgId, projectId, assetId, kitId } = event.payload;

  switch (type) {
    case "project:updated":
      return [["project", orgId, projectId], ["projects"], ["dashboard"]];
    case "project:created":
    case "project:deleted":
      return [["projects"], ["dashboard"]];
    case "line-item:changed":
      return [
        ["project", orgId, projectId],
        ["project-overbooked"],
        ["availability"],
      ];
    case "warehouse:changed":
      return [
        ["warehouse-project", orgId, projectId],
        ["warehouse-projects"],
      ];
    case "asset:updated":
      return [["asset", orgId, assetId], ["assets"]];
    case "asset:created":
      return [["assets"]];
    case "kit:updated":
      return [["kit", orgId, kitId], ["kits"]];
    case "kit:created":
      return [["kits"]];
    case "maintenance:changed":
      return [["maintenance-records"], ["asset", orgId, assetId]];
    case "crew:changed":
      return [["crew-members"]];
    case "settings:changed":
      return [["org-settings"]];
    default:
      return [];
  }
}

export function useRealtime() {
  const queryClient = useQueryClient();
  const { data: org } = useActiveOrganization();

  useEffect(() => {
    const orgId = org?.id;
    if (!orgId) return;

    const eventSource = new EventSource(`/api/realtime?orgId=${orgId}`);

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as RealtimeEvent;
        const keys = getInvalidationKeys(data.type, data);
        for (const key of keys) {
          queryClient.invalidateQueries({ queryKey: key.filter(Boolean) });
        }
      } catch (e) {
        console.error("Failed to process realtime event:", e);
      }
    };

    eventSource.onerror = () => {};

    return () => {
      eventSource.close();
    };
  }, [queryClient, org?.id]);
}
