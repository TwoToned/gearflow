// @vitest-environment node
//
// convex/lib/clientContactCore.ts — the ONE shared "which contact represents this
// client" resolver (WS9 #948), used by clients.ts (listPage/detail),
// globalSearch.ts, and build-document-data.ts (PDF client_contact/email/phone
// tokens). This is the fallback-chain fixture the PDF token resolution relies on:
// project's explicitly selected contact -> client's primary contact -> legacy
// embedded clients.contactName/Email/Phone fields.
import { describe, test, expect } from "vitest";
import { getPrimaryContact, resolveClientContactDisplay } from "./clientContactCore";

describe("getPrimaryContact", () => {
  test("no contacts -> null (a client with zero contacts stays valid)", () => {
    expect(getPrimaryContact([])).toBeNull();
  });

  test("returns the row flagged isPrimary, regardless of position", () => {
    const contacts = [
      { id: "a", isPrimary: false, sortOrder: 0 },
      { id: "b", isPrimary: true, sortOrder: 1 },
    ];
    expect(getPrimaryContact(contacts)?.id).toBe("b");
  });

  test("no isPrimary flag set -> falls back to the lowest sortOrder", () => {
    const contacts = [
      { id: "a", sortOrder: 2 },
      { id: "b", sortOrder: 0 },
      { id: "c", sortOrder: 1 },
    ];
    expect(getPrimaryContact(contacts)?.id).toBe("b");
  });
});

describe("resolveClientContactDisplay — PDF token fallback chain (WS9 #948)", () => {
  const legacy = { contactName: "Legacy Name", contactEmail: "legacy@acme.com", contactPhone: "0400000000" };
  const contacts = [
    { id: "primary", name: "Primary Person", email: "primary@acme.com", phone: "0411111111", isPrimary: true, sortOrder: 0 },
    { id: "other", name: "Other Person", email: "other@acme.com", phone: "0422222222", isPrimary: false, sortOrder: 1 },
  ];

  test("1. project's explicitly SELECTED contact wins over the client's primary", () => {
    const resolved = resolveClientContactDisplay(legacy, contacts, "other");
    expect(resolved).toEqual({ name: "Other Person", email: "other@acme.com", phone: "0422222222" });
  });

  test("2. no selected contact -> falls back to the client's PRIMARY contact", () => {
    const resolved = resolveClientContactDisplay(legacy, contacts, undefined);
    expect(resolved).toEqual({ name: "Primary Person", email: "primary@acme.com", phone: "0411111111" });
  });

  test("2b. a selected contact id that doesn't exist among the client's contacts also falls back to primary", () => {
    const resolved = resolveClientContactDisplay(legacy, contacts, "does-not-exist");
    expect(resolved).toEqual({ name: "Primary Person", email: "primary@acme.com", phone: "0411111111" });
  });

  test("3. no contacts at all -> falls back to the LEGACY embedded fields (migration window)", () => {
    const resolved = resolveClientContactDisplay(legacy, [], "other");
    expect(resolved).toEqual({ name: "Legacy Name", email: "legacy@acme.com", phone: "0400000000" });
  });

  test("no contacts and no legacy fields -> all null (never undefined)", () => {
    const resolved = resolveClientContactDisplay({}, [], undefined);
    expect(resolved).toEqual({ name: null, email: null, phone: null });
  });
});
