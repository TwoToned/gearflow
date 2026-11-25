// @vitest-environment jsdom
//
// UX Phase 10 (spec §8c): the Files section. Filter chips, the row ⋯ OPENED, the change
// category menu, rename dialog, a confirmed Remove (no Undo), the bulk bar and the
// read-only `Also on this job` list. The real components render; the reads and the
// writes are stubbed.
import React from "react";
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { FunctionReference } from "convex/server";

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as never;
});

const writes = { add: vi.fn(), remove: vi.fn(async () => undefined), setType: vi.fn(async () => undefined), rename: vi.fn(async () => undefined) };
vi.mock("@/hooks/use-project-file-writes", () => ({ useProjectFileWrites: () => writes }));
let viewer = false;
vi.mock("@/lib/use-permissions", () => ({ useIsViewer: () => viewer }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const file = (id: string, name: string, mime: string, type: string) => ({
  id,
  fileId: `f-${id}`,
  type,
  displayName: null,
  addedAt: Date.UTC(2026, 10, 6),
  uploadedByName: "Sam",
  file: { id: `f-${id}`, fileName: name, fileSize: 2048, mimeType: mime, url: `https://x.test/${name}`, thumbnailUrl: null },
});
vi.mock("@/hooks/use-authed-query", async () => {
  const { getFunctionName } = await import("convex/server");
  return {
    useAuthedQuery: (q: FunctionReference<"query">, args: unknown) => {
      if (args === "skip") return undefined;
      const name = getFunctionName(q);
      if (name === "projectFiles:listForProject") {
        return { truncated: false, files: [file("m1", "rider.pdf", "application/pdf", "OTHER"), file("m2", "stage.jpg", "image/jpeg", "PHOTO")] };
      }
      if (name === "projectFiles:alsoOnJob") return { truncated: false, items: [{ key: "q1", name: "Quote v2.pdf", origin: "Sent quote", href: "/api/finance/quote/q1/pdf" }] };
      return undefined;
    },
  };
});

import { FilesSection } from "@/components/projects/tasks-notes/files-section";

beforeEach(() => {
  vi.clearAllMocks();
  viewer = false;
});

describe("FilesSection", () => {
  it("lists the files, filters by chip, and shows Also on this job read-only with an open link", async () => {
    const user = userEvent.setup();
    render(<FilesSection projectId="p1" orgId="org1" />);
    expect(screen.getByText("rider.pdf")).toBeTruthy();
    expect(screen.getByText("stage.jpg")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Photos" }));
    expect(screen.queryByText("rider.pdf")).toBeNull();
    expect(screen.getByText("stage.jpg")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "All" }));
    const also = screen.getByText("Also on this job").parentElement as HTMLElement;
    expect(within(also).getByText("Quote v2.pdf")).toBeTruthy();
    expect(within(also).getByRole("link", { name: /Open/ }).getAttribute("href")).toBe("/api/finance/quote/q1/pdf");
  });

  it("the row ⋯ opens; Rename… asks for a name and writes it", async () => {
    const user = userEvent.setup();
    render(<FilesSection projectId="p1" orgId="org1" />);
    await user.click(screen.getByRole("button", { name: "rider.pdf actions" }));
    const menu = await screen.findByRole("menu");
    for (const n of ["Open", "Download", "Rename…", "Change category", "Remove"]) expect(within(menu).getByRole("menuitem", { name: new RegExp(n) })).toBeTruthy();
    await user.click(within(menu).getByRole("menuitem", { name: /Rename/ }));
    const input = await screen.findByLabelText("File name");
    await user.clear(input);
    await user.type(input, "tech rider.pdf");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(writes.rename).toHaveBeenCalledWith("m1", "tech rider.pdf");
  });

  it("the category word is a menu: choosing Floor plan sets that one file's type", async () => {
    const user = userEvent.setup();
    render(<FilesSection projectId="p1" orgId="org1" />);
    await user.click(screen.getByRole("button", { name: "Category: Other" }));
    const menu = await screen.findByRole("menu");
    await user.click(within(menu).getByRole("menuitem", { name: "Floor plan" }));
    expect(writes.setType).toHaveBeenCalledWith(["m1"], "FLOOR_PLAN");
  });

  it("Remove asks first, names that it cannot be undone, then removes the file", async () => {
    const user = userEvent.setup();
    render(<FilesSection projectId="p1" orgId="org1" />);
    await user.click(screen.getByRole("button", { name: "rider.pdf actions" }));
    await user.click(within(await screen.findByRole("menu")).getByRole("menuitem", { name: /Remove/ }));
    expect(writes.remove).not.toHaveBeenCalled();
    expect(await screen.findByText(/cannot be undone/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Remove file" }));
    expect(writes.remove).toHaveBeenCalledWith("m1");
  });

  it("selecting a file shows the bulk bar with counted verbs", async () => {
    const user = userEvent.setup();
    render(<FilesSection projectId="p1" orgId="org1" />);
    await user.click(screen.getByRole("checkbox", { name: "Select rider.pdf" }));
    await user.click(screen.getByRole("checkbox", { name: "Select stage.jpg" }));
    const bar = await screen.findByRole("toolbar", { name: "Bulk actions" }).catch(() => screen.getByLabelText("Bulk actions"));
    expect(within(bar).getByText(/Remove 2/)).toBeTruthy();
    expect(within(bar).getByText(/Download 2/)).toBeTruthy();
  });

  it("a viewer can open and download but has no upload strip, rename, category menu or Remove", async () => {
    viewer = true;
    const user = userEvent.setup();
    render(<FilesSection projectId="p1" orgId="org1" />);
    expect(screen.queryByLabelText("Upload files")).toBeNull();
    expect(screen.queryByRole("button", { name: "Category: Other" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "rider.pdf actions" }));
    const menu = await screen.findByRole("menu");
    expect(within(menu).queryByRole("menuitem", { name: /Remove|Rename/ })).toBeNull();
    expect(within(menu).getByRole("menuitem", { name: /Download/ })).toBeTruthy();
  });
});
