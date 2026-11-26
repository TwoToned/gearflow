// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

const redirect = vi.hoisted(() => vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
}));
vi.mock("next/navigation", () => ({ redirect }));

import MaintenanceDueRedirect from "./page";

describe("/maintenance/due", () => {
  it("redirects into the Maintenance page's Check off cycle dialog", () => {
    expect(() => MaintenanceDueRedirect()).toThrow("REDIRECT:/maintenance?dialog=checkoff");
  });
});
