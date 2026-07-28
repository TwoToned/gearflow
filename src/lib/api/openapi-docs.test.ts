import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, test, expect } from "vitest";
import { OPENAPI_DOCUMENT } from "./openapi.generated";
import { LLMS_TXT } from "./llms-txt.generated";
import { API_REGISTRY } from "./registry.generated";

/**
 * OpenAPI 3.1 + llms.txt (#998 acceptance criteria: "OpenAPI 3.1 validates;
 * llms.txt regenerates deterministically; both are staleness-gated in CI").
 * The staleness gate itself is `pnpm run api:docs:check`
 * (scripts/generate-api-docs.mts), wired into .github/workflows/ci.yml right
 * after the registry gate — this file covers the two properties CI alone
 * can't show: the document is actually well-formed, and running the generator
 * twice in a row produces byte-identical output (no clock/random-order drift).
 */

const ROOT = resolve(import.meta.dirname, "../../..");
const GENERATOR = join(ROOT, "scripts/generate-api-docs.mts");

function runGenerator(args: string[]): { ok: boolean; output: string } {
  try {
    const output = execFileSync("pnpm", ["exec", "tsx", GENERATOR, ...args], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true, output };
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string };
    return { ok: false, output: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

type Obj = Record<string, unknown>;

describe("OpenAPI 3.1 document — structural validity", () => {
  test("declares the 3.1.x version and required top-level fields", () => {
    expect(OPENAPI_DOCUMENT.openapi).toMatch(/^3\.1\.\d+$/);
    expect(OPENAPI_DOCUMENT.info.title).toBeTruthy();
    expect(OPENAPI_DOCUMENT.info.version).toBeTruthy();
    expect(Object.keys(OPENAPI_DOCUMENT.paths).length).toBeGreaterThan(0);
  });

  test("declares bearer auth and no other scheme (R-8.11.1 — bearer-only)", () => {
    const schemes = (OPENAPI_DOCUMENT.components as Obj).securitySchemes as Obj;
    expect(Object.keys(schemes)).toEqual(["bearerAuth"]);
    expect((schemes.bearerAuth as Obj).type).toBe("http");
    expect((schemes.bearerAuth as Obj).scheme).toBe("bearer");
  });

  test("every operation declares at least one response with a description", () => {
    for (const [path, item] of Object.entries(OPENAPI_DOCUMENT.paths as Record<string, Obj>)) {
      for (const [method, operation] of Object.entries(item)) {
        const op = operation as Obj;
        expect(op.responses, `${method.toUpperCase()} ${path} has no responses`).toBeTruthy();
        for (const [status, response] of Object.entries(op.responses as Obj)) {
          expect((response as Obj).description, `${method.toUpperCase()} ${path} ${status} has no description`).toBeTruthy();
        }
      }
    }
  });

  test("every $ref in a path resolves to a real components.schemas entry", () => {
    const knownSchemas = new Set(Object.keys((OPENAPI_DOCUMENT.components as Obj).schemas as Obj));
    const refs: string[] = [];
    const walk = (node: unknown) => {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) return node.forEach(walk);
      const obj = node as Obj;
      if (typeof obj.$ref === "string") refs.push(obj.$ref);
      for (const v of Object.values(obj)) walk(v);
    };
    walk(OPENAPI_DOCUMENT.paths);
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      const name = ref.replace("#/components/schemas/", "");
      expect(knownSchemas.has(name), `dangling $ref: ${ref}`).toBe(true);
    }
  });

  test("one path per agent-reachable operation, no more, no fewer", () => {
    const reachableCount = API_REGISTRY.filter((op) => op.agentReachable).length;
    // +3 fixed paths: /whoami, /operations, /operations/{operation}.
    expect(Object.keys(OPENAPI_DOCUMENT.paths).length).toBe(reachableCount + 3);
  });

  test("an injected arg (actor/id/auditId/now/orgId) never appears in a published request schema", () => {
    const assetsListPath = (OPENAPI_DOCUMENT.paths as Record<string, Obj>)["/api/v1/ops/assetWrites.updateNative"];
    expect(assetsListPath).toBeTruthy();
    const schema = ((assetsListPath as Obj).post as Obj).requestBody as Obj;
    const argsSchema = (((schema.content as Obj)["application/json"] as Obj).schema as Obj).properties as Obj;
    const argsProps = Object.keys((argsSchema.args as Obj).properties as Obj);
    expect(argsProps).not.toContain("actor");
    expect(argsProps).not.toContain("auditId");
    expect(argsProps).not.toContain("now");
    expect(argsProps).not.toContain("orgId");
  });
});

describe("llms.txt — deterministic + in sync across all three outputs", () => {
  test("the committed TS constant and the served public/llms.txt file are byte-identical", () => {
    const publicFile = readFileSync(join(ROOT, "public/llms.txt"), "utf8");
    expect(publicFile).toBe(LLMS_TXT);
  });

  test("lists every agent-reachable operation exactly once", () => {
    const reachable = API_REGISTRY.filter((op) => op.agentReachable);
    for (const op of reachable) {
      const occurrences = LLMS_TXT.split(`\`${op.operation}\``).length - 1;
      expect(occurrences, `${op.operation} should appear exactly once`).toBe(1);
    }
  });
});

describe("staleness gate + determinism (invokes the real generator)", () => {
  test("the committed docs are current (api:docs:check passes)", () => {
    const result = runGenerator(["--check"]);
    expect(result.output).toMatch(/API docs current/);
    expect(result.ok).toBe(true);
  }, 60_000);

  test("running the generator twice produces byte-identical output (no clock/random drift)", () => {
    // Regenerate (writes), then --check must still see it as current — if the
    // generator weren't deterministic, its own second run would flag itself stale.
    expect(runGenerator([]).ok).toBe(true);
    const second = runGenerator(["--check"]);
    expect(second.ok).toBe(true);
    expect(second.output).toMatch(/API docs current/);
  }, 60_000);
});
