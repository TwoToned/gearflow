// WS9 #948 — pure matching helpers shared by src/server/woocommerce.ts's
// findOrCreateClient (the server-action path; that function stays un-exported —
// see its docstring — so this pins the exact decision logic it calls directly).
// The Convex-native twin (convex/wooCommerceActions.ts) keeps its own verbatim
// copy, behavior-pinned end-to-end in convex/wooCommerceActions.test.ts.
import { describe, test, expect } from "vitest";
import { groupContactsByClient, clientKnowsEmail } from "./woocommerce-client-match";

describe("groupContactsByClient", () => {
  test("groups contacts by clientId, preserving order within a client", () => {
    const contacts = [
      { clientId: "c1", email: "a@x.com" },
      { clientId: "c2", email: "b@x.com" },
      { clientId: "c1", email: "c@x.com" },
    ];
    const grouped = groupContactsByClient(contacts);
    expect(grouped.get("c1")).toEqual([{ clientId: "c1", email: "a@x.com" }, { clientId: "c1", email: "c@x.com" }]);
    expect(grouped.get("c2")).toEqual([{ clientId: "c2", email: "b@x.com" }]);
    expect(grouped.get("c3")).toBeUndefined();
  });

  test("empty input yields an empty map", () => {
    expect(groupContactsByClient([]).size).toBe(0);
  });
});

describe("clientKnowsEmail", () => {
  const empty = new Map<string, { clientId: string; email?: string }[]>();

  test("false when no email is supplied", () => {
    expect(clientKnowsEmail({ id: "c1" }, undefined, empty)).toBe(false);
  });

  test("true when the legacy embedded contactEmail matches", () => {
    expect(clientKnowsEmail({ id: "c1", contactEmail: "jane@acme.com" }, "jane@acme.com", empty)).toBe(true);
  });

  test("true when a NON-primary contact row's email matches (the widen)", () => {
    const byClient = groupContactsByClient([{ clientId: "c1", email: "bob@acme.com" }]);
    expect(clientKnowsEmail({ id: "c1", contactEmail: "jane@acme.com" }, "bob@acme.com", byClient)).toBe(true);
  });

  test("false when the email matches neither the legacy field nor any contact", () => {
    const byClient = groupContactsByClient([{ clientId: "c1", email: "bob@acme.com" }]);
    expect(clientKnowsEmail({ id: "c1", contactEmail: "jane@acme.com" }, "unknown@acme.com", byClient)).toBe(false);
  });

  test("false when the matching contact belongs to a DIFFERENT client", () => {
    const byClient = groupContactsByClient([{ clientId: "c2", email: "bob@acme.com" }]);
    expect(clientKnowsEmail({ id: "c1" }, "bob@acme.com", byClient)).toBe(false);
  });
});
