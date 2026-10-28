"use client";

import { createContext, useContext } from "react";

/**
 * "Convert to custom item" wiring for the Equipment tab (FEATUREDOCS/12). Provided
 * once at the tab level (which owns `useWarehouseWrites`) and consumed by the line
 * kebab deep inside LineItemRow — same reason as `reassign-context.tsx`: no
 * threading a handler through every LineItemRow call site. Without a provider
 * (read-only consumers like the pull sheet) `useCustomUnitActions()` is null and
 * the row offers nothing.
 */
export interface CustomUnitContextValue {
  /** Move one free unit of the line to a custom (off-inventory) unit. */
  convert: (lineItemId: string) => void;
  /** Put one not-yet-deployed custom unit back on inventory. */
  convertBack: (lineItemId: string) => void;
  /** Lines with a call in flight. */
  pendingLineIds: ReadonlySet<string>;
}

const CustomUnitContext = createContext<CustomUnitContextValue | null>(null);

export const CustomUnitProvider = CustomUnitContext.Provider;

export function useCustomUnitActions(): CustomUnitContextValue | null {
  return useContext(CustomUnitContext);
}
