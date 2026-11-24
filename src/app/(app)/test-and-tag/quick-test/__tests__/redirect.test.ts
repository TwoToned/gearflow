import { describe, expect, it, vi } from "vitest";

const redirect = vi.fn();
vi.mock("next/navigation", () => ({ redirect: (href: string) => redirect(href) }));

import QuickTestRedirect from "../page";

describe("/test-and-tag/quick-test → /scan?mode=tt", () => {
  it("carries ?id= as the tag", async () => {
    await QuickTestRedirect({ searchParams: Promise.resolve({ id: "TT-0412" }) });
    expect(redirect).toHaveBeenLastCalledWith("/scan?mode=tt&tag=TT-0412");
  });

  it("with no id lands on Test & tag mode, Ready", async () => {
    await QuickTestRedirect({ searchParams: Promise.resolve({}) });
    expect(redirect).toHaveBeenLastCalledWith("/scan?mode=tt");
    await QuickTestRedirect({ searchParams: Promise.resolve({ id: ["TT-1", "TT-2"] }) });
    expect(redirect).toHaveBeenLastCalledWith("/scan?mode=tt&tag=TT-1");
  });
});
