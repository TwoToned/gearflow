import { v } from "convex/values";
import { createId } from "@paralleldrive/cuid2";
import { mutation } from "./_generated/server";
import { requireService } from "./lib/auth";

/**
 * WS9 #948 — expand-migrate backfill: one `ClientContact{isPrimary:true}` row per
 * client whose EMBEDDED contact (contactName/contactEmail/contactPhone) carries any
 * field. See docs/designs/pdf-system-redesign.md's sibling —
 * FEATUREDOCS/63-client-contacts.md — for the full widen→migrate→defer-narrow plan;
 * this PR is the widen+migrate half only (narrow/drop-the-3-legacy-fields is a
 * SEPARATE follow-up).
 *
 * Idempotent — skips any client that ALREADY has a clientContacts row (a client
 * manually given a contact after the widen ships, or a prior run of this backfill),
 * so re-runs never clobber live state. `name` is synthesized from the email's
 * local-part ONLY when the client had no `contactName` but did have a
 * `contactEmail`; a client whose embedded contact is entirely empty gets no row
 * (fully-optional contacts — a client with zero contacts stays valid).
 *
 * SERVICE-only, paginated (one query can't scan a large table — mirrors
 * backfillKitUnits.ts). `apply=false` is a dry-run that only counts.
 *
 * Driver: scripts/convex-backfill-client-contacts.ts (pages the cursor until isDone).
 */
export const backfillClientContactsPage = mutation({
  args: {
    cursor: v.union(v.string(), v.null()),
    apply: v.boolean(),
    numItems: v.optional(v.number()),
  },
  handler: async (ctx, { cursor, apply, numItems }) => {
    await requireService(ctx);
    const res = await ctx.db.query("clients").paginate({ cursor, numItems: numItems ?? 300 });

    let scanned = 0;
    let created = 0;
    for (const client of res.page) {
      const hasEmbedded = !!(client.contactName || client.contactEmail || client.contactPhone);
      if (!hasEmbedded) continue;

      // Idempotent — a client that already has ANY contact row is left alone,
      // whether from a prior backfill run or a contact added post-widen.
      const already = await ctx.db.query("clientContacts").withIndex("by_clientId", (q) => q.eq("clientId", client.id)).first();
      if (already) continue;

      scanned++; // a client that NEEDS a backfilled primary contact
      if (!apply) continue;

      const name = client.contactName || (client.contactEmail ? client.contactEmail.split("@")[0] : undefined);
      const now = client.updatedAt ?? client.createdAt ?? Date.now();
      await ctx.db.insert("clientContacts", {
        id: createId(),
        organizationId: client.organizationId,
        clientId: client.id,
        name,
        email: client.contactEmail,
        phone: client.contactPhone,
        isPrimary: true,
        sortOrder: 0,
        createdAt: now,
        updatedAt: now,
      });
      created++;
    }
    return { scanned, created, isDone: res.isDone, continueCursor: res.continueCursor };
  },
});
