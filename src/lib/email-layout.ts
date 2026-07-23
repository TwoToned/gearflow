/**
 * Single source of truth for transactional-email chrome (POLICY.md R-8.10.4,
 * R-3.1). Every template composes its body from these helpers so the wrapper,
 * CTA button, and muted-note markup live in exactly ONE place — before this
 * module the same `<div style="font-family: sans-serif; …">` wrapper and
 * `#0d9488` button were hand-copied across ~11 call sites and could drift.
 *
 * Plain inline-styled HTML (no MJML / React Email) to match the existing
 * lightweight email codebase; email clients require inline styles.
 */

const WRAPPER_STYLE = "font-family: sans-serif; max-width: 600px; margin: 0 auto;";
const BUTTON_STYLE =
  "display: inline-block; padding: 12px 24px; background-color: #0d9488; color: white; text-decoration: none; border-radius: 6px; font-weight: 600;";
const MUTED_STYLE = "color: #666; font-size: 14px;";

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/**
 * Escape HTML-significant characters before interpolating untrusted text
 * (org names, invitee names, roles, asset descriptions, etc.) into email
 * HTML (POLICY.md R-8.11.3). Apply this to every user-controlled string
 * that lands inside an `html` template — never to plain-text `subject`
 * lines, which aren't HTML-interpreted.
 */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);
}

/** Wrap a template body in the standard 600px centred email container. */
export function emailShell(innerHtml: string): string {
  return `<div style="${WRAPPER_STYLE}">${innerHtml}</div>`;
}

/** The standard primary CTA button. */
export function emailButton({
  href,
  label,
}: {
  href: string;
  label: string;
}): string {
  return `<p><a href="${href}" style="${BUTTON_STYLE}">${label}</a></p>`;
}

/** A muted secondary note (e.g. "This invitation expires in 7 days."). */
export function emailMutedNote(text: string): string {
  return `<p style="${MUTED_STYLE}">${text}</p>`;
}
