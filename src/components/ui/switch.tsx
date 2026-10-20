"use client";

import * as React from "react";
import * as SwitchPrimitive from "@radix-ui/react-switch";

import { cn } from "@/lib/utils";

const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitive.Root
    ref={ref}
    className={cn(
      "group relative inline-flex min-h-11 w-11 shrink-0 cursor-pointer items-center rounded-full transition-[background-color,border-color]",
      "after:absolute after:inset-0 after:rounded-none after:content-['']",
      "before:absolute before:inset-x-0 before:top-1/2 before:h-6 before:-translate-y-1/2 before:rounded-full before:border-2 before:border-input before:bg-paper-2 data-[state=checked]:before:bg-primary data-[state=checked]:before:border-primary",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red focus-visible:ring-offset-2 focus-visible:ring-offset-paper",
      "disabled:cursor-not-allowed disabled:opacity-45",
      className,
    )}
    {...props}
  >
    <SwitchPrimitive.Thumb
      className={cn(
        "pointer-events-none relative size-4 rounded-full bg-ink ring-0 transition-transform",
        "translate-x-1 data-[state=checked]:translate-x-5 data-[state=checked]:bg-primary-foreground",
      )}
    />
  </SwitchPrimitive.Root>
));
Switch.displayName = SwitchPrimitive.Root.displayName;

export { Switch };
