"use client";

import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";

import { cn } from "@/lib/utils";

const Tabs = TabsPrimitive.Root;

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => {
  // When the list scrolls (mobile) and the initially-active tab is a later one
  // (e.g. a deep-linked / persisted tab), bring it into view on mount — Radix only
  // reveals it once keyboard focus reaches it.
  const localRef = React.useRef<React.ElementRef<typeof TabsPrimitive.List> | null>(null);
  const setRef = React.useCallback(
    (node: React.ElementRef<typeof TabsPrimitive.List> | null) => {
      localRef.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    },
    [ref],
  );
  React.useEffect(() => {
    const list = localRef.current;
    if (!list || list.scrollWidth <= list.clientWidth) return;
    const active = list.querySelector<HTMLElement>('[data-state="active"]');
    if (!active) return;
    const lr = list.getBoundingClientRect();
    const ar = active.getBoundingClientRect();
    list.scrollBy({ left: ar.left - lr.left - list.clientWidth / 2 + ar.width / 2 });
  }, []);
  return (
  <TabsPrimitive.List
    ref={setRef}
    className={cn(
      "inline-flex items-center gap-1 rounded-full border-2 border-border bg-paper-2 p-1",
      // Scroll sideways instead of clipping when the tabs are wider than the
      // viewport (mobile). min-w-0 lets it shrink below content inside a flex row;
      // the scrollbar is hidden so the pill still reads as a clean control.
      "min-w-0 max-w-full overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
      className,
    )}
    {...props}
  />
  );
});
TabsList.displayName = TabsPrimitive.List.displayName;

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      "shrink-0 whitespace-nowrap rounded-[8px] px-3 py-1.5 text-[14px] font-medium text-muted transition-[background-color,color,box-shadow]",
      "data-[state=active]:bg-elev data-[state=active]:text-ink data-[state=active]:shadow-[var(--lit)]",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red",
      "disabled:cursor-not-allowed disabled:select-none disabled:opacity-45",
      className,
    )}
    {...props}
  />
));
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      "mt-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red",
      className,
    )}
    {...props}
  />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;

export { Tabs, TabsList, TabsTrigger, TabsContent };
