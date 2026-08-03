"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useActiveOrganization } from "@/lib/auth-client";
import { useOrganization } from "@/hooks/use-organization";
import {
  formatCurrency as baseFormatCurrency,
  formatDate as baseFormatDate,
  formatDateDayMonth as baseFormatDateDayMonth,
  formatDateLong as baseFormatDateLong,
  formatDateWithTime as baseFormatDateWithTime,
  formatMonthYear as baseFormatMonthYear,
  formatConfigFromOrgSettings,
  DEFAULT_FORMAT_CONFIG,
  type FormatConfig,
} from "@/lib/formatters";
import type { OrgSettings } from "@/lib/org-settings-types";

/**
 * I2 (#1081) — the client half of the locale-aware formatting lever. Org
 * settings are already loaded in the app layout (`BrandingProvider` reads
 * the same `useOrganization` store), so this just derives a `FormatConfig`
 * from them and exposes it as context.
 *
 * `formatters.ts`'s bare `formatCurrency`/`formatDate` stay the un-themed
 * fallback for every call site that hasn't migrated to `useFormatters()`
 * yet — mounting this provider changes nothing for them. Only a component
 * that explicitly calls `useFormatters()` renders in the org's own
 * country/currency.
 */
const FormatContext = createContext<FormatConfig>(DEFAULT_FORMAT_CONFIG);

export function FormatProvider({ children }: { children: ReactNode }) {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const { data: org } = useOrganization(orgId);

  const settings = (org as Record<string, unknown> | undefined)?.settings as OrgSettings | undefined;
  const config = useMemo(() => formatConfigFromOrgSettings(settings), [settings]);

  return <FormatContext.Provider value={config}>{children}</FormatContext.Provider>;
}

type DateArg = string | Date | null | undefined;

export interface Formatters {
  formatCurrency: (value: number | null | undefined) => string;
  /** The "short" role — day, short month, year. */
  formatDate: (date: DateArg) => string;
  /** No year — a compact range/relative label. */
  formatDateDayMonth: (date: DateArg) => string;
  /** Weekday + full month + year — a page-header-style date. */
  formatDateLong: (date: DateArg) => string;
  /** The "short" role plus a 24-hour clock time. */
  formatDateWithTime: (date: DateArg) => string;
  /** Month + year only — calendar headers. */
  formatMonthYear: (date: DateArg) => string;
  /** The resolved config, for a call site that needs the raw locale/currency
   *  (e.g. an `<input>` step hint) rather than a formatted string. */
  config: FormatConfig;
}

/** Locale-aware `formatCurrency`/named date-role formatters (I3, #1082)
 *  bound to the active org's country/currency. Outside any `FormatProvider`
 *  (or before org settings load) this returns the `DEFAULT_FORMAT_CONFIG`-
 *  bound (AU) formatters — never throws, never blocks render on the org
 *  fetch. */
export function useFormatters(): Formatters {
  const config = useContext(FormatContext);
  return useMemo(
    () => ({
      formatCurrency: (value: number | null | undefined) => baseFormatCurrency(value, config),
      formatDate: (date: DateArg) => baseFormatDate(date, config),
      formatDateDayMonth: (date: DateArg) => baseFormatDateDayMonth(date, config),
      formatDateLong: (date: DateArg) => baseFormatDateLong(date, config),
      formatDateWithTime: (date: DateArg) => baseFormatDateWithTime(date, config),
      formatMonthYear: (date: DateArg) => baseFormatMonthYear(date, config),
      config,
    }),
    [config],
  );
}
