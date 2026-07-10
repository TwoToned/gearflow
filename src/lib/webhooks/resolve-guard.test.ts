import { describe, it, expect, vi, beforeEach } from "vitest";

const lookup = vi.hoisted(() => vi.fn());
vi.mock("node:dns/promises", () => ({ lookup }));

const { hostResolvesToPrivate } = await import("./resolve-guard");

beforeEach(() => vi.clearAllMocks());

describe("hostResolvesToPrivate", () => {
  it("blocks a hostname that resolves to the metadata endpoint (the static-DNS bypass)", async () => {
    lookup.mockResolvedValue([{ address: "169.254.169.254", family: 4 }]);
    expect(await hostResolvesToPrivate("https://mymeta.attacker.com/x")).toBe(true);
  });

  it("blocks when ANY resolved address is private (multi-A record)", async () => {
    lookup.mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
      { address: "10.0.0.5", family: 4 },
    ]);
    expect(await hostResolvesToPrivate("https://mixed.example.com/x")).toBe(true);
  });

  it("blocks a resolved private IPv6 address", async () => {
    lookup.mockResolvedValue([{ address: "::1", family: 6 }]);
    expect(await hostResolvesToPrivate("https://sneaky.example.com/x")).toBe(true);
  });

  it("allows a hostname that resolves only to public addresses", async () => {
    lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    expect(await hostResolvesToPrivate("https://hooks.example.com/x")).toBe(false);
    expect(lookup).toHaveBeenCalledWith("hooks.example.com", { all: true });
  });

  it("blocks an IP literal without a DNS lookup", async () => {
    expect(await hostResolvesToPrivate("https://127.0.0.1/x")).toBe(true);
    expect(await hostResolvesToPrivate("https://[::ffff:169.254.169.254]/x")).toBe(true);
    expect(lookup).not.toHaveBeenCalled();
  });

  it("does not block on a transient DNS failure — the fetch will fail and be recorded", async () => {
    lookup.mockRejectedValue(new Error("ENOTFOUND"));
    expect(await hostResolvesToPrivate("https://ghost.example.com/x")).toBe(false);
  });

  it("treats an unparseable URL as unsafe", async () => {
    expect(await hostResolvesToPrivate("not a url")).toBe(true);
  });
});
