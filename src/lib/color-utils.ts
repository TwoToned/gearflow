/**
 * Color utilities for converting hex colors to oklch and generating theme palettes.
 */

/** Parse a hex color string to RGB [0-1] */
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  ];
}

/** sRGB to linear RGB */
function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** Convert linear RGB to OKLab */
function linearRgbToOklab(r: number, g: number, b: number): [number, number, number] {
  const l_ = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m_ = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s_ = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;

  const l = Math.cbrt(l_);
  const m = Math.cbrt(m_);
  const s = Math.cbrt(s_);

  return [
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  ];
}

/** Convert OKLab to OKLCH */
function oklabToOklch(L: number, a: number, b: number): [number, number, number] {
  const C = Math.sqrt(a * a + b * b);
  let h = (Math.atan2(b, a) * 180) / Math.PI;
  if (h < 0) h += 360;
  return [L, C, h];
}

/** Convert hex to OKLCH values */
export function hexToOklch(hex: string): { l: number; c: number; h: number } {
  const [r, g, b] = hexToRgb(hex);
  const [lr, lg, lb] = [srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)];
  const [L, a, bLab] = linearRgbToOklab(lr, lg, lb);
  const [l, c, h] = oklabToOklch(L, a, bLab);
  return { l, c, h };
}

/** Format OKLCH values as a CSS string */
export function oklchString(l: number, c: number, h: number): string {
  return `oklch(${l.toFixed(3)} ${c.toFixed(4)} ${h.toFixed(1)})`;
}

/**
 * Generate CSS variable overrides for a given primary hex color.
 * Returns a record of CSS variable name -> value pairs.
 */
export function generatePrimaryPalette(
  hex: string,
  mode: "light" | "dark"
): Record<string, string> {
  const { c, h } = hexToOklch(hex);

  if (mode === "light") {
    const primary = oklchString(0.45, Math.min(c, 0.15), h);
    const primaryFg = oklchString(0.98, 0.005, h);
    const ring = primary;
    const accent = oklchString(0.94, 0.015, h);
    const accentFg = oklchString(0.20, 0.02, h);
    const secondary = oklchString(0.95, 0.01, h);
    const secondaryFg = oklchString(0.20, 0.02, h);
    const sidebar = oklchString(0.97, 0.008, h);
    const sidebarPrimary = primary;
    const sidebarPrimaryFg = primaryFg;
    const sidebarAccent = oklchString(0.93, 0.015, h);
    const sidebarAccentFg = oklchString(0.20, 0.02, h);
    const sidebarRing = primary;

    return {
      "--primary": primary,
      "--primary-foreground": primaryFg,
      "--ring": ring,
      "--accent": accent,
      "--accent-foreground": accentFg,
      "--secondary": secondary,
      "--secondary-foreground": secondaryFg,
      "--chart-1": primary,
      "--sidebar": sidebar,
      "--sidebar-primary": sidebarPrimary,
      "--sidebar-primary-foreground": sidebarPrimaryFg,
      "--sidebar-accent": sidebarAccent,
      "--sidebar-accent-foreground": sidebarAccentFg,
      "--sidebar-ring": sidebarRing,
    };
  } else {
    // dark mode
    const primary = oklchString(0.55, Math.min(c, 0.16), h);
    const primaryFg = oklchString(0.13, 0.015, h);
    const ring = primary;
    const accent = oklchString(0.25, 0.02, h);
    const accentFg = oklchString(0.95, 0.005, h);
    const secondary = oklchString(0.22, 0.015, h);
    const secondaryFg = oklchString(0.95, 0.005, h);
    const sidebar = oklchString(0.15, 0.015, h);
    const sidebarPrimary = primary;
    const sidebarPrimaryFg = primaryFg;
    const sidebarAccent = oklchString(0.22, 0.02, h);
    const sidebarAccentFg = oklchString(0.95, 0.005, h);
    const sidebarRing = primary;

    return {
      "--primary": primary,
      "--primary-foreground": primaryFg,
      "--ring": ring,
      "--accent": accent,
      "--accent-foreground": accentFg,
      "--secondary": secondary,
      "--secondary-foreground": secondaryFg,
      "--chart-1": primary,
      "--sidebar": sidebar,
      "--sidebar-primary": sidebarPrimary,
      "--sidebar-primary-foreground": sidebarPrimaryFg,
      "--sidebar-accent": sidebarAccent,
      "--sidebar-accent-foreground": sidebarAccentFg,
      "--sidebar-ring": sidebarRing,
    };
  }
}

/**
 * Lighten a hex color by blending toward white.
 * amount = 0 means original, amount = 1 means white.
 */
export function lightenHex(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  const lr = Math.round((r + (1 - r) * amount) * 255);
  const lg = Math.round((g + (1 - g) * amount) * 255);
  const lb = Math.round((b + (1 - b) * amount) * 255);
  return `#${lr.toString(16).padStart(2, "0")}${lg.toString(16).padStart(2, "0")}${lb.toString(16).padStart(2, "0")}`;
}
