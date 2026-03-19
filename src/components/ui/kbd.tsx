import { cn } from "@/lib/utils";

interface KbdProps {
  /** Shortcut string to display (e.g., "N", "⌘K", "Ctrl+S") */
  children: React.ReactNode;
  className?: string;
}

/**
 * Keyboard shortcut badge — displayed inline in buttons and tooltips.
 * Per DESIGN.md: display shortcut hints in button tooltips.
 */
export function Kbd({ children, className }: KbdProps) {
  return (
    <kbd
      className={cn(
        "inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[3px]",
        "bg-bg-inset px-1 font-mono text-[10px] font-medium text-fg-3",
        "border border-border",
        className,
      )}
    >
      {children}
    </kbd>
  );
}
