import { describe, it, expect } from "vitest";
import { buildRuntimeDatabaseUrl } from "./db-url";

const BASE = "postgresql://user:pw@localhost:5432/gearflow?schema=public";

function paramsOf(url: string) {
  return new URL(url).searchParams;
}

describe("buildRuntimeDatabaseUrl", () => {
  it("adds statement_timeout via the libpq options param", () => {
    const out = buildRuntimeDatabaseUrl(BASE, { statementTimeoutMs: 30000 });
    expect(paramsOf(out).get("options")).toBe("-c statement_timeout=30000");
  });

  it("preserves existing query params (e.g. schema)", () => {
    const out = buildRuntimeDatabaseUrl(BASE, { statementTimeoutMs: 30000 });
    expect(paramsOf(out).get("schema")).toBe("public");
  });

  it("sets pool_timeout and connection_limit when provided", () => {
    const out = buildRuntimeDatabaseUrl(BASE, { poolTimeoutS: 10, connectionLimit: 12 });
    const p = paramsOf(out);
    expect(p.get("pool_timeout")).toBe("10");
    expect(p.get("connection_limit")).toBe("12");
  });

  it("leaves connection_limit to Prisma's default when not provided", () => {
    const out = buildRuntimeDatabaseUrl(BASE, { statementTimeoutMs: 30000 });
    expect(paramsOf(out).has("connection_limit")).toBe(false);
  });

  it("does not override params the operator set explicitly in the env URL", () => {
    const withOverrides =
      "postgresql://user:pw@localhost:5432/db?connection_limit=3&pool_timeout=2";
    const out = buildRuntimeDatabaseUrl(withOverrides, {
      poolTimeoutS: 10,
      connectionLimit: 12,
    });
    const p = paramsOf(out);
    expect(p.get("connection_limit")).toBe("3");
    expect(p.get("pool_timeout")).toBe("2");
  });

  it("does not clobber an operator-provided statement_timeout in options", () => {
    const withOpts =
      "postgresql://user:pw@localhost:5432/db?options=-c%20statement_timeout%3D5000";
    const out = buildRuntimeDatabaseUrl(withOpts, { statementTimeoutMs: 30000 });
    expect(paramsOf(out).get("options")).toBe("-c statement_timeout=5000");
  });

  it("appends statement_timeout alongside an unrelated existing option", () => {
    const withOpts =
      "postgresql://user:pw@localhost:5432/db?options=-c%20application_name%3Dgearflow";
    const out = buildRuntimeDatabaseUrl(withOpts, { statementTimeoutMs: 30000 });
    expect(paramsOf(out).get("options")).toBe(
      "-c application_name=gearflow -c statement_timeout=30000",
    );
  });

  it("disables the timeout when set to 0", () => {
    const out = buildRuntimeDatabaseUrl(BASE, { statementTimeoutMs: 0 });
    expect(paramsOf(out).has("options")).toBe(false);
  });

  it("returns a non-URL connection string untouched", () => {
    const kv = "host=localhost dbname=gearflow user=app";
    expect(buildRuntimeDatabaseUrl(kv, { statementTimeoutMs: 30000 })).toBe(kv);
  });
});
