"use client";

import { FileDown, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useServerQuery } from "@/hooks/use-server-query";
import { formatDateLong } from "@/lib/formatters";
import { getProjectPullSheet } from "@/server/warehouse";
import { PullSheetDocument, type PullSheetData } from "./pull-sheet-document";

/** Printing the dialog prints only the sheets (everything else is hidden). */
const PRINT_CSS = `
@media print {
  @page { margin: 14mm; }
  body * { visibility: hidden !important; }
  .pull-sheet-print, .pull-sheet-print * { visibility: visible !important; }
  .pull-sheet-print { position: absolute; inset: 0; overflow: visible !important; max-height: none !important; }
  thead { display: table-header-group; }
  tr { break-inside: avoid; }
}`;

/**
 * The pull sheet (spec §9c.5) as a dialog over the floor or the warehouse job,
 * replacing the `/warehouse/[id]/pull-sheet` page. One or many jobs stack, one
 * sheet each. `Print` prints them; `Save PDF` opens the pull-slip PDF, which
 * reads the SAME pull list (R-3.1).
 */
export function PullSheetDialog({ projectIds, onClose }: { projectIds: string[] | null; onClose: () => void }) {
  const ids = projectIds ?? [];
  const { data, isLoading } = useServerQuery({
    queryKey: ["pull-sheet", ...ids],
    queryFn: () => Promise.all(ids.map((id) => getProjectPullSheet(id))) as Promise<PullSheetData[]>,
    enabled: ids.length > 0,
  });
  const n = ids.length;
  const printedAt = formatDateLong(new Date());

  return (
    <Dialog open={n > 0} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <style>{PRINT_CSS}</style>
        <DialogHeader className="print:hidden">
          <DialogTitle>{n === 1 ? "Pull sheet" : `Pull sheets · ${n} jobs`}</DialogTitle>
          <DialogDescription>Tick each item as it comes off the shelf.</DialogDescription>
        </DialogHeader>
        <div className="flex gap-2 print:hidden">
          <Button onClick={() => window.print()} disabled={!data}>
            <Printer className="mr-2 size-4" aria-hidden="true" /> Print
          </Button>
          <Button variant="line" onClick={() => ids.forEach((id) => window.open(`/api/documents/${id}?type=pull-slip`, "_blank"))}>
            <FileDown className="mr-2 size-4" aria-hidden="true" /> Save PDF
          </Button>
        </div>
        <div className="pull-sheet-print flex flex-col gap-10">
          {isLoading || !data ? <Skeleton className="h-64 rounded-[var(--r-lg)]" /> : null}
          {data?.map((d) => <PullSheetDocument key={d.project.id} data={d} printedAt={printedAt} />)}
        </div>
      </DialogContent>
    </Dialog>
  );
}
