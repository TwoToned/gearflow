"use client";

import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

const sizeMap = {
  xs: "size-6",
  sm: "size-8",
  md: "size-10",
  lg: "size-12",
  xl: "size-16",
} as const;

const textSizeMap = {
  xs: "text-[10px]",
  sm: "text-xs",
  md: "text-sm",
  lg: "text-base",
  xl: "text-lg",
} as const;

// Consistent color per user based on name hash
const avatarColors = [
  "bg-red-500/15 text-red-600",
  "bg-blue-500/15 text-blue-600",
  "bg-green-500/15 text-green-600",
  "bg-amber-500/15 text-amber-600",
  "bg-pink-500/15 text-pink-600",
  "bg-teal-500/15 text-teal-600",
  "bg-orange-500/15 text-orange-600",
  "bg-cyan-500/15 text-cyan-600",
];

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function getInitials(name: string | null | undefined): string {
  if (!name) return "?";
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

interface UserAvatarProps {
  user: { name?: string | null; image?: string | null };
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  className?: string;
}

export function UserAvatar({ user, size = "sm", className }: UserAvatarProps) {
  const initials = getInitials(user.name);
  const colorIndex = hashString(user.name || "?") % avatarColors.length;

  return (
    <Avatar className={cn(sizeMap[size], className)}>
      {user.image && (
        <AvatarImage src={user.image} alt={user.name || "User"} />
      )}
      <AvatarFallback className={cn(textSizeMap[size], avatarColors[colorIndex])}>
        {initials}
      </AvatarFallback>
    </Avatar>
  );
}
