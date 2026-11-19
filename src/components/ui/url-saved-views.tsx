"use client";

import { useCallback, useMemo } from "react";
import { useSearchParams } from "next/navigation";

import { SavedViewsMenu } from "@/components/ui/saved-views-menu";
import {
  defaultListState,
  hasNoListParams,
  parseListState,
  type ListUrlSpec,
  type ListUrlState,
} from "@/lib/list-url-state";
import { queryOf, viewQuery, type LegacyKeyAliases, type UrlBuiltInView } from "@/lib/list-views/saved-view-url";

interface Props {
  tableId: string;
  spec: ListUrlSpec;
  state: ListUrlState;
  setState: (next: ListUrlState) => void;
  builtIns?: UrlBuiltInView[];
  /** Old stored filter keys that were renamed for the URL (e.g. `locationId` -> `loc`). */
  aliases?: LegacyKeyAliases;
}

/**
 * Saved views for a URL-state list (D11): a view IS the list's query string, applying one is
 * a `router.push`, and a default applies only when the URL has no list params. `spec` and
 * `aliases` must be module constants (they key the memos).
 */
export function UrlSavedViewsMenu({ tableId, spec, state, setState, builtIns, aliases }: Props) {
  const params = useSearchParams();
  const normalize = useCallback(
    (config: Parameters<typeof viewQuery>[0]) => ({ query: viewQuery(config, spec, aliases) }),
    [spec, aliases],
  );
  const urlBuiltIns = useMemo(
    () => (builtIns ?? []).map((b) => ({ id: b.id, name: b.name, config: { query: b.query } })),
    [builtIns],
  );
  return (
    <SavedViewsMenu
      tableId={tableId}
      currentConfig={{ query: queryOf(state, spec) }}
      applyConfig={(c) => setState(parseListState(new URLSearchParams(viewQuery(c, spec, aliases)), spec))}
      onResetPreferences={() => setState(defaultListState(spec))}
      urlMode={{ normalize, builtIns: urlBuiltIns, isPristine: hasNoListParams(new URLSearchParams(params.toString()), spec) }}
    />
  );
}
