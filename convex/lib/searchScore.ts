/**
 * Pure scoring helpers for the native global search (convex/globalSearch.ts).
 *
 * The old engine (src/server/search.ts) ran 14 raw pg_trgm `$queryRaw` SQL
 * statements against Postgres. Those tables are now FROZEN (Convex is the source of
 * truth), so the palette returned stale results — recently-created records never
 * appeared. This module re-implements the SQL's match + rank semantics in pure JS so
 * the same logic can run backend-local inside a single Convex query over the LIVE
 * Convex docs.
 *
 * Parity notes vs the SQL:
 *   - `ILIKE '%q%'`               → case-insensitive substring (`includesLower`)
 *   - `regexp_replace([^a-z0-9]) LIKE '%nq%'` → normalized substring (`includesNorm`)
 *   - `similarity(field, q) > 0.15` → `trigramSimilarity(field, q) > 0.15`
 *   - `unnest(tags) t WHERE t ILIKE '%q%'` → `anyTagMatches`
 *   - `match_quality = GREATEST(similarity(lower(field), ql) …)` → `bestSimilarity`
 *
 * `trigramSimilarity` mirrors Postgres `pg_trgm`: lowercase, split on non-alphanumeric
 * runs, pad each word with 2 leading + 1 trailing space, take the set of distinct
 * 3-grams, and compute the Jaccard index |A∩B| / |A∪B|. It is not bit-identical to
 * Postgres (which has additional word-boundary tuning), but the dominant match path in
 * practice is exact substring/normalized matching; the trigram score only drives the
 * fuzzy-typo fallback and the relevance ordering.
 */

export const TRIGRAM_THRESHOLD = 0.15;

/** Strip everything but [a-z0-9], lowercase — mirrors the SQL `regexp_replace` + lower. */
export function normalize(s: string): string {
  return s.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

/** Distinct pg_trgm-style trigrams of a string (2 leading + 1 trailing pad per word). */
function trigrams(input: string): Set<string> {
  const cleaned = input.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const set = new Set<string>();
  if (!cleaned) return set;
  for (const word of cleaned.split(" ")) {
    if (!word) continue;
    const padded = `  ${word} `;
    for (let i = 0; i < padded.length - 2; i++) {
      set.add(padded.slice(i, i + 3));
    }
  }
  return set;
}

/** pg_trgm `similarity(a, b)` — symmetric Jaccard over trigram sets, [0, 1]. */
export function trigramSimilarity(a: string, b: string): number {
  const A = trigrams(a);
  const B = trigrams(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  const union = A.size + B.size - inter;
  return union === 0 ? 0 : inter / union;
}

/** Case-insensitive substring — the `ILIKE '%q%'` path. Empty needle never matches. */
export function includesLower(haystack: string | null | undefined, needleLower: string): boolean {
  if (!haystack || !needleLower) return false;
  return haystack.toLowerCase().includes(needleLower);
}

/** Normalized (alnum-only) substring — the `regexp_replace(...) LIKE '%nq%'` path. */
export function includesNorm(haystack: string | null | undefined, needleNorm: string): boolean {
  if (!haystack || !needleNorm) return false;
  return normalize(haystack).includes(needleNorm);
}

/** Any tag ILIKE-matches — the `unnest(tags) t WHERE t ILIKE '%q%'` path. */
export function anyTagMatches(tags: string[] | null | undefined, needleLower: string): boolean {
  if (!tags || !needleLower) return false;
  return tags.some((t) => t.toLowerCase().includes(needleLower));
}

/** The parsed query terms, computed once per request. */
export type SearchTerms = {
  /** trimmed, original-case query (for trigram similarity, mirrors SQL `${q}`) */
  q: string;
  /** lowercased query (for ILIKE, mirrors SQL `${ql}`) */
  ql: string;
  /** normalized query (alnum-only lowercase, mirrors SQL `${nq}`) */
  nq: string;
};

export function parseTerms(query: string): SearchTerms {
  const q = query.trim();
  return { q, ql: q.toLowerCase(), nq: normalize(q) };
}

/**
 * Highest trigram similarity of the query against any of the given field values —
 * this is the `match_quality = GREATEST(similarity(lower(field), ql), …)` port.
 * Null/undefined fields contribute 0.
 */
export function bestSimilarity(terms: SearchTerms, fields: Array<string | null | undefined>): number {
  let best = 0;
  for (const f of fields) {
    if (!f) continue;
    const s = trigramSimilarity(f, terms.q);
    if (s > best) best = s;
  }
  return best;
}

/**
 * Does the row match at all? Mirrors the SQL `WHERE (... OR ...)` disjunction:
 * a raw ILIKE hit on any `ilikeFields`, OR a normalized-LIKE hit on any `normFields`,
 * OR a trigram hit above threshold on any `fuzzyFields`, OR a tag hit.
 *
 * `ilikeFields` and `normFields` are SEPARATE on purpose: the SQL applied the
 * `regexp_replace(...) LIKE '%nq%'` normalized match to only a SUBSET of the ILIKE
 * fields (e.g. a model's name/number but not its free-text description), so folding
 * them together would over-match (query "foobar" hitting a description "foo-bar").
 * Each caller passes the exact field split the original SQL used.
 */
export function matchesQuery(
  terms: SearchTerms,
  opts: {
    ilikeFields: Array<string | null | undefined>;
    normFields: Array<string | null | undefined>;
    fuzzyFields: Array<string | null | undefined>;
    tags?: string[] | null;
  },
): boolean {
  const { ql, nq } = terms;
  for (const f of opts.ilikeFields) {
    if (includesLower(f, ql)) return true;
  }
  for (const f of opts.normFields) {
    if (includesNorm(f, nq)) return true;
  }
  for (const f of opts.fuzzyFields) {
    if (f && trigramSimilarity(f, terms.q) > TRIGRAM_THRESHOLD) return true;
  }
  if (opts.tags && anyTagMatches(opts.tags, ql)) return true;
  return false;
}
