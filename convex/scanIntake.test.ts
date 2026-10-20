// @vitest-environment node
//
// Browser-direct WAREHOUSE writes (Phase 3 PR-A) — the return / undeploy / container
// write family. Verifies for a representative subset (checkInItems, undeployKitsBatch,
// checkInKit, ensureContainerOnProject, syncContainersBatch): success + state
// transition + in-mutation audit; RBAC deny (viewer); cross-org FK rejection; batch
// empty-guard + dedupe; and that a spoofed actor.userId is overridden by the verified
// token subject. The requireService mirrors are covered by kitPerUnit / warehousePageBatch.
import { readFileSync } from "node:fs";
import { convexTest } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { register as registerShardedCounter } from "@convex-dev/sharded-counter/test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { evaluateBlockingGate as convexGate } from "./lib/blockingCommentsGate";
import { evaluateBlockingGate as srcGate } from "@/lib/blocking-comments-gate";

const modules = import.meta.glob("./**/*.ts");
const ORG = "org_1";
const OTHER = "org_other";
const USER = "user_1";
const NOW = 1_700_000_000_000;
const asUser = (orgId: string) => ({ subject: USER, orgId });
// SERVICE identity to drive the createKitLineItem fixture (requireService) in the
// checkOutKitsBatch partial-success test.
const SERVICE = { subject: "gearflow-service", svc: true };
// A deliberately-wrong actor — resolveActor must pin attribution to the token subject.
const SPOOF = { userId: "attacker_id", userName: "Mallory" };

function makeT() {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  registerShardedCounter(t, "shardedCounter");
  return t;
}
type T = ReturnType<typeof makeT>;

async function member(t: T, role: string, orgId = ORG) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: `m-${role}`, organizationId: orgId, userId: USER, role });
  });
}

/** #1228 — deterministic per-(project,org) version id. */
function versionIdFor(id: string, orgId: string): string {
  return `v-${id}-${orgId}`;
}

async function seedProject(t: T, id = "p1", orgId = ORG) {
  const versionId = versionIdFor(id, orgId);
  await t.run(async (ctx) => {
    await ctx.db.insert("projects", {
      id, organizationId: orgId, projectNumber: `P-${id}`, name: "Gig", status: "CONFIRMED",
      total: 0, liveVersionId: versionId,
    });
    await ctx.db.insert("projectVersions", {
      id: versionId, organizationId: orgId, projectId: id, number: 1, contentState: "ready", createdAt: NOW, createdById: "u1",
    });
  });
}

const baseLine = (id: string, extra: Record<string, unknown>, orgId = ORG) => ({
  id, organizationId: orgId, projectId: "p1", versionId: versionIdFor("p1", orgId), lineageId: id,
  type: "EQUIPMENT" as const, quantity: 1, sortOrder: 0,
  status: "CONFIRMED" as const, checkedOutQuantity: 0, prepStatus: "PENDING" as const,
  isKitChild: false, createdAt: NOW, updatedAt: NOW, ...extra,
});

