import * as React from "react";
import { Search } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * RVLT Flow input — 2px outline, red focus ring, 16px text (no iOS zoom, §16.13),
 * 44px min height. Set aria-invalid for the error state (§9.1).
 */
const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, type, ...props }, ref) => (
  <input
    type={type}
    ref={ref}
    className={cn(
      "flex min-h-11 w-full rounded-[var(--radius)] border-2 border-input bg-card px-3.5 py-2 text-[16px] text-ink",
      "placeholder:text-muted",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red focus-visible:ring-offset-2 focus-visible:ring-offset-paper",
      "aria-[invalid=true]:border-t-out aria-[invalid=true]:focus-visible:ring-t-out",
      "disabled:cursor-not-allowed disabled:opacity-45",
      "file:border-0 file:bg-transparent file:text-sm file:font-medium",
      className,
    )}
    {...props}
  />
));
Input.displayName = "Input";

/**
 * SearchInput — the leading-icon search box used in list toolbars (R-8.7.3).
 * Wraps its own `relative` positioning; size the outer layout slot around it.
 */
const SearchInput = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, type = "search", ...props }, ref) => (
  <div className="relative">
    <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
    <Input ref={ref} type={type} className={cn("pl-9", className)} {...props} />
  </div>
));
SearchInput.displayName = "SearchInput";

export { Input, SearchInput };
