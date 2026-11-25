// @vitest-environment node
import { describe, expect, test } from "vitest";
import { xeroSyncCounts } from "@/lib/xero-sync-counts";

describe("xeroSyncCounts", () => {
  test("counts only issued invoices: synced, failed, and the rest still to push", () => {
    expect(
      xeroSyncCounts([
        { status: "ISSUED", xeroSyncStatus: "SYNCED" },
        { status: "ISSUED", xeroSyncStatus: "ERROR" },
        { status: "ISSUED", xeroSyncStatus: "NOT_SYNCED" },
        { status: "ISSUED" },
        { status: "DRAFT" },
        { status: "VOID", xeroSyncStatus: "SYNCED" },
      ]),
    ).toEqual({ synced: 1, failed: 1, toPush: 2 });
  });
});
