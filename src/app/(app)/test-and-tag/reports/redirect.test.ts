// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

const redirect = vi.hoisted(() => vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
}));
vi.mock("next/navigation", () => ({ redirect }));

import TestTagReportsRedirect from "./page";

describe("/test-and-tag/reports", () => {
  it("redirects into the Test & tag page's Reports dialog", () => {
    expect(() => TestTagReportsRedirect()).toThrow("REDIRECT:/test-and-tag?dialog=reports");
  });
});
