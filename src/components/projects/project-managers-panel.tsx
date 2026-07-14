"use client";

import { useState } from "react";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { refreshProjectDetail } from "@/hooks/use-project-detail";
import { useServerQuery } from "@/hooks/use-server-query";

import { Plus, X } from "lucide-react";
import { toast } from "sonner";

import { getMembers } from "@/server/settings";
import { useProjectManagerWrites } from "@/hooks/use-project-managers-writes";
import { Button } from "@/components/ui/button";
import { PersonAvatar } from "@/components/ui/avatar";
import { ComboboxPicker } from "@/components/ui/combobox-picker";
import { useActiveOrganization } from "@/lib/auth-client";
import { SectionHeader } from "@/components/layout/page-layouts";
import { cn, focusRing, disabledState } from "@/lib/utils";

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
  const writes = useProjectManagerWrites();

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

  const addMutation = useServerMutation({
    mutationFn: (userId: string) => writes.add(projectId, userId),
    onSuccess: () => {
      refreshProjectDetail(projectId);
      setShowPicker(false);
    },
    onError: (e) => toast.error(e.message),
  });

  const removeMutation = useServerMutation({
    mutationFn: (userId: string) => writes.remove(projectId, userId),
    onSuccess: () => {
      refreshProjectDetail(projectId);
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="border-b border-line pb-4 space-y-2">
      <div className="flex items-center justify-between">
        <SectionHeader label="Project managers" />
        <Button
          variant="ghost"
          size="icon"
          className="touch-target size-7 text-muted hover:text-ink-2"
          title="Add project manager"
          onClick={() => setShowPicker(!showPicker)}
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>

      {managers.length === 0 && !showPicker && (
        <button
          type="button"
          onClick={() => setShowPicker(true)}
          className={cn("rounded-sm text-caption text-faint hover:text-muted transition-colors", focusRing)}
        >
          Add project managers
        </button>
      )}

      {managers.length > 0 && (
        <div className="space-y-1">
          {managers.map((pm) => (
            <div
              key={pm.user.id}
              className="flex items-center gap-2 rounded-[var(--r)] px-1 py-0.5 group"
            >
              <PersonAvatar
                name={pm.user.name ?? pm.user.email}
                src={pm.user.image ?? undefined}
                className="size-6 border-0"
              />
              <span className="flex-1 truncate text-ui-text text-ink-2">
                {pm.user.name ?? pm.user.email}
              </span>
              <button
                onClick={() => removeMutation.mutate(pm.user.id)}
                disabled={removeMutation.isPending}
                className={cn(
                  "rounded-sm text-faint opacity-0 transition-opacity pointer-coarse:opacity-100 hover:text-t-out group-hover:opacity-100",
                  focusRing,
                  disabledState,
                )}
                title="Remove project manager"
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
          placeholder="Add a project manager..."
          searchPlaceholder="Search members..."
          emptyMessage="No available members."
        />
      )}
    </div>
  );
}
