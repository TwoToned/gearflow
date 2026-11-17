/**
 * The one set of responsive breakpoints (UX unification D67/D68).
 *
 * Phone is `max-width: 859px`; Tailwind's `md` is therefore 860px
 * (`--breakpoint-md` in globals.css `@theme`, kept in step by
 * `breakpoints.test.ts`). The tablet icon rail applies at <= 1023px
 * (Tailwind `lg` = 1024px).
 */
export const PHONE_MAX = 859;
export const TABLET_MAX = 1023;

export const PHONE_MEDIA_QUERY = `(max-width: ${PHONE_MAX}px)`;
export const TABLET_MEDIA_QUERY = `(max-width: ${TABLET_MAX}px)`;
