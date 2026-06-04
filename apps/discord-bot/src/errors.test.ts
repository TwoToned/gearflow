import { describe, expect, it } from "vitest";
import { BOT_ERROR_CODES, botErrorMessage } from "./errors.js";

describe("botErrorMessage", () => {
  it("returns a non-empty, actionable message for every code", () => {
    for (const code of BOT_ERROR_CODES) {
      const msg = botErrorMessage(code);
      expect(msg.length).toBeGreaterThan(10);
    }
  });

  it("interpolates the required role into FORBIDDEN copy", () => {
    expect(botErrorMessage("FORBIDDEN", { requiredRole: "manager", actualRole: "viewer" })).toContain("manager");
  });

  it("interpolates the asset code into ASSET_NOT_FOUND copy", () => {
    expect(botErrorMessage("ASSET_NOT_FOUND", { code: "TTP-042" })).toContain("TTP-042");
  });

  it("interpolates retryAfter into RATE_LIMITED copy", () => {
    expect(botErrorMessage("RATE_LIMITED", { retryAfterSeconds: 30 })).toContain("30");
  });

  it("NOT_LINKED tells the user to run /link", () => {
    expect(botErrorMessage("NOT_LINKED")).toContain("/link");
  });
});
