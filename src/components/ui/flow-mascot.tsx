import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Albert — RVLT Flow's mascot (docs/brand/albert-pack), shown on empty states,
 * loading, 404, success (DESIGN.md §11 "Mascot: true zero-state only"). Decorative
 * → alt="" unless it carries meaning. `variant="avatar"` is for larger placements
 * (64px+, e.g. the auth brand collage); the default `"icon"` is for the small
 * (24-48px) inline empty-state slot. Passing `eyeColor` selects Albert's happy
 * expression instead of his neutral one — kept as a prop name so existing
 * "this is a good state" call sites (finance/overbookings zero-clash, dashboard
 * widgets) didn't need to change.
 */
const FlowMascot = React.forwardRef<
  HTMLImageElement,
  React.ImgHTMLAttributes<HTMLImageElement> & { eyeColor?: string; variant?: "icon" | "avatar" }
>(({ className, eyeColor, variant = "icon", alt = "", ...props }, ref) => {
  const src = eyeColor ? "/albert/svg/albert-happy.svg" : variant === "avatar" ? "/albert/svg/albert-avatar.svg" : "/albert/svg/albert-icon.svg";
  return (
    <img
      ref={ref}
      src={src}
      alt={alt}
      draggable={false}
      className={cn("size-12 object-contain", className)}
      {...props}
    />
  );
});
FlowMascot.displayName = "FlowMascot";

export { FlowMascot };
