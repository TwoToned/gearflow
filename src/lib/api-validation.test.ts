import { describe, expect, it } from "vitest";
import { z } from "zod";
import { readValidatedBody, withValidatedBody } from "./api-validation";

const schema = z.object({ email: z.string().email() });
const req = (body: string) =>
  new Request("http://localhost/api", { method: "POST", body });

describe("readValidatedBody", () => {
  it("returns parsed data for a valid body", async () => {
    const r = await readValidatedBody(req('{"email":"a@b.com"}'), schema);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.email).toBe("a@b.com");
  });

  it("400s on invalid JSON", async () => {
    const r = await readValidatedBody(req("not json"), schema);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.status).toBe(400);
  });

  it("400s on schema mismatch", async () => {
    const r = await readValidatedBody(req('{"email":"nope"}'), schema);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.status).toBe(400);
  });
});

// R-8.6.4 — a route built with withValidatedBody structurally cannot skip the schema.
describe("withValidatedBody", () => {
  it("calls the handler with the parsed body on a valid request", async () => {
    const handler = withValidatedBody(schema, async (body) => {
      return new Response(JSON.stringify({ received: body.email }), { status: 200 });
    });
    const res = await handler(req('{"email":"a@b.com"}'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: "a@b.com" });
  });

  it("returns 400 without calling the handler on an invalid body", async () => {
    let called = false;
    const handler = withValidatedBody(schema, async () => {
      called = true;
      return new Response(null, { status: 200 });
    });
    const res = await handler(req('{"email":"nope"}'));
    expect(res.status).toBe(400);
    expect(called).toBe(false);
  });

  it("passes the request and context through to the handler", async () => {
    const handler = withValidatedBody<{ email: string }, { params: Promise<{ id: string }> }>(
      schema,
      async (body, request, context) => {
        const { id } = await context.params;
        return new Response(JSON.stringify({ email: body.email, url: request.url, id }), { status: 200 });
      },
    );
    const res = await handler(req('{"email":"a@b.com"}'), { params: Promise.resolve({ id: "42" }) });
    expect(await res.json()).toEqual({ email: "a@b.com", url: "http://localhost/api", id: "42" });
  });
});
