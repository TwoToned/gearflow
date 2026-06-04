import { describe, expect, it } from "vitest";
import {
  DISCORD_API_ERROR_CODES,
  DISCORD_API_VERSION,
  DiscordApiError,
  discordErrorBody,
  discordSuccessBody,
} from "./api-errors";

describe("discord api error contract", () => {
  it("maps each code to a status and retryable flag without throwing", () => {
    for (const code of DISCORD_API_ERROR_CODES) {
      const err = new DiscordApiError(code, `msg for ${code}`);
      expect(err.status).toBeGreaterThanOrEqual(400);
      expect(typeof err.retryable).toBe("boolean");
    }
  });

  it("RATE_LIMITED is retryable; FORBIDDEN is not", () => {
    expect(new DiscordApiError("RATE_LIMITED", "slow down").retryable).toBe(true);
    expect(new DiscordApiError("FORBIDDEN", "nope").retryable).toBe(false);
  });

  it("builds an error envelope with code, retryable, meta and optional fields", () => {
    const err = new DiscordApiError("FORBIDDEN", "Needs Project Manager", {
      userAction: "Ask a PM",
      details: { requiredRole: "manager", actualRole: "viewer" },
    });
    const { body, status } = discordErrorBody(err, "req_test");
    expect(status).toBe(403);
    expect(body).toEqual({
      ok: false,
      error: {
        code: "FORBIDDEN",
        message: "Needs Project Manager",
        retryable: false,
        userAction: "Ask a PM",
        details: { requiredRole: "manager", actualRole: "viewer" },
      },
      meta: { requestId: "req_test", apiVersion: DISCORD_API_VERSION },
    });
  });

  it("omits userAction/details when absent", () => {
    const { body } = discordErrorBody(new DiscordApiError("INTERNAL", "boom"), "req_1");
    expect(body.error).not.toHaveProperty("userAction");
    expect(body.error).not.toHaveProperty("details");
  });

  it("builds a success envelope", () => {
    const { body, status } = discordSuccessBody({ assetCode: "TTP-042" }, "req_2");
    expect(status).toBe(200);
    expect(body).toEqual({
      ok: true,
      data: { assetCode: "TTP-042" },
      meta: { requestId: "req_2", apiVersion: DISCORD_API_VERSION },
    });
  });
});
