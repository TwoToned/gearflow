/**
 * exportActivityLogCSV routes every cell through `@/lib/csv` (the one
 * formula-injection guard). User-controlled text (user name, entity name,
 * summary, details) that starts with `= + - @`, tab or CR must open as text.
 */
import { describe, it, expect, vi } from "vitest";

const queryMock = vi.fn();
vi.mock("@/lib/convex-client", () => ({
  getConvexClient: vi.fn(async () => ({ query: queryMock })),
}));
vi.mock("@/lib/org-context", () => ({
  getOrgContext: vi.fn(async () => ({ organizationId: "org_1" })),
}));

import { exportActivityLogCSV } from "./activity-log";

describe("exportActivityLogCSV", () => {
  it("neutralises formula starts in every user-controlled column", async () => {
    queryMock.mockResolvedValueOnce([
      {
        createdAt: "2026-11-01T00:00:00.000Z",
        userName: "=HYPERLINK(\"http://x\",\"y\")",
        action: "+UPDATE",
        entityType: "-project",
        entityName: "@SUM(A1)",
        summary: "\tcmd",
        details: undefined,
      },
      {
        createdAt: "2026-11-02T00:00:00.000Z",
        userName: "\rAlice",
        action: "CREATE",
        entityType: "project",
        entityName: "Main Stage",
        summary: "Created job",
        details: { note: "x" },
      },
    ]);

    const lines = (await exportActivityLogCSV()).split("\n");

    expect(lines[0]).toBe("Timestamp,User,Action,Entity Type,Entity Name,Summary,Details");
    expect(lines[1]).toBe(
      "2026-11-01T00:00:00.000Z,\"'=HYPERLINK(\"\"http://x\"\",\"\"y\"\")\",'+UPDATE,'-project,'@SUM(A1),'\tcmd,",
    );
    // CR is both a formula start and a line break, so the cell is guarded AND quoted;
    // JSON details are quoted (they contain `"`), never prefixed (they start with `{`).
    expect(lines.slice(2).join("\n")).toBe(
      "2026-11-02T00:00:00.000Z,\"'\rAlice\",CREATE,project,Main Stage,Created job,\"{\"\"note\"\":\"\"x\"\"}\"",
    );
  });
});
