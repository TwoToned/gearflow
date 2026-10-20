// @vitest-environment jsdom
import {expect,it,vi,beforeEach} from 'vitest';
import {ScanIntake,type ScanScope} from './scan-intake';
const scope:ScanScope={orgId:'synthetic-org',userId:'synthetic-user',projectId:'synthetic-project'};
beforeEach(()=>localStorage.clear());
it('F15 persists raw scan and condition before any lookup, survives new instance and duplicate replay',async()=>{
 const q=new ScanIntake(localStorage);const entry=q.capture(scope,'return',' RAW-001 ','DAMAGED','dented');
 expect(new ScanIntake(localStorage).list(scope)[0]).toMatchObject({id:entry.id,raw:' RAW-001 ',condition:'DAMAGED',state:'pending'});
 let commits=0;const receipts=new Set<string>();
 const process=vi.fn(async(e)=>{expect(new ScanIntake(localStorage).list(scope)[0].raw).toBe(' RAW-001 ');if(!receipts.has(e.id)){commits++;receipts.add(e.id);}});
 await q.replay(scope,async()=>true,process);expect(q.list(scope)[0].state).toBe('confirmed');expect(commits).toBe(1);
 await new ScanIntake(localStorage).replay(scope,async()=>true,process);expect(process).toHaveBeenCalledTimes(1);
});
it('F15 never exposes another identity or replays mismatched/unverified scope',async()=>{
 const q=new ScanIntake(localStorage);q.capture(scope,'deploy','A','GOOD','');const other={...scope,userId:'other'};const process=vi.fn();
 expect(q.list(other)).toEqual([]);await q.replay(scope,async()=>false,process);expect(process).not.toHaveBeenCalled();expect(q.list(scope)[0].state).toBe('pending');
});
it('F15 retains conflicts and revocations as failed, no success before acknowledgement',async()=>{
 const q=new ScanIntake(localStorage);q.capture(scope,'deploy','A','GOOD','');
 await q.replay(scope,async()=>true,async()=>{throw new Error('Permission revoked / conflict');});
 expect(q.list(scope)[0]).toMatchObject({state:'failed',error:'Permission revoked / conflict'});
});
it('F15 storage failure is surfaced before network and original scan remains with caller',()=>{
 const q=new ScanIntake({getItem:()=>null,setItem:()=>{throw new Error('quota');},key:()=>null,length:0});
 expect(()=>q.capture(scope,'deploy','KEEP-ME','GOOD','')).toThrow(/not saved/);
});
it('F15 drains scans captured while replay is awaiting an acknowledgement',async()=>{
 const q=new ScanIntake(localStorage);q.capture(scope,'deploy','first','GOOD','');const seen:string[]=[];
 await q.replay(scope,async()=>true,async e=>{seen.push(e.raw);if(e.raw==='first')q.capture(scope,'return','second','GOOD','');});
 expect(seen).toEqual(['first','second']);expect(q.list(scope).every(e=>e.state==='confirmed')).toBe(true);
});
it('F15 transport failures stay pending for reconnect; server conflicts stay failed',async()=>{
 const {PendingScanError}=await import('./scan-intake');const q=new ScanIntake(localStorage);q.capture(scope,'deploy','A','GOOD','');
 await q.replay(scope,async()=>true,async()=>{throw new PendingScanError('Waiting for connection');});
 expect(q.list(scope)[0].state).toBe('pending');await q.replay(scope,async()=>true,async()=>{});expect(q.list(scope)[0].state).toBe('confirmed');
});
