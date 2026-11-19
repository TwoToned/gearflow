"use client";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/**
 * `Assign packer…` (card ⋯ and bulk). One tap picks a member (or `No packer`)
 * and writes once for every chosen job; the write's toast carries Undo.
 */
export function PackerDialog({
  jobIds,
  members,
  current,
  onClose,
  onPick,
}: {
  /** The jobs being assigned; null = closed. */
  jobIds: string[] | null;
  members: Array<{ id: string; name: string }>;
  /** The packer when every chosen job shares one (highlighted), else null. */
  current: string | null;
  onClose: () => void;
  onPick: (userId: string | null) => void;
}) {
  const n = jobIds?.length ?? 0;
  const pick = (userId: string | null) => {
    onPick(userId);
    onClose();
  };
  return (
    <Dialog open={jobIds != null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Assign packer</DialogTitle>
          <DialogDescription>{n === 1 ? "Who packs this job?" : `Who packs these ${n} jobs?`}</DialogDescription>
        </DialogHeader>
        <ul className="flex max-h-80 flex-col overflow-y-auto" aria-label="Packers">
          {members.map((m) => (
            <li key={m.id}>
              <Button
                variant="ghost"
                className="min-h-11 w-full justify-start"
                aria-current={m.id === current ? "true" : undefined}
                onClick={() => pick(m.id)}
              >
                {m.name}
                {m.id === current ? <span className="ml-auto text-caption text-muted">current</span> : null}
              </Button>
            </li>
          ))}
          <li>
            <Button variant="ghost" className="min-h-11 w-full justify-start text-muted" onClick={() => pick(null)}>
              No packer
            </Button>
          </li>
        </ul>
      </DialogContent>
    </Dialog>
  );
}
