"use client";

/**
 * The desktop print of the run sheet (D4): the same days, services and crew
 * the Logistics tab shows, laid out for paper. Hidden on screen, the only thing
 * visible when printing (`Print runsheet` in the tab menu, or `?print=1`).
 * It reads the tab's own data set: the old `/runsheet` page's separate
 * read-only copy is gone.
 */
import { crewNotesLines } from "@/lib/crew-notes-print";
import { dayLabel, groupByDay, whenText, type LogisticsService } from "@/lib/logistics-model";
import { personName, whereLine } from "./service-rows";
import type { SiteFacts } from "./facts";

export function PrintRunsheet({ title, services, site, crewNotes }: { title: string; services: LogisticsService[]; site: SiteFacts; crewNotes?: string | null }) {
  const live = services.filter((s) => s.status !== "CANCELLED");
  // The job's crew notes print at the top, the same lines the call sheet prints (UX Phase 10).
  const notes = crewNotesLines(crewNotes);
  return (
    <div className="hidden print:block" data-testid="print-runsheet">
      {/* Paper shows only the run sheet: hide the rest of the page, lift this block to the top. */}
      <style>{`@media print { body * { visibility: hidden; } [data-testid="print-runsheet"], [data-testid="print-runsheet"] * { visibility: visible; } [data-testid="print-runsheet"] { position: absolute; left: 0; top: 0; width: 100%; } }`}</style>
      <h1 className="text-lg font-bold">{title + " · Run sheet"}</h1>
      {(site.venue || site.contactName) && (
        <p className="text-sm">
          {[site.venue, site.address, site.access].filter(Boolean).join(" · ")}
          {site.contactName ? " · " + site.contactName + " " + site.contactPhone : ""}
        </p>
      )}
      {notes.length > 0 && (
        <section className="mt-3 break-inside-avoid" data-testid="print-runsheet-crew-notes">
          <h2 className="border-b border-black text-base font-semibold">Crew notes</h2>
          {notes.map((line, i) => (
            <p key={i} className="min-h-[1em] whitespace-pre-wrap text-sm">
              {line}
            </p>
          ))}
        </section>
      )}
      {groupByDay(live).map((g) => (
        <section key={g.key || "tbc"} className="mt-4 break-inside-avoid">
          <h2 className="border-b border-black text-base font-semibold">{dayLabel(g.key)}</h2>
          {g.services.map((s) => (
            <div key={s.id} className="py-1 text-sm">
              <span className="font-mono font-semibold">{whenText(s) || "--:--"}</span>
              <span className="ml-3 font-medium">{s.title}</span>
              {whereLine(s) && <div className="text-xs">{whereLine(s)}</div>}
              {s.notes && <div className="text-xs">{s.notes}</div>}
              {s.crewAssignments.length > 0 && (
                <div className="text-xs">{"Crew: " + s.crewAssignments.map((a) => personName(a) + " (" + a.status.toLowerCase() + ")").join(", ")}</div>
              )}
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
