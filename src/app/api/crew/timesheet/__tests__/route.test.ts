import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { z } from "zod";

const impl = vi.hoisted(() => ({ fn: (_f: unknown): Promise<string> => Promise.resolve(""), last: undefined as unknown }));
vi.mock("@/server/crew-time", () => ({
  exportTimesheetCSV: (f: unknown) => {
    impl.last = f;
    return impl.fn(f);
  },
}));

import { GET } from "../route";

const req = (qs = "") => new NextRequest(`https://flow.test/api/crew/timesheet${qs}`);

describe("GET /api/crew/timesheet", () => {
  it("streams the server CSV", async () => {
    impl.fn = async () => "Crew Member\n";
    const res = await GET(req("?dateFrom=2026-11-01"));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("Crew Member\n");
    expect(impl.last).toMatchObject({ dateFrom: "2026-11-01" });
  });

  it("a filter that fails validation is a 400, not a 401", async () => {
    impl.fn = async () => {
      z.object({ status: z.string().max(2) }).parse({ status: "way too long" });
      return "";
    };
    expect((await GET(req("?status=way+too+long"))).status).toBe(400);
  });

  it("an auth failure is still a 401", async () => {
    impl.fn = async () => {
      throw new Error("Unauthorized");
    };
    expect((await GET(req())).status).toBe(401);
  });
});
