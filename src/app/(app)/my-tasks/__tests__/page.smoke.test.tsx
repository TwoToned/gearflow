// @vitest-environment node
//
// /my-tasks (work-layer phase 0.5, #1242) — superseded by Today; this page is
// now a pure redirect so old bookmarks/links land somewhere real.
import { describe, it, expect, vi } from "vitest";

const redirectSpy = vi.fn();
vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirectSpy(url),
}));

import MyTasksPage from "../page";

describe("MyTasksPage (redirect)", () => {
  it("redirects to /dashboard", () => {
    MyTasksPage();
    expect(redirectSpy).toHaveBeenCalledWith("/dashboard");
  });
});
