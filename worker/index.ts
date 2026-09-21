/// <reference lib="webworker" />

/**
 * Custom service-worker source for Web Push (#1244, design §13). Picked up
 * automatically by `@ducanh2912/next-pwa`'s `customWorkerSrc` (default
 * "worker", see next.config.ts's `withPWAInit` call — no extra config
 * needed once this file exists) and `importScripts`-ed into the generated
 * `public/sw.js`, so it runs alongside next-pwa's own Workbox caching, not
 * instead of it.
 *
 * SCOPE (documented follow-up, FEATUREDOCS/50): nothing in this deployment
 * SENDS a push yet — this handler is what fires WHEN one arrives, once a
 * server-side sender exists. `src/hooks/use-push-subscription.ts` completes
 * the other half (subscribe/unsubscribe, storing the row in
 * `pushSubscriptions`). Until a sender ships, this file has no effect.
 */

declare const self: ServiceWorkerGlobalScope;

interface PushPayload {
  title?: string;
  body?: string;
  href?: string;
  tag?: string;
}

function parsePushPayload(event: PushEvent): PushPayload {
  try {
    return event.data ? (event.data.json() as PushPayload) : {};
  } catch {
    return { body: event.data?.text() };
  }
}

self.addEventListener("push", (event: PushEvent) => {
  const payload = parsePushPayload(event);
  const title = payload.title ?? "RVLT Flow";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body,
      tag: payload.tag,
      data: { href: payload.href ?? "/dashboard" },
      icon: "/icons/icon-192.png",
    }),
  );
});

self.addEventListener("notificationclick", (event: NotificationEvent) => {
  event.notification.close();
  const href = (event.notification.data as { href?: string } | undefined)?.href ?? "/dashboard";
  event.waitUntil(
    (async () => {
      const clientsList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const existing = clientsList.find((c) => "focus" in c);
      if (existing) {
        await (existing as WindowClient).focus();
        return;
      }
      await self.clients.openWindow(href);
    })(),
  );
});
