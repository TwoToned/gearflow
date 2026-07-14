import { v, ConvexError } from "convex/values";
import { mutation } from "./_generated/server";
import { requireOrgPermission, resolveActor } from "./lib/auth";
import { assertWritesEnabled } from "./lib/writeGuard";
import { enforceBrowserWriteLimit } from "./lib/rateLimiter";
import { writeActivityLog } from "./lib/audit";
import * as enums from "./lib/validators";

/**
 * Native CUSTOM-FIELD-DEFINITION write mutations (Phase 3 browser-direct — replaces
 * the createCustomFieldDefinition/updateCustomFieldDefinition/deleteCustomFieldDefinition
 * server actions in src/server/custom-fields.ts). Gates on `orgSettings:update` (defining
 * fields is an org-configuration task). Each mutation is the standard shape: 4 guards
 * (assertWritesEnabled + enforceBrowserWriteLimit + requireOrgPermission + resolveActor)
 * + per-row org re-check + atomic audit. The settings form's zodResolver validates
 * before submit; the v.* arg validators enforce the shape at the boundary.
 *
 * `fieldKey` / `entityType` / `createdAt` are IMMUTABLE post-create — the update
 * mutation never patches them, matching the deleted action's carry-forward behaviour.
 * The @@unique([organizationId, entityType, fieldKey]) DB constraint (Convex has no
 * unique index) is re-implemented on create via the composite index.
 */

const actorValidator = v.object({ userId: v.string(), userName: v.string() });

// A fieldKey must be a stable, JSON-safe identifier (mirrors fieldKeyRegex in
// src/lib/validations/custom-field.ts — the Convex bundler can't import the zod module).
const FIELD_KEY_REGEX = /^[a-zA-Z][a-zA-Z0-9_]*$/;

/**
 * Re-enforce the customFieldDefinitionSchema invariants at the mutation boundary.
 * Client hooks run zod before calling, but this is now the PUBLIC write surface — a
 * direct caller could otherwise persist an empty label / malformed fieldKey / optionless
 * SELECT / over-long values. `checkKey` is false on update (fieldKey is immutable there).
 */
function assertValidDefinition(
  input: {
    label: string;
    fieldType: string;
    options: string[];
    helpText?: string;
    sortOrder: number;
    fieldKey?: string;
  },
  checkKey: boolean,
): void {
  // Raw-length checks (exact parity with the client zod, which does not trim).
  if (input.label.length < 1) throw new ConvexError("Label is required");
  if (input.label.length > 60) throw new ConvexError("Label must be 60 characters or fewer");
  if (checkKey) {
    const key = input.fieldKey ?? "";
    if (!key) throw new ConvexError("Key is required");
    if (key.length > 40) throw new ConvexError("Key must be 40 characters or fewer");
    if (!FIELD_KEY_REGEX.test(key)) {
      throw new ConvexError("Key must start with a letter; letters, numbers, underscores only");
    }
  }
  if (input.helpText !== undefined && input.helpText.length > 200) {
    throw new ConvexError("Help text must be 200 characters or fewer");
  }
  if (!Number.isInteger(input.sortOrder) || input.sortOrder < 0) {
    throw new ConvexError("Sort order must be a non-negative integer");
  }
  if (input.fieldType === "SELECT") {
    if (input.options.length === 0) throw new ConvexError("SELECT fields need at least one option");
    if (input.options.length > 50) throw new ConvexError("A field can have at most 50 options");
    for (const opt of input.options) {
      if (opt.length < 1 || opt.length > 80) {
        throw new ConvexError("Each option must be 1–80 characters");
      }
    }
  }
}

