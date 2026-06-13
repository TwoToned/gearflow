import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireService } from "./lib/auth";

/**
 * Migration parity helper — a generic, paginated table count.
 *
 * Convex has no built-in "count all rows" and a single query can't `.collect()`
 * a large table (the per-query read limit is ~16k docs / 8MiB). So we page
 * through with a cursor and let the client (scripts/convex-parity-check.ts) sum
 * the pages. SERVICE-only: this can read ANY table by name, so it must never be
 * browser-callable. Not part of the app's runtime — only the parity gate uses it.
 */
export const countPage = query({
  args: { table: v.string(), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { table, cursor }) => {
    await requireService(ctx);
    const res = await ctx.db
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .query(table as any)
      .paginate({ cursor, numItems: 2000 });
    return {
      count: res.page.length,
      isDone: res.isDone,
      continueCursor: res.continueCursor,
    };
  },
});
