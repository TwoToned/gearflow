/**
 * Shared filter shape for the Test & Tag reports. Lives in a plain `lib` module
 * (not the `"use server"` reports file) so both the server actions and the
 * read-helper / route consumers can import it without tripping Next's
 * server-action type-export transform. See CLAUDE.md "Server Actions".
 */
export interface ReportFilters {
  dateFrom?: string;
  dateTo?: string;
  statuses?: string[];
  equipmentClasses?: string[];
  applianceTypes?: string[];
  results?: string[];
  assetLinkType?: "all" | "serialized" | "bulk" | "standalone";
  locations?: string[];
  testedBy?: string[];
  testTagIds?: string[];
  bulkAssetId?: string;
  searchQuery?: string;
}
