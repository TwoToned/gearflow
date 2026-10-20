// @vitest-environment jsdom
import {renderHook,act,waitFor} from '@testing-library/react';
import {expect,it,vi,afterEach} from 'vitest';
import {useDurableScanIntake} from './use-durable-scan-intake';
afterEach(()=>{vi.restoreAllMocks();localStorage.clear();});
it('F15 storage refusal retains raw scan visibly in memory with honest error',async()=>{
 const scope={orgId:'synthetic-org',userId:'synthetic-user',projectId:'synthetic-project'};
 const process=vi.fn();const {result}=renderHook(()=>useDurableScanIntake(scope,async()=>true,process));
 await waitFor(()=>expect(result.current.busy).toBe(false));
 vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('quota');});
 act(()=>{expect(result.current.capture('deploy','KEEP-RAW','GOOD','')).toBe(false);});
 expect(result.current.error).toContain('not saved');expect(result.current.unsaved).toBe('KEEP-RAW');expect(process).not.toHaveBeenCalled();
});
it('F15 identity switch during verification never processes the prior queue',async()=>{
 let resolve:(value:boolean)=>void=()=>{};const verify=vi.fn(()=>new Promise<boolean>(r=>{resolve=r;}));const process=vi.fn();
 const a={orgId:'synthetic-org',userId:'synthetic-user',projectId:'synthetic-project'};
 const {result,rerender}=renderHook(({scope})=>useDurableScanIntake(scope,verify,process),{initialProps:{scope:a}});
 act(()=>{result.current.capture('deploy','A','GOOD','');});await waitFor(()=>expect(verify).toHaveBeenCalled());
 rerender({scope:{...a,userId:'other'}});await act(async()=>{resolve(true);});
 expect(process).not.toHaveBeenCalled();expect(result.current.entries).toEqual([]);
});
it('F15 a negative context verification blocks processing',async()=>{
 const process=vi.fn();const a={orgId:'synthetic-org',userId:'synthetic-user',projectId:'synthetic-project'};
 const {result}=renderHook(()=>useDurableScanIntake(a,async()=>false,process));
 act(()=>{result.current.capture('deploy','A','GOOD','');});
 await waitFor(()=>expect(result.current.entries[0]?.state).toBe('failed'));expect(process).not.toHaveBeenCalled();
});
it('explicitly retries pending transport errors while navigator stays online',async()=>{
 const process=vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValue(undefined);
 const scope={orgId:'o',userId:'u',projectId:'p'};
 const {result}=renderHook(()=>useDurableScanIntake(scope,async()=>true,process));
 act(()=>{result.current.capture('return','A','DAMAGED','note');});
 await waitFor(()=>expect(result.current.entries[0]?.error).toContain('Waiting'));
 const id=result.current.entries[0].id;
 act(()=>result.current.retry(id));
 await waitFor(()=>expect(result.current.entries[0]?.state).toBe('confirmed'));
 expect(process.mock.calls[1][0].id).toBe(id);
});
it('retry storage refusal is visible and never sends a request',async()=>{
 const process=vi.fn().mockRejectedValue(new Error('conflict'));
 const scope={orgId:'o',userId:'u',projectId:'p'};
 const {result}=renderHook(()=>useDurableScanIntake(scope,async()=>true,process));
 act(()=>{result.current.capture('return','A','GOOD','');});
 await waitFor(()=>expect(result.current.entries[0]?.state).toBe('failed'));
 vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('quota');});
 act(()=>result.current.retry(result.current.entries[0].id));
 expect(result.current.error).toContain('not saved');expect(process).toHaveBeenCalledTimes(1);
 expect(result.current.entries[0].state).toBe('failed');
});
it('captures expected version durably before the first lookup',async()=>{
 const scope={orgId:'o',userId:'u',projectId:'p',expectedVersionId:'v1'};
 const process=vi.fn(async(entry)=>{expect(entry.expectedVersionId).toBe('v1');expect(JSON.stringify(localStorage)).toContain('v1');});
 const {result}=renderHook(()=>useDurableScanIntake(scope,async()=>true,process));
 act(()=>{result.current.capture('return','A','GOOD','');});
 await waitFor(()=>expect(result.current.entries[0]?.state).toBe('confirmed'));
 expect(process).toHaveBeenCalledTimes(1);
});
it('durable manual review resumes the same operation and captured fields',async()=>{
 const {ReviewScanError}=await import('@/lib/scan-intake');
 const scope={orgId:'o',userId:'u',projectId:'p',expectedVersionId:'v1'};
 const process=vi.fn(async(entry,assertCurrent,save)=>{if(!entry.effect?.kitDecision){entry.effect={kitId:'kit',lineItemId:'parent'};save(entry);throw new ReviewScanError('Review kit');}});
 const {result}=renderHook(()=>useDurableScanIntake(scope,async()=>true,process));
 act(()=>{result.current.capture('return','KIT','DAMAGED','captured');});
 await waitFor(()=>expect(result.current.entries[0]?.state).toBe('review'));
 const entry=result.current.entries[0];
 act(()=>result.current.review(entry.id,{...entry.effect!,kitDecision:'all'}));
 await waitFor(()=>expect(result.current.entries[0]?.state).toBe('confirmed'));
 expect(process.mock.calls[1][0]).toMatchObject({id:entry.id,condition:'DAMAGED',notes:'captured',effect:{kitDecision:'all'}});
});
it('retains confirmed receipt truth after scope changes and stops old-scope drain',async()=>{
 let resolve!:()=>void;const process=vi.fn(()=>new Promise<void>(r=>{resolve=r;}));
 const a={orgId:'o',userId:'u',projectId:'p'};
 const {result,rerender}=renderHook(({scope})=>useDurableScanIntake(scope,async()=>true,process),{initialProps:{scope:a}});
 act(()=>{result.current.capture('return','first','GOOD','');result.current.capture('return','second','GOOD','');});
 await waitFor(()=>expect(process).toHaveBeenCalledTimes(1));
 rerender({scope:{...a,userId:'other'}});
 await act(async()=>resolve());
 const {ScanIntake}=await import('@/lib/scan-intake');
 expect(new ScanIntake(localStorage).list(a).map(e=>e.state)).toEqual(['confirmed','pending']);
 expect(result.current.entries).toEqual([]);expect(process).toHaveBeenCalledTimes(1);
});
it('retry storage read refusal is visible without a request',async()=>{
 const process=vi.fn().mockRejectedValue(new Error('conflict'));const scope={orgId:'o',userId:'u',projectId:'p'};
 const {result}=renderHook(()=>useDurableScanIntake(scope,async()=>true,process));
 act(()=>{result.current.capture('return','A','GOOD','');});
 await waitFor(()=>expect(result.current.entries[0]?.state).toBe('failed'));
 const id=result.current.entries[0].id;
 vi.spyOn(Storage.prototype,'getItem').mockImplementation(()=>{throw new Error('Storage read refused');});
 act(()=>result.current.retry(id));
 expect(result.current.error).toContain('read');expect(process).toHaveBeenCalledTimes(1);
});

