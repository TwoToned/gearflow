"use client";

import { useEffect, useRef, useCallback, useMemo } from "react";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { api } from "../../convex/_generated/api";
import { useActiveOrganization, useSession } from "@/lib/auth-client";
import { getUserColor, getUserInitials } from "@/lib/collaboration-colors";
import { useServerMutation } from "./use-server-mutation";
import {
  heartbeatPresence,
  clearPresence,
  acquireLock,
  heartbeatLock,
  releaseLock,
  takeoverLock,
} from "@/server/collaboration";

/**
 * Stable client session id — differentiates same-user in two tabs.
 * Stored in sessionStorage so it survives hot-reload but not tab close.
 */
export function getClientSessionId(): string {
  if (typeof sessionStorage === "undefined") return "ssr";
  const key = "__collab_session_id__";
  let id = sessionStorage.getItem(key);
  if (!id) {
    id = Math.random().toString(36).slice(2) + Date.now().toString(36);
    sessionStorage.setItem(key, id);
  }
  return id;
}

// ─── Presence ─────────────────────────────────────────────────────────────────

interface UsePresenceOptions {
  entityType: string;
  entityId: string;
  section?: string;
  /** Disable when the entity/org aren't ready yet. */
  enabled?: boolean;
}

export interface PresenceUser {
  userId: string;
  userName: string;
  userColor: string;
  avatarUrl?: string;
  mode: string;
  section?: string;
  activeTargetType?: string;
  activeTargetId?: string;
  lastSeenAt: number;
}

/**
 * Register presence for the current user on an entity and return the list of
 * other active users. Heartbeats every 15 s; clears on unmount (best-effort).
 */
export function usePresence(options: UsePresenceOptions) {
  const { entityType, entityId, section, enabled = true } = options;
  const { data: activeOrg } = useActiveOrganization();
  const { data: session } = useSession();
  const orgId = activeOrg?.id;

  // Keep a stable ref to beat/clear fns so the interval closure never stales
  const beatFnRef = useRef<() => void>(() => {});
  const clearFnRef = useRef<() => void>(() => {});

  const heartbeatMut = useServerMutation({
    mutationFn: () =>
      heartbeatPresence(entityType, entityId, "viewing", section),
    onError: (e) => console.warn("[presence] heartbeat failed", e),
  });

  const clearMut = useServerMutation({
    mutationFn: () => clearPresence(entityType, entityId),
    onError: () => {},
  });

  // Update stable refs each render so interval closure always calls latest
  useEffect(() => {
    beatFnRef.current = () => heartbeatMut.mutate();
    clearFnRef.current = () => clearMut.mutate();
  });

  const presence = useAuthedQuery(
    api.collaboration.listPresence,
    orgId && enabled
      ? { orgId, entityType, entityId }
      : "skip"
  ) as PresenceUser[] | undefined;

  useEffect(() => {
    if (!enabled || !orgId) return;
    beatFnRef.current();
    const interval = setInterval(() => beatFnRef.current(), 15_000);
    return () => {
      clearInterval(interval);
      clearFnRef.current();
    };
  }, [enabled, orgId, entityType, entityId, section]);

  const myUserId = session?.user?.id;
  const others = useMemo(
    () => (presence ?? []).filter((p) => p.userId !== myUserId),
    [presence, myUserId]
  );

  return { presence: presence ?? [], others };
}

// ─── Edit Lock ─────────────────────────────────────────────────────────────────

export type LockState =
  | { status: "idle" }
  | { status: "held"; lockId: string; isSameUser: boolean; sessionId: string }
  | { status: "blocked"; ownerName: string; ownerColor: string; ownerUserId: string; expiresAt: number; lockId: string }
  | { status: "stale"; ownerName: string; ownerColor: string; expiresAt: number; lockId: string }
  | { status: "error"; message: string };

interface UseEditLockOptions {
  entityType: string;
  entityId: string;
  targetType: string;
  targetId: string;
  /** Only attempt to acquire the lock when true (e.g. when the editor opens). */
  active?: boolean;
  enabled?: boolean;
}

/**
 * Manage an edit lock for a specific target (e.g. a line item).
 * - Acquires when `active` becomes true.
 * - Heartbeats every 10 s while active.
 * - Releases on deactivate or unmount.
 * - Returns the reactive lock state so other subscribers see who holds it.
 */
