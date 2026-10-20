"use client";
import { Button } from '@/components/ui/button';
import type { SavedScan } from '@/lib/scan-intake';
export function ScanIntakeStatus({ entries, error, unsaved, retry }: {
    entries: SavedScan[];
    error: string | null;
    unsaved: string | null;
    retry: (id: string) => void;
}) {
    return <section aria-label="Saved scan intake" className="space-y-2">
  {unsaved && <p role="alert" className="break-words t-reading-body text-t-out">Not saved: {unsaved}. Keep this page open and copy the barcode before retrying.</p>}
  {error && <p role="alert" className="t-reading-body text-t-out">{error}</p>}
  {entries.length > 0 && <details><summary className="min-h-11 cursor-pointer py-3 focus-visible:ring-2 focus-visible:ring-red">Saved scans: {entries.filter(e => e.state === 'pending').length} pending, {entries.filter(e => e.state === 'review').length} awaiting review, {entries.filter(e => e.state === 'failed').length} failed, {entries.filter(e => e.state === 'confirmed').length} confirmed</summary>
   <ul className="space-y-2">{entries.map(e => <li key={e.id} className="rounded border border-border p-3"><p className="break-words">{e.raw} · {e.operation} · {e.state}</p>{e.error && <p className="text-t-out">{e.error}</p>}{e.state !== 'confirmed' && <Button variant="line" onClick={() => retry(e.id)}>{e.state === 'review' ? 'Review saved scan' : 'Retry saved scan'}</Button>}</li>)}</ul>
  </details>}
 </section>;
}
