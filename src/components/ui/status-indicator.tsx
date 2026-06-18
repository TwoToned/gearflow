import { cn } from "@/lib/utils";
import { type StatusCategory, getStatusColor, type ColorIntent, intentStyles } from "@/lib/status-colors";

interface StatusIndicatorProps {
  /** Status category (e.g., "asset", "project") */
  category?: StatusCategory;
  /** Status value (e.g., "AVAILABLE", "CONFIRMED") */
  value?: string;
  /** Direct color intent — use when you don't have a category/value pair */
  intent?: ColorIntent;
  /** Human-readable label to display */
  label: string;
  /** Display variant: "dot" for detail views, "pill" for tables/compact */
  variant?: "dot" | "pill";
  className?: string;
}

/**
 * Unified status indicator component.
 *
 * Two variants per DESIGN.md:
 * - **dot**: 7px dot with ring glow + colored text. For detail views and headers.
 * - **pill**: Compact pill with dot inside + subtle colored background. For tables.
 */
export function StatusIndicator({
  category,
  value,
  intent: directIntent,
  label,
  variant = "dot",
  className,
}: StatusIndicatorProps) {
  const styles = directIntent
    ? intentStyles[directIntent]
    : category && value
      ? getStatusColor(category, value)
      : intentStyles.neutral;

  if (variant === "pill") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-sm px-2 py-0.5",
          "text-[11px] font-medium leading-none",
          styles.pill,
          className,
        )}
      >
        <span
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            styles.dot,
          )}
        />
        {label}
      </span>
    );
  }

  // dot variant — detail views and headers
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2",
        className,
      )}
    >
      <span
        className={cn(
          "size-[7px] shrink-0 rounded-full ring-2",
          styles.dot,
          // Ring glow uses the same RVLT color token at low opacity
          styles.dot === "bg-ok" && "ring-ok/20",
          styles.dot === "bg-warn" && "ring-warn/20",
          styles.dot === "bg-t-out" && "ring-t-out/20",
          styles.dot === "bg-blue" && "ring-blue/20",
          styles.dot === "bg-rep" && "ring-rep/20",
          styles.dot === "bg-red" && "ring-red/20",
        )}
      />
      <span className={cn("text-[13px] font-medium", styles.text)}>
        {label}
      </span>
    </span>
  );
}