export function useEditLock(options: UseEditLockOptions) {
  const { entityType, entityId, targetType, targetId, active = true, enabled = true } = options;
  const { data: activeOrg } = useActiveOrganization();
  const { data: session } = useSession();
  const orgId = activeOrg?.id;
  const myUserId = session?.user?.id;
  // Stable session id — memo so it never changes for this component instance
  const clientSessionId = useMemo(() => getClientSessionId(), []);

  const lockIdRef = useRef<string | null>(null);
  const heartbeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const activeRef = useRef(active);
  useEffect(() => { activeRef.current = active; });

  const stopHeartbeat = useCallback(() => {
    if (heartbeatTimerRef.current) {
      clearInterval(heartbeatTimerRef.current);
      heartbeatTimerRef.current = null;
    }
  }, []);

  const startHeartbeat = useCallback((lockId: string) => {
    lockIdRef.current = lockId;
    stopHeartbeat();
    heartbeatTimerRef.current = setInterval(async () => {
      if (!lockIdRef.current || !activeRef.current) return;
      await heartbeatFnRef.current({ lockId: lockIdRef.current, sid: clientSessionId });
    }, 10_000);
  }, [clientSessionId, stopHeartbeat]);

  // Stable fn refs for effect closures
  const acquireFnRef = useRef<(sid: string) => Promise<unknown>>(() => Promise.resolve(null));
  const heartbeatFnRef = useRef<(args: { lockId: string; sid: string }) => Promise<unknown>>(() => Promise.resolve(null));
  const releaseFnRef = useRef<(lockId: string) => Promise<unknown>>(() => Promise.resolve(null));
  const takeoverFnRef = useRef<(sid: string) => Promise<unknown>>(() => Promise.resolve(null));

  const acquireMut = useServerMutation({
    mutationFn: (sid: string) =>
      acquireLock(entityType, entityId, targetType, targetId, sid),
    onError: (e) => console.warn("[lock] acquire failed", e),
  });

  const heartbeatMut = useServerMutation({
    mutationFn: ({ lockId, sid }: { lockId: string; sid: string }) =>
      heartbeatLock(lockId, sid),
    onError: () => {},
  });

  const releaseMut = useServerMutation({
    mutationFn: (lockId: string) => releaseLock(lockId, clientSessionId),
    onError: () => {},
  });

  const takeoverMut = useServerMutation({
    mutationFn: (sid: string) =>
      takeoverLock(entityId, targetId, entityType, targetType, sid),
    onError: (e) => console.warn("[lock] takeover failed", e),
  });

  useEffect(() => {
    acquireFnRef.current = (sid) => acquireMut.mutateAsync(sid);
    heartbeatFnRef.current = (args) => heartbeatMut.mutateAsync(args);
    releaseFnRef.current = (lockId) => releaseMut.mutateAsync(lockId);
    takeoverFnRef.current = (sid) => takeoverMut.mutateAsync(sid);
  });

  // Reactive lock view for all subscribers via Convex subscription
  const liveLock = useAuthedQuery(
    api.collaboration.getLock,
    orgId && enabled ? { orgId, entityType, entityId, targetType, targetId } : "skip"
  );

  // Acquire / heartbeat / release lifecycle
  useEffect(() => {
    if (!enabled || !orgId || !active) {
      // If we have a lock and became inactive, release it
      if (!active && lockIdRef.current) {
        const id = lockIdRef.current;
        lockIdRef.current = null;
        releaseFnRef.current(id).catch(() => {});
      }
      return;
    }

    let cancelled = false;
    (async () => {
      const raw = await acquireFnRef.current(clientSessionId);
      if (cancelled) return;
      const result = raw as { acquired: boolean; lockId?: string } | null;
      if (result?.acquired && result.lockId) {
        startHeartbeat(result.lockId);
      }
    })();

    return () => {
      cancelled = true;
      stopHeartbeat();
      if (lockIdRef.current) {
        const id = lockIdRef.current;
        lockIdRef.current = null;
        releaseFnRef.current(id).catch(() => {});
      }
    };
  }, [enabled, orgId, active, entityType, entityId, targetType, targetId, clientSessionId, startHeartbeat, stopHeartbeat]);

  // Derive lock state from live Convex subscription
  const lockState = useMemo((): LockState => {
    if (!liveLock) return { status: "idle" };
    const isOwner = liveLock.ownerUserId === myUserId && liveLock.clientSessionId === clientSessionId;
    const isStale = liveLock.isStale;
    const lockId = String(liveLock._id);
    if (isOwner) {
      return {
        status: "held",
        lockId,
        isSameUser: true,
        sessionId: liveLock.clientSessionId,
      };
    }
    if (isStale) {
      return {
        status: "stale",
        ownerName: liveLock.ownerName,
        ownerColor: liveLock.ownerColor,
        expiresAt: liveLock.expiresAt,
        lockId,
      };
    }
    return {
      status: "blocked",
      ownerName: liveLock.ownerName,
      ownerColor: liveLock.ownerColor,
      ownerUserId: liveLock.ownerUserId,
      expiresAt: liveLock.expiresAt,
      lockId,
    };
  }, [liveLock, myUserId, clientSessionId]);

  const takeover = useCallback(async () => {
    if (!orgId) return null;
    const raw = await takeoverFnRef.current(clientSessionId);
    const result = raw as { acquired: boolean; lockId?: string } | null;
    if (result?.acquired && result.lockId) {
      startHeartbeat(result.lockId);
      await heartbeatFnRef.current({ lockId: result.lockId, sid: clientSessionId });
    }
    return result;
  }, [orgId, clientSessionId, startHeartbeat]);

  const isLocked = lockState.status === "blocked";
  const isHeld = lockState.status === "held";
  const isStale = lockState.status === "stale";

  return { lockState, isLocked, isHeld, isStale, takeover, liveLock };
}

// ─── User colour helper hook ──────────────────────────────────────────────────

/** Returns the current user's stable collaboration colour and initials. */
export function useCurrentUserCollab() {
  const { data: session } = useSession();
  const userId = session?.user?.id ?? "";
  const name = session?.user?.name ?? "?";
  return {
    color: getUserColor(userId),
    initials: getUserInitials(name),
    name,
    userId,
    avatarUrl: (session?.user as { image?: string } | undefined)?.image ?? undefined,
  };
}
