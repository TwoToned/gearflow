/**
 * Global-search result types. Plain module (not "use server") so the client hook
 * (`use-global-search.ts`) and consumers (`command-search.tsx`) can import them —
 * Next's server-action transform breaks on type re-exports from a "use server" file,
 * which is why these were previously declared in `src/server/search.ts`.
 */

export type SearchResultType =
  | "model"
  | "kit"
  | "asset"
  | "bulk-asset"
  | "project"
  | "client"
  | "supplier"
  | "location"
  | "category"
  | "maintenance"
  | "crew"
  | "check-item"
  | "group-template"
  | "sub-hire";

export type SearchResult = {
  id: string;
  type: SearchResultType;
  title: string;
  subtitle: string | null;
  href: string;
  relevance: number;
  isChild?: boolean;
  /** Status field for projects (used by warehouse filtering) */
  status?: string;
};
