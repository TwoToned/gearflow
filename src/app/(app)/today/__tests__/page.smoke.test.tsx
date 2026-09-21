// @vitest-environment node
//
// /today — hidden (D10C), superseded by Dashboard; this page is now a pure
// redirect so old bookmarks/links land somewhere real. TodayWorkListWidget's
// own behavioural coverage moved to
// src/components/dashboard/widgets/__tests__/today-work-list-widget.smoke.test.tsx.
import { describe, it, expect, vi } from "vitest";

const redirectSpy = vi.fn();
vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirectSpy(url),
}));

import TodayPage from "../page";

describe("TodayPage (redirect)", () => {
  it("redirects to /dashboard", () => {
    TodayPage();
    expect(redirectSpy).toHaveBeenCalledWith("/dashboard");
  });
});
