// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ContactsTab, DocumentsTab, documentHealthItems, type ContactRow, type DocumentRow } from "../people-tabs";
import { OrderFilesPanel, type OrderFileRow } from "../order-files-panel";

/** UX Phase 13 B3: the supplier Contacts / Documents tabs and the order Files panel, with their sheets OPENED and driven. */
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
const contact: ContactRow = { id: "c1", name: "Priya Shah", role: "Account manager", email: "priya@scene.test", phone: null, notes: null };
const file = { id: "f1", fileName: "cover.pdf", fileSize: 2048, mimeType: "application/pdf", url: "/api/files/k1" };
const doc = (over: Partial<DocumentRow> = {}): DocumentRow => ({ id: "d1", name: "Public liability", kind: "Insurance", expiryDate: NOW + 90 * DAY, notes: null, file, ...over });

describe("ContactsTab", () => {
  it("Add contact opens the sheet; a contact needs a name, email or phone; the valid save calls onAdd with trimmed values", async () => {
    const onAdd = vi.fn().mockResolvedValue(true);
    render(<ContactsTab contacts={[]} canUpdate onAdd={onAdd} onEdit={vi.fn()} onRemove={vi.fn()} />);
    expect(screen.getByText(/No other contacts yet/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add contact" }));
    expect(screen.getByRole("dialog", { name: "Add contact" })).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Add contact" }).at(-1)!);
    expect(await screen.findByText("Provide at least a name, email, or phone number.")).toBeTruthy();
    expect(onAdd).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "  Sam Lee " } });
    fireEvent.change(screen.getByLabelText("Phone"), { target: { value: "0400 000 000" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Add contact" }).at(-1)!);
    await waitFor(() => expect(onAdd).toHaveBeenCalledWith({ name: "Sam Lee", role: undefined, email: undefined, phone: "0400 000 000", notes: undefined }));
  });

  it("the row menu opens Edit (prefilled) and Remove (confirmed first); a viewer sees neither the button nor the menu", async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn().mockResolvedValue(true);
    const onRemove = vi.fn().mockResolvedValue(true);
    render(<ContactsTab contacts={[contact]} canUpdate onAdd={vi.fn()} onEdit={onEdit} onRemove={onRemove} />);
    await user.click(screen.getByRole("button", { name: "Priya Shah actions" }));
    await user.click(await screen.findByRole("menuitem", { name: /Edit/ }));
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Priya Shah");
    fireEvent.change(screen.getByLabelText("Role"), { target: { value: "Director" } });
    fireEvent.click(screen.getByRole("button", { name: "Save contact" }));
    await waitFor(() => expect(onEdit).toHaveBeenCalledWith("c1", expect.objectContaining({ name: "Priya Shah", role: "Director" })));

    cleanup();
    render(<ContactsTab contacts={[contact]} canUpdate onAdd={vi.fn()} onEdit={onEdit} onRemove={onRemove} />);
    await user.click(screen.getByRole("button", { name: "Priya Shah actions" }));
    await user.click(await screen.findByRole("menuitem", { name: /Remove/ }));
    expect(onRemove).not.toHaveBeenCalled(); // a confirm comes first
    await user.click(await screen.findByRole("button", { name: "Remove contact" }));
    await waitFor(() => expect(onRemove).toHaveBeenCalledWith("c1", "Priya Shah"));

    cleanup();
    render(<ContactsTab contacts={[contact]} canUpdate={false} onAdd={vi.fn()} onEdit={vi.fn()} onRemove={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Add contact" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Priya Shah actions" })).toBeNull();
  });
});

