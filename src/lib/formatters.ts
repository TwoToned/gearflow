/**
 * Shared formatting utilities. Use these instead of defining inline formatters.
 */

export function formatCurrency(value: number | null | undefined): string {
  if (value == null) return "\u2014";
  return `$${Number(value).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatDate(date: string | Date | null | undefined): string {
  if (!date) return "\u2014";
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function formatLabel(value: string): string {
  return value
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}
