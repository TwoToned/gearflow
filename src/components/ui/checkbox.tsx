"use client";

import * as React from "react";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check } from "lucide-react";

import { cn } from "@/lib/utils";

const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      "group relative grid min-h-11 min-w-11 shrink-0 place-items-center rounded-[8px] transition-[background-color,border-color]",
      "after:absolute after:inset-0 after:rounded-none after:content-['']",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red focus-visible:ring-offset-2 focus-visible:ring-offset-paper",
      "disabled:cursor-not-allowed disabled:opacity-45",
      className,
    )}
    {...props}
  >
    <span className="grid size-5 place-items-center rounded-[8px] border-2 border-input bg-paper-2 group-data-[state=checked]:bg-primary group-data-[state=checked]:border-primary">
    <CheckboxPrimitive.Indicator className="flex items-center justify-center">
      <Check className="size-3.5 text-primary-foreground" strokeWidth={3} />
    </CheckboxPrimitive.Indicator>
    </span>
  </CheckboxPrimitive.Root>
));
Checkbox.displayName = CheckboxPrimitive.Root.displayName;

export { Checkbox };
