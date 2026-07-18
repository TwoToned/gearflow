// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppImage } from "@/components/ui/app-image";

/**
 * Smoke test: AppImage adopts next/image (R-8.1.4) but renders an <img> pointing
 * at the original src (unoptimized — the app's images come from the auth-gated
 * /api/files proxy + blob/data URLs; see ADR-0002), with lazy-loading on.
 */
describe("AppImage", () => {
  it("renders an img with the given src and lazy loading (fixed size)", () => {
    const { container } = render(
      <AppImage src="/api/files/abc123" alt="model" width={200} height={200} />,
    );
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    // unoptimized → the src is served as-is (no /_next/image optimizer rewrite).
    expect(img!.getAttribute("src")).toBe("/api/files/abc123");
    expect(img!.getAttribute("loading")).toBe("lazy");
    expect(img!.getAttribute("alt")).toBe("model");
  });

  it("renders a fill image inside a positioned parent", () => {
    const { container } = render(
      <div style={{ position: "relative", width: 100, height: 100 }}>
        <AppImage src="blob:local-preview" alt="" fill sizes="100px" className="object-cover" />
      </div>,
    );
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img!.getAttribute("src")).toBe("blob:local-preview");
    expect(img!.className).toContain("object-cover");
  });
});
