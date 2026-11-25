/**
 * A job file's category (UX Phase 10, spec §8c): the existing `ProjectMediaType`
 * enum (`convex/lib/validators.ts`) shown as words, a name-based GUESS so an upload
 * is not always `OTHER` (editable on the row), and the `All · Documents · Photos`
 * filter. Pure.
 */
export const FILE_CATEGORIES = [
  { value: "FLOOR_PLAN", label: "Floor plan" },
  { value: "SITE_MAP", label: "Site map" },
  { value: "CLIENT_BRIEF", label: "Client brief" },
  { value: "RISK_ASSESSMENT", label: "Risk assessment" },
  { value: "CONTRACT", label: "Contract · PO" },
  { value: "CAD", label: "CAD" },
  { value: "PHOTO", label: "Photo" },
  { value: "QUOTE", label: "Quote" },
  { value: "INVOICE", label: "Invoice" },
  { value: "OTHER", label: "Other" },
] as const;

export type FileCategory = (typeof FILE_CATEGORIES)[number]["value"];

export function fileCategoryLabel(type: string): string {
  return FILE_CATEGORIES.find((c) => c.value === type)?.label ?? "Other";
}

const NAME_HINTS: readonly [RegExp, FileCategory][] = [
  [/floor\s*-?plan|\bplan\b|layout/i, "FLOOR_PLAN"],
  [/site\s*-?map|venue\s*map|\bmap\b/i, "SITE_MAP"],
  [/brief/i, "CLIENT_BRIEF"],
  [/risk|\bswms\b|\bjsa\b|\brams\b/i, "RISK_ASSESSMENT"],
  [/contract|agreement|purchase\s*order|\bpo[-_ ]?\d|\bpo\b/i, "CONTRACT"],
  [/\.(dwg|dxf)$/i, "CAD"],
  [/quote|estimate/i, "QUOTE"],
  [/invoice|\binv[-_ ]?\d/i, "INVOICE"],
];

/** The category an upload is filed under until someone changes it: the file's name, then its type. */
export function guessFileCategory(fileName: string, mimeType: string): FileCategory {
  for (const [pattern, category] of NAME_HINTS) if (pattern.test(fileName)) return category;
  return mimeType.startsWith("image/") ? "PHOTO" : "OTHER";
}

export type FileFilter = "all" | "documents" | "photos";
export const FILE_FILTERS: readonly { value: FileFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "documents", label: "Documents" },
  { value: "photos", label: "Photos" },
];

/** A photo is an image file (what the row shows as a thumbnail), whatever its category says. */
export const isPhotoFile = (mimeType: string): boolean => mimeType.startsWith("image/");

export function matchesFileFilter(mimeType: string, filter: FileFilter): boolean {
  if (filter === "all") return true;
  return filter === "photos" ? isPhotoFile(mimeType) : !isPhotoFile(mimeType);
}

/** `1.2 MB`, `340 KB`. */
export function fileSizeLabel(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
