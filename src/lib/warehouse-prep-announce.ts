import { announceWarehouseWrite, type AnnouncedWrite } from "@/lib/warehouse-undo-toast";

export interface PrepDeprepOp {
  lineItemId: string;
  quantity?: number;
}

/**
 * Toast + ONE guarded Undo for a prep write (prep is reversible: de-prep). Goes through
 * `announceWarehouseWrite`, so the returned `scanUndo` IS the toast action's closure and the
 * scan strip plugs it in unchanged (CLAUDE.md: a second surface reuses the exact reverse trigger).
 * `canUndo` is the REVERSE permission; when absent (or the write has no clean reverse, e.g. an
 * accessories-only pack) the toast carries no Undo and `scanUndo` is undefined.
 */
export function announcePrepWrite(p: {
  doneTitle: string;
  undoneTitle: string;
  /** The de-prep ops that reverse this write; empty = not reversible. */
  reverse: PrepDeprepOp[];
  canUndo: boolean;
  deprep: (ops: PrepDeprepOp[]) => Promise<unknown>;
}): AnnouncedWrite<{ autoStatus: null }> {
  return announceWarehouseWrite({ autoStatus: null }, {
    doneTitle: p.doneTitle,
    undoneTitle: p.undoneTitle,
    canUndo: p.canUndo && p.reverse.length > 0,
    performUndo: async () => { await p.deprep(p.reverse); },
  });
}
