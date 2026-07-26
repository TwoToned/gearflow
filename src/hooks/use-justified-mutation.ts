"use client";

import { useCallback, useRef, useState } from "react";
import { ConvexError } from "convex/values";

/**
 * #793 shared wrapper: pre-checks the project's lock tier and prompts for a
 * justification BEFORE invoking a gated mutation, and also catches the
 * server's `JUSTIFICATION_REQUIRED` as a fallback (the project may have
 * advanced to ON_SITE+ underneath a stale client). One shared hook so every
 * equipment/group/service/crew surface prompts the same way — not a
 * per-form one-off (CLAUDE.md / #793 acceptance criteria).
 *
 * Usage:
 *   const { run, dialogProps } = useJustifiedMutation(mutateFn, lockStatus);
 *   await run({ ...args }); // shows the dialog + waits for confirm if needed
 *   <JustificationDialog {...dialogProps} />
 */

function isJustificationRequired(e: unknown): boolean {
  return (
    e instanceof ConvexError &&
    !!e.data &&
    typeof e.data === "object" &&
    (e.data as { code?: unknown }).code === "JUSTIFICATION_REQUIRED"
  );
}

export interface LockStatusLike {
  tier?: "OPEN" | "FINANCE_LOCKED" | "JUSTIFY" | "HARD_LOCKED";
  hasOpenSession?: boolean;
}

interface PendingCall<TArgs, TResult> {
  args: TArgs;
  resolve: (v: TResult) => void;
  reject: (e: unknown) => void;
}

export function useJustifiedMutation<TArgs extends { justification?: string }, TResult>(
  mutate: (args: TArgs) => Promise<TResult>,
  status: LockStatusLike | undefined,
) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pendingCall = useRef<PendingCall<TArgs, TResult> | null>(null);

  const needsJustification = status?.tier === "JUSTIFY" && !status.hasOpenSession;

  const promptFor = useCallback((args: TArgs): Promise<TResult> => {
    return new Promise<TResult>((resolve, reject) => {
      pendingCall.current = { args, resolve, reject };
      setError(null);
      setOpen(true);
    });
  }, []);

  const run = useCallback(
    async (args: TArgs): Promise<TResult> => {
      if (needsJustification && !args.justification) {
        return promptFor(args);
      }
      try {
        return await mutate(args);
      } catch (e) {
        if (isJustificationRequired(e)) return promptFor(args);
        throw e;
      }
    },
    [mutate, needsJustification, promptFor],
  );

  const confirm = useCallback(
    async (justification: string) => {
      const call = pendingCall.current;
      if (!call) return;
      setPending(true);
      setError(null);
      try {
        const result = await mutate({ ...call.args, justification });
        call.resolve(result);
        setOpen(false);
        pendingCall.current = null;
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong. Try again.");
      } finally {
        setPending(false);
      }
    },
    [mutate],
  );

  const cancel = useCallback(() => {
    pendingCall.current?.reject(new Error("Cancelled"));
    pendingCall.current = null;
    setOpen(false);
    setError(null);
  }, []);

  return {
    run,
    dialogProps: { open, onOpenChange: (v: boolean) => (v ? undefined : cancel()), onConfirm: confirm, onCancel: cancel, pending, error },
  };
}
