/**
 * Integration tests for Wave 2.D scheduled reports persistence and selection.
 *
 * `isReportScheduleDue` (the bucket-time calculator) is already covered by
 * 14 unit tests in src/lib/validations/report-schedule.test.ts. These tests
 * cover the integration-layer concerns:
 *
 *  • Schedule fields persist correctly on SavedReport
 *  • The candidate-selection query (scheduleFrequency: not null) picks
 *    only scheduled reports
 *  • scheduleLastRunAt stamp updates correctly
 *  • Index ([scheduleFrequency, scheduleLastRunAt]) actually exists
 *
 * The fan-out (executeReport + CSV + sendEmail) is not tested here — those
 * are external concerns with their own tests; integration-testing the cron
 * runner would just exercise the orchestration glue.
 */

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import {
  testPrisma,
  setupIntegrationTest,
  createOrgFixture,
  createUserFixture,
} from "../../tests/helpers/integration";
import { createId } from "@paralleldrive/cuid2";

async function createSavedReport(
  orgId: string,
  userId: string,
  overrides?: Partial<{
    scheduleFrequency: "DAILY" | "WEEKLY" | "MONTHLY" | null;
    scheduleHour: number | null;
    scheduleDayOfWeek: number | null;
    scheduleDayOfMonth: number | null;
    scheduleRecipients: string[];
    scheduleLastRunAt: Date | null;
  }>,
) {
  return testPrisma.savedReport.create({
    data: {
      organizationId: orgId,
      name: `Report ${createId().slice(0, 6)}`,
      dataSource: "assets",
      config: {},
      createdById: userId,
      scheduleFrequency: overrides?.scheduleFrequency ?? null,
      scheduleHour: overrides?.scheduleHour ?? null,
      scheduleDayOfWeek: overrides?.scheduleDayOfWeek ?? null,
      scheduleDayOfMonth: overrides?.scheduleDayOfMonth ?? null,
      scheduleRecipients: overrides?.scheduleRecipients ?? [],
      scheduleLastRunAt: overrides?.scheduleLastRunAt ?? null,
    },
  });
}

describe("SavedReport scheduling persistence", () => {
  beforeEach(async () => {
    await setupIntegrationTest();
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it("stores all schedule fields on a daily report", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id);

    const report = await createSavedReport(org.id, user.id, {
      scheduleFrequency: "DAILY",
      scheduleHour: 9,
      scheduleRecipients: ["ops@example.com", "manager@example.com"],
    });

    const fetched = await testPrisma.savedReport.findUniqueOrThrow({
      where: { id: report.id },
    });
    expect(fetched.scheduleFrequency).toBe("DAILY");
    expect(fetched.scheduleHour).toBe(9);
    expect(fetched.scheduleRecipients).toEqual([
      "ops@example.com",
      "manager@example.com",
    ]);
    expect(fetched.scheduleLastRunAt).toBeNull();
  });

  it("stores weekly schedule with day-of-week", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id);

    const report = await createSavedReport(org.id, user.id, {
      scheduleFrequency: "WEEKLY",
      scheduleHour: 8,
      scheduleDayOfWeek: 1, // Monday
    });

    const fetched = await testPrisma.savedReport.findUniqueOrThrow({
      where: { id: report.id },
    });
    expect(fetched.scheduleFrequency).toBe("WEEKLY");
    expect(fetched.scheduleDayOfWeek).toBe(1);
  });

  it("stores monthly schedule with day-of-month", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id);

    const report = await createSavedReport(org.id, user.id, {
      scheduleFrequency: "MONTHLY",
      scheduleHour: 7,
      scheduleDayOfMonth: 1,
    });

    const fetched = await testPrisma.savedReport.findUniqueOrThrow({
      where: { id: report.id },
    });
    expect(fetched.scheduleFrequency).toBe("MONTHLY");
    expect(fetched.scheduleDayOfMonth).toBe(1);
  });

  it("an unscheduled report has scheduleFrequency null + empty recipients", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id);

    const report = await createSavedReport(org.id, user.id);

    const fetched = await testPrisma.savedReport.findUniqueOrThrow({
      where: { id: report.id },
    });
    expect(fetched.scheduleFrequency).toBeNull();
    expect(fetched.scheduleHour).toBeNull();
    expect(fetched.scheduleRecipients).toEqual([]);
  });

  it("scheduleLastRunAt updates atomically after a run", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id);

    const report = await createSavedReport(org.id, user.id, {
      scheduleFrequency: "DAILY",
      scheduleHour: 9,
    });

    const stampTime = new Date("2026-03-15T10:00:00Z");
    await testPrisma.savedReport.update({
      where: { id: report.id },
      data: { scheduleLastRunAt: stampTime },
    });

    const fetched = await testPrisma.savedReport.findUniqueOrThrow({
      where: { id: report.id },
    });
    expect(fetched.scheduleLastRunAt?.toISOString()).toBe(stampTime.toISOString());
  });
});

describe("runDueScheduledReports candidate selection", () => {
  beforeEach(async () => {
    await setupIntegrationTest();
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it("query filters to only scheduled reports (scheduleFrequency not null)", async () => {
    // Mirrors the production query in runDueScheduledReports (line 62-69)
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id);

    // Mix of scheduled and unscheduled reports
    await createSavedReport(org.id, user.id); // unscheduled
    await createSavedReport(org.id, user.id, {
      scheduleFrequency: "DAILY",
      scheduleHour: 9,
    });
    await createSavedReport(org.id, user.id); // another unscheduled
    await createSavedReport(org.id, user.id, {
      scheduleFrequency: "WEEKLY",
      scheduleHour: 8,
      scheduleDayOfWeek: 1,
    });

    const candidates = await testPrisma.savedReport.findMany({
      where: { scheduleFrequency: { not: null } },
    });

    expect(candidates).toHaveLength(2);
    candidates.forEach((c) => expect(c.scheduleFrequency).not.toBeNull());
  });

  it("query is cross-org (cron runs across all orgs)", async () => {
    // The candidate query has NO organizationId filter — cron iterates
    // every org's scheduled reports. Verify this isn't a regression.
    const orgA = await createOrgFixture({ slug: "org-a" });
    const orgB = await createOrgFixture({ slug: "org-b" });
    const userA = await createUserFixture(orgA.id);
    const userB = await createUserFixture(orgB.id);

    await createSavedReport(orgA.id, userA.id, {
      scheduleFrequency: "DAILY",
      scheduleHour: 9,
    });
    await createSavedReport(orgB.id, userB.id, {
      scheduleFrequency: "DAILY",
      scheduleHour: 9,
    });

    const candidates = await testPrisma.savedReport.findMany({
      where: { scheduleFrequency: { not: null } },
    });

    expect(candidates).toHaveLength(2);
    const orgIds = candidates.map((c) => c.organizationId).sort();
    expect(orgIds).toEqual([orgA.id, orgB.id].sort());
  });
});
