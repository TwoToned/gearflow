// @vitest-environment jsdom
import React, { Suspense } from "react";
import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * UX Phase 13: the crew record on `RecordShell`. The tab strip, the Documents tab present only when the
 * server returned the list (the B2 rule), Rates absent when the server did not send them (the pay line),
 * Delete behind Deactivate (the UI half of C2), and `?tab=` / the old slash-command tab names.
 */
const st = vi.hoisted(() => ({
  search: "",
  replace: vi.fn(),
  push: vi.fn(),
  member: {} as Record<string, unknown>,
  documents: null as unknown,
  perms: { update: true, delete: true, read: true } as Record<string, boolean>,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: st.replace, push: st.push }),
  usePathname: () => "/crew/c1",
  useSearchParams: () => new URLSearchParams(st.search),
}));
vi.mock("next/link", () => ({ default: ({ href, children, ...p }: { href: string; children: React.ReactNode }) => <a href={href} {...p}>{children}</a> }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@/components/layout/page-meta", () => ({ PageMeta: () => null }));
vi.mock("convex/react", () => ({ useConvex: () => ({ query: async () => undefined }), useConvexAuth: () => ({ isAuthenticated: true }), useMutation: () => vi.fn() }));
vi.mock("../../../../../../convex/_generated/api", () => {
  const leaf = (a: string, b: string) => ({ __name: `${a}.${b}` });
  const api = new Proxy({}, { get: (_t, a) => new Proxy({}, { get: (_u, b) => leaf(String(a), String(b)) }) });
  return { api };
});
vi.mock("@/hooks/use-server-query", () => ({
  useServerQuery: ({ queryKey }: { queryKey: unknown[] }) => ({
    data: queryKey[0] === "crew-member" ? st.member : queryKey[0] === "crew-availability" ? [] : [],
    isLoading: false,
    refetch: vi.fn(),
  }),
}));
vi.mock("@/hooks/use-server-mutation", () => ({ useServerMutation: () => ({ mutate: vi.fn(), isPending: false }) }));
vi.mock("@/hooks/use-authed-query", () => ({ useAuthedQuery: () => st.documents }));
vi.mock("@/hooks/use-crew-writes", () => ({ useCrewWrites: () => ({ remove: vi.fn() }) }));
vi.mock("@/hooks/use-crew-assignment-writes", () => ({ useCrewAssignmentWrites: () => ({}) }));
vi.mock("@/hooks/use-crew-availability-writes", () => ({ useCrewAvailabilityWrites: () => ({}) }));
vi.mock("@/hooks/use-crew-time-writes", () => ({ useCrewTimeWrites: () => ({}) }));
vi.mock("@/server/crew-communication", () => ({ sendCrewOffer: vi.fn() }));
vi.mock("@/components/crew/record/use-crew-document-writes", () => ({ useCrewDocumentWrites: () => ({ add: vi.fn(), update: vi.fn(), remove: vi.fn() }) }));
vi.mock("@/components/people/use-people-writes", () => ({ usePeopleBulk: () => ({ setActive: vi.fn() }) }));
vi.mock("@/lib/auth-client", () => ({ useActiveOrganization: () => ({ data: { id: "org1" } }), useSession: () => ({ data: { user: { id: "u1", name: "A" } } }) }));
vi.mock("@/lib/use-permissions", () => ({ useCanDo: (_r: string, action: string) => !!st.perms[action] }));
vi.mock("@/components/auth/permission-gate", () => ({ CanDo: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("@/components/crew/crew-ical-feed-card", () => ({ CrewIcalFeedCard: () => <p>FEED-CARD</p> }));
vi.mock("@/components/activity/activity-timeline", () => ({ ActivityTimeline: () => <p>TIMELINE</p> }));

import CrewMemberDetailPage from "../page";

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});
afterEach(() => {
  cleanup();
  st.search = "";
  st.replace.mockClear();
  st.push.mockClear();
});

const baseMember = { id: "c1", firstName: "Bob", lastName: "Ryan", status: "ACTIVE", type: "FREELANCE", isActive: true, email: "bob@x.test", phone: "0400", skills: [], tags: [], assignments: [], crewRole: { name: "Rigger" } };
const params = () => Promise.resolve({ id: "c1" });
async function renderPage() {
  await act(async () => {
    render(
      <Suspense fallback={<div>Loading…</div>}>
        <CrewMemberDetailPage params={params()} />
      </Suspense>,
    );
    await Promise.resolve();
  });
}
function setup(over: { member?: Record<string, unknown>; documents?: unknown; perms?: Record<string, boolean> } = {}) {
  st.member = { ...baseMember, ...over.member };
  st.documents = over.documents ?? null;
  st.perms = { update: true, delete: true, read: true, ...over.perms };
}

describe("the crew record", () => {
  it("renders the shell, the six tabs plus Calendar, and keeps Documents ABSENT when the server returned null", async () => {
    setup();
    await renderPage();
    for (const name of ["Overview", "Calls", "Timesheets", "Availability", "History", "Calendar"]) expect(screen.getAllByRole("tab", { name: new RegExp(`^${name}`) }).length).toBeGreaterThan(0);
    expect(screen.queryByRole("tab", { name: /^Documents/ })).toBeNull();
    expect(screen.getAllByText("Bob Ryan").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy();
  });

  it("shows Documents, with the worst expiry as the Overview health row, when the server returned the list", async () => {
    setup({ documents: [{ id: "d1", kind: "LICENCE", name: "White card", expiresAt: Date.UTC(2020, 0, 5), createdAt: 1, file: null }] });
    await renderPage();
    expect(screen.getByRole("tab", { name: /^Documents/ })).toBeTruthy();
    expect(screen.getByText("Licence expired 5 Jan")).toBeTruthy();
    expect(screen.queryByText("White card")).toBeNull(); // the Overview names the kind and the date, never the label
  });

  it("Rates exist only when the server sent them (the pay line): absent, never zero or a dash", async () => {
    setup();
    await renderPage();
    expect(screen.queryByText("Rates")).toBeNull();
    cleanup();
    setup({ member: { defaultDayRate: 450 } });
    await renderPage();
    expect(screen.getByText("Rates")).toBeTruthy();
    expect(screen.getByText("$450.00")).toBeTruthy();
  });

  it("Delete is absent while the person is active (C2) and present, red, once inactive", async () => {
    const user = userEvent.setup();
    setup();
    await renderPage();
    await user.click(screen.getByRole("button", { name: "More actions" }));
    expect(await screen.findByRole("menuitem", { name: /Deactivate/ })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: /Delete/ })).toBeNull();
    cleanup();
    setup({ member: { status: "INACTIVE", isActive: false } });
    await renderPage();
    await user.click(screen.getByRole("button", { name: "More actions" }));
    expect(await screen.findByRole("menuitem", { name: /Reactivate/ })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /Delete/ })).toBeTruthy();
  });

  it("a read-only viewer gets no Edit, no Deactivate and no Delete", async () => {
    setup({ perms: { update: false, delete: false } });
    await renderPage();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  });

  it("?tab=calendar opens the feed card, and an unknown tab falls back to Overview", async () => {
    setup();
    st.search = "tab=calendar";
    await renderPage();
    expect(screen.getByText("FEED-CARD")).toBeTruthy();
    cleanup();
    st.search = "tab=nonsense";
    await renderPage();
    expect(screen.queryByText("FEED-CARD")).toBeNull();
    expect(screen.getByText("Nothing needs a look.")).toBeTruthy();
  });
});
