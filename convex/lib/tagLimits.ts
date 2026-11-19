/**
 * The ONE definition of a free-form tag's bounds (R-3.1). Read by the Convex write
 * guard (`assertTags` in `fieldGuards.ts`), the add/remove-tag mutations, the Zod
 * project schema and the bulk `Add tag…` prompt, so the client and the server can
 * never disagree about what a legal tag is. Plain module: no Convex imports, so
 * `src/` can import it.
 */
export const MAX_TAGS = 25;
export const MAX_TAG_LEN = 40;

/** A tag as stored: trimmed. Empty means "no tag". */
export function cleanTag(raw: string): string {
  return raw.trim();
}
