/**
 * How long an invitation stays valid after it is sent (or re-sent). ONE definition (R-3.1):
 * the Team invite, the site-admin invite, and the Team resend cooldown (which derives the
 * last-sent time as `expiresAt - INVITE_TTL_MS`) all read it, so they can't drift apart.
 */
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
