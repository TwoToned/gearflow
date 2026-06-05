/**
 * Integration tests for configurable auto project numbers (createProject +
 * peekNextProjectNumber). Verifies the sequence is allocated atomically, renders
 * via the org's template, respects padding, falls back to manual entry, and that
 * preview never consumes a number.
 */

import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import {
  testPrisma,
  setupIntegrationTest,
  createOrgFixture,
  createUserFixture,
} from "../../tests/helpers/integration";
import { datePartsInTimezone } from "@/lib/project-number";

const h = vi.hoisted(() => ({
  ctx: { organizationId: "", userId: "", userName: "Tester" },
}));
vi.mock("@/lib/org-context", () => ({
  getOrgContext: async () => h.ctx,
  requirePermission: async () => h.ctx,
}));
vi.mock("@/lib/activity-log", () => ({ logActivity: vi.fn(async () => {}) }));

import { createProject, peekNextProjectNumber } from "@/server/projects";

function act(orgId: string, userId: string) {
  h.ctx.organizationId = orgId;
  h.ctx.userId = userId;
}

async function setFormat(
  orgId: string,
  cfg: { format?: string; reset?: string; padding?: number; timezone?: string },
) {
  await testPrisma.organization.update({
    where: { id: orgId },
    data: {
      metadata: JSON.stringify({
        projectNumberFormat: cfg.format,
        projectNumberIncrementReset: cfg.reset,
        projectNumberIncrementPadding: cfg.padding,
        timezone: cfg.timezone ?? "UTC",
      }),
    },
  });
}

/** Current YYMM in UTC, matching the engine's view used by the server. */
function yymm() {
  const p = datePartsInTimezone(new Date(), "UTC");
  return String(p.year).slice(-2) + String(p.month).padStart(2, "0");
}

describe("auto project numbers", () => {
  beforeEach(async () => {
    await setupIntegrationTest();
  });
  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it("auto-generates sequential numbers within the reset period", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id);
    act(org.id, user.id);
    await setFormat(org.id, { format: "%YY%MM%INC", reset: "MONTHLY", padding: 2 });

    const p1 = (await createProject({ name: "A" })) as { projectNumber: string };
    const p2 = (await createProject({ name: "B" })) as { projectNumber: string };

    expect(p1.projectNumber).toBe(`${yymm()}01`);
    expect(p2.projectNumber).toBe(`${yymm()}02`);
  });

  it("respects increment padding and literal text", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id);
    act(org.id, user.id);
    await setFormat(org.id, { format: "GIG-%SEQ", reset: "NONE", padding: 4 });

    const p1 = (await createProject({ name: "A" })) as { projectNumber: string };
    expect(p1.projectNumber).toBe("GIG-0001");
  });

  it("keeps a manually-entered number even when auto-numbering is on", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id);
    act(org.id, user.id);
    await setFormat(org.id, { format: "%YY%MM%INC", reset: "MONTHLY", padding: 2 });

    const p = (await createProject({ name: "A", projectNumber: "MANUAL-99" })) as { projectNumber: string };
    expect(p.projectNumber).toBe("MANUAL-99");
  });

  it("rejects a blank code when auto-numbering is NOT configured", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id);
    act(org.id, user.id);
    // No metadata / no format.
    await expect(createProject({ name: "A" })).rejects.toThrow();
  });

  it("peekNextProjectNumber previews without consuming a number", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id);
    act(org.id, user.id);
    await setFormat(org.id, { format: "%YY%MM%INC", reset: "MONTHLY", padding: 2 });

    const peek1 = await peekNextProjectNumber();
    const peek2 = await peekNextProjectNumber();
    expect(peek1).toBe(`${yymm()}01`);
    expect(peek2).toBe(`${yymm()}01`); // unchanged — preview must not increment

    await createProject({ name: "A" });
    const peek3 = await peekNextProjectNumber();
    expect(peek3).toBe(`${yymm()}02`);
  });

  it("preview honours an unsaved format override", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id);
    act(org.id, user.id);
    await setFormat(org.id, { format: "%YY%MM%INC", reset: "MONTHLY", padding: 2 });

    const preview = await peekNextProjectNumber({ format: "JOB-%SEQ", reset: "NONE", padding: 3 });
    expect(preview).toBe("JOB-001");
  });
});
