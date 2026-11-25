// @vitest-environment node
import { describe, expect, test, vi } from "vitest";
import { buildFileBulkActions, buildFileRowActions } from "@/lib/row-actions/file-row";

const h = () => ({ onOpen: vi.fn(), onDownload: vi.fn(), onRename: vi.fn(), onSetType: vi.fn(), onRemove: vi.fn() });
const keys = (s: { items: { key: string }[] }) => s.items.map((i) => i.key);

describe("buildFileRowActions", () => {
  test("an editor gets Open, Download, Rename, Change category (not the current one) and a LAST, danger, CONFIRMED Remove", () => {
    const spec = buildFileRowActions({ type: "OTHER", name: "plan.pdf" }, true, h());
    expect(keys(spec)).toEqual(["open", "download", "rename", "category", "remove"]);
    expect(spec.items[3].children?.some((c) => c.key === "category-OTHER")).toBe(false);
    const remove = spec.items[4];
    expect(remove.danger).toBe(true);
    expect(remove.confirm?.body).toMatch(/cannot be undone/i); // a stored-file delete: no Undo, ever
  });

  test("a viewer gets only Open and Download (write verbs absent, not disabled)", () => {
    expect(keys(buildFileRowActions({ type: "OTHER", name: "x" }, false, h()))).toEqual(["open", "download"]);
  });
});

describe("buildFileBulkActions", () => {
  test("Category ▾ · Download · Remove with counts; Remove is last and confirmed", () => {
    const a = buildFileBulkActions(true, { onSetType: vi.fn(), onDownload: vi.fn(), onRemove: vi.fn() });
    expect(a.map((x) => x.label(3))).toEqual(["Category 3", "Download 3", "Remove 3"]);
    expect(a[2].danger).toBe(true);
    expect(a[2].confirm).toBeDefined();
    expect(buildFileBulkActions(false, { onSetType: vi.fn(), onDownload: vi.fn(), onRemove: vi.fn() }).map((x) => x.key)).toEqual(["download"]);
  });
});
