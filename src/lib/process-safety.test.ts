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

  it("does NOT exit when a peer hung up mid-request (the CI/prod 502 maker)", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as never);
    installProcessSafetyNet("web");

    // The exact shape Next's dev server throws when a request is aborted while
    // a route is still compiling: a bare `Error: aborted` carrying ECONNRESET.
    const aborted = Object.assign(new Error("aborted"), { code: "ECONNRESET" });
    handlers.uncaughtException?.(aborted);

    await drain();
    expect(exitSpy).not.toHaveBeenCalled(); // the whole point: keep serving
    expect(phCapture).not.toHaveBeenCalled(); // routine, not a defect
    expect(errSpy).toHaveBeenCalledWith("[web] ignored peer disconnect:", aborted);
    exitSpy.mockRestore();
  });

  it.each(["ECONNRESET", "ECONNABORTED", "EPIPE", "ERR_STREAM_PREMATURE_CLOSE"])(
    "treats %s as a peer disconnect, not a fatal fault",
    async (code) => {
      const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as never);
      installProcessSafetyNet("web");

      handlers.uncaughtException?.(Object.assign(new Error("socket hang up"), { code }));

      await drain();
      expect(exitSpy).not.toHaveBeenCalled();
      exitSpy.mockRestore();
    },
  );

  it("still exits on a real fault that merely mentions a disconnect code", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as never);
    installProcessSafetyNet("web");

    // Message-matching would swallow this; the check is on `code` for that reason.
    handlers.uncaughtException?.(new Error("ECONNRESET while rebuilding the index"));

    await drain();
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(phCapture).toHaveBeenCalledTimes(1);
    exitSpy.mockRestore();
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
