/**
 * Re-exports the isomorphic ClientContact core so Next.js code can share the same
 * "which contact represents this client" logic Convex uses — mirrors how
 * `src/lib/permissions.ts` re-exports `convex/lib/permissionsCore.ts`. Consumers:
 * client detail page (hero + table columns), build-document-data.ts (PDF tokens).
 */
export {
  getPrimaryContact,
  resolveClientContactDisplay,
  type ClientContactLike,
  type LegacyClientContactFields,
} from "../../convex/lib/clientContactCore";
