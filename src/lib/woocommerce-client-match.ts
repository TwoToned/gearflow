/**
 * Pure WooCommerce client-matching helpers (WS9 #948) — extracted so they're
 * testable without importing the "use server" `src/server/woocommerce.ts` (every
 * export from a "use server" file becomes a client-invocable server action;
 * `findOrCreateClient` takes a raw `orgId` with no permission check, so it must
 * stay un-exported — see its docstring). The Convex-native twin
 * (convex/wooCommerceActions.ts) keeps its OWN verbatim copy of this logic — Convex
 * function files can't import from `src/lib/*` (bundler restriction, see
 * convex/lib/permissionsCore.ts's header) — so the two stay in sync by review, the
 * same "verbatim duplicate, both must change together" convention already
 * documented for `fuzzyMatchCompany`/`findOrCreateClient` (CLAUDE.md).
 */

export interface ClientContactLike {
  clientId: string;
  email?: string | null;
}

export interface ClientLike {
  id: string;
  contactEmail?: string | null;
}

/** Group an org's contacts by clientId. */
export function groupContactsByClient<T extends ClientContactLike>(allContacts: readonly T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const c of allContacts) {
    const list = map.get(c.clientId) ?? [];
    list.push(c);
    map.set(c.clientId, list);
  }
  return map;
}

/**
 * True if `email` is already known for this client — the legacy embedded
 * `contactEmail` field OR any of its `clientContacts` rows.
 */
export function clientKnowsEmail<C extends ClientLike, T extends ClientContactLike>(
  client: C,
  email: string | undefined,
  contactsByClient: Map<string, T[]>,
): boolean {
  if (!email) return false;
  if (client.contactEmail === email) return true;
  return (contactsByClient.get(client.id) ?? []).some((c) => c.email === email);
}
