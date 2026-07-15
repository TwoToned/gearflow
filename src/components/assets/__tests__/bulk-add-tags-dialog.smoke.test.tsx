// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});

// Org-tag suggestions come from a Convex query hook — stub it out.
vi.mock("@/hooks/use-org-tags", () => ({ useOrgTags: vi.fn(() => ["blue", "green"]) }));
// The browser-direct writes hook isn't invoked on render — stub it (avoids needing
// a ConvexProvider for useMutation).
vi.mock("@/hooks/use-asset-writes", () => ({ useAssetWrites: () => ({ bulkTag: vi.fn() }) }));

import { BulkAddTagsDialog } from "@/components/assets/asset-table";

/**
 * The bulk "Add tags" dialog nests a TagInput (Radix Popover) inside a Radix
 * modal Dialog — the SAFE composition (a Base UI popup here would inherit the
 * modal's pointer-events lock and swallow clicks; see CLAUDE.md). This smoke
 * test just proves the overlay renders open without throwing — the only thing
 * that catches an overlay-composition regression, per the smoke-test rule.
 */
describe("BulkAddTagsDialog smoke", () => {
  it("renders open without throwing", () => {
    render(
      <BulkAddTagsDialog
        open
        onOpenChange={() => {}}
        selectedIds={new Set(["a1", "a2"])}
        orgId="org_1"
        onSuccess={() => {}}
      />,
    );
    // Radix Dialog portals to <body>; assert the title + append copy are present.
    expect(screen.getByText("Add tags to 2 assets")).toBeTruthy();
    expect(screen.getByText(/Tags are appended/)).toBeTruthy();
    expect(screen.getByText("Add to 2 assets")).toBeTruthy();
  });
});
