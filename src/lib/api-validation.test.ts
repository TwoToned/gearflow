import { describe, expect, it } from "vitest";
import { z } from "zod";
import { readValidatedBody } from "./api-validation";

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
