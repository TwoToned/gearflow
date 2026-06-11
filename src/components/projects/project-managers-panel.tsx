"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { refreshProjectDetail } from "@/hooks/use-project-detail";
import { useServerQuery } from "@/hooks/use-server-query";

import { Plus, X } from "lucide-react";
import { toast } from "sonner";

import { getMembers } from "@/server/settings";
import {
  addProjectManager,
  removeProjectManager,
} from "@/server/project-managers";
import { Button } from "@/components/ui/button";
import { ComboboxPicker } from "@/components/ui/combobox-picker";
import { useActiveOrganization } from "@/lib/auth-client";
import { SectionHeader } from "@/components/layout/page-layouts";

interface PM {
  userId: string;
  user: {
    id: string;
    name: string | null;
    email: string;
    image: string | null;
  };
}

interface ProjectManagersPanelProps {
  projectId: string;
  managers: PM[];
}

export function ProjectManagersPanel({
  projectId,
  managers,
}: ProjectManagersPanelProps) {
  const { data: activeOrg } = useActiveOrganization();
  const [showPicker, setShowPicker] = useState(false);

  const { data: members } = useServerQuery({
    queryKey: ["members", activeOrg?.id],
    queryFn: getMembers,
    enabled: showPicker,
  });

  const existingUserIds = new Set(managers.map((pm) => pm.user.id));

  const memberOptions = (members ?? [])
    .filter(
      (m: { user: { id: string; name: string | null; email: string } }) =>
        !existingUserIds.has(m.user.id)
    )
    .map(
      (m: { user: { id: string; name: string | null; email: string } }) => ({
        value: m.user.id,
        label: m.user.name ?? m.user.email,
        description: m.user.name ? m.user.email : undefined,
      })
    );

  const addMutation = useMutation({
    mutationFn: (userId: string) => addProjectManager(projectId, userId),
    onSuccess: () => {
      refreshProjectDetail(projectId);
      setShowPicker(false);
    },
    onError: (e) => toast.error(e.message),
  });

  const removeMutation = useMutation({
    mutationFn: (userId: string) => removeProjectManager(projectId, userId),
    onSuccess: () => {
      refreshProjectDetail(projectId);
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="border-b border-border pb-4 space-y-2">
      <div className="flex items-center justify-between">
        <SectionHeader label="Project Managers" />
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0 text-fg-4 hover:text-fg-2"
          onClick={() => setShowPicker(!showPicker)}
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>

      {managers.length === 0 && !showPicker && (
        <p className="text-sm text-fg-3">No PMs assigned</p>
      )}

      {managers.length > 0 && (
        <div className="space-y-1">
          {managers.map((pm) => (
            <div
              key={pm.user.id}
              className="flex items-center gap-2 rounded-md px-1 py-0.5 group"
            >
              <div className="h-6 w-6 shrink-0 rounded-full bg-bg-inset flex items-center justify-center text-[10px] font-medium text-fg-3">
                {pm.user.image ? (
                  <img
                    src={pm.user.image}
                    alt={pm.user.name ?? ""}
                    className="h-6 w-6 rounded-full object-cover"
                  />
                ) : (
                  (pm.user.name ?? pm.user.email).charAt(0).toUpperCase()
                )}
              </div>
              <span className="flex-1 truncate text-sm text-fg-2">
                {pm.user.name ?? pm.user.email}
              </span>
              <button
                onClick={() => removeMutation.mutate(pm.user.id)}
                disabled={removeMutation.isPending}
                className="opacity-0 group-hover:opacity-100 text-fg-4 hover:text-destructive transition-opacity"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {showPicker && (
        <ComboboxPicker
          value=""
          onChange={(userId) => {
            if (userId) addMutation.mutate(userId);
          }}
          options={memberOptions}
          placeholder="Add a PM..."
          searchPlaceholder="Search members..."
          emptyMessage="No available members."
        />
      )}
    </div>
  );
}
