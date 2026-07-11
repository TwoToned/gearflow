// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

const h = vi.hoisted(() => ({
  session: null as { user: { id: string } } | null,
}));

vi.mock("@/lib/auth-client", () => ({
  useSession: () => ({ data: h.session }),
}));

import { usePersistentPref } from "@/hooks/use-persistent-pref";

describe("usePersistentPref", () => {
  beforeEach(() => {
    localStorage.clear();
    h.session = null;
  });

  it("returns the default first, then persists updates", () => {
    const { result } = renderHook(() => usePersistentPref("density", "comfortable"));
    expect(result.current[0]).toBe("comfortable");

    act(() => result.current[1]("compact"));
    expect(result.current[0]).toBe("compact");

    // A fresh mount reads the persisted value back.
    const again = renderHook(() => usePersistentPref("density", "comfortable"));
    expect(again.result.current[0]).toBe("compact");
  });

  it("scopes storage per user so shared devices don't leak preferences", () => {
    h.session = { user: { id: "userA" } };
    const a = renderHook(() => usePersistentPref("density", "comfortable"));
    act(() => a.result.current[1]("relaxed"));

    // A different operator on the same device sees the default, not userA's choice.
    h.session = { user: { id: "userB" } };
    const b = renderHook(() => usePersistentPref("density", "comfortable"));
    expect(b.result.current[0]).toBe("comfortable");

    // userA's value is untouched under their own scope.
    h.session = { user: { id: "userA" } };
    const a2 = renderHook(() => usePersistentPref("density", "comfortable"));
    expect(a2.result.current[0]).toBe("relaxed");
  });

  it("adopts the user's stored value when the session resolves after mount", () => {
    // Seed userA's stored preference.
    h.session = { user: { id: "userA" } };
    const seed = renderHook(() => usePersistentPref("view", "cards"));
    act(() => seed.result.current[1]("table"));

    // New mount that starts anonymous (session not yet resolved), then resolves to userA.
    h.session = null;
    const { result, rerender } = renderHook(() => usePersistentPref("view", "cards"));
    expect(result.current[0]).toBe("cards"); // anon fallback

    h.session = { user: { id: "userA" } };
    rerender();
    expect(result.current[0]).toBe("table"); // re-read userA's stored value
  });

  it("re-reads when the key changes on a reused hook instance (no cross-table bleed)", () => {
    const { result, rerender } = renderHook(({ k }) => usePersistentPref(k, "def"), {
      initialProps: { k: "tableA-density" },
    });
    act(() => result.current[1]("compact")); // stored under tableA

    // Same hook instance, different key (component reused for another table).
    rerender({ k: "tableB-density" });
    expect(result.current[0]).toBe("def"); // NOT tableA's "compact"

    rerender({ k: "tableA-density" });
    expect(result.current[0]).toBe("compact"); // tableA's value intact
  });

  it("survives unavailable / malformed storage without throwing", () => {
    localStorage.setItem("gearflow-pref-anon-density", "{not json");
    const { result } = renderHook(() => usePersistentPref("density", "comfortable"));
    expect(result.current[0]).toBe("comfortable");
  });
});
