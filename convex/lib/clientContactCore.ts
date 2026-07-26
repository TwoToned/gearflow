/**
 * Isomorphic ClientContact core — pure, side-effect-free (same rule as
 * permissionsCore.ts: no Prisma/Node/browser/`@/`-aliased imports, so this bundles
 * cleanly into BOTH the Convex deployment and the Next.js build). Shared by
 * `convex/globalSearch.ts` (relative import) and `src/lib/client-contact-helpers.ts`
 * (re-exports this via a relative import, mirroring how `src/lib/permissions.ts`
 * re-exports `convex/lib/permissionsCore.ts`).
 *
 * One authoritative "which contact represents this client" resolver (R-3.1) — every
 * consumer (client detail hero, table columns, search subtitle, PDF tokens,
 * WooCommerce matching) reads a client's primary/derived contact through here
 * instead of re-deriving the same "isPrimary, else lowest sortOrder" rule.
 */

/** The subset of a `clientContacts` row every consumer needs to resolve a primary contact. */
export interface ClientContactLike {
  id: string;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  isPrimary?: boolean | null;
  sortOrder?: number | null;
}

/** The subset of a `clients` row the legacy-embedded fallback reads. */
export interface LegacyClientContactFields {
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
}

/**
 * The client's primary contact: the row with `isPrimary: true`, else the lowest
 * `sortOrder` (ties broken by array order), else `null` when the client has no
 * contacts yet (fully optional — a client with zero contacts stays valid).
 */
export function getPrimaryContact<T extends ClientContactLike>(contacts: readonly T[]): T | null {
  if (contacts.length === 0) return null;
  const primary = contacts.find((c) => c.isPrimary === true);
  if (primary) return primary;
  return [...contacts].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))[0];
}

/**
 * Resolved display fields for a client, preferring (in order): an explicitly
 * selected contact (e.g. a project's `clientContactId`), else the client's primary
 * contact, else the legacy embedded `clients.contactName/Email/Phone` fields (the
 * migration-window fallback — see FEATUREDOCS/63). Never returns `undefined`
 * fields; absent values are `null`.
 */
export function resolveClientContactDisplay(
  legacy: LegacyClientContactFields,
  contacts: readonly ClientContactLike[],
  selectedContactId?: string | null,
): { name: string | null; email: string | null; phone: string | null } {
  const selected = selectedContactId && contacts.find((c) => c.id === selectedContactId);
  const resolved = selected || getPrimaryContact(contacts);
  return {
    name: (resolved ? resolved.name : legacy.contactName) ?? null,
    email: (resolved ? resolved.email : legacy.contactEmail) ?? null,
    phone: (resolved ? resolved.phone : legacy.contactPhone) ?? null,
  };
}
