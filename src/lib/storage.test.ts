import { beforeEach, describe, expect, it, vi } from "vitest";

const convexMock = vi.hoisted(() => ({ query: vi.fn(), mutation: vi.fn() }));
vi.mock("@/lib/convex-client", () => ({
  getConvexClient: vi.fn(async () => convexMock),
}));

vi.mock("@/lib/fetch-with-timeout", () => ({ fetchWithTimeout: vi.fn() }));

import { fetchWithTimeout } from "@/lib/fetch-with-timeout";
import { uploadToS3 } from "@/lib/storage";

const fetchMock = vi.mocked(fetchWithTimeout);

// Convex's generated `api` object is a Proxy that mints a fresh reference on
// every property access (no stable identity, no toString) — so distinguish
// calls by argument shape instead of `fn === api.files.generateUploadUrl`.
function isGenerateUploadUrlCall(args: unknown): boolean {
  return typeof args === "object" && args !== null && !("storageId" in args);
}

function jsonResponse(status: number, body?: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  let urlCounter = 0;
  convexMock.mutation.mockImplementation(async (_fn: unknown, args: unknown) => {
    if (isGenerateUploadUrlCall(args)) {
      urlCounter += 1;
      return `https://upload.example/${urlCounter}`;
    }
    return null; // register
  });
});

describe("uploadToS3 retry (POLICY.md R-8.10.3)", () => {
  it("retries a transient (5xx) upload failure and succeeds", async () => {
    vi.useFakeTimers();
    fetchMock
      .mockResolvedValueOnce(jsonResponse(503))
      .mockResolvedValueOnce(jsonResponse(200, { storageId: "storage_1" }));

    const promise = uploadToS3(Buffer.from("bytes"), {
      organizationId: "org_1",
      folder: "avatars",
      entityId: "ent_1",
      fileName: "a.png",
      mimeType: "image/png",
    });
    await vi.advanceTimersByTimeAsync(5000);
    const result = await promise;

    expect(result).toEqual({ storageKey: "storage_1", url: "/api/files/storage_1" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // A fresh (one-time-use) upload URL is minted on every attempt.
    const generateCalls = convexMock.mutation.mock.calls.filter(([, args]) =>
      isGenerateUploadUrlCall(args),
    );
    expect(generateCalls).toHaveLength(2);
    vi.useRealTimers();
  });

  it("does not retry a non-retryable (4xx) upload failure", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(400));

    await expect(
      uploadToS3(Buffer.from("bytes"), {
        organizationId: "org_1",
        folder: "avatars",
        entityId: "ent_1",
        fileName: "a.png",
        mimeType: "image/png",
      }),
    ).rejects.toThrow("Convex storage upload failed: 400");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws after exhausting retries on a persistent transient failure", async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue(jsonResponse(500));

    const promise = uploadToS3(Buffer.from("bytes"), {
      organizationId: "org_1",
      folder: "avatars",
      entityId: "ent_1",
      fileName: "a.png",
      mimeType: "image/png",
    });
    const assertion = expect(promise).rejects.toThrow("Convex storage upload failed: 500");
    await vi.advanceTimersByTimeAsync(10_000);
    await assertion;

    expect(fetchMock).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });
});
