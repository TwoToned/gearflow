import type { ColorIntent } from "@/lib/status-colors";

/**
 * Client timeline display vocabulary (#1245, design §8.4) — filter chips and
 * per-category styling for `<ClientTimelineTab>`. Plain module (no Convex/
 * React imports) so it can be unit-tested and reused by the pipeline view.
 */

const TIMELINE_CATEGORIES = ["money", "work", "comment", "logged"] as const;
export type TimelineCategory = (typeof TIMELINE_CATEGORIES)[number];

export const TIMELINE_FILTERS = ["all", ...TIMELINE_CATEGORIES] as const;
export type TimelineFilter = (typeof TIMELINE_FILTERS)[number];

export const TIMELINE_FILTER_LABELS: Record<TimelineFilter, string> = {
  all: "All",
  logged: "Logged",
  money: "Money",
  work: "Work",
  comment: "Comments",
};

export const TIMELINE_CATEGORY_INTENT: Record<TimelineCategory, ColorIntent> = {
  money: "success",
  work: "info",
  comment: "neutral",
  logged: "warning",
};

export function matchesTimelineFilter(category: TimelineCategory, filter: TimelineFilter): boolean {
  return filter === "all" || filter === category;
}
