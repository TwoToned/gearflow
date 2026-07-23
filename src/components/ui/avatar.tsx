"use client";

import * as React from "react";
import * as AvatarPrimitive from "@radix-ui/react-avatar";

import { cn } from "@/lib/utils";

/** The 8 deterministic crew/avatar hues (DESIGN.md §3.7). Red is never an avatar colour. */
const HUES = ["blue", "amber", "green", "purple", "coral", "teal", "pink", "lime"] as const;
export type AvatarHue = (typeof HUES)[number];

/** Stable per-person colour so someone keeps one hue everywhere (§15.4c). */
export function avatarHue(name: string): AvatarHue {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return HUES[h % HUES.length];
}

export function initials(name: string): string {
  const p = name.trim().split(/\s+/).filter(Boolean);
  if (!p.length) return "?";
  return ((p[0][0] ?? "") + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase();
}

// AA-safe, theme-aware initials (§3.7): dark theme (bright fills) → --dark ink;
// light theme (deeper fills) → white, except amber/lime (still light) → --dark.
const FALLBACK: Record<AvatarHue, string> = {
  blue: "bg-blue text-dark [.light_&]:text-white",
  amber: "bg-amber text-dark [.light_&]:text-dark",
  green: "bg-green text-dark [.light_&]:text-white",
  purple: "bg-purple text-dark [.light_&]:text-white",
  coral: "bg-coral text-dark [.light_&]:text-white",
  teal: "bg-teal text-dark [.light_&]:text-white",
  pink: "bg-pink text-dark [.light_&]:text-white",
  lime: "bg-lime text-dark [.light_&]:text-dark",
};

const Avatar = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Root>
>(({ className, ...props }, ref) => (
  <AvatarPrimitive.Root
    ref={ref}
    className={cn(
      "relative flex size-9 shrink-0 select-none overflow-hidden rounded-full border-2 border-card",
      className,
    )}
    {...props}
  />
));
Avatar.displayName = AvatarPrimitive.Root.displayName;

const AvatarImage = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Image>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Image>
>(({ className, ...props }, ref) => (
  <AvatarPrimitive.Image ref={ref} className={cn("aspect-square size-full object-cover", className)} {...props} />
));
AvatarImage.displayName = AvatarPrimitive.Image.displayName;

const AvatarFallback = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Fallback>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Fallback>
>(({ className, ...props }, ref) => (
  <AvatarPrimitive.Fallback
    ref={ref}
    className={cn("flex size-full items-center justify-center font-sans text-[12px] font-bold", className)}
    {...props}
  />
));
AvatarFallback.displayName = AvatarPrimitive.Fallback.displayName;

/** Convenience: a crew avatar coloured + initialled from a name (the scheduler antidote to a grey roster). */
const PersonAvatar = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Root> & { name: string; src?: string }
>(({ name, src, className, ...props }, ref) => (
  <Avatar ref={ref} className={className} {...props}>
    {src ? <AvatarImage src={src} alt={name} /> : null}
    <AvatarFallback className={FALLBACK[avatarHue(name)]}>{initials(name)}</AvatarFallback>
  </Avatar>
));
PersonAvatar.displayName = "PersonAvatar";

export { Avatar, AvatarImage, AvatarFallback, PersonAvatar };
