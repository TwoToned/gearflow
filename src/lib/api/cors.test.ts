import { describe, expect, it } from "vitest";
import { withCors, corsPreflight } from "./cors";

describe("withCors", () => {
  it("sets an open, credential-less CORS header set on the response", () => {
    const response = withCors(new Response(null, { status: 200 }));
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.get("Access-Control-Allow-Methods")).toContain("POST");
    expect(response.headers.get("Access-Control-Allow-Headers")).toContain("Authorization");
    expect(response.headers.get("Access-Control-Allow-Headers")).toContain("Mcp-Session-Id");
    expect(response.headers.get("Access-Control-Expose-Headers")).toContain("Mcp-Session-Id");
    expect(response.headers.get("Access-Control-Allow-Credentials")).toBeNull();
  });

  it("preserves the response status and existing headers", () => {
    const response = withCors(new Response(null, { status: 401, headers: { "WWW-Authenticate": "Bearer" } }));
    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toBe("Bearer");
  });
});

describe("corsPreflight", () => {
  it("answers OPTIONS with a bare 204 carrying the same CORS headers", () => {
    const response = corsPreflight();
    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
});
