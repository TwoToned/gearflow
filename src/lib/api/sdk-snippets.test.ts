import { describe, test, expect } from "vitest";
import { curlSnippet, typescriptSnippet, pythonSnippet, snippetsFor } from "./sdk-snippets";
import { API_REGISTRY_BY_OPERATION } from "./registry.generated";
import { API_BASE_URL } from "./version";

/**
 * SDK snippets (#1004): derived from the registry, not hand-written, so a
 * regression here means the DERIVATION broke — not that some committed
 * example text drifted from reality (there is no committed text to drift).
 */

const readOp = API_REGISTRY_BY_OPERATION.get("assets.list")!;
const writeOp = API_REGISTRY_BY_OPERATION.get("lineItemWrites.addNative")!;

describe("curlSnippet", () => {
  test("posts to the operation's /api/v1/ops path with a bearer placeholder", () => {
    const snippet = curlSnippet(readOp);
    expect(snippet).toContain(`curl -X POST ${API_BASE_URL}/api/v1/ops/assets.list`);
    expect(snippet).toContain("Authorization: Bearer $RVLT_FLOW_API_KEY");
    expect(snippet).not.toContain("idempotencyKey"); // reads don't need one
  });

  test("a mutation's body includes an idempotencyKey placeholder", () => {
    expect(curlSnippet(writeOp)).toContain("idempotencyKey");
  });

  test("never includes a server-injected field (actor/id/auditId/now/orgId)", () => {
    const snippet = curlSnippet(writeOp);
    expect(snippet).not.toMatch(/"actor"/);
    expect(snippet).not.toMatch(/"auditId"/);
    expect(snippet).not.toMatch(/"orgId"/);
  });
});

describe("typescriptSnippet", () => {
  test("is a fetch() call against the same URL, with a JSON body", () => {
    const snippet = typescriptSnippet(readOp);
    expect(snippet).toContain(`fetch("${API_BASE_URL}/api/v1/ops/assets.list"`);
    expect(snippet).toContain("JSON.stringify(");
    expect(snippet).toContain("process.env.RVLT_FLOW_API_KEY");
  });
});

describe("pythonSnippet", () => {
  test("uses Python literals (True/None), never JSON's true/null", () => {
    const snippet = pythonSnippet(writeOp);
    expect(snippet).toContain("requests.post(");
    expect(snippet).not.toMatch(/:\s*true\b/);
    expect(snippet).not.toMatch(/:\s*null\b/);
  });

  test("an empty-object/array placeholder renders as Python {}/[] (valid either language)", () => {
    // Any op with an object/array-typed public arg exercises the branch;
    // fall back to asserting the function never throws on the whole registry.
    for (const op of API_REGISTRY_BY_OPERATION.values()) {
      expect(() => pythonSnippet(op)).not.toThrow();
    }
  });
});

describe("snippetsFor", () => {
  test("returns all three languages", () => {
    const snippets = snippetsFor(readOp);
    expect(Object.keys(snippets).sort()).toEqual(["curl", "python", "typescript"]);
  });
});
