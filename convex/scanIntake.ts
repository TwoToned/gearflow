import type { AgentOpsAnnotations } from './lib/agentOps';
import { v, ConvexError } from 'convex/values';
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
export const commit = mutation({
    args: { ...scopeArgs, expectedVersionId: v.string(), operationId: v.string(), raw: v.string(), condition: v.union(v.literal('GOOD'), v.literal('DAMAGED'), v.literal('MISSING')), notes: v.string(), effect: v.object({ lineItemId: v.optional(v.string()), assetId: v.optional(v.string()), kitId: v.optional(v.string()), accessoryDecision: v.optional(v.union(v.literal("override"), v.literal("verified"), v.literal("all"))), includeAccessoryIds: v.optional(v.array(v.string())), skippedAccessories: v.optional(v.array(v.object({accessoryLineItemId:v.string(),tier:v.union(v.literal("DEFAULT"),v.literal("OPTIONAL")),reason:v.string()}))), kitDecision: v.optional(v.union(v.literal("all"), v.literal("verified"))), verifiedLineItemIds: v.optional(v.array(v.string())) }) },
    returns: v.object({ confirmed: v.literal(true) }),
    handler: async (ctx, a): Promise<{
        confirmed: true;
    }> => {
        const userId = await verify(ctx, a);
        if (!a.operationId || a.operationId.length > 128 || !a.raw.trim() || a.raw.length > 512 || a.notes.length > 5000)
            throw new ConvexError('Invalid scan');
        const fingerprint = JSON.stringify([a.projectId, a.expectedVersionId, a.operation, a.raw, a.condition, a.notes, a.effect.lineItemId ?? null, a.effect.assetId ?? null, a.effect.kitId ?? null, a.effect.kitDecision ?? null, a.effect.verifiedLineItemIds ?? null, a.effect.accessoryDecision ?? null, a.effect.includeAccessoryIds ?? null, a.effect.skippedAccessories ?? null]);
        const prior = await ctx.db.query('scanReceipts').withIndex('by_orgId_and_userId_and_operationId', q => q.eq('orgId', a.orgId).eq('userId', userId).eq('operationId', a.operationId)).unique();
        if (prior) {
            if (prior.fingerprint !== fingerprint)
                throw new ConvexError('Operation ID already belongs to a different scan');
            return { confirmed: true };
        }
        const project = await ctx.db.query('projects').withIndex('by_cuid', q => q.eq('id', a.projectId)).unique();
        if (!a.expectedVersionId || project?.liveVersionId !== a.expectedVersionId)
            throw new ConvexError('Project version changed. Review this saved scan.');
        if (a.effect.lineItemId) {
            const line = await ctx.db.query('projectLineItems').withIndex('by_cuid', q => q.eq('id', a.effect.lineItemId!)).unique();
            if (!line || line.organizationId !== a.orgId || line.projectId !== a.projectId || line.versionId !== a.expectedVersionId)
                throw new ConvexError('Scan line does not belong to the expected project version');
        }
        const common = { orgId: a.orgId, projectId: a.projectId, actor: { userId, userName: userId }, now: Date.now() };
        // Nested mutations are subtransactions of this transaction. Fulfillment, its
        // permission/conflict gates, audit and the receipt either all commit or roll back.
        if (a.effect.kitId) {
            const parent = a.effect.lineItemId && await ctx.db.query('projectLineItems').withIndex('by_cuid', q => q.eq('id', a.effect.lineItemId!)).unique();
            if (!parent || parent.kitId !== a.effect.kitId || parent.isKitChild)
                throw new ConvexError('Kit parent requires version-bound review');
            // Native whole-kit fulfillment resolves by kit identity. Refuse an
            // ambiguous live snapshot before any effects or receipt can commit.
            const candidates = await ctx.db.query('projectLineItems').withIndex('by_kitId', q => q.eq('kitId', a.effect.kitId!)).collect();
            if (candidates.filter(line => line.organizationId === a.orgId && line.projectId === a.projectId && line.versionId === a.expectedVersionId && !line.isKitChild).length !== 1)
                throw new ConvexError('Ambiguous kit parents in this project version. Review duplicate allocations.');
            if (a.operation === 'return' && a.effect.kitDecision === 'verified') {
                const ids = [...new Set(a.effect.verifiedLineItemIds ?? [])];
                if (!ids.length) throw new ConvexError('No verified kit items selected');
                for (const id of ids) {
                    let child = await ctx.db.query('projectLineItems').withIndex('by_cuid', q => q.eq('id', id)).unique();
                    const seen = new Set<string>();
                    while (child && child.id !== parent.id) {
                        if (seen.has(child.id) || child.organizationId !== a.orgId || child.projectId !== a.projectId || child.versionId !== a.expectedVersionId || !child.parentLineItemId)
                            throw new ConvexError('Verified item is not in this kit version');
                        seen.add(child.id);
                        const parentId = child.parentLineItemId;
                        child = await ctx.db.query('projectLineItems').withIndex('by_cuid', q => q.eq('id', parentId)).unique();
                    }
                    if (!child || id === parent.id) throw new ConvexError('Verified item is not a kit child');
                }
                await ctx.runMutation(api.warehouseWrites.checkInItems, { ...common, items: ids.map(lineItemId => ({lineItemId, returnCondition:a.condition, notes:a.notes || undefined})), auditIds:ids.map((_, i) => `${a.operationId}:${i}`) });
            } else {
            if (a.operation === 'return' && a.effect.kitDecision !== 'all') throw new ConvexError('Kit requires review decision');
            if (a.operation === 'deploy')
                await ctx.runMutation(api.warehouseWrites.checkOutKit, { ...common, kitId: a.effect.kitId, notes: a.notes || undefined, auditId: a.operationId });
            else
                await ctx.runMutation(api.warehouseWrites.checkInKit, { ...common, kitId: a.effect.kitId, returnCondition: a.condition, notes: a.notes || undefined, auditId: a.operationId });
            }
        }
        else if (a.effect.lineItemId) {
            if (a.effect.accessoryDecision) {
                if (a.operation !== 'deploy') throw new ConvexError('Accessory decision requires deploy');
                const children = await ctx.db.query('projectLineItems').withIndex('by_parentLineItemId', q => q.eq('parentLineItemId', a.effect.lineItemId!)).collect();
                const accessories = children.filter(c => c.organizationId === a.orgId && c.projectId === a.projectId && c.versionId === a.expectedVersionId && c.childKind === 'ACCESSORY');
                if ((a.effect.includeAccessoryIds ?? []).some(id => !accessories.some(c => c.assetId === id || c.bulkAssetId === id)))
                    throw new ConvexError('Accessory is outside the captured parent version');
                for (const skipped of a.effect.skippedAccessories ?? []) {
                    if (!accessories.some(c => c.id === skipped.accessoryLineItemId)) throw new ConvexError('Skipped accessory is outside the captured parent version');
                }
                if (a.effect.accessoryDecision === 'override')
                    await ctx.runMutation(api.warehouseWrites.logAccessoryCheckoutOverride, {...common, parentName:a.effect.lineItemId, skipped:a.effect.skippedAccessories ?? []});
            }
            const item = { lineItemId: a.effect.lineItemId, assetId: a.effect.assetId, includeAccessoryIds:a.effect.includeAccessoryIds, notes: a.notes || undefined };
            if (a.operation === 'deploy')
                await ctx.runMutation(api.warehouseWrites.checkOutItems, { ...common, items: [item], includeAccessories: true, auditIds: [a.operationId] });
            else
                await ctx.runMutation(api.warehouseWrites.checkInItems, { ...common, items: [{ ...item, returnCondition: a.condition }], auditIds: [a.operationId] });
        }
        else
            throw new ConvexError('Scan requires review before committing');
        await ctx.db.insert('scanReceipts', { orgId: a.orgId, userId, projectId: a.projectId, operationId: a.operationId, fingerprint, confirmedAt: Date.now() });
        return { confirmed: true };
    }
});
