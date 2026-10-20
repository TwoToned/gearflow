import type { FilterBuilder } from 'convex/server';
import type { DataModel } from './_generated/dataModel';
import type { AgentOpsAnnotations } from './lib/agentOps';
import { v, ConvexError, type Infer } from 'convex/values';
import { mutation, query } from './_generated/server';
import { api } from './_generated/api';
import { getAuthContext, requireOrgPermission } from './lib/auth';
import type { MutationCtx, QueryCtx } from './_generated/server';
export const agentOps: AgentOpsAnnotations = {
    verifyContext: { agentAccess: 'denied', reason: 'Device-local physical scan replay is bound to the capturing browser user; service and agent tokens are rejected.' },
    commit: { agentAccess: 'denied', reason: 'Device-local physical scan replay is bound to the capturing browser user; service and agent tokens are rejected.' },
};
const scopeArgs = { orgId: v.string(), projectId: v.string(), expectedUserId: v.string(), operation: v.union(v.literal('deploy'), v.literal('return')) };
async function verify(ctx: MutationCtx | QueryCtx, a: {
    orgId: string;
    projectId: string;
    expectedUserId: string;
    operation: 'deploy' | 'return';
}) {
    const auth = await getAuthContext(ctx);
    // expectedUserId confines replay to its captured identity; it NEVER grants authority.
    if (!auth || auth.kind !== 'user')
        throw new ConvexError('Scan replay requires a browser user identity.');
    if (auth.userId !== a.expectedUserId)
        throw new ConvexError('Scan identity changed. Sign in with the account that captured it.');
    await requireOrgPermission(ctx, a.orgId, 'warehouse', a.operation === 'deploy' ? 'check_out' : 'check_in');
    const project = await ctx.db.query('projects').withIndex('by_cuid', q => q.eq('id', a.projectId)).unique();
    if (!project || project.organizationId !== a.orgId)
        throw new ConvexError('Project not found');
    return auth.userId;
}
export const verifyContext = query({ args: scopeArgs, returns: v.boolean(), handler: async (ctx, a) => { await verify(ctx, a); return true; } });
const commitArgs = v.object({ ...scopeArgs, expectedVersionId: v.string(), operationId: v.string(), raw: v.string(), condition: v.union(v.literal('GOOD'), v.literal('DAMAGED'), v.literal('MISSING')), notes: v.string(), effect: v.object({ lineItemId: v.optional(v.string()), assetId: v.optional(v.string()), kitId: v.optional(v.string()), accessoryDecision: v.optional(v.union(v.literal("override"), v.literal("verified"), v.literal("all"))), includeAccessoryIds: v.optional(v.array(v.string())), skippedAccessories: v.optional(v.array(v.object({accessoryLineItemId:v.string(),tier:v.union(v.literal("DEFAULT"),v.literal("OPTIONAL")),reason:v.string()}))), kitDecision: v.optional(v.union(v.literal("all"), v.literal("verified"))), verifiedLineItemIds: v.optional(v.array(v.string())) }) });
type CommitArgs = Infer<typeof commitArgs>;
type Common = { orgId: string; projectId: string; actor: { userId: string; userName: string }; now: number };

function validateScan(a: CommitArgs) {
    if (!a.operationId || a.operationId.length > 128 || !a.raw.trim() || a.raw.length > 512 || a.notes.length > 5000)
        throw new ConvexError('Invalid scan');
}

function scanFingerprint(a: CommitArgs) {
    return JSON.stringify([a.projectId, a.expectedVersionId, a.operation, a.raw, a.condition, a.notes, a.effect.lineItemId ?? null, a.effect.assetId ?? null, a.effect.kitId ?? null, a.effect.kitDecision ?? null, a.effect.verifiedLineItemIds ?? null, a.effect.accessoryDecision ?? null, a.effect.includeAccessoryIds ?? null, a.effect.skippedAccessories ?? null]);
}

