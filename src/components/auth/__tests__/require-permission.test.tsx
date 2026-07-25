// @vitest-environment jsdom
//
// Regression guard for R-8.9.3 finding #862: RequirePermission used to derive
// `allowed` from useCanDo, which returns false while the permissions query is
// still loading — flashing "Access Denied" for every authorized user on every
// gated page before flipping to the real content. That's a spurious LCP/CLS
// candidate on data-heavy dashboards (/crew, /warehouse, /dashboard) as well
// as a misleading false negative. This pins that loading renders nothing,
// not the denial.
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

let mockRole: { permissions: Record<string, string[]> | null; isLoading: boolean };
vi.mock("@/lib/use-permissions", () => ({
  useCurrentRole: () => mockRole,
}));

import { RequirePermission } from "../require-permission";

describe("RequirePermission", () => {
  it("renders nothing (not Access Denied) while permissions are still loading", () => {
    mockRole = { permissions: null, isLoading: true };
    const { container } = render(
      <RequirePermission resource="crew" action="read">
        <div>Secret content</div>
      </RequirePermission>,
    );
    expect(screen.queryByText("Access Denied")).toBeNull();
    expect(screen.queryByText("Secret content")).toBeNull();
    expect(container.textContent).toBe("");
  });

  it("renders Access Denied once loaded and the permission is missing", () => {
    mockRole = { permissions: { asset: ["read"] }, isLoading: false };
    render(
      <RequirePermission resource="crew" action="read">
        <div>Secret content</div>
      </RequirePermission>,
    );
    expect(screen.getByText("Access Denied")).toBeTruthy();
    expect(screen.queryByText("Secret content")).toBeNull();
  });

  it("renders children once loaded and the permission is granted", () => {
    mockRole = { permissions: { crew: ["read", "update"] }, isLoading: false };
    render(
      <RequirePermission resource="crew" action="read">
        <div>Secret content</div>
      </RequirePermission>,
    );
    expect(screen.getByText("Secret content")).toBeTruthy();
    expect(screen.queryByText("Access Denied")).toBeNull();
  });
});
