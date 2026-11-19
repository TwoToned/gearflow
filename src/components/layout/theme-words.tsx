"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";

const OPTIONS = [
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
] as const;

/**
 * Theme as two words, `Dark · Light` (D69) — in the user menu on desktop and the
 * More sheet's user head on phone (the old top-bar toggle was `hidden sm:flex`, so
 * a phone could not reach it). The active word is ink; the other is muted.
 */
export function ThemeWords({ className, rowClassName }: { className?: string; rowClassName?: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const current = mounted ? resolvedTheme : undefined;

  return (
    <div role="group" aria-label="Theme" className={cn("flex items-center gap-1", className)}>
      <span className="mr-2 text-[13px] text-muted">Theme</span>
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={current === o.value}
          onClick={(e) => {
            e.preventDefault();
            setTheme(o.value);
          }}
          className={cn(
            "min-h-9 min-w-11 cursor-pointer rounded-[var(--r)] px-2 text-[13px] transition-colors [@media(pointer:coarse)]:min-h-11",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red",
            current === o.value ? "font-semibold text-ink" : "text-muted hover:text-ink",
            rowClassName,
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
