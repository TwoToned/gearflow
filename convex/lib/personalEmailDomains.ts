/**
 * Free/consumer email domains excluded from B2's (#1094) verified-domain
 * "ask to join" match. Without this, a request from `you@gmail.com` would
 * match every org that happens to have any Gmail-using member — an
 * undifferentiated result set that leaks "does this org have a Gmail user"
 * for a domain that says nothing about which company someone works for.
 * Domain-request matching only makes sense for a company's own mail domain.
 *
 * Not exhaustive — a short, deliberately conservative list (R-3.1: one place
 * to extend). Checked both client-side (so the search never surfaces a
 * personal-domain match) and inside the `request` mutation itself (defence in
 * depth — R-9.3, the server re-derives this regardless of what the UI did).
 */
const PERSONAL_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "yahoo.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "icloud.com",
  "me.com",
  "aol.com",
  "protonmail.com",
  "proton.me",
  "gmx.com",
  "mail.com",
]);

export function isPersonalEmailDomain(domain: string): boolean {
  return PERSONAL_EMAIL_DOMAINS.has(domain.toLowerCase());
}

/** `undefined` for anything without an `@`, an empty local part, or no domain. */
export function emailDomain(email: string): string | undefined {
  const at = email.lastIndexOf("@");
  if (at <= 0 || at === email.length - 1) return undefined;
  return email.slice(at + 1).toLowerCase();
}
