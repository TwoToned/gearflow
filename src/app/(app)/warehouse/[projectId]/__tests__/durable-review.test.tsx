// @vitest-environment jsdom
import React from 'react';
import {render,screen,fireEvent,waitFor,act,cleanup} from '@testing-library/react';
import {it,expect,vi,afterEach,beforeEach} from 'vitest';
const io=vi.hoisted(()=>({tab:'check-in',user:'u',lookup:vi.fn(),commit:vi.fn(),ordinary:vi.fn(),play:vi.fn(),project:null as Record<string,unknown> | null}));
vi.mock('next/navigation',()=>({useSearchParams:()=>new URLSearchParams('tab='+io.tab)}));
vi.mock('@/lib/auth-client',()=>({useActiveOrganization:()=>({data:{id:'o'}}),useSession:()=>({data:{user:{id:io.user}}})}));
vi.mock('convex/react',()=>({useConvex:()=>({query:async()=>true,mutation:io.commit}),useConvexAuth:()=>({isAuthenticated:true}),useQuery:()=>undefined,useMutation:()=>io.ordinary}));
vi.mock('@/lib/use-permissions',()=>({useCurrentRole:()=>({role:'owner',permissions:{warehouse:['read','check_in','check_out','update']},isLoading:false}),useCanDo:()=>true}));
vi.mock('@/hooks/use-native-warehouse',()=>({useNativeWarehouseProject:()=>({data:io.project,isLoading:false})}));
vi.mock('@/hooks/use-warehouse-overbooked',()=>({useWarehouseOverbooked:()=>({})}));
vi.mock('@/server/warehouse',()=>({lookupAssetForScan:io.lookup,getAvailableAssetsForModels:async()=>[]}));
vi.mock('@/server/check-records',()=>({pullItem:vi.fn(),prepItemDirect:vi.fn(),prepItemsBatch:vi.fn(),deprepKit:vi.fn(),deprepItemsBatch:vi.fn(),prepKitChildren:vi.fn(),prepKitsBatch:vi.fn(),unpackItem:vi.fn()}));
vi.mock('@/hooks/use-warehouse-writes',()=>({useWarehouseWrites:()=>new Proxy({},{get:()=>io.ordinary})}));
vi.mock('@/hooks/use-check-record-writes',()=>({useCheckRecordWrites:()=>({})}));
vi.mock('@/hooks/use-project-container-writes',()=>({useProjectContainerWrites:()=>({})}));
vi.mock('@/hooks/use-scan-feedback',()=>({useScanFeedback:()=>({play:io.play,entries:[],history:[],clearHistory:vi.fn(),enabled:false,setEnabled:vi.fn()})}));
vi.mock('@/hooks/use-server-query',()=>({useServerQuery:()=>({data:[],isLoading:false})}));
import Page from '../page';
import {ScanIntake} from '@/lib/scan-intake';
const scope={orgId:'o',userId:'u',projectId:'p',expectedVersionId:'v1'};
beforeEach(()=>{
 window.matchMedia=()=>({matches:false,addEventListener:()=>{},removeEventListener:()=>{}} as unknown as MediaQueryList);
 localStorage.clear();io.tab='check-in';io.user='u';io.commit.mockReset().mockResolvedValue({confirmed:true});io.lookup.mockReset().mockResolvedValue({found:true,type:'kit',kitId:'k',lineItemId:'parent',assetName:'Lighting'});io.ordinary.mockReset();
 Element.prototype.hasPointerCapture??=()=>false;Element.prototype.setPointerCapture??=()=>{};Element.prototype.releasePointerCapture??=()=>{};Element.prototype.scrollIntoView??=()=>{};
 const child={id:'child',type:'EQUIPMENT',quantity:1,status:'CHECKED_OUT',checkedOutQuantity:1,prepStatus:'PACKED',assetId:'a',asset:{id:'a',assetTag:'A',status:'CHECKED_OUT'},modelId:'m',model:{id:'m',name:'Lamp'},isKitChild:true,parentLineItemId:'parent',units:[{id:'unit',assetId:'a',quantity:1,status:'CHECKED_OUT'}]};
 io.project={id:'p',name:'Gig',projectNumber:'P1',status:'CHECKED_OUT',liveVersionId:'v1',lineItems:[{id:'parent',type:'EQUIPMENT',quantity:1,status:'CHECKED_OUT',checkedOutQuantity:1,prepStatus:'PACKED',kitId:'k',kit:{id:'k',name:'Lighting',assetTag:'KIT',checkMode:'PER_ITEM'},childLineItems:[child],units:[]}],client:null,location:null};
});
afterEach(()=>{cleanup();localStorage.clear();});
it('mounted Return All commits saved condition notes and operation ID and reconciles queue',async()=>{
 const q=new ScanIntake(localStorage);const entry=q.capture(scope,'return','KIT','DAMAGED','captured dents');
 await act(async()=>{render(<Page params={Promise.resolve({projectId:'p'})}/>);});
 fireEvent.click(await screen.findByRole('button',{name:/Return All/}));
 await waitFor(()=>expect(q.list(scope)[0].state).toBe('confirmed'));
 expect(io.commit).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({operationId:entry.id,condition:'DAMAGED',notes:'captured dents',expectedVersionId:'v1',effect:{kitId:'k',lineItemId:'parent',kitDecision:'all'}}));
 expect(io.ordinary).not.toHaveBeenCalled();
});
it('mounted cancellation keeps review durable and performs no ordinary return',async()=>{
 const q=new ScanIntake(localStorage);q.capture(scope,'return','KIT','MISSING','missing case');
 await act(async()=>{render(<Page params={Promise.resolve({projectId:'p'})}/>);});
 fireEvent.click(await screen.findByRole('button',{name:'Cancel'}));
 expect(q.list(scope)[0]).toMatchObject({state:'review',condition:'MISSING',notes:'missing case'});
 expect(io.commit).not.toHaveBeenCalled();expect(io.ordinary).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'Review saved scan'}));
 expect(await screen.findByRole('button',{name:/Return All/})).toBeTruthy();
});
it('mounted lost acknowledgement explicitly retries same reviewed operation and payload',async()=>{
 const q=new ScanIntake(localStorage);const entry=q.capture(scope,'return','KIT','DAMAGED','captured');
 io.commit.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValue({confirmed:true});
 await act(async()=>{render(<Page params={Promise.resolve({projectId:'p'})}/>);});
 fireEvent.click(await screen.findByRole('button',{name:/Return All/}));
 await waitFor(()=>expect(q.list(scope)[0].error).toContain('Waiting'));
 fireEvent.click(screen.getByRole('button',{name:'Retry saved scan'}));
 await waitFor(()=>expect(q.list(scope)[0].state).toBe('confirmed'));
 expect(io.commit.mock.calls[0][1]).toEqual(io.commit.mock.calls[1][1]);
 expect(io.commit.mock.calls[1][1].operationId).toBe(entry.id);expect(io.lookup).toHaveBeenCalledTimes(1);expect(io.ordinary).not.toHaveBeenCalled();
});
it('mounted successful response after identity switch confirms original record without stale feedback',async()=>{
 const q=new ScanIntake(localStorage);const entry=q.capture(scope,'return','A','GOOD','');q.save({...entry,effect:{lineItemId:'child',assetId:'a'}});
 let resolve!:(value:{confirmed:true})=>void;io.commit.mockImplementation(()=>new Promise(r=>{resolve=r;}));io.play.mockClear();
 const params=Promise.resolve({projectId:'p'});
 let view!:ReturnType<typeof render>;await act(async()=>{view=render(<Page params={params}/>);});
 await waitFor(()=>expect(io.commit).toHaveBeenCalledTimes(1));
 io.user='other';view.rerender(<Page params={params}/>);
 await act(async()=>resolve({confirmed:true}));
 expect(q.list(scope)[0].state).toBe('confirmed');expect(io.play).not.toHaveBeenCalled();
});
it('mounted manual review context switch cannot complete the old account operation',async()=>{
 const q=new ScanIntake(localStorage);q.capture(scope,'return','KIT','DAMAGED','original');
 const params=Promise.resolve({projectId:'p'});let view!:ReturnType<typeof render>;
 await act(async()=>{view=render(<Page params={params}/>);});
 await screen.findByRole('button',{name:/Return All/});
 io.user='other';view.rerender(<Page params={params}/>);
 await waitFor(()=>expect(screen.queryByRole('button',{name:/Return All/})).toBeNull());
 expect(io.commit).not.toHaveBeenCalled();expect(io.ordinary).not.toHaveBeenCalled();expect(q.list(scope)[0].state).toBe('review');
});
it('mounted scan capture persists the displayed version before deferred lookup',async()=>{
 io.lookup.mockImplementation(()=>new Promise(()=>{}));
 await act(async()=>{render(<Page params={Promise.resolve({projectId:'p'})}/>);});
 const input=await screen.findByPlaceholderText('Scan or enter asset tag to return...');
 fireEvent.change(input,{target:{value:'KIT'}});fireEvent.keyDown(input,{key:'Enter'});
 await waitFor(()=>expect(io.lookup).toHaveBeenCalledTimes(1));
 expect(new ScanIntake(localStorage).list(scope)[0]).toMatchObject({raw:'KIT',expectedVersionId:'v1',state:'pending'});
});

