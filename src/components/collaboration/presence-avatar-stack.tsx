"use client";

import { AppImage } from "@/components/ui/app-image";
import { getUserInitials, getForegroundColor } from "@/lib/collaboration-colors";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { usePresence } from "@/hooks/use-collaboration";
import { cn } from "@/lib/utils";

interface PresenceAvatarProps {
  userName: string;
  userColor: string;
  avatarUrl?: string;
  mode?: string;
  section?: string;
  size?: "sm" | "md";
}

function PresenceAvatar({ userName, userColor, avatarUrl, mode, section, size = "md" }: PresenceAvatarProps) {
  const initials = getUserInitials(userName);
  const fg = getForegroundColor(userColor);
  const dim = size === "sm" ? "h-6 w-6 text-[10px]" : "h-8 w-8 text-xs";

  const label = mode === "editing"
    ? `${userName} — editing${section ? ` (${section})` : ""}`
    : `${userName} — viewing`;

  return (
    <Tooltip>
      <TooltipTrigger>
        <div
          className={cn(
            "relative flex items-center justify-center rounded-full ring-2 ring-background select-none shrink-0 overflow-hidden",
            dim,
            mode === "editing" && "ring-offset-1 ring-offset-background"
          )}
          style={{ background: userColor, color: fg, boxShadow: `0 0 0 2px ${userColor}` }}
          aria-label={label}
        >
          {avatarUrl ? (
            <AppImage src={avatarUrl} alt={userName} fill sizes="40px" className="object-cover" />
          ) : (
            <span className="font-medium leading-none">{initials}</span>
          )}
          {mode === "editing" && (
            <span className="absolute bottom-0 right-0 h-2 w-2 rounded-full bg-green-500 ring-1 ring-background" />
          )}
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

interface PresenceAvatarStackProps {
  entityType: string;
  entityId: string;
  className?: string;
  maxVisible?: number;
  size?: "sm" | "md";
}

/**
 * Shows a compact stack of avatars for users currently present on an entity.
 * Registers the current user's presence and heartbeats automatically.
 */
export function PresenceAvatarStack({
  entityType,
  entityId,
  className,
  maxVisible = 5,
  size = "md",
}: PresenceAvatarStackProps) {
  const { others } = usePresence({ entityType, entityId });

  if (others.length === 0) return null;

  const visible = others.slice(0, maxVisible);
  const overflow = others.length - visible.length;

  return (
    <TooltipProvider>
      <div className={cn("flex items-center -space-x-2", className)}>
        {visible.map((user) => (
          <PresenceAvatar
            key={user.userId}
            userName={user.userName}
            userColor={user.userColor}
            avatarUrl={user.avatarUrl}
            mode={user.mode}
            section={user.section}
            size={size}
          />
        ))}
        {overflow > 0 && (
          <div
            className={cn(
              "flex items-center justify-center rounded-full bg-muted text-muted-foreground ring-2 ring-background text-xs font-medium",
              size === "sm" ? "h-6 w-6 text-[10px]" : "h-8 w-8"
            )}
          >
            +{overflow}
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}
