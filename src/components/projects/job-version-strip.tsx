"use client";

import { Button } from "@/components/ui/button";
import { useFormatters } from "@/components/providers/format-provider";
import { CanDo } from "@/components/auth/permission-gate";
import { useProjectVersion, type ProjectVersionSummary } from "@/components/projects/project-version-context";

/** `+$1,240.00` / `-$1,240.00`: the drift sign convention used elsewhere on this page. */
function formatDriftAmount(amount: number, formatCurrency: (v: number) => string): string {
  return `${amount >= 0 ? "+" : "-"}${formatCurrency(Math.abs(amount))}`;
}

/**
 * The header's ONE quiet strip (spec §6b, `DetailHeader.strip`): shown only
 * while viewing a non-live version. It keeps everything the old `VersionStrip`
 * state 2 offered: what is on screen, what the warehouse, availability and
 * invoices follow, the quote-drift line that opens Compare (D53), `Make vN
 * live` (the one `MakeLiveDialog`) and `Back to live`. The pricing lock is no
 * longer a strip; it is the header glyph.
 *
 * Returns null when there is nothing to say (live).
 */
export function JobVersionStrip({ onMakeLive }: { onMakeLive: (target: ProjectVersionSummary) => void }) {
  const { formatCurrency } = useFormatters();
  const { isViewingVersion, viewingVersion, liveVersion, viewingQuoteDrift, setViewingNumber, openCompare } = useProjectVersion();
  if (!isViewingVersion || !viewingVersion) return null;
  const drift = viewingQuoteDrift && viewingQuoteDrift.driftAmount !== 0 ? viewingQuoteDrift : null;

  return (
    <>
      <p className="min-w-0 flex-1">
        <span className="font-semibold text-ink">
          Viewing v{viewingVersion.number}
          {viewingVersion.label ? ` · ${viewingVersion.label}` : ""}
        </span>{" "}
        — a draft, editable on Equipment and Finance. The warehouse, availability and invoices follow
        {liveVersion ? ` v${liveVersion.number}` : " the live version"}.
        {drift ? (
          <>
            {" "}
            <button
              type="button"
              className="underline decoration-dotted underline-offset-2 hover:decoration-solid"
              onClick={() =>
                openCompare(
                  { kind: "quoteSnapshot", quoteId: drift.quoteId, label: drift.quoteLabel },
                  { kind: "version", number: viewingVersion.number },
                )
              }
            >
              Quote total has moved {formatDriftAmount(drift.driftAmount, formatCurrency)} since {drift.quoteLabel} was sent.
            </button>
          </>
        ) : null}
      </p>
      <div className="flex shrink-0 items-center gap-2">
        <CanDo resource="project" action="update">
          <Button type="button" variant="line" size="sm" onClick={() => onMakeLive(viewingVersion)}>
            Make v{viewingVersion.number} live
          </Button>
        </CanDo>
        <Button type="button" variant="ghost" size="sm" onClick={() => setViewingNumber(null)}>
          Back to live{liveVersion ? ` (v${liveVersion.number})` : ""}
        </Button>
      </div>
    </>
  );
}