async function validateProjectVersion(ctx: MutationCtx, a: CommitArgs) {
    const project = await ctx.db.query('projects').withIndex('by_cuid', q => q.eq('id', a.projectId)).unique();
    if (!a.expectedVersionId || project?.liveVersionId !== a.expectedVersionId)
        throw new ConvexError('Project version changed. Review this saved scan.');
}

async function validateCapturedLine(ctx: MutationCtx, a: CommitArgs) {
    if (a.effect.lineItemId) {
        const line = await ctx.db.query('projectLineItems').withIndex('by_cuid', q => q.eq('id', a.effect.lineItemId!)).unique();
        if (!line || line.organizationId !== a.orgId || line.projectId !== a.projectId || line.versionId !== a.expectedVersionId)
            throw new ConvexError('Scan line does not belong to the expected project version');
    }
}

async function validatedKitParent(ctx: MutationCtx, a: CommitArgs) {
    const parent = a.effect.lineItemId && await ctx.db.query('projectLineItems').withIndex('by_cuid', q => q.eq('id', a.effect.lineItemId!)).unique();
    if (!parent || parent.kitId !== a.effect.kitId || parent.isKitChild)
        throw new ConvexError('Kit parent requires version-bound review');
    // Native whole-kit fulfillment resolves by kit identity. Refuse an
    // ambiguous live snapshot before any effects or receipt can commit.
    const candidates = await ctx.db.query('projectLineItems').withIndex('by_kitId', q => q.eq('kitId', a.effect.kitId!))
        .filter(q => q.and(q.eq(q.field('organizationId'), a.orgId), q.eq(q.field('projectId'), a.projectId), q.eq(q.field('versionId'), a.expectedVersionId), q.neq(q.field('isKitChild'), true))).take(2);
    if (candidates.length !== 1)
        throw new ConvexError('Ambiguous kit parents in this project version. Review duplicate allocations.');
    return parent;
}

async function validateKitChild(ctx: MutationCtx, a: CommitArgs, parentId: string, id: string) {
    let child = await ctx.db.query('projectLineItems').withIndex('by_cuid', q => q.eq('id', id)).unique();
    const seen = new Set<string>();
    while (child && child.id !== parentId) {
        if (seen.has(child.id) || child.organizationId !== a.orgId || child.projectId !== a.projectId || child.versionId !== a.expectedVersionId || !child.parentLineItemId)
            throw new ConvexError('Verified item is not in this kit version');
        seen.add(child.id);
        const ancestorId = child.parentLineItemId;
        child = await ctx.db.query('projectLineItems').withIndex('by_cuid', q => q.eq('id', ancestorId)).unique();
    }
    if (!child || id === parentId)
        throw new ConvexError('Verified item is not a kit child');
}

async function returnVerifiedKitItems(ctx: MutationCtx, a: CommitArgs, common: Common, parentId: string) {
    const ids = [...new Set(a.effect.verifiedLineItemIds ?? [])];
    if (!ids.length)
        throw new ConvexError('No verified kit items selected');
    for (const id of ids)
        await validateKitChild(ctx, a, parentId, id);
    await ctx.runMutation(api.warehouseWrites.checkInItems, { ...common, items: ids.map(lineItemId => ({ lineItemId, returnCondition: a.condition, notes: a.notes || undefined })), auditIds: ids.map((_, i) => `${a.operationId}:${i}`) });
}

async function commitKit(ctx: MutationCtx, a: CommitArgs, common: Common) {
    const parent = await validatedKitParent(ctx, a);
    if (a.operation === 'return' && a.effect.kitDecision === 'verified') {
        await returnVerifiedKitItems(ctx, a, common, parent.id);
    }
    else {
        if (a.operation === 'return' && a.effect.kitDecision !== 'all')
            throw new ConvexError('Kit requires review decision');
        if (a.operation === 'deploy')
            await ctx.runMutation(api.warehouseWrites.checkOutKit, { ...common, kitId: a.effect.kitId!, notes: a.notes || undefined, auditId: a.operationId });
        else
            await ctx.runMutation(api.warehouseWrites.checkInKit, { ...common, kitId: a.effect.kitId!, returnCondition: a.condition, notes: a.notes || undefined, auditId: a.operationId });
    }
}