// Real hook + device intake; only the asynchronous server boundaries are deferred.
const deferred = <T,>() => {
 let resolve!: (value: T) => void;
 const promise = new Promise<T>(r => { resolve = r; });
 return {promise, resolve};
};
const unmountScope = {orgId:'unmount-org',userId:'unmount-user',projectId:'A',expectedVersionId:'v1'};
it.each(['verify','lookup'] as const)('unmount during deferred %s stops commit and further A drain, isolates B, and permits a fresh mount',async boundary=>{
 const {ScanIntake}=await import('@/lib/scan-intake');
 const gate=deferred<boolean>();const commit=vi.fn();const feedback=vi.fn();
 const verify=vi.fn(async()=>boundary==='verify' ? gate.promise : true);
 const process=vi.fn(async(entry,assertCurrent,save)=>{
  if(boundary==='lookup') await gate.promise;
  assertCurrent();
  entry.effect={lineItemId:'line-A'};save(entry);
  await commit(entry);
  try {assertCurrent();feedback();} catch { /* Preserve sent acknowledgement. */ }
 });
 const a=renderHook(()=>useDurableScanIntake(unmountScope,verify,process));
 act(()=>{a.result.current.capture('return','first','DAMAGED','original');a.result.current.capture('return','second','GOOD','');});
 await waitFor(()=>expect(boundary==='verify'?verify:process).toHaveBeenCalledTimes(1));
 const originals=new ScanIntake(localStorage).list(unmountScope);
 a.unmount();
 const b=renderHook(()=>useDurableScanIntake({...unmountScope,projectId:'B'},async()=>true,vi.fn()));
 await act(async()=>{gate.resolve(true);});
 expect(commit).not.toHaveBeenCalled();expect(feedback).not.toHaveBeenCalled();
 expect(verify).toHaveBeenCalledTimes(1);
 const saved=new ScanIntake(localStorage).list(unmountScope);
 expect(saved.map(e=>e.id)).toEqual(originals.map(e=>e.id));
 expect(saved[0].state).not.toBe('confirmed');expect(saved[1].state).toBe('pending');
 expect(saved[0].effect).toBeUndefined();expect(b.result.current.entries).toEqual([]);
 const freshProcess=vi.fn(async(_entry: import('@/lib/scan-intake').SavedScan)=>{});
 const fresh=renderHook(()=>useDurableScanIntake(unmountScope,async()=>true,freshProcess));
 await waitFor(()=>expect(freshProcess).toHaveBeenCalledTimes(1));
 expect(freshProcess.mock.calls[0][0].id).toBe(originals[1].id);
 fresh.unmount();b.unmount();
});
it('unmount after commit sent preserves original confirmed receipt, suppresses stale feedback and stops drain',async()=>{
 const {ScanIntake}=await import('@/lib/scan-intake');
 const ack=deferred<boolean>();const commit=vi.fn(()=>ack.promise);const feedback=vi.fn();
 const process=vi.fn(async(entry,assertCurrent)=>{
  assertCurrent();
  if(!await commit(entry)) throw new Error('Missing acknowledgement');
  try {assertCurrent();feedback(entry);} catch { /* Confirmation survives navigation. */ }
 });
 const a=renderHook(()=>useDurableScanIntake(unmountScope,async()=>true,process));
 act(()=>{a.result.current.capture('return','sent','DAMAGED','original');a.result.current.capture('return','queued','GOOD','');});
 await waitFor(()=>expect(commit).toHaveBeenCalledTimes(1));
 const original=new ScanIntake(localStorage).list(unmountScope)[0];
 a.unmount();
 const b=renderHook(()=>useDurableScanIntake({...unmountScope,projectId:'B'},async()=>true,vi.fn()));
 await act(async()=>{ack.resolve(true);});
 expect(new ScanIntake(localStorage).list(unmountScope)).toEqual([{...original,state:'confirmed'},expect.objectContaining({raw:'queued',state:'pending'})]);
 expect(feedback).not.toHaveBeenCalled();expect(commit).toHaveBeenCalledTimes(1);expect(b.result.current.entries).toEqual([]);
 b.unmount();
});
