"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * FeaturePatch — module wayfinding icon badge (§9.2 / §10 / §15.5).
 *
 * variant="sticker"  full hue fill + 2px cream border + --sh-stk (feature cards, hero blocks)
 * variant="soft"     hue-soft fill + hue-tinted icon (sidebar nav, launcher tiles, active states)
 *
 * Icon is a Lucide glyph passed as children. Sticker uses 2.6px stroke per §9.2.
 * On-fill rule (§3.7) applied per hue: dark theme bright fills → text-dark (espresso);
 * light theme deeper fills → text-primary-foreground, except amber (stays text-dark both).
 * Always pair with a visible label or aria-label (§3.3).
 *
 * Module → hue (§15.5): Jobs=blue · Gear=amber · Crew=purple · Availability=green
 *                        Compliance=teal · Maintenance=coral
 * Radius: var(--radius) = 14px (closest allowed to spec's "rounded 16px" — §7 / Appendix A sm=8 md=14).
 */

export const MODULE_HUES = ["blue", "amber", "green", "purple", "coral", "teal"] as const;
export type ModuleHue = (typeof MODULE_HUES)[number];

const patchVariants = cva(
  "inline-flex shrink-0 items-center justify-center",
  {
    variants: {
      variant: {
        sticker:
          "border-2 border-cream shadow-[var(--sh-stk)] [&_svg]:[stroke-width:2.6] [&_svg]:size-6",
        soft: "[&_svg]:size-5",
      },
      hue: {
        blue: "", amber: "", green: "", purple: "", coral: "", teal: "",
      },
      size: {
        default: "size-[42px] rounded-[var(--radius)]",
        sm: "size-8 rounded-[8px]",
      },
    },
    compoundVariants: [
      // sticker — full hue fill; on-fill rule (§3.7):
      // dark theme: bright fills → text-dark; light theme: deeper fills → text-primary-foreground
      // amber stays text-dark on both (fill remains light on light theme)
      { variant: "sticker", hue: "blue",   className: "bg-blue   text-dark [.light_&]:text-primary-foreground" },
      { variant: "sticker", hue: "amber",  className: "bg-amber  text-dark" },
      { variant: "sticker", hue: "green",  className: "bg-green  text-dark [.light_&]:text-primary-foreground" },
      { variant: "sticker", hue: "purple", className: "bg-purple text-dark [.light_&]:text-primary-foreground" },
      { variant: "sticker", hue: "coral",  className: "bg-coral  text-dark [.light_&]:text-primary-foreground" },
      { variant: "sticker", hue: "teal",   className: "bg-teal   text-dark [.light_&]:text-primary-foreground" },
      // soft — translucent fill, hue-coloured icon
      { variant: "soft", hue: "blue",   className: "bg-blue-soft   text-blue" },
      { variant: "soft", hue: "amber",  className: "bg-amber-soft  text-amber" },
      { variant: "soft", hue: "green",  className: "bg-green-soft  text-green" },
      { variant: "soft", hue: "purple", className: "bg-purple-soft text-purple" },
      { variant: "soft", hue: "coral",  className: "bg-coral-soft  text-coral" },
      { variant: "soft", hue: "teal",   className: "bg-teal-soft   text-teal" },
    ],
    defaultVariants: { variant: "sticker", hue: "blue", size: "default" },
  },
);

export interface FeaturePatchProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof patchVariants> {}

function FeaturePatch({
  hue = "blue",
  variant = "sticker",
  size = "default",
  className,
  children,
  ...props
}: FeaturePatchProps) {
  return (
    <div
      className={cn(patchVariants({ hue, variant, size }), className)}
      {...props}
    >
      {children}
    </div>
  );
}

export { FeaturePatch };
