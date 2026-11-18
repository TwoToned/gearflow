"use client";

/**
 * A derived sub-hire stop (`Collect from <supplier> · SH-xxxx`). Read-only:
 * no checkbox, no money, no status; the one action is opening the order.
 * Shared by the desktop timeline and phone day mode so both read one shape.
 */
import type { TransportStop } from "@/lib/logistics-transport";

export function TransportStopRow({ stop, onOpen }: { stop: TransportStop; onOpen: (subHireId: string) => void }) {
  return (
    <div
      data-stop-id={stop.id}
      className="flex min-h-11 items-center gap-3 border-t border-line px-1 text-ui-text"
    >
      <span className="min-w-0 flex-1 truncate text-ink">
        {stop.title}
        <span className="t-mono text-caption text-muted">{" · " + stop.orderNumber}</span>
      </span>
      <span className="text-caption text-muted">Sub-hire</span>
      <button
        type="button"
        onClick={() => onOpen(stop.subHireId)}
        aria-label={"Open order " + stop.orderNumber}
        className="inline-flex min-h-11 items-center px-1 text-caption text-link"
      >
        Open order
      </button>
    </div>
  );
}