async function validateAccessories(ctx: MutationCtx, a: CommitArgs) {
    if (a.operation !== 'deploy')
        throw new ConvexError('Accessory decision requires deploy');
    // Validate each requested identity without loading or truncating siblings.
    const inScope = (q: FilterBuilder<DataModel['projectLineItems']>) => q.and(q.eq(q.field('parentLineItemId'), a.effect.lineItemId!), q.eq(q.field('organizationId'), a.orgId), q.eq(q.field('projectId'), a.projectId), q.eq(q.field('versionId'), a.expectedVersionId), q.eq(q.field('childKind'), 'ACCESSORY'));
    for (const id of a.effect.includeAccessoryIds ?? []) {
        const accessory = await ctx.db.query('projectLineItems').withIndex('by_assetId', q => q.eq('assetId', id)).filter(inScope).first()
            ?? await ctx.db.query('projectLineItems').withIndex('by_bulkAssetId', q => q.eq('bulkAssetId', id)).filter(inScope).first();
        if (!accessory)
            throw new ConvexError('Accessory is outside the captured parent version');
    }
    for (const skipped of a.effect.skippedAccessories ?? []) {
        const accessory = await ctx.db.query('projectLineItems').withIndex('by_cuid', q => q.eq('id', skipped.accessoryLineItemId)).filter(inScope).first();
        if (!accessory)
            throw new ConvexError('Skipped accessory is outside the captured parent version');
    }
}

async function commitLine(ctx: MutationCtx, a: CommitArgs, common: Common) {
    if (a.effect.accessoryDecision) {
        await validateAccessories(ctx, a);
        if (a.effect.accessoryDecision === 'override')
            await ctx.runMutation(api.warehouseWrites.logAccessoryCheckoutOverride, { ...common, parentName: a.effect.lineItemId!, skipped: a.effect.skippedAccessories ?? [] });
    }
    const item = { lineItemId: a.effect.lineItemId!, assetId: a.effect.assetId, includeAccessoryIds: a.effect.includeAccessoryIds, notes: a.notes || undefined };
    if (a.operation === 'deploy')
        await ctx.runMutation(api.warehouseWrites.checkOutItems, { ...common, items: [item], includeAccessories: true, auditIds: [a.operationId] });
    else
        await ctx.runMutation(api.warehouseWrites.checkInItems, { ...common, items: [{ ...item, returnCondition: a.condition }], auditIds: [a.operationId] });
}

export const commit = mutation({
    args: commitArgs.fields,
    returns: v.object({ confirmed: v.literal(true) }),
    handler: async (ctx, a): Promise<{
        confirmed: true;
    }> => {
        const userId = await verify(ctx, a);
        validateScan(a);
        const fingerprint = scanFingerprint(a);
        const prior = await ctx.db.query('scanReceipts').withIndex('by_orgId_and_userId_and_operationId', q => q.eq('orgId', a.orgId).eq('userId', userId).eq('operationId', a.operationId)).unique();
        if (prior) {
            if (prior.fingerprint !== fingerprint)
                throw new ConvexError('Operation ID already belongs to a different scan');
            return { confirmed: true };
        }
        await validateProjectVersion(ctx, a);
        await validateCapturedLine(ctx, a);
        const common = { orgId: a.orgId, projectId: a.projectId, actor: { userId, userName: userId }, now: Date.now() };
        // Nested mutations are subtransactions of this transaction. Fulfillment, its
        // permission/conflict gates, audit and the receipt either all commit or roll back.
        if (a.effect.kitId)
            await commitKit(ctx, a, common);
        else if (a.effect.lineItemId)
            await commitLine(ctx, a, common);
        else
            throw new ConvexError('Scan requires review before committing');
        await ctx.db.insert('scanReceipts', { orgId: a.orgId, userId, projectId: a.projectId, operationId: a.operationId, fingerprint, confirmedAt: Date.now() });
        return { confirmed: true };
    }
});
