/**
 * Curated REST aliases (design §11, #998) — proves the alias literally calls
 * the same `dispatch()` the generic `/ops/{operation}` route uses, so the two
 * can't drift. Only one representative alias is exercised end to end here;
 * `dispatcher.test.ts` covers dispatch() itself exhaustively.
 */
import { test, expect, vi, beforeEach } from "vitest";

const dispatch = vi.fn(async () => ({ status: 200, body: { data: [{ id: "p1" }], requestId: "req_1" } }));
vi.mock("@/lib/api/dispatcher", () => ({
  dispatch: (...args: unknown[]) => dispatch(...(args as [])),
}));

const { GET } = await import("./route");

beforeEach(() => vi.clearAllMocks());

test("GET /api/v1/projects calls dispatch(\"projects.list\", …) — the same path /ops/{operation} uses", async () => {
  const request = new Request("http://localhost/api/v1/projects", {
    headers: { authorization: "Bearer gf_live_test", "x-request-id": "req_1" },
  }) as never;

  const res = await GET(request);
  const body = await res.json();

  expect(dispatch).toHaveBeenCalledWith(
    "projects.list",
    { args: {}, idempotencyKey: undefined },
    "Bearer gf_live_test",
    "req_1",
  );
  expect(res.status).toBe(200);
  expect(body.data).toEqual([{ id: "p1" }]);
});