const lineById = (t: T, id: string) =>
  t.run(async (ctx) => ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", id)).unique());
const unitById = (t: T, id: string) =>
  t.run(async (ctx) => ctx.db.query("projectLineItemUnits").withIndex("by_cuid", (q) => q.eq("id", id)).unique());
const assetById = (t: T, id: string) =>
  t.run(async (ctx) => ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", id)).unique());
const kitById = (t: T, id: string) =>
  t.run(async (ctx) => ctx.db.query("kits").withIndex("by_cuid", (q) => q.eq("id", id)).unique());
const logById = (t: T, id: string) =>
  t.run(async (ctx) => ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", id)).first());
const projectById = (t: T, id = "p1") =>
  t.run(async (ctx) => ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", id)).first());

async function seedModelAsset(t: T, orgId = ORG, status: "CHECKED_OUT" | "AVAILABLE" | "IN_MAINTENANCE" | "RETIRED" | "LOST" | "RESERVED" | "SOLD" = "CHECKED_OUT") {
  await t.run(async (ctx) => {
    await ctx.db.insert("models", { id: "m1", organizationId: orgId, name: "PAR", createdAt: NOW, updatedAt: NOW });
    await ctx.db.insert("assets", { id: "a1", organizationId: orgId, modelId: "m1", assetTag: "A-1", status, condition: "GOOD", isActive: true, createdAt: NOW, updatedAt: NOW });
  });
}

// ─── checkInItems ─────────────────────────────────────────────────────────────
describe("F15 synthetic atomic scan receipts", () => {
  async function seed(t: T) {
    await member(t, "member");
    await seedProject(t);
    await seedModelAsset(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItems", baseLine("li1", { modelId: "m1", assetId: "a1", status: "CHECKED_OUT", checkedOutQuantity: 1 }));
      await ctx.db.insert("projectLineItemUnits", { id: "u1", organizationId: ORG, lineItemId: "li1", ordinal: 0, assetId: "a1", quantity: 1, status: "CHECKED_OUT", createdAt: NOW, updatedAt: NOW });
    });
  }

  test("changed live version rejects old intent but acknowledges a matching prior receipt",async()=>{
    const t=makeT();await seed(t);const user=t.withIdentity(asUser(ORG));
    const args={orgId:ORG,projectId:'p1',expectedUserId:USER,expectedVersionId:versionIdFor('p1',ORG),operationId:'version-op',raw:'A-1',operation:'return' as const,condition:'GOOD' as const,notes:'',effect:{lineItemId:'li1',assetId:'a1'}};
    await user.mutation(api.scanIntake.commit,args);
    await t.run(async ctx=>{const p=await ctx.db.query('projects').first();await ctx.db.patch(p!._id,{liveVersionId:'v2'});});
    expect(await user.mutation(api.scanIntake.commit,args)).toEqual({confirmed:true});
    await expect(user.mutation(api.scanIntake.commit,{...args,operationId:'new-op'})).rejects.toThrow(/version/i);
    expect(await t.run(ctx=>ctx.db.query('scanReceipts').collect())).toHaveLength(1);
  });

  test("duplicate replay has one atomic effect; permission revocation still denies receipt", async()=>{
    const t=makeT();await seed(t);
    const args={orgId:ORG,projectId:"p1",expectedUserId:USER,expectedVersionId:versionIdFor("p1",ORG),operationId:"synthetic-operation",raw:"A-1",operation:"return" as const,condition:"GOOD" as const,notes:"",effect:{lineItemId:"li1",assetId:"a1"}};
    const user=t.withIdentity(asUser(ORG));
    expect(await user.mutation(api.scanIntake.commit,args)).toEqual({confirmed:true});
    expect(await user.mutation(api.scanIntake.commit,args)).toEqual({confirmed:true});
    const receipts=await t.run(ctx=>ctx.db.query("scanReceipts").collect());expect(receipts).toHaveLength(1);
    expect((await unitById(t,"u1"))?.status).toBe("RETURNED");
    await expect(user.mutation(api.scanIntake.commit,{...args,condition:"DAMAGED"})).rejects.toThrow(/different scan/);
    await t.run(async ctx=>{const m=await ctx.db.query("members").first();await ctx.db.patch("members",m!._id,{role:"viewer"});});
    await expect(user.mutation(api.scanIntake.commit,args)).rejects.toThrow(/permissions/i);
  });
  test("wrong identity and cross project never consume or commit a receipt",async()=>{
    const t=makeT();await seed(t);
    const args={orgId:ORG,projectId:"p1",expectedUserId:"another-user",expectedVersionId:versionIdFor("p1",ORG),operationId:"synthetic-operation",raw:"A-1",operation:"return" as const,condition:"GOOD" as const,notes:"",effect:{lineItemId:"li1",assetId:"a1"}};
    await expect(t.withIdentity(asUser(ORG)).mutation(api.scanIntake.commit,args)).rejects.toThrow(/identity/i);
    await expect(t.withIdentity(asUser(ORG)).mutation(api.scanIntake.commit,{...args,expectedUserId:USER,projectId:"other"})).rejects.toThrow(/Project/);
    expect(await t.run(ctx=>ctx.db.query("scanReceipts").collect())).toHaveLength(0);
  });
  test("scan replay is a browser-user operation, not a service or agent API",async()=>{
    const t=makeT();await seed(t);
    await expect(t.withIdentity({...asUser(ORG),akid:"synthetic-key"}).query(api.scanIntake.verifyContext,{orgId:ORG,projectId:"p1",expectedUserId:USER,operation:"return"})).rejects.toThrow(/browser user/);
  });

  test("existing blocking-comment conflict rolls back fulfillment and receipt together",async()=>{
    const t=makeT();await seed(t);
    await t.run(async ctx=>{await ctx.db.insert("commentThreads",{orgId:ORG,entityType:"project",entityId:"p1",projectId:"p1",status:"open",isBlocking:true,createdBy:USER,createdByName:"Synthetic",createdAt:NOW,updatedAt:NOW});});
    await expect(t.withIdentity(asUser(ORG)).mutation(api.scanIntake.commit,{orgId:ORG,projectId:"p1",expectedUserId:USER,expectedVersionId:versionIdFor("p1",ORG),operationId:"synthetic-blocked",raw:"A-1",operation:"deploy",condition:"GOOD",notes:"",effect:{lineItemId:"li1",assetId:"a1"}})).rejects.toThrow(/blocking comment/i);
    expect(await t.run(ctx=>ctx.db.query("scanReceipts").collect())).toHaveLength(0);
    expect((await unitById(t,"u1"))?.status).toBe("CHECKED_OUT");
  });

  test("concurrent duplicate replay commits a single receipt and audit",async()=>{
    const t=makeT();await seed(t);const user=t.withIdentity(asUser(ORG));
    const args={orgId:ORG,projectId:"p1",expectedUserId:USER,expectedVersionId:versionIdFor("p1",ORG),operationId:"synthetic-concurrent",raw:"A-1",operation:"return" as const,condition:"GOOD" as const,notes:"",effect:{lineItemId:"li1",assetId:"a1"}};
    await Promise.all([user.mutation(api.scanIntake.commit,args),user.mutation(api.scanIntake.commit,args)]);
    expect(await t.run(ctx=>ctx.db.query("scanReceipts").collect())).toHaveLength(1);
    const audits=await t.run(ctx=>ctx.db.query("activityLogs").withIndex("by_cuid",q=>q.eq("id",args.operationId)).collect());expect(audits).toHaveLength(1);
  });

});

async function seedKit(t: T, opts?: { bulk?: boolean }) {
  await t.run(async (ctx) => {
    // #1228 — createKitLineItemCore now resolves the project's live version.
    await ctx.db.insert("projects", { id: "p1", organizationId: ORG, projectNumber: "P1", name: "Gig", status: "CONFIRMED", isTemplate: false, liveVersionId: "v-p1", createdAt: NOW, updatedAt: NOW });
    await ctx.db.insert("projectVersions", { id: "v-p1", organizationId: ORG, projectId: "p1", number: 1, contentState: "ready", createdAt: NOW, createdById: "u1" });
    await ctx.db.insert("kits", { id: "k1", organizationId: ORG, assetTag: "KIT-1", name: "Lighting", status: "AVAILABLE", condition: "GOOD", isActive: true, createdAt: NOW, updatedAt: NOW });
    await ctx.db.insert("models", { id: "m1", organizationId: ORG, name: "PAR", createdAt: NOW, updatedAt: NOW });
    await ctx.db.insert("assets", { id: "a1", organizationId: ORG, modelId: "m1", assetTag: "A-1", status: "AVAILABLE", condition: "GOOD", isActive: true, createdAt: NOW, updatedAt: NOW });
    await ctx.db.insert("kitSerializedItems", { id: "ks1", organizationId: ORG, kitId: "k1", assetId: "a1", addedById: USER });
    if (opts?.bulk) {
      await ctx.db.insert("bulkAssets", { id: "b1", organizationId: ORG, modelId: "m1", assetTag: "B-1", availableQuantity: 10, totalQuantity: 10, isActive: true });
      await ctx.db.insert("kitBulkItems", { id: "kb1", organizationId: ORG, kitId: "k1", bulkAssetId: "b1", quantity: 3, addedById: USER });
    }
  });
  await t.withIdentity(SERVICE).mutation(api.projectLineItems.createKitLineItem, { id: "kl1", organizationId: ORG, projectId: "p1", kitId: "k1", pricingMode: "KIT_PRICE", now: NOW });
}


test('durable kit Return All preserves missing condition, notes, receipt and live-version parent',async()=>{
 const t=makeT();await member(t,'member');await seedKit(t,{bulk:true});await coKit(t);
 const args={orgId:ORG,projectId:'p1',expectedUserId:USER,expectedVersionId:'v-p1',operationId:'kit-all',raw:'KIT-1',operation:'return' as const,condition:'MISSING' as const,notes:'Captured missing case',effect:{kitId:'k1',lineItemId:'kl1',kitDecision:'all' as const}};
 const user=t.withIdentity(asUser(ORG));
 expect(await user.mutation(api.scanIntake.commit,args)).toEqual({confirmed:true});
 expect(await user.mutation(api.scanIntake.commit,args)).toEqual({confirmed:true});
 expect((await assetById(t,'a1'))?.status).toBe('LOST');
 const logs=await t.run(ctx=>ctx.db.query('assetScanLogs').collect());expect(JSON.stringify(logs)).toContain('Captured missing case');
 const log=await logById(t,'kit-all');expect(JSON.stringify(log)).toContain('Captured missing case');
 expect(await t.run(ctx=>ctx.db.query('scanReceipts').collect())).toHaveLength(1);
});
test('durable kit verified subset returns native units and leaves other members deployed',async()=>{
 const t=makeT();await member(t,'member');await seedKit(t,{bulk:true});await coKit(t);
 const children=await t.run(ctx=>ctx.db.query('projectLineItems').withIndex('by_parentLineItemId',q=>q.eq('parentLineItemId','kl1')).collect());
 const serial=children.find(c=>c.assetId==='a1')!;const bulk=children.find(c=>c.bulkAssetId==='b1')!;
 const args={orgId:ORG,projectId:'p1',expectedUserId:USER,expectedVersionId:'v-p1',operationId:'kit-partial',raw:'KIT-1',operation:'return' as const,condition:'DAMAGED' as const,notes:'Dented',effect:{kitId:'k1',lineItemId:'kl1',kitDecision:'verified' as const,verifiedLineItemIds:[serial.id]}};
 const user=t.withIdentity(asUser(ORG));await user.mutation(api.scanIntake.commit,args);await user.mutation(api.scanIntake.commit,args);
 expect((await assetById(t,'a1'))?.status).toBe('IN_MAINTENANCE');
 expect((await lineById(t,bulk.id))?.status).toBe('CHECKED_OUT');
 const units=await t.run(ctx=>ctx.db.query('projectLineItemUnits').withIndex('by_lineItemId',q=>q.eq('lineItemId',serial.id)).collect());
 expect(units).toHaveLength(1);expect(units.every(u=>u.status==='RETURNED' && u.returnCondition==='DAMAGED' && u.returnNotes==='Dented')).toBe(true);
 expect((await lineById(t,'kl1'))?.status).toBe('CHECKED_OUT');
 expect(JSON.stringify(await logById(t,'kit-partial:0'))).toContain('Dented');
});
async function coKit(t:T){await t.withIdentity(SERVICE).mutation(api.warehouseOps.checkoutKit,{organizationId:ORG,projectId:'p1',userId:USER,kitId:'k1',now:NOW});}
test('kit receipt mutates the live parent when retained older kit rows precede it',async()=>{
 const t=makeT();await member(t,'member');await seedKit(t);
 await t.run(async ctx=>{const p=await ctx.db.query('projects').first();await ctx.db.patch(p!._id,{liveVersionId:'v2'});await ctx.db.insert('projectVersions',{id:'v2',organizationId:ORG,projectId:'p1',number:2,contentState:'ready',createdAt:NOW,createdById:USER});});
 await t.run(async ctx=>{
  for(let i=0;i<150;i++) await ctx.db.insert('projectLineItems',baseLine(`kit-distractor-${i}`,{kitId:'k1',organizationId:i%4===0?OTHER:ORG,projectId:i%4===1?'other':'p1',versionId:i%4===2?'old':'v2',isKitChild:i%4===3}));
 });
 await t.withIdentity(SERVICE).mutation(api.projectLineItems.createKitLineItem,{id:'kl2',organizationId:ORG,projectId:'p1',kitId:'k1',pricingMode:'KIT_PRICE',now:NOW});
 await coKit(t);
 await t.withIdentity(asUser(ORG)).mutation(api.scanIntake.commit,{orgId:ORG,projectId:'p1',expectedUserId:USER,expectedVersionId:'v2',operationId:'live-kit',raw:'KIT-1',operation:'return',condition:'GOOD',notes:'',effect:{kitId:'k1',lineItemId:'kl2',kitDecision:'all'}});
 expect((await lineById(t,'kl2'))?.status).toBe('RETURNED');
 expect((await lineById(t,'kl1'))?.status).not.toBe('RETURNED');
});

test.each(['deploy','return'] as const)('same-version duplicate parents reject %s atomically with native units, including nested rows',async operation=>{
 const t=makeT();await member(t,'member');await seedKit(t,{bulk:true});
 if(operation==='return') await coKit(t);
 const before=await t.run(ctx=>ctx.db.query('projectLineItemUnits').collect());
 expect(before.length).toBeGreaterThan(0);
 await t.run(async ctx=>{
  const parent=await ctx.db.query('projectLineItems').withIndex('by_cuid',q=>q.eq('id','kl1')).unique();
  const {_id,_creationTime,...fields}=parent!;
  for(let i=0;i<150;i++) await ctx.db.insert('projectLineItems',{...fields,id:`other-${i}`,lineageId:`other-${i}`,organizationId:i%3===0?OTHER:ORG,projectId:i%3===1?'other':'p1',versionId:i%3===2?'old':'v-p1'});
  await ctx.db.insert('projectLineItems',{...fields,id:'duplicate-B',lineageId:'duplicate-B'});
  await ctx.db.insert('projectLineItems',{...fields,id:'nested',lineageId:'nested',isKitChild:true,parentLineItemId:'duplicate-B'});
 });
 await expect(t.withIdentity(asUser(ORG)).mutation(api.scanIntake.commit,{orgId:ORG,projectId:'p1',expectedUserId:USER,expectedVersionId:'v-p1',operationId:'duplicate-op',raw:'KIT-1',operation,condition:'GOOD',notes:'B only',effect:{kitId:'k1',lineItemId:'duplicate-B',kitDecision:'all'}})).rejects.toThrow(/ambiguous/i);
 expect(await t.run(ctx=>ctx.db.query('scanReceipts').collect())).toHaveLength(0);
 expect(await t.run(ctx=>ctx.db.query('projectLineItemUnits').collect())).toEqual(before);
 expect((await lineById(t,'kl1'))?.status).toBe((await lineById(t,'duplicate-B'))?.status);
});

test('durable accessory decision narrows native checkout and atomically receipts override on retry',async()=>{
 const t=makeT();await member(t,'member');await seedProject(t);await seedModelAsset(t,ORG,'AVAILABLE');
 await t.run(async ctx=>{
  await ctx.db.insert('projectLineItems',baseLine('li1',{modelId:'m1',assetId:'a1',prepStatus:'PACKED'}));
  await ctx.db.insert('projectLineItemUnits',{id:'u1',organizationId:ORG,lineItemId:'li1',ordinal:0,assetId:'a1',quantity:1,status:'PREPPED',createdAt:NOW,updatedAt:NOW});
  for(let i=0;i<150;i++) await ctx.db.insert('projectLineItems',baseLine(`unrelated-${i}`,{parentLineItemId:'li1',childKind:'ACCESSORY',versionId:'old',assetId:'a1'}));
  await ctx.db.insert('projectLineItems',baseLine('acc',{modelId:'m1',isKitChild:true,parentLineItemId:'li1',childKind:'ACCESSORY',accessoryInclusion:'DEFAULT'}));
 });
 const args={orgId:ORG,projectId:'p1',expectedUserId:USER,expectedVersionId:versionIdFor('p1',ORG),operationId:'accessory-op',raw:'A-1',operation:'deploy' as const,condition:'GOOD' as const,notes:'captured',effect:{lineItemId:'li1',assetId:'a1',accessoryDecision:'override' as const,includeAccessoryIds:[],skippedAccessories:[{accessoryLineItemId:'acc',tier:'DEFAULT' as const,reason:'Left in warehouse'}]}};
 const user=t.withIdentity(asUser(ORG));await user.mutation(api.scanIntake.commit,args);await user.mutation(api.scanIntake.commit,args);
 expect((await unitById(t,'u1'))?.status).toBe('CHECKED_OUT');
 expect((await lineById(t,'acc'))?.status).not.toBe('CHECKED_OUT');
 expect((await lineById(t,'acc'))?.notes).toContain('Left in warehouse');
 expect(await t.run(ctx=>ctx.db.query('scanReceipts').collect())).toHaveLength(1);
 const logs=await t.run(ctx=>ctx.db.query('activityLogs').collect());expect(logs.filter(l=>l.summary?.includes('Left in warehouse'))).toHaveLength(1);
 await expect(user.mutation(api.scanIntake.commit,{...args,effect:{...args.effect,includeAccessoryIds:['acc']}})).rejects.toThrow(/different scan/);
});

test.each(['all','verified'] as const)('nested native kit return %s preserves descendant targeting with a same-kit nested row',async decision=>{
 const t=makeT();await member(t,'member');await seedKit(t);
 await t.run(async ctx=>{
  const child=await ctx.db.query('projectLineItems').withIndex('by_parentLineItemId',q=>q.eq('parentLineItemId','kl1')).first();
  await ctx.db.insert('kits',{id:'outer',organizationId:ORG,assetTag:'OUTER',name:'Outer',status:'AVAILABLE',condition:'GOOD',isActive:true,createdAt:NOW,updatedAt:NOW});
  await ctx.db.insert('projectLineItems',baseLine('outer-parent',{versionId:'v-p1',kitId:'outer'}));
  const parent=await ctx.db.query('projectLineItems').withIndex('by_cuid',q=>q.eq('id','kl1')).unique();
  await ctx.db.patch(parent!._id,{parentLineItemId:'outer-parent',isKitChild:true});
  expect(child).toBeTruthy();
 });
 await t.withIdentity(SERVICE).mutation(api.warehouseOps.checkoutKit,{organizationId:ORG,projectId:'p1',userId:USER,kitId:'outer',now:NOW});
 const children=await t.run(ctx=>ctx.db.query('projectLineItems').withIndex('by_parentLineItemId',q=>q.eq('parentLineItemId','kl1')).collect());
 const args={orgId:ORG,projectId:'p1',expectedUserId:USER,expectedVersionId:'v-p1',operationId:'nested-op',raw:'OUTER',operation:'return' as const,condition:'DAMAGED' as const,notes:'nested dent',effect:{kitId:'outer',lineItemId:'outer-parent',kitDecision:decision,verifiedLineItemIds:decision==='verified'?[children[0].id]:undefined}};
 const user=t.withIdentity(asUser(ORG));await user.mutation(api.scanIntake.commit,args);await user.mutation(api.scanIntake.commit,args);
 const units=await t.run(ctx=>ctx.db.query('projectLineItemUnits').withIndex('by_lineItemId',q=>q.eq('lineItemId',children[0].id)).collect());
 expect(units.length).toBeGreaterThan(0);expect(units.every(u=>u.status==='RETURNED' && u.returnCondition==='DAMAGED')).toBe(true);
 expect((await lineById(t,'outer-parent'))?.status).toBe(decision==='all'?'RETURNED':'CHECKED_OUT');
 expect(await t.run(ctx=>ctx.db.query('scanReceipts').collect())).toHaveLength(1);
});

test('accessory override cannot write notes outside captured parent and version',async()=>{
 const t=makeT();await member(t,'member');await seedProject(t);await seedModelAsset(t,ORG,'AVAILABLE');
 await t.run(async ctx=>{
  await ctx.db.insert('projectLineItems',baseLine('li1',{assetId:'a1',modelId:'m1',prepStatus:'PACKED'}));
  await ctx.db.insert('projectLineItems',baseLine('foreign',{versionId:'v-old',isKitChild:true,parentLineItemId:'li1',childKind:'ACCESSORY'}));
 });
 await expect(t.withIdentity(asUser(ORG)).mutation(api.scanIntake.commit,{orgId:ORG,projectId:'p1',expectedUserId:USER,expectedVersionId:versionIdFor('p1',ORG),operationId:'foreign-accessory',raw:'A-1',operation:'deploy',condition:'GOOD',notes:'',effect:{lineItemId:'li1',assetId:'a1',accessoryDecision:'override',includeAccessoryIds:[],skippedAccessories:[{accessoryLineItemId:'foreign',tier:'DEFAULT',reason:'skip'}]}})).rejects.toThrow(/captured parent version/);
 expect((await lineById(t,'foreign'))?.notes).toBeUndefined();
 expect((await assetById(t,'a1'))?.status).toBe('AVAILABLE');
 expect(await t.run(ctx=>ctx.db.query('scanReceipts').collect())).toHaveLength(0);
});


test("scan validation never materializes unbounded candidate collections", () => {
 const source = readFileSync(new URL('./scanIntake.ts', import.meta.url), 'utf8');
 expect(source).not.toMatch(/\.collect\s*\(/);
});

test.each(['organizationId','projectId','versionId','parentLineItemId','childKind'] as const)('accessory identity checks reject mismatched %s for serial, bulk and skips',async field=>{
 const t=makeT();await member(t,'member');await seedProject(t);await seedModelAsset(t,ORG,'AVAILABLE');
 await t.run(async ctx=>{
  await ctx.db.insert('projectLineItems',baseLine('li1',{assetId:'a1',modelId:'m1',prepStatus:'PACKED'}));
  await ctx.db.insert('projectLineItems',baseLine('invalid',{parentLineItemId:'li1',childKind:'ACCESSORY',assetId:'serial-other',bulkAssetId:'bulk-other',[field]:field==='childKind'?'KIT':'other'}));
 });
 const args={orgId:ORG,projectId:'p1',expectedUserId:USER,expectedVersionId:versionIdFor('p1',ORG),operationId:'scope-test',raw:'A-1',operation:'deploy' as const,condition:'GOOD' as const,notes:''};
 for(const includeAccessoryIds of [['serial-other'],['bulk-other']])
  await expect(t.withIdentity(asUser(ORG)).mutation(api.scanIntake.commit,{...args,effect:{lineItemId:'li1',accessoryDecision:'verified',includeAccessoryIds}})).rejects.toThrow(/captured parent version/);
 await expect(t.withIdentity(asUser(ORG)).mutation(api.scanIntake.commit,{...args,effect:{lineItemId:'li1',accessoryDecision:'override',skippedAccessories:[{accessoryLineItemId:'invalid',tier:'DEFAULT',reason:'skip'}]}})).rejects.toThrow(/captured parent version/);
 expect(await t.run(ctx=>ctx.db.query('scanReceipts').collect())).toHaveLength(0);
 expect((await assetById(t,'a1'))?.status).toBe('AVAILABLE');
 expect((await lineById(t,'invalid'))?.notes).toBeUndefined();
});

test.each(['assetId','bulkAssetId'] as const)('valid accessory %s after many wrong-scope matches reaches native conflict gate',async field=>{
 const t=makeT();await member(t,'member');await seedProject(t);await seedModelAsset(t,ORG,'AVAILABLE');
 await t.run(async ctx=>{
  await ctx.db.insert('projectLineItems',baseLine('li1',{assetId:'a1',modelId:'m1',prepStatus:'PACKED'}));
  for(let i=0;i<150;i++) await ctx.db.insert('projectLineItems',baseLine(`distractor-${i}`,{parentLineItemId:'li1',childKind:'ACCESSORY',versionId:'old',[field]:'selected'}));
  await ctx.db.insert('projectLineItems',baseLine('selected-line',{parentLineItemId:'li1',childKind:'ACCESSORY',[field]:'selected'}));
  await ctx.db.insert('commentThreads',{orgId:ORG,entityType:'project',entityId:'p1',projectId:'p1',status:'open',isBlocking:true,createdBy:USER,createdByName:'Synthetic',createdAt:NOW,updatedAt:NOW});
 });
 await expect(t.withIdentity(asUser(ORG)).mutation(api.scanIntake.commit,{orgId:ORG,projectId:'p1',expectedUserId:USER,expectedVersionId:versionIdFor('p1',ORG),operationId:'valid-accessory',raw:'A-1',operation:'deploy',condition:'GOOD',notes:'',effect:{lineItemId:'li1',accessoryDecision:'verified',includeAccessoryIds:['selected']}})).rejects.toThrow(/blocking comment/i);
 expect(await t.run(ctx=>ctx.db.query('scanReceipts').collect())).toHaveLength(0);
});
