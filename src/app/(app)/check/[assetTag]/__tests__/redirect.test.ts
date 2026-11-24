import { describe, expect, it, vi } from "vitest";

const redirect = vi.fn();
vi.mock("next/navigation", () => ({ redirect: (href: string) => redirect(href) }));

import CheckRedirect from "../page";

describe("/check/[assetTag] → /scan", () => {
  it("server-redirects into the Scan page's Check mode with the tag loaded", async () => {
    await CheckRedirect({ params: Promise.resolve({ assetTag: "AURA-01" }) });
    expect(redirect).toHaveBeenLastCalledWith("/scan?mode=check&tag=AURA-01");
  });

  it("decodes an encoded tag, and tolerates a malformed escape", async () => {
    await CheckRedirect({ params: Promise.resolve({ assetTag: "A%20B" }) });
    expect(redirect).toHaveBeenLastCalledWith("/scan?mode=check&tag=A+B");
    await CheckRedirect({ params: Promise.resolve({ assetTag: "%E0%A4" }) });
    expect(redirect).toHaveBeenLastCalledWith("/scan?mode=check&tag=%25E0%25A4");
  });
});
