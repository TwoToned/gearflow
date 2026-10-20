/** Durable device-local intake. No tenant data is read by the public offline shell. */
export interface ScanScope {
    orgId: string;
    userId: string;
    projectId: string;
    expectedVersionId?: string;
}
export type ScanEffect = {
    lineItemId?: string;
    assetId?: string;
    kitId?: string;
    accessoryDecision?: "override" | "verified" | "all";
    includeAccessoryIds?: string[];
    skippedAccessories?: Array<{ accessoryLineItemId: string; tier: "DEFAULT" | "OPTIONAL"; reason: string }>;
    kitDecision?: "all" | "verified";
    verifiedLineItemIds?: string[];
};
export interface SavedScan extends ScanScope {
    id: string;
    raw: string;
    operation: 'deploy' | 'return';
    condition: 'GOOD' | 'DAMAGED' | 'MISSING';
    notes: string;
    state: 'pending' | 'review' | 'failed' | 'confirmed';
    createdAt: number;
    error?: string;
    effect?: ScanEffect;
}
export class ReviewScanError extends Error {}
export class PendingScanError extends Error {
}
type Store = Pick<Storage, 'getItem' | 'setItem' | 'key' | 'length'>;
const prefix = 'flow.scan.v1:';
export const sameScanScope = (a: ScanScope, b: ScanScope) => a.orgId === b.orgId && a.userId === b.userId && a.projectId === b.projectId;
export class ScanIntake {
    private running = false;
    constructor(private storage: Store) { }
    private key(e: SavedScan) { return prefix + JSON.stringify([e.orgId, e.userId, e.projectId, e.operation, e.id]); }
    save(e: SavedScan) {
        try {
            this.storage.setItem(this.key(e), JSON.stringify(e));
        }
        catch {
            throw new Error('Scan not saved on this device. Keep the barcode in the field and retry; do not close this page.');
        }
    }
    capture(scope: ScanScope, operation: SavedScan['operation'], raw: string, condition: SavedScan['condition'], notes: string) {
        if (!scope.orgId || !scope.userId || !scope.projectId)
            throw new Error('Sign in to the project before saving a scan.');
        const e: SavedScan = { ...scope, id: crypto.randomUUID(), operation, raw, condition, notes, state: 'pending', createdAt: Date.now() };
        this.save(e);
        return e;
    }
    list(scope: ScanScope): SavedScan[] {
        const rows: SavedScan[] = [];
        for (let i = 0; i < this.storage.length; i++) {
            const key = this.storage.key(i);
            if (!key?.startsWith(prefix))
                continue;
            const raw = this.storage.getItem(key);
            try {
                const e = JSON.parse(raw ?? 'null') as SavedScan;
                if (e && sameScanScope(e, scope) && this.key(e) === key && ['pending', 'review', 'failed', 'confirmed'].includes(e.state))
                    rows.push(e);
            }
            catch { /* An unrelated malformed record must not erase valid intake. */ }
        }
        return rows.sort((a, b) => a.createdAt - b.createdAt);
    }
    async replay(scope: ScanScope, verified: () => Promise<boolean>, process: (entry: SavedScan) => Promise<void>, changed: () => void = () => { }) {
        if (this.running)
            return;
        this.running = true;
        try {
            while (true) {
                const e = this.list(scope).find(e => e.state === 'pending');
                if (!e)
                    break;
                // Revalidate immediately before EVERY operation; no global queue replay on login.
                if (!await verified())
                    break;
                try {
                    await process(e);
                    e.state = 'confirmed';
                    delete e.error;
                }
                catch (error) {
                    e.state = error instanceof ReviewScanError ? 'review' : error instanceof PendingScanError ? 'pending' : 'failed';
                    e.error = error instanceof Error ? error.message : 'Scan failed. Review before retrying.';
                    this.save(e);
                    changed();
                    if (e.state === 'pending')
                        break;
                    continue;
                }
                this.save(e);
                changed();
            }
        }
        finally {
            this.running = false;
        }
    }
}
