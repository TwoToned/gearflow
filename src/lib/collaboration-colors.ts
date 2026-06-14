/**
 * Deterministic user colours for collaboration features.
 *
 * Each user gets a stable colour derived from their userId so it never
 * changes between sessions. Red/orange are excluded to avoid collision with
 * GearFlow's error/warning semantics.
 */

// 12 distinct colours covering the hue wheel, skipping red and orange.
export const COLLAB_COLORS = [
  "#2563eb", // blue
  "#7c3aed", // violet
  "#db2777", // pink
  "#0891b2", // cyan
  "#059669", // emerald
  "#65a30d", // lime
  "#d97706", // amber — warm but not error-red
  "#0d9488", // teal
  "#4f46e5", // indigo
  "#9333ea", // purple
  "#0284c7", // sky
  "#16a34a", // green
] as const;

/** Derive a stable colour hex from a user id string. Pure function, no random. */
export function getUserColor(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  }
  return COLLAB_COLORS[hash % COLLAB_COLORS.length];
}

/** Derive display initials from a display name (up to 2 characters). */
export function getUserInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Return a CSS-safe foreground colour (white or near-black) that is legible
 * against the given background hex colour.
 */
export function getForegroundColor(bgHex: string): string {
  const r = parseInt(bgHex.slice(1, 3), 16) / 255;
  const g = parseInt(bgHex.slice(3, 5), 16) / 255;
  const b = parseInt(bgHex.slice(5, 7), 16) / 255;
  // Perceived luminance (sRGB)
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.35 ? "#1a1a1a" : "#ffffff";
}

/** How long ago a timestamp was, as a human-readable string. */
export function timeAgo(ts: number): string {
  const diffMs = Date.now() - ts;
  const diffS = Math.floor(diffMs / 1000);
  if (diffS < 30) return "just now";
  if (diffS < 60) return `${diffS}s ago`;
  const diffM = Math.floor(diffS / 60);
  if (diffM < 60) return `${diffM}m ago`;
  const diffH = Math.floor(diffM / 60);
  if (diffH < 24) return `${diffH}h ago`;
  return `${Math.floor(diffH / 24)}d ago`;
}
