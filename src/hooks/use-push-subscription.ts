"use client";

import { useCallback, useEffect, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";

/**
 * Web Push subscribe/unsubscribe (#1244, design §13). Browser-local state
 * only — `pushSubscriptions` (Convex) stores the (org, user, device) row,
 * but WHETHER THIS BROWSER currently holds a subscription is asked of the
 * Push API itself (`PushManager.getSubscription()`), never inferred from
 * the server, since two browsers for the same person are independent.
 *
 * SCOPE (documented follow-up, FEATUREDOCS/50): this hook completes the
 * subscribe/unsubscribe flow and stores the row. Nothing SENDS a push yet —
 * that's a server-side job against `web-push`'s protocol, deliberately left
 * for a later pass rather than rushed into an already-large phase.
 */

export type PushSupport = "unsupported" | "checking" | "supported";

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const base64Safe = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64Safe);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

export function usePushSubscription() {
  const [support, setSupport] = useState<PushSupport>("checking");
  const [subscribed, setSubscribed] = useState(false);
  const [pending, setPending] = useState(false);
  const subscribeM = useMutation(api.pushSubscriptionsWrites.subscribeNative);
  const unsubscribeM = useMutation(api.pushSubscriptionsWrites.unsubscribeNative);

  const refresh = useCallback(async () => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      setSupport("unsupported");
      return;
    }
    setSupport("supported");
    try {
      const registration = await navigator.serviceWorker.ready;
      const existing = await registration.pushManager.getSubscription();
      setSubscribed(existing != null);
    } catch {
      setSubscribed(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const subscribe = useCallback(async () => {
    const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (!vapidKey) throw new Error("Push notifications aren't configured for this deployment.");
    setPending(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") throw new Error("Notification permission was not granted.");
      const registration = await navigator.serviceWorker.ready;
      const sub = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        // Cast: lib.dom.d.ts's stricter ArrayBuffer-vs-SharedArrayBuffer
        // typed-array generics reject a plain Uint8Array here even though
        // the Push API accepts any BufferSource at runtime.
        applicationServerKey: urlBase64ToUint8Array(vapidKey) as BufferSource,
      });
      const json = sub.toJSON();
      if (!json.keys?.p256dh || !json.keys?.auth) throw new Error("Subscription is missing encryption keys.");
      await subscribeM({
        endpoint: sub.endpoint,
        p256dh: json.keys.p256dh,
        auth: json.keys.auth,
        userAgent: navigator.userAgent,
        now: Date.now(),
      });
      setSubscribed(true);
    } finally {
      setPending(false);
    }
  }, [subscribeM]);

  const unsubscribe = useCallback(async () => {
    setPending(true);
    try {
      const registration = await navigator.serviceWorker.ready;
      const sub = await registration.pushManager.getSubscription();
      if (sub) {
        await unsubscribeM({ endpoint: sub.endpoint });
        await sub.unsubscribe();
      }
      setSubscribed(false);
    } finally {
      setPending(false);
    }
  }, [unsubscribeM]);

  return { support, subscribed, pending, subscribe, unsubscribe };
}