function accessoryProject(packed=false) {
 const child=(id:string)=>({id,type:'EQUIPMENT',quantity:1,status:'CONFIRMED',checkedOutQuantity:0,prepStatus:packed?'PACKED':'PENDING',assetId:id,asset:{id,assetTag:id,status:'AVAILABLE'},modelId:'m',model:{id:'m',name:id},isKitChild:true,childKind:'ACCESSORY',accessoryInclusion:'DEFAULT',parentLineItemId:'parent',units:[]});
 io.project={...io.project,status:'CONFIRMED',lineItems:[{id:'parent',type:'EQUIPMENT',quantity:1,status:'CONFIRMED',checkedOutQuantity:0,prepStatus:'PACKED',assetId:'a',asset:{id:'a',assetTag:'A',status:'AVAILABLE'},modelId:'m',model:{id:'m',name:'Lamp'},childLineItems:[child('acc1'),child('acc2')],units:[]}]};
 io.lookup.mockResolvedValue({found:true,type:'asset',lineItemId:'parent',assetId:'a',assetName:'Lamp'});
}
it('mounted missing-accessory override retains captured operation, decision and notes through lost acknowledgement',async()=>{
 accessoryProject();
 const q=new ScanIntake(localStorage);const entry=q.capture(scope,'deploy','A','GOOD','captured deploy note');
 io.commit.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValue({confirmed:true});
 await act(async()=>{render(<Page params={Promise.resolve({projectId:'p'})}/>);});
 fireEvent.click(await screen.findByRole('button',{name:'Deploy anyway'}));
 await waitFor(()=>expect(io.commit).toHaveBeenCalledTimes(1));
 expect(io.ordinary).not.toHaveBeenCalled();
 expect(q.list(scope)[0]).toMatchObject({state:'pending'});
 fireEvent.click(await screen.findByRole('button',{name:'Retry saved scan'}));
 await waitFor(()=>expect(q.list(scope)[0].state).toBe('confirmed'));
 expect(io.commit.mock.calls[0][1]).toEqual(io.commit.mock.calls[1][1]);
 expect(io.commit.mock.calls[0][1]).toMatchObject({operationId:entry.id,expectedVersionId:'v1',notes:'captured deploy note',effect:{lineItemId:'parent',assetId:'a',accessoryDecision:'override',includeAccessoryIds:[],skippedAccessories:[{accessoryLineItemId:'acc1',tier:'DEFAULT',reason:expect.any(String)},{accessoryLineItemId:'acc2',tier:'DEFAULT',reason:expect.any(String)}]}});
});
it.each(['account','version'] as const)('mounted accessory %s switch closes review and retains original intent',async context=>{
 accessoryProject();const q=new ScanIntake(localStorage);q.capture(scope,'deploy','A','GOOD','saved');
 const params=Promise.resolve({projectId:'p'});let view!:ReturnType<typeof render>;
 await act(async()=>{view=render(<Page params={params}/>);});
 await screen.findByRole('button',{name:'Deploy anyway'});
 if(context==='account') io.user='other';else io.project={...io.project,liveVersionId:'v2'};
 view.rerender(<Page params={params}/>);
 await waitFor(()=>expect(screen.queryByRole('button',{name:'Deploy anyway'})).toBeNull());
 expect(q.list(scope)[0].state).toBe('review');expect(io.commit).not.toHaveBeenCalled();expect(io.ordinary).not.toHaveBeenCalled();
});
it.each(['verified','all'] as const)('mounted partial accessory verification commits %s decision through saved scan',async decision=>{
 accessoryProject(true);io.tab='check-out';
 await act(async()=>{render(<Page params={Promise.resolve({projectId:'p'})}/>);});

 fireEvent.click((await screen.findAllByRole('button',{name:/Lamp.*Accessories/}))[0]);
 const verify=await screen.findAllByRole('button',{name:'Tap to verify present'});fireEvent.click(verify[0]);
 const q=new ScanIntake(localStorage);
 const input=await screen.findByPlaceholderText('Scan asset tag to deploy...');
 fireEvent.change(input,{target:{value:'A'}});fireEvent.keyDown(input,{key:'Enter'});
 fireEvent.click(await screen.findByRole('button',{name:decision==='verified'?/Deploy Verified Only/:/Deploy All/}));
 await waitFor(()=>expect(q.list(scope)[0].state).toBe('confirmed'));
 expect(io.commit.mock.calls[0][1].effect).toMatchObject({lineItemId:'parent',accessoryDecision:decision,...(decision==='verified'?{includeAccessoryIds:['acc1']}:{})});
 expect(io.ordinary).not.toHaveBeenCalled();
});
it('mounted rejected accessory commit remains failed and cancellation remains review',async()=>{
 accessoryProject();const q=new ScanIntake(localStorage);q.capture(scope,'deploy','A','GOOD','retained');
 io.commit.mockRejectedValue(new Error('Project version changed'));
 await act(async()=>{render(<Page params={Promise.resolve({projectId:'p'})}/>);});
 fireEvent.click(await screen.findByRole('button',{name:'Cancel'}));
 expect(q.list(scope)[0]).toMatchObject({state:'review',notes:'retained'});expect(io.commit).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'Review saved scan'}));
 fireEvent.click(await screen.findByRole('button',{name:'Deploy anyway'}));
 await waitFor(()=>expect(q.list(scope)[0]).toMatchObject({state:'failed',error:'Project version changed',notes:'retained'}));
 expect(io.ordinary).not.toHaveBeenCalled();
});
