"use client";

import { createContext } from "react";

/**
 * "Convert to custom item" wiring for the Equipment tab (FEATUREDOCS/12). Provided
 * once at the tab level (which owns `useWarehouseWrites`) and passed into
 * `buildEquipmentSections`, whose gear-line menu offers the convert actions.
 * Without it (read-only consumers like the pull sheet) a row offers nothing.
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

