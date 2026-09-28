/**
 * "3 containers · 47 items · 212 kg · 2 loose items" — shared by the two
 * `byContainer` client/warehouse-facing docs that print a summary line
 * (manifest #1296 3b, delivery-docket #1296 3c/D7). Only the parts with
 * something to say print, so a job with no containers adopted yet (or
 * nothing packed) doesn't print a summary of zeros.
 */
import { Text } from "@react-pdf/renderer";
import type { DocumentData } from "@/lib/pdfme/types";

const FONT_SIZE_SUMMARY = 8;

function buildSummaryLine(data: DocumentData): string {
  const parts: string[] = [];
  if (data.container_count) {
    const nested = data.nested_container_count ? ` (+${data.nested_container_count} nested)` : "";
    parts.push(`${data.container_count} container${data.container_count === 1 ? "" : "s"}${nested}`);
  }
  parts.push(`${data.total_items} item${data.total_items === 1 ? "" : "s"}`);
  if (data.total_weight > 0) parts.push(`${Math.round(data.total_weight)} kg`);
  if (data.loose_item_count) parts.push(`${data.loose_item_count} loose item${data.loose_item_count === 1 ? "" : "s"}`);
  return `Summary: ${parts.join(" · ")}`;
}

export function SummaryLine({ data }: { data: DocumentData }) {
  return <Text style={{ fontSize: FONT_SIZE_SUMMARY, color: "#333333" }}>{buildSummaryLine(data)}</Text>;
}
