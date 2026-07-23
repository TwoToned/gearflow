import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  installProcessSafetyNet,
  __resetProcessSafetyNetForTests,
} from "./process-safety";

const phCapture = vi.fn<(...args: unknown[]) => Promise<void>>(() =>
  Promise.resolve(),
);
vi.mock("@/lib/posthog-server", () => ({
  captureServerException: (...args: unknown[]) => phCapture(...args),
}));

// Let all queued microtasks (Promise.allSettled(...).finally(exit)) drain.
const drain = () => new Promise((r) => setTimeout(r, 0));

describe("installProcessSafetyNet", () => {
  const handlers: Record<string, (arg: unknown) => void> = {};
  let onSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    __resetProcessSafetyNetForTests();
    phCapture.mockClear();
    for (const k of Object.keys(handlers)) delete handlers[k];
    onSpy = vi
      .spyOn(process, "on")
      // capture the registered listeners instead of really wiring them
      .mockImplementation(((event: string | symbol, cb: (arg: unknown) => void) => {
        handlers[String(event)] = cb;
        return process;
      }) as never) as unknown as ReturnType<typeof vi.spyOn>;
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    onSpy.mockRestore();
    errSpy.mockRestore();
  });

  it("registers unhandledRejection and uncaughtException once", () => {
    installProcessSafetyNet("test");
    installProcessSafetyNet("test"); // idempotent — second call is a no-op
    const calls = onSpy.mock.calls.map((c: string[]) => c[0]);
    expect(calls.filter((e: string) => e === "unhandledRejection")).toHaveLength(1);
    expect(calls.filter((e: string) => e === "uncaughtException")).toHaveLength(1);
  });

  it("logs and reports an unhandled rejection WITHOUT exiting", () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as never);
    installProcessSafetyNet("web");

    handlers.unhandledRejection?.(new Error("boom"));

    expect(errSpy).toHaveBeenCalledWith("[web] unhandledRejection:", expect.any(Error));
    expect(phCapture).toHaveBeenCalledTimes(1);
    expect(exitSpy).not.toHaveBeenCalled(); // the whole point: do not crash the server
    exitSpy.mockRestore();
  });

  it("wraps a non-Error rejection reason in an Error before reporting", () => {
    installProcessSafetyNet("web");
    handlers.unhandledRejection?.("string reason");
    const reported = phCapture.mock.calls[0]?.[0];
    expect(reported).toBeInstanceOf(Error);
    expect((reported as Error).message).toBe("string reason");
  });

  it("reports and exits on an uncaught exception", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as never);
    installProcessSafetyNet("worker");

    handlers.uncaughtException?.(new Error("fatal"));

    expect(phCapture).toHaveBeenCalledTimes(1);
    // exit is gated on captureServerException(...).finally(exit), which resolves
    // on a later tick — drain the queue before asserting (no leak).
    await drain();
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });
});
