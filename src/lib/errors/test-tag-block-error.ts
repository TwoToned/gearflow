/**
 * Thrown when a scan or checkout is blocked because an asset has a Test &
 * Tag record in FAILED or OVERDUE status. Per AS/NZS 3760:2022, equipment
 * without current electrical-safety testing must not be deployed.
 *
 * Hard block — no in-flow override. An override flow (admin role + mandatory
 * reason + activity log entry) is a separate Wave 2+ feature.
 *
 * Lives here (not in `src/server/warehouse.ts`) because Next.js "use server"
 * files can only export async functions — a class export breaks the bundler.
 */
export class TestTagBlockError extends Error {
  constructor(
    public readonly blocks: Array<{
      assetTag: string;
      status: "FAILED" | "OVERDUE";
      nextDueDate: Date | null;
    }>,
  ) {
    const lines = blocks.map(
      (b) =>
        `  • ${b.assetTag}: T&T ${b.status}${
          b.nextDueDate ? ` (next test due ${b.nextDueDate.toISOString().split("T")[0]})` : ""
        }`,
    );
    super(
      `Cannot check out — Test & Tag compliance block:\n${lines.join("\n")}\n\n` +
        `Resolve the failed/overdue tests before deploying.`,
    );
    this.name = "TestTagBlockError";
  }
}
