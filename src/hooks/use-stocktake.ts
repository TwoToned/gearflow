"use client";

import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";

/**
 * Reactive "version vector" for the warehouse stocktake SCANNER
 * (`stocktake-scanner.tsx`). The cheap Convex value `useReactiveServerQuery`
 * watches to re-run the unchanged getStocktakeProgress / getRecentScans /
 * searchStocktakeAssets server actions whenever any item of the stocktake changes
 * — cross-user over the WebSocket, replacing the scanner's 3–5s polling. See
 * convex/stocktakeDetail.ts for the scope contract. Pass `undefined` to skip.
 *
 * Lives in src/hooks (NOT convex/) so the Convex bundler never bundles this React
 * module. See FEATUREDOCS/54.
 */
export function useStocktakeVersion(stocktakeId: string | undefined) {
  return useQuery(api.stocktakeDetail.version, stocktakeId ? { stocktakeId } : "skip");
}
