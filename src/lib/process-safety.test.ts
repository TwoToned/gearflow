import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  installProcessSafetyNet,
  __resetProcessSafetyNetForTests,
} from "./process-safety";

const captureException = vi.fn<(...args: unknown[]) => void>();
const flush = vi.fn<(...args: unknown[]) => Promise<boolean>>(() =>
  Promise.resolve(true),
);
vi.mock("@sentry/nextjs", () => ({
  captureException: (...args: unknown[]) => captureException(...args),
  flush: (...args: unknown[]) => flush(...args),
}));

describe("installProcessSafetyNet", () => {
  const handlers: Record<string, (arg: unknown) => void> = {};
  let onSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    __resetProcessSafetyNetForTests();
    captureException.mockClear();
    flush.mockClear();
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
    const calls = onSpy.mock.calls.map((c) => c[0]);
    expect(calls.filter((e) => e === "unhandledRejection")).toHaveLength(1);
    expect(calls.filter((e) => e === "uncaughtException")).toHaveLength(1);
  });

  it("logs and reports an unhandled rejection WITHOUT exiting", () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as never);
    installProcessSafetyNet("web");

    handlers.unhandledRejection?.(new Error("boom"));

    expect(errSpy).toHaveBeenCalledWith("[web] unhandledRejection:", expect.any(Error));
    expect(captureException).toHaveBeenCalledTimes(1);
    expect(exitSpy).not.toHaveBeenCalled(); // the whole point: do not crash the server
    exitSpy.mockRestore();
  });

  it("wraps a non-Error rejection reason in an Error before reporting", () => {
    installProcessSafetyNet("web");
    handlers.unhandledRejection?.("string reason");
    const reported = captureException.mock.calls[0]?.[0];
    expect(reported).toBeInstanceOf(Error);
    expect((reported as Error).message).toBe("string reason");
  });

  it("reports and exits on an uncaught exception", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as never);
    installProcessSafetyNet("discord-bot");

    handlers.uncaughtException?.(new Error("fatal"));

    expect(captureException).toHaveBeenCalledTimes(1);
    expect(flush).toHaveBeenCalled();
    // flush().finally(() => process.exit(1)) resolves on a later tick — wait for
    // it so the exit happens while the spy is still installed (no leak).
    await flush.mock.results[0]!.value;
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });
});
