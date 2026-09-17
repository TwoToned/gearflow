import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * #1225 (Q2) — the quote_expiring branch of the notification email pipeline:
 * the audience filter (invoice:read only) and the two-bucket dedupe key
 * ("soon" | "expired", not per-day). Every other branch in
 * `buildOrgNotifications` is stubbed to produce nothing so these tests only
 * exercise the new code path.
 */

vi.mock("@/env", () => ({ env: { NEXT_PUBLIC_APP_URL: "https://flow.example" } }));

vi.mock("../../../convex/_generated/api", () => ({
  api: {
    financeOrg: { expiringForNotifications: "financeOrg.expiringForNotifications" },
    projectLineItems: {
      listByProjectIds: "projectLineItems.listByProjectIds",
      listFlagged: "projectLineItems.listFlagged",
    },
    notificationEmailLogs: {
      list: "notificationEmailLogs.list",
      create: "notificationEmailLogs.create",
      remove: "notificationEmailLogs.remove",
    },
  },
}));

const emailLogs: Array<{ id: string; organizationId: string; userId: string; notificationKey: string; sentAt: number }> = [];
const expiringRows = vi.hoisted(() => ({ value: [] as unknown[] }));

const convexMock = vi.hoisted(() => ({ query: vi.fn(), mutation: vi.fn() }));
vi.mock("@/lib/convex-client", () => ({ getConvexClient: vi.fn(async () => convexMock) }));

vi.mock("@/lib/models-read", () => ({ getModelMap: vi.fn(async () => new Map()) }));
vi.mock("@/lib/projects-read", () => ({ getProjectsByOrg: vi.fn(async () => []) }));
vi.mock("@/lib/assets-read", () => ({ getAssetsByOrg: vi.fn(async () => []) }));
vi.mock("@/lib/maintenance-read", () => ({ getMaintenanceRecordsByOrg: vi.fn(async () => []) }));
vi.mock("@/lib/maintenance-record-asset-read", () => ({ getMaintenanceAssetLinksByRecordIds: vi.fn(async () => []) }));
vi.mock("@/lib/crew-scheduling-read", () => ({
  getCrewAssignmentsByOrg: vi.fn(async () => []),
  getCrewTimeEntriesByOrg: vi.fn(async () => []),
  countAssignmentsByStatus: () => 0,
  countTimeEntriesByStatus: () => 0,
}));

const sendEmailMock = vi.fn(async (_args: { to: string; subject: string; html: string }) => {});
vi.mock("@/lib/email", () => ({ sendEmail: (...a: [{ to: string; subject: string; html: string }]) => sendEmailMock(...a) }));

import { NOTIFICATION_PREFERENCE_DEFAULTS } from "@/lib/validations/notification-preferences";
vi.mock("@/lib/user-notification-preferences-read", () => ({
  getUserNotificationPreferenceMap: vi.fn(async (userIds: string[]) => {
    const map = new Map();
    for (const id of userIds) map.set(id, { ...NOTIFICATION_PREFERENCE_DEFAULTS });
    return map;
  }),
}));

const ORG = { id: "org_1", name: "Acme Rentals" };
const ADMIN = { id: "user_admin", name: "Ada Admin", email: "ada@example.com" };
// Every current built-in role (owner/admin/manager/member/warehouse/viewer)
// happens to carry `invoice: read` — so to exercise the audience gate at all,
// this recipient carries a role `hasPermission` doesn't recognise. That's a
// real case, not a contrivance: `hasPermission` fails CLOSED on any unknown
// role string (the comment on `permissionsCore.ts`'s role map notes this is
// exactly what happens to a pre-consolidation custom role that was never
// migrated) — this is the only way a member can lack invoice:read today.
const NO_INVOICE_ACCESS = { id: "user_stale", name: "Stale Role", email: "stale@example.com" };

vi.mock("@/lib/prisma", () => ({
  prisma: {
    organization: { findMany: vi.fn(async () => [ORG]) },
    member: {
      findMany: vi.fn(async () => [
        { role: "manager", user: { id: ADMIN.id, name: ADMIN.name, email: ADMIN.email, banned: false } },
        { role: "custom:retired-role", user: { id: NO_INVOICE_ACCESS.id, name: NO_INVOICE_ACCESS.name, email: NO_INVOICE_ACCESS.email, banned: false } },
      ]),
    },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  emailLogs.length = 0;
  convexMock.query.mockImplementation(async (op: string) => {
    if (op === "financeOrg.expiringForNotifications") return expiringRows.value;
    if (op === "notificationEmailLogs.list") return [...emailLogs];
    return [];
  });
  convexMock.mutation.mockImplementation(async (op: string, args: Record<string, unknown>) => {
    if (op === "notificationEmailLogs.create") {
      emailLogs.push(args as (typeof emailLogs)[number]);
    }
  });
});

const { sendNotificationEmails } = await import("@/server/notification-email-sender");

const NOW_MS = 1_700_000_000_000;
const DAY = 86_400_000;

function seedExpiringQuote(daysLeft: number) {
  expiringRows.value = [
    {
      quoteId: "q1",
      projectId: "p1",
      projectNumber: "P-1042",
      clientName: "Big Client Co",
      version: 2,
      validUntil: NOW_MS + daysLeft * DAY,
      daysLeft,
      total: 5000,
    },
  ];
}

describe("sendNotificationEmails — quote_expiring audience gate (#1225, D4)", () => {
  it("emails the invoice:read recipient but not one whose role carries no invoice access", async () => {
    seedExpiringQuote(3);
    await sendNotificationEmails();

    const recipients = sendEmailMock.mock.calls.map((c) => c[0].to);
    expect(recipients).toContain(ADMIN.email);
    expect(recipients).not.toContain(NO_INVOICE_ACCESS.email);
  });

  it("subject reads 'Expiring soon' while still valid", async () => {
    seedExpiringQuote(3);
    await sendNotificationEmails();
    const call = sendEmailMock.mock.calls.find((c) => c[0].to === ADMIN.email);
    expect(call?.[0].subject).toMatch(/Expiring soon/);
  });

  it("subject reads 'Expired' once the window has lapsed", async () => {
    seedExpiringQuote(-2);
    await sendNotificationEmails();
    const call = sendEmailMock.mock.calls.find((c) => c[0].to === ADMIN.email);
    expect(call?.[0].subject).toMatch(/Expired/);
  });
});

describe("sendNotificationEmails — quote_expiring dedupe (#1225)", () => {
  it("does not re-send within the same bucket on a second pass", async () => {
    seedExpiringQuote(3);
    await sendNotificationEmails();
    sendEmailMock.mockClear();
    await sendNotificationEmails();
    const recipients = sendEmailMock.mock.calls.map((c) => c[0].to);
    expect(recipients).not.toContain(ADMIN.email);
  });

  it("sends again once the quote crosses from the 'soon' bucket into 'expired' — two nudges in its life, not zero after the first", async () => {
    seedExpiringQuote(3);
    await sendNotificationEmails();
    sendEmailMock.mockClear();

    seedExpiringQuote(-1); // same quote, now past validUntil
    await sendNotificationEmails();
    const recipients = sendEmailMock.mock.calls.map((c) => c[0].to);
    expect(recipients).toContain(ADMIN.email);
  });
});