describe("DocumentsTab", () => {
  it("expiry is a derived word: Expired, Expires in Nd, nothing when far off or unset; the Overview rows list only the first two", () => {
    const docs = [doc({ id: "a", name: "Old cover", expiryDate: NOW - 3 * DAY }), doc({ id: "b", name: "Soon cover", expiryDate: NOW + 10 * DAY }), doc({ id: "c", name: "Fine cover" }), doc({ id: "d", name: "No expiry", expiryDate: null })];
    render(<DocumentsTab documents={docs} now={NOW} canUpdate={false} onAdd={vi.fn()} onEdit={vi.fn()} onRemove={vi.fn()} />);
    expect(screen.getByText("Expired")).toBeTruthy();
    expect(screen.getByText("Expires in 10d")).toBeTruthy();
    expect(screen.getAllByText(/Expires in|Expired/)).toHaveLength(2);
    const items = documentHealthItems(docs, NOW, vi.fn());
    expect(items.map((i) => i.tone)).toEqual(["error", "warning"]);
  });

  it("Add document needs a file and a name, then calls onAdd with the epoch-ms expiry and the file", async () => {
    const onAdd = vi.fn().mockResolvedValue(true);
    render(<DocumentsTab documents={[]} now={NOW} canUpdate onAdd={onAdd} onEdit={vi.fn()} onRemove={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Add document" }));
    expect(screen.getByRole("dialog", { name: "Add document" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Public liability" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Add document" }).at(-1)!);
    expect(await screen.findByText("Choose a file to upload")).toBeTruthy();
    const f = new File(["x"], "cover.pdf", { type: "application/pdf" });
    fireEvent.change(screen.getByLabelText("File"), { target: { files: [f] } });
    fireEvent.change(screen.getByLabelText("Expires"), { target: { value: "2027-06-30" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Add document" }).at(-1)!);
    await waitFor(() => expect(onAdd).toHaveBeenCalled());
    expect(onAdd.mock.calls[0][0]).toMatchObject({ name: "Public liability", expiryDate: Date.UTC(2027, 5, 30) });
    expect(onAdd.mock.calls[0][1]).toBe(f);
  });

  it("Edit keeps the file (no file field) and Remove says the file is deleted for good, behind a confirm", async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn().mockResolvedValue(true);
    const onRemove = vi.fn().mockResolvedValue(true);
    render(<DocumentsTab documents={[doc()]} now={NOW} canUpdate onAdd={vi.fn()} onEdit={onEdit} onRemove={onRemove} />);
    await user.click(screen.getByRole("button", { name: "Public liability actions" }));
    await user.click(await screen.findByRole("menuitem", { name: /Edit/ }));
    expect(screen.queryByLabelText("File")).toBeNull();
    expect((screen.getByLabelText("Expires") as HTMLInputElement).value).toBe("2027-02-23");
    fireEvent.change(screen.getByLabelText("Expires"), { target: { value: "2028-02-23" } });
    fireEvent.click(screen.getByRole("button", { name: "Save document" }));
    await waitFor(() => expect(onEdit).toHaveBeenCalledWith("d1", expect.objectContaining({ expiryDate: Date.UTC(2028, 1, 23) })));

    cleanup();
    render(<DocumentsTab documents={[doc()]} now={NOW} canUpdate onAdd={vi.fn()} onEdit={onEdit} onRemove={onRemove} />);
    await user.click(screen.getByRole("button", { name: "Public liability actions" }));
    await user.click(await screen.findByRole("menuitem", { name: /Remove/ }));
    expect(await screen.findByText(/deletes the document and its file for good/)).toBeTruthy();
    expect(onRemove).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Delete document" }));
    await waitFor(() => expect(onRemove).toHaveBeenCalledWith("d1", "Public liability"));
  });
});

describe("OrderFilesPanel", () => {
  const row: OrderFileRow = { id: "of1", kind: "DOCKET", name: null, file };

  it("Attach file opens the sheet, needs a file, and sends the chosen kind", async () => {
    const onAdd = vi.fn().mockResolvedValue(true);
    render(<OrderFilesPanel files={[row]} canUpdate onAdd={onAdd} onRemove={vi.fn()} />);
    expect(screen.getByText("cover.pdf")).toBeTruthy();
    expect(screen.getByText(/Docket/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Attach file" }));
    expect(screen.getByRole("dialog", { name: "Attach a file" })).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Attach file" }).at(-1)!);
    expect(await screen.findByText("Choose a file to upload")).toBeTruthy();
    const f = new File(["x"], "po-114.pdf", { type: "application/pdf" });
    fireEvent.change(screen.getByLabelText("File"), { target: { files: [f] } });
    fireEvent.click(screen.getAllByRole("button", { name: "Attach file" }).at(-1)!);
    await waitFor(() => expect(onAdd).toHaveBeenCalledWith(f, "PO", undefined));
  });

  it("Remove is a confirmed red verb; a viewer gets no Attach and no menu", async () => {
    const user = userEvent.setup();
    const onRemove = vi.fn().mockResolvedValue(true);
    render(<OrderFilesPanel files={[row]} canUpdate onAdd={vi.fn()} onRemove={onRemove} />);
    await user.click(screen.getByRole("button", { name: "cover.pdf actions" }));
    await user.click(await screen.findByRole("menuitem", { name: /Remove/ }));
    expect(onRemove).not.toHaveBeenCalled();
    await user.click(await screen.findByRole("button", { name: "Delete file" }));
    await waitFor(() => expect(onRemove).toHaveBeenCalledWith("of1", "cover.pdf"));
    cleanup();
    render(<OrderFilesPanel files={[row]} canUpdate={false} onAdd={vi.fn()} onRemove={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Attach file" })).toBeNull();
    expect(screen.queryByRole("button", { name: "cover.pdf actions" })).toBeNull();
  });
});
