import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

/**
 * D54: Chase is COPY-ONLY, Flow never emails a client. The runtime proof is in finance-hub-actions.smoke;
 * this is the structural one: no Finance hub module may import a mail sender or a send-mail server action.
 */
const ROOT = join(__dirname, "..", "..", "..", "..");
const FILES = [
  ...readdirSync(join(ROOT, "src/components/finance"))
    .filter((f) => /\.tsx?$/.test(f))
    .map((f) => join("src/components/finance", f)),
  "src/lib/finance-chase.ts",
  "src/lib/finance-bulk.ts",
  "src/lib/finance-export.ts",
  "src/lib/row-actions/finance.ts",
  "src/lib/list-views/finance.ts",
];
const FORBIDDEN = /from\s+["'](?:@\/lib\/email[^"']*|@\/server\/[^"']*(?:mail|send)[^"']*|resend|nodemailer)["']/;

describe("Finance hub never sends mail", () => {
  test("scans the hub's modules", () => {
    expect(FILES.length).toBeGreaterThan(8);
  });
  test.each(FILES)("%s imports no mail sender", (f) => {
    expect(readFileSync(join(ROOT, f), "utf8")).not.toMatch(FORBIDDEN);
  });
  test("the guard itself catches a mail import", () => {
    expect('import { sendEmail } from "@/lib/email";').toMatch(FORBIDDEN);
  });
});
