import { cn } from "@/lib/utils";

interface KbdProps {
  /** Shortcut string to display (e.g., "N", "⌘K", "Ctrl+S") */
  children: React.ReactNode;
  className?: string;
}

/**
 * Keyboard shortcut key cap — displayed inline in buttons, tooltips and the shortcuts dialog.
 * One spec across RVLT (rvlt-designlanguage v1.2.0 §9): Geist Mono at the 11px floor,
 * --muted on --paper-2, a 1px --line-2 border with a 2px bottom edge, radius 5px.
 */
export function Kbd({ children, className }: KbdProps) {
  return (
    <kbd
      className={cn(
        "inline-flex items-center justify-center rounded-[5px] border border-b-2 border-line-2 bg-paper-2 px-1.5",
        "font-mono text-[11px] text-muted",
        className,
      )}
    >
      {children}
    </kbd>
  );
}
