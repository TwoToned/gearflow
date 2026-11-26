import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * The crew-document download route (owner ruling B2): only the member themself or crew:update, on
 * a cookie session; everyone else, and every missing document, gets the SAME 404; nothing is
 * fetched before the rule passes; the bytes go out `private, no-store`.
 */
const state = vi.hoisted(() => ({
  authed: true as boolean,
  userId: "u1",
  role: "manager" as string | null,
  info: null as null | { url: string; memberUserId: string | null; fileName: string; mimeType: string; fileSize: number },
  queryArgs: undefined as unknown,
  fetched: [] as string[],
}));

vi.mock("@/lib/auth-server", () => ({
  requireOrganization: async () => {
    if (!state.authed) throw new Error("Unauthorized");
    return { organizationId: "org1", session: { user: { id: state.userId } } };
  },
}));
vi.mock("@/lib/org-context", () => ({ getCurrentRole: async () => state.role }));
vi.mock("@/lib/convex-client", () => ({
  getConvexClient: async () => ({
    query: async (_ref: unknown, args: unknown) => {
      state.queryArgs = args;
      return state.info;
    },
  }),
}));
vi.mock("@/lib/fetch-with-timeout", () => ({
  fetchWithTimeout: async (url: string) => {
    state.fetched.push(url);
    return new Response("PDFBYTES", { status: 200 });
  },
}));
vi.mock("../../../../../../../../convex/_generated/api", () => ({ api: { crewDocuments: { getForDownload: "getForDownload" } } }));

import { GET } from "../route";

const call = (id = "d1") => GET(new NextRequest(`https://flow.test/api/crew/documents/${id}/file`), { params: Promise.resolve({ id }) });

beforeEach(() => {
  state.authed = true;
  state.userId = "u1";
  state.role = "manager";
  state.info = { url: "https://storage.test/k", memberUserId: "u_member", fileName: 'white "card".pdf', mimeType: "application/pdf", fileSize: 8 };
  state.queryArgs = undefined;
  state.fetched = [];
});

describe("GET /api/crew/documents/[id]/file", () => {
  it("serves a manager (crew:update) with private, no-store headers and a clean file name", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("PDFBYTES");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("content-disposition")).toContain('filename="white _card_.pdf"');
    expect(state.queryArgs).toEqual({ orgId: "org1", id: "d1" });
  });

  it("serves the member themself even with a read-only role", async () => {
    state.role = "member";
    state.userId = "u_member";
    expect((await call()).status).toBe(200);
  });

  it("a warehouse user, a viewer and another member get the same 404 as a missing document, and nothing is fetched", async () => {
    for (const [role, userId] of [["warehouse", "u2"], ["viewer", "u3"], ["member", "u4"]] as const) {
      state.role = role;
      state.userId = userId;
      expect((await call()).status).toBe(404);
    }
    state.role = "manager";
    state.info = null;
    expect((await call("missing")).status).toBe(404);
    expect(state.fetched).toEqual([]);
  });

  it("an unauthenticated caller is a 401 and a malformed id a 404", async () => {
    state.authed = false;
    expect((await call()).status).toBe(401);
    state.authed = true;
    expect((await call("")).status).toBe(404);
    expect(state.queryArgs).toBeUndefined();
  });
});
