/**
 * The push services a Web Push subscription endpoint may point at. A browser
 * hands us its endpoint on subscribe, and the server later POSTs to it — so an
 * endpoint is user-supplied input to a server-side request, and anything other
 * than a real push service would be a request-forgery hole (R-8.11). Checked
 * on subscribe (`pushSubscriptionsWrites.subscribeNative`) AND again before
 * every send (`src/lib/web-push.ts`), so a row written before this check
 * existed can't be used either. A plain module: Convex and `src/` share it.
 *
 * The request URL is rebuilt from the CONSTANT origin below plus the
 * endpoint's path — the host never comes from stored input. That is also why
 * Edge-on-Windows (WNS, per-region `*.notify.windows.com` hosts) isn't
 * supported: its host can't be a constant. Chrome/Edge's FCM, Firefox and
 * every iOS/Safari browser are.
 */
const PUSH_ORIGINS = [
  "https://fcm.googleapis.com", // Chrome, Android, Chromium browsers
  "https://updates.push.services.mozilla.com", // Firefox
  "https://web.push.apple.com", // Safari + every iOS browser
] as const;

/** The URL to POST to — a known push-service origin + the endpoint's path —
 *  or null when the endpoint isn't a plain https URL on one of them. */
export function pushRequestUrl(endpoint: string): string | null {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return null;
  }
  if (url.username || url.password || url.port) return null;
  const origin = PUSH_ORIGINS.find((o) => o === url.origin);
  return origin ? `${origin}${url.pathname}${url.search}` : null;
}
