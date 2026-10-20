"use client";
import { useCallback, useEffect, useRef, useState } from 'react';
import { ScanIntake, PendingScanError, sameScanScope, type ScanScope, type SavedScan, type ScanEffect } from '@/lib/scan-intake';
export function useDurableScanIntake(scope: ScanScope | null, verify: (operation: SavedScan['operation']) => Promise<boolean>, process: (entry: SavedScan, assertCurrent: () => void, save: (entry: SavedScan) => void) => Promise<void>) {
    const [entries, setEntries] = useState<SavedScan[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [unsaved, setUnsaved] = useState<{
        scope: ScanScope;
        raw: string;
    } | null>(null);
    const [busy, setBusy] = useState(false);
    const current = useRef({ scope, verify, process });
    const store = useRef<ScanIntake | null>(null);
    // Each effect lifetime owns its replay; a later setup cannot revive old work.
    const lifecycle = useRef({ active: false, generation: 0 });
    useEffect(() => { current.current = { scope, verify, process }; });
    const refresh = useCallback(() => { const s = current.current.scope; if (s && store.current)
        setEntries(store.current.list(s));
    else
        setEntries([]); }, []);
    const replay = useCallback(async () => {
        const captured = current.current.scope;
        const intake = store.current;
        const generation = lifecycle.current.generation;
        const isCurrent = () => lifecycle.current.active && lifecycle.current.generation === generation;
        if (!captured || !intake || !isCurrent() || !navigator.onLine)
            return;
        const assertCurrent = () => { const now = current.current.scope; if (!isCurrent() || !now || !sameScanScope(now, captured))
            throw new Error('Scan context changed. Return to the original account and project.'); };
        setBusy(true);
        try {
            await intake.replay(captured, async () => { assertCurrent(); return true; }, async (e) => {
                try {
                    assertCurrent();
                    if (!await current.current.verify(e.operation))
                        throw new Error('Scan context could not be verified. Review before retrying.');
                    assertCurrent();
                    // Do not assert after process: an already-sent successful commit
                    // must still be recorded by this original intake after navigation.
                    await current.current.process(e, assertCurrent, entry => { assertCurrent(); intake.save(entry); });
                }
                catch (error) {
                    if (!navigator.onLine || (error instanceof TypeError && /fetch|network/i.test(error.message)))
                        throw new PendingScanError('Waiting for connection. Scan remains pending.');
                    throw error;
                }
            }, () => { if (isCurrent()) refresh(); });
            if (isCurrent()) refresh();
        }
        catch (e) {
            if (isCurrent()) setError(e instanceof Error ? e.message : 'Could not read saved scans.');
        }
        finally {
            if (isCurrent()) setBusy(false);
        }
    }, [refresh]);
    const scopeKey = scope ? JSON.stringify(scope) : '';
    useEffect(() => {
        lifecycle.current = { active: true, generation: lifecycle.current.generation + 1 };
        setBusy(false);
        try {
            store.current = new ScanIntake(window.localStorage);
            refresh();
            void replay();
        }
        catch (e) {
            setError(e instanceof Error ? e.message : 'Device storage unavailable. Keep your scan in the field.');
        }
        window.addEventListener('online', replay);
        return () => {
            lifecycle.current.active = false;
            lifecycle.current.generation += 1;
            window.removeEventListener('online', replay);
        };
    }, [scopeKey, refresh, replay]);
    const capture = useCallback((operation: SavedScan['operation'], raw: string, condition: SavedScan['condition'], notes: string) => {
        try {
            const s = current.current.scope;
            if (!s || !store.current)
                throw new Error('Verified account required. Keep your scan in the field.');
            store.current.capture(s, operation, raw, condition, notes);
            setError(null);
            setUnsaved(null);
            refresh();
            void replay();
            return true;
        }
        catch (e) {
            const s = current.current.scope;
            if (s)
                setUnsaved({ scope: s, raw });
            setError(e instanceof Error ? e.message : 'Scan not saved. Keep it in the field.');
            return false;
        }
    }, [refresh, replay]);
    const retry = useCallback((id: string) => { try { const s = current.current.scope; if (!s || !store.current)
        return; const e = store.current.list(s).find(e => e.id === id); if (e && e.state !== 'confirmed') {
        store.current.save({ ...e, state: 'pending', error: undefined });
        refresh();
        void replay();
    } } catch (e) { setError(e instanceof Error ? e.message : 'Could not save retry. Retry after device storage is available.'); } }, [refresh, replay]);
    const review = useCallback((id: string, effect: ScanEffect) => {
        try {
            const s = current.current.scope;
            if (!s || !store.current) return false;
            const entry = store.current.list(s).find(e => e.id === id && e.state === 'review');
            if (!entry) throw new Error('Return to the original scan scope to complete this review.');
            if (effect.kitId !== entry.effect?.kitId || effect.lineItemId !== entry.effect?.lineItemId)
                throw new Error('Review target changed. Reopen the saved scan.');
            store.current.save({...entry, effect, state:'pending', error:undefined});
            setError(null);refresh();void replay();return true;
        } catch (e) { setError(e instanceof Error ? e.message : 'Could not save review.');return false; }
    }, [refresh, replay]);
    return { capture, retry, review, busy, error, unsaved: unsaved && scope && sameScanScope(unsaved.scope, scope) ? unsaved.raw : null, entries: scope ? entries.filter(e => sameScanScope(e, scope)) : [] };
}
