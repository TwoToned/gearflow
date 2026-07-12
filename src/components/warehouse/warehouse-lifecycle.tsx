"use client";

import * as React from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  WAREHOUSE_STAGES,
  WAREHOUSE_STAGE_INDEX,
  activeWarehouseStage,
  totalStaged,
  type WarehouseStageCounts,
  type WarehouseStageKey,
} from "./warehouse-stages";

/**
 * WarehouseLifecycle — the gear-handling pipeline as a left-to-right stepper.
 *
 * Unlike a project's single-pointer lifecycle, a job's gear is spread across
 * stages at once (some prepping, some deployed, some already back). So this
 * reads as a DISTRIBUTION: every stage shows a live count, populated stages
 * light up in their semantic colour, and the "active front" (earliest stage
 * still needing a warehouse action) gets the ring. Returned gear sits in its
 * own node — it never collapses back into Prep or Deploy.
 *
 * Visual grammar mirrors ProjectLifecycle (filled connectors before the front,
 * red on the active edge, muted line after) so the two steppers feel like one
 * family.
 */

const STAGE_COLOR: Record<
  WarehouseStageKey,
  { ring: string; fill: string; text: string; dot: string }
> = {
  // to_prep — work waiting on the warehouse
  to_prep: { ring: "ring-warn", fill: "bg-warn-soft", text: "text-warn", dot: "bg-warn" },
  // prepped — packed and staged
  prepped: { ring: "ring-blue", fill: "bg-blue-soft", text: "text-blue", dot: "bg-blue" },
  // deployed — LIVE / in use on site (DESIGN: red = in-use)
  deployed: { ring: "ring-red", fill: "bg-red-soft", text: "text-red", dot: "bg-red" },
  // returned — physically back, awaiting de-prep checks
  returned: { ring: "ring-warn", fill: "bg-warn-soft", text: "text-warn", dot: "bg-warn" },
  // deprepped — checked and back in inventory (available again)
  deprepped: { ring: "ring-ok", fill: "bg-ok-soft", text: "text-ok", dot: "bg-ok" },
};

/** Connector j sits between node j and node j+1. */
function connectorClass(j: number, activeIdx: number): string {
  if (j < activeIdx) return "bg-ink";
  if (j === activeIdx) return "bg-red";
  return "bg-line";
}

export function WarehouseLifecycle({
  counts,
  className,
}: {
  counts: WarehouseStageCounts;
  className?: string;
}) {
  const total = totalStaged(counts);
  const activeKey = activeWarehouseStage(counts);
  const activeIdx = WAREHOUSE_STAGE_INDEX[activeKey];
  const allDeprepped = total > 0 && counts.deprepped === total;
  const activeMeta = WAREHOUSE_STAGES[activeIdx];

  // On mobile the stepper scrolls sideways rather than compressing; keep the active
  // stage centered so the operator always sees where the gear currently sits.
  const olRef = React.useRef<HTMLOListElement>(null);
  const nodeRefs = React.useRef<(HTMLSpanElement | null)[]>([]);
  React.useEffect(() => {
    const ol = olRef.current;
    const node = nodeRefs.current[activeIdx];
    if (!ol || !node || ol.scrollWidth <= ol.clientWidth) return;
    const olRect = ol.getBoundingClientRect();
    const nodeRect = node.getBoundingClientRect();
    const delta = nodeRect.left - olRect.left - ol.clientWidth / 2 + nodeRect.width / 2;
    ol.scrollBy({ left: delta, behavior: "smooth" });
  }, [activeIdx]);

  return (
    <div className={cn("flex flex-col gap-2", className)} aria-label="Warehouse lifecycle">
      <ol
        ref={olRef}
        className="flex min-w-0 items-start overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        role="list"
      >
        {WAREHOUSE_STAGES.map((s, i) => {
          const n = counts[s.key];
          const populated = n > 0;
          const isActive = i === activeIdx;
          const isFirst = i === 0;
          const isLast = i === WAREHOUSE_STAGES.length - 1;
          const c = STAGE_COLOR[s.key];
          const done = allDeprepped && s.key === "deprepped";

          return (
            <li key={s.key} className="flex min-w-[76px] flex-1 flex-col items-center gap-2">
              <div className="flex w-full items-center">
                <span
                  className={cn("h-[2px] flex-1 rounded-full", isFirst ? "opacity-0" : connectorClass(i - 1, activeIdx))}
                  aria-hidden
                />
                <span
                  ref={(el) => {
                    nodeRefs.current[i] = el;
                  }}
                  className={cn(
                    "flex size-10 shrink-0 items-center justify-center rounded-full text-ui-text font-bold tabular-nums transition-colors",
                    populated
                      ? cn(c.fill, c.text, "ring-2", c.ring)
                      : "bg-card text-faint ring-1 ring-line",
                    isActive && populated && "ring-2",
                  )}
                  aria-current={isActive ? "step" : undefined}
                  title={`${s.label}: ${n} item${n === 1 ? "" : "s"}`}
                >
                  {done ? <Check className="h-4 w-4" strokeWidth={3} /> : n}
                </span>
                <span
                  className={cn("h-[2px] flex-1 rounded-full", isLast ? "opacity-0" : connectorClass(i, activeIdx))}
                  aria-hidden
                />
              </div>
              <span
                className={cn(
                  "whitespace-nowrap text-center text-caption",
                  isActive ? "font-semibold text-ink" : populated ? "text-ink-2" : "text-faint",
                )}
              >
                {s.label}
              </span>
            </li>
          );
        })}
      </ol>
      {total > 0 && activeMeta && (
        <p className="text-center t-micro text-muted lg:text-left">
          {allDeprepped ? "All gear is checked and back in inventory." : activeMeta.hint}
        </p>
      )}
    </div>
  );
}
