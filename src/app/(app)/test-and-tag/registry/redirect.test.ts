// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

const redirect = vi.hoisted(() => vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
}));
vi.mock("next/navigation", () => ({ redirect }));

import TestTagRegistryRedirect from "./page";

describe("/test-and-tag/registry", () => {
  it("redirects into the Test and tag list's All word", () => {
    expect(() => TestTagRegistryRedirect()).toThrow("REDIRECT:/test-and-tag?seg=all");
  });
});