export const createNative = mutation({
  returns: v.object({ id: v.string() }),
  args: {
    id: v.string(),
    organizationId: v.string(),
    entityType: enums.CustomFieldEntity,
    label: v.string(),
    fieldKey: v.string(),
    fieldType: enums.CustomFieldType,
    options: v.array(v.string()),
    required: v.boolean(),
    helpText: v.optional(v.string()),
    sortOrder: v.number(),
    isActive: v.boolean(),
    createdAt: v.number(),
    actor: actorValidator,
    auditId: v.string(),
  },
  handler: async (ctx, args) => {
    const { actor: suppliedActor, auditId, ...fields } = args;
    await assertWritesEnabled(ctx, "customField");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, fields.organizationId, "orgSettings", "update");
    const actor = await resolveActor(ctx, suppliedActor);

    assertValidDefinition(fields, true);

    // Re-implement the @@unique([organizationId, entityType, fieldKey]) DB guard:
    // reject a duplicate fieldKey for this org + entity type (composite index).
    const dup = await ctx.db
      .query("customFieldDefinitions")
      .withIndex("by_organizationId_entityType_fieldKey", (q) =>
        q
          .eq("organizationId", fields.organizationId)
          .eq("entityType", fields.entityType)
          .eq("fieldKey", fields.fieldKey),
      )
      .first();
    if (dup) {
      throw new ConvexError(
        `A custom field with key "${fields.fieldKey}" already exists for ${fields.entityType.toLowerCase()}s.`,
      );
    }

    // Normalize at the mutation boundary (parity with the deleted server action):
    // non-SELECT fields carry no options; blank help text stores as absent.
    await ctx.db.insert("customFieldDefinitions", {
      ...fields,
      options: fields.fieldType === "SELECT" ? fields.options : [],
      helpText: fields.helpText || undefined,
      updatedAt: fields.createdAt,
    });

    await writeActivityLog(ctx, {
      id: auditId,
      organizationId: fields.organizationId,
      action: "CREATE",
      entityType: "settings",
      entityId: fields.id,
      entityName: fields.label,
      userId: actor.userId,
      userName: actor.userName,
      summary: `Added custom field "${fields.label}" (${fields.entityType.toLowerCase()})`,
      createdAt: fields.createdAt,
    });

    return { id: fields.id };
  },
});

export const updateNative = mutation({
  returns: v.object({ id: v.string() }),
  args: {
    id: v.string(),
    orgId: v.string(),
    label: v.string(),
    fieldType: enums.CustomFieldType,
    options: v.array(v.string()),
    required: v.boolean(),
    helpText: v.optional(v.string()),
    sortOrder: v.number(),
    isActive: v.boolean(),
    actor: actorValidator,
    auditId: v.string(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const { id, orgId, actor: suppliedActor, auditId, now, ...patch } = args;
    await assertWritesEnabled(ctx, "customField");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, orgId, "orgSettings", "update");
    const actor = await resolveActor(ctx, suppliedActor);

    assertValidDefinition(patch, false);

    const doc = await ctx.db
      .query("customFieldDefinitions")
      .withIndex("by_cuid", (q) => q.eq("id", id))
      .first();
    if (!doc || doc.organizationId !== orgId) {
      throw new ConvexError("Custom field not found: " + id);
    }

    // fieldKey / entityType / createdAt are immutable — patch only the editable fields.
    // Normalize at the boundary (parity): non-SELECT clears options; blank help text
    // patches to absent.
    await ctx.db.patch(doc._id, {
      ...patch,
      options: patch.fieldType === "SELECT" ? patch.options : [],
      helpText: patch.helpText || undefined,
      updatedAt: now,
    });

    await writeActivityLog(ctx, {
      id: auditId,
      organizationId: orgId,
      action: "UPDATE",
      entityType: "settings",
      entityId: id,
      entityName: patch.label,
      userId: actor.userId,
      userName: actor.userName,
      summary: `Updated custom field "${patch.label}"`,
      createdAt: now,
    });

    return { id };
  },
});

export const removeNative = mutation({
  returns: v.object({ ok: v.boolean() }),
  args: {
    id: v.string(),
    orgId: v.string(),
    actor: actorValidator,
    auditId: v.string(),
    now: v.number(),
  },
  handler: async (ctx, { id, orgId, actor: suppliedActor, auditId, now }) => {
    await assertWritesEnabled(ctx, "customField");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, orgId, "orgSettings", "update");
    const actor = await resolveActor(ctx, suppliedActor);

    const doc = await ctx.db
      .query("customFieldDefinitions")
      .withIndex("by_cuid", (q) => q.eq("id", id))
      .first();
    if (!doc || doc.organizationId !== orgId) {
      throw new ConvexError("Custom field not found: " + id);
    }

    // Values already stored in each entity's customFieldValues JSON are left as-is
    // (orphaned keys are harmless — the form just stops rendering them).
    await ctx.db.delete(doc._id);

    await writeActivityLog(ctx, {
      id: auditId,
      organizationId: orgId,
      action: "DELETE",
      entityType: "settings",
      entityId: id,
      entityName: doc.label,
      userId: actor.userId,
      userName: actor.userName,
      summary: `Removed custom field "${doc.label}"`,
      createdAt: now,
    });

    return { ok: true };
  },
});
