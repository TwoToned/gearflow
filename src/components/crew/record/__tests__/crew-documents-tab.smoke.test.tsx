// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { CrewDocumentsTab, crewDocumentHealthItem, type CrewDocumentRow } from "../crew-documents-tab";

/** UX Phase 13, D72: the crew Documents tab with its sheet and menus OPENED and driven; the Overview health row. */
vi.mock("next/link", () => ({ default: ({ href, children, ...p }: { href: string; children: React.ReactNode }) => <a href={href} {...p}>{children}</a> }));

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});
afterEach(cleanup);

const NOW = Date.UTC(2026, 10, 25, 12);
const DAY = 86_400_000;
const doc = (over: Partial<CrewDocumentRow> = {}): CrewDocumentRow => ({
  id: "d1", kind: "LICENCE", name: "White card", expiresAt: NOW + 90 * DAY,
  file: { fileName: "card.pdf", fileSize: 2048, mimeType: "application/pdf", downloadPath: "/api/crew/documents/d1/file" }, ...over,
});

describe("crewDocumentHealthItem", () => {
  it("names the WORST document by kind and date only, never the file or its label", () => {
    const item = crewDocumentHealthItem([
      { kind: "TICKET", expiresAt: NOW + 20 * DAY },
      { kind: "LICENCE", expiresAt: Date.UTC(2026, 10, 21) },
      { kind: "ID", expiresAt: null },
    ], NOW, vi.fn());
    expect(item).toMatchObject({ tone: "error", text: "Licence expired 21 Nov", action: { label: "Documents" } });
    expect(crewDocumentHealthItem([{ kind: "TICKET", expiresAt: NOW + 10 * DAY }], NOW, vi.fn())).toMatchObject({ tone: "warning", text: "Ticket expires in 10d" });
    expect(crewDocumentHealthItem([{ kind: "TICKET", expiresAt: NOW + 200 * DAY }, { kind: "ID", expiresAt: null }], NOW, vi.fn())).toBeNull();
  });
});

describe("CrewDocumentsTab", () => {
  it("Add document opens the sheet, needs a file, then calls onAdd with the kind and the epoch-ms expiry", async () => {
    const onAdd = vi.fn().mockResolvedValue(true);
    render(<CrewDocumentsTab documents={[]} now={NOW} canWrite onAdd={onAdd} onEdit={vi.fn()} onRemove={vi.fn()} />);
    expect(screen.getByText(/No documents yet/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add document" }));
    expect(screen.getByRole("dialog", { name: "Add document" })).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Add document" }).at(-1)!);
    expect(await screen.findByText("Choose a file to upload")).toBeTruthy();
    const f = new File(["x"], "card.pdf", { type: "application/pdf" });
    fireEvent.change(screen.getByLabelText("File"), { target: { files: [f] } });
    fireEvent.change(screen.getByLabelText("Name (optional)"), { target: { value: "  White card " } });
    fireEvent.change(screen.getByLabelText("Expires"), { target: { value: "2027-06-30" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Add document" }).at(-1)!);
    await waitFor(() => expect(onAdd).toHaveBeenCalled());
    expect(onAdd.mock.calls[0][0]).toEqual({ kind: "LICENCE", name: "White card", expiresAt: Date.UTC(2027, 5, 30) });
    expect(onAdd.mock.calls[0][1]).toBe(f);
  });

  it("expiry is a derived word on the row", () => {
    render(<CrewDocumentsTab documents={[doc({ id: "a", name: "Old", expiresAt: NOW - 3 * DAY }), doc({ id: "b", name: "Soon", expiresAt: NOW + 10 * DAY }), doc({ id: "c", name: "Far" })]} now={NOW} canWrite={false} onAdd={vi.fn()} onEdit={vi.fn()} onRemove={vi.fn()} />);
    expect(screen.getByText("Expired")).toBeTruthy();
    expect(screen.getByText("Expires in 10d")).toBeTruthy();
    expect(screen.getAllByText(/Expires in|Expired/)).toHaveLength(2);
  });

  it("Edit has no file field and keeps the file; Remove says the file is deleted for good, behind a confirm", async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn().mockResolvedValue(true);
    const onRemove = vi.fn().mockResolvedValue(true);
    render(<CrewDocumentsTab documents={[doc()]} now={NOW} canWrite onAdd={vi.fn()} onEdit={onEdit} onRemove={onRemove} />);
    await user.click(screen.getByRole("button", { name: "White card actions" }));
    await user.click(await screen.findByRole("menuitem", { name: /Edit/ }));
    expect(screen.queryByLabelText("File")).toBeNull();
    fireEvent.change(screen.getByLabelText("Expires"), { target: { value: "2028-02-23" } });
    fireEvent.click(screen.getByRole("button", { name: "Save document" }));
    await waitFor(() => expect(onEdit).toHaveBeenCalledWith("d1", expect.objectContaining({ kind: "LICENCE", expiresAt: Date.UTC(2028, 1, 23) })));

    cleanup();
    render(<CrewDocumentsTab documents={[doc()]} now={NOW} canWrite onAdd={vi.fn()} onEdit={onEdit} onRemove={onRemove} />);
    await user.click(screen.getByRole("button", { name: "White card actions" }));
    await user.click(await screen.findByRole("menuitem", { name: /Remove/ }));
    expect(await screen.findByText(/deletes the document and its file for good/)).toBeTruthy();
    expect(onRemove).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Delete document" }));
    await waitFor(() => expect(onRemove).toHaveBeenCalledWith("d1", "White card"));
  });

  it("the member themself (read-only) can open the file but sees no Add, Edit or Remove", async () => {
    const user = userEvent.setup();
    render(<CrewDocumentsTab documents={[doc()]} now={NOW} canWrite={false} onAdd={vi.fn()} onEdit={vi.fn()} onRemove={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Add document" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "White card actions" }));
    expect(await screen.findByRole("menuitem", { name: /Open file/ })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: /Edit/ })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: /Remove/ })).toBeNull();
  });
});
