import { afterEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };

const sendMock = vi.hoisted(() => vi.fn());
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: sendMock };
  },
}));
vi.mock("@/lib/vendor-cost-tracking", () => ({ reportVendorUsage: vi.fn() }));

async function loadEmailModule() {
  vi.resetModules();
  process.env.RESEND_API_KEY = "re_test_key_1234567890";
  return import("@/lib/email");
}

describe("sendEmail retry (POLICY.md R-8.10.3)", () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.useRealTimers();
    sendMock.mockReset();
  });

  it("retries a transient Resend error and succeeds", async () => {
    sendMock
      .mockResolvedValueOnce({ data: null, error: { message: "rate limited" } })
      .mockResolvedValueOnce({ data: { id: "email_123" }, error: null });

    const { sendEmail } = await loadEmailModule();
    vi.useFakeTimers();

    const promise = sendEmail({ to: "a@x.com", subject: "hi", html: "<p>hi</p>" });
    await vi.advanceTimersByTimeAsync(5000);
    const result = await promise;

    expect(result).toEqual({ id: "email_123" });
    expect(sendMock).toHaveBeenCalledTimes(2);
  });

  it("throws after exhausting retries on a persistent failure", async () => {
    sendMock.mockResolvedValue({ data: null, error: { message: "down" } });

    const { sendEmail } = await loadEmailModule();
    vi.useFakeTimers();

    const promise = sendEmail({ to: "a@x.com", subject: "hi", html: "<p>hi</p>" });
    const assertion = expect(promise).rejects.toThrow("Failed to send email: down");
    await vi.advanceTimersByTimeAsync(10_000);
    await assertion;

    expect(sendMock).toHaveBeenCalledTimes(3);
  });

  it("succeeds without retrying on the first try", async () => {
    sendMock.mockResolvedValueOnce({ data: { id: "email_456" }, error: null });

    const { sendEmail } = await loadEmailModule();
    const result = await sendEmail({ to: "a@x.com", subject: "hi", html: "<p>hi</p>" });

    expect(result).toEqual({ id: "email_456" });
    expect(sendMock).toHaveBeenCalledTimes(1);
  });
});
