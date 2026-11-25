// @vitest-environment jsdom
//
// UX Phase 9 (D23): `?templates=1` opens Manage templates, `?templates=new` opens the New
// template sheet (name, type, tags, description; no code or discount), over any /projects page;
// closing drops the param; creating makes a TEMPLATE and opens its page.
import React from "react";
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { templatesCloseHref, templatesHref } from "@/lib/templates-url";

beforeAll(() => {
  Element.prototype.scrollIntoView ??= () => {};
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
});

const push = vi.fn();
const replace = vi.fn();
const create = vi.fn(async () => ({ id: "tpl9" }));
let query = "templates=new&tab=equipment";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace }),
  usePathname: () => "/projects",
  useSearchParams: () => new URLSearchParams(query),
}));
vi.mock("@/lib/auth-client", () => ({ useActiveOrganization: () => ({ data: { id: "org1" } }), useSession: () => ({ data: { user: { id: "u1" } } }) }));
vi.mock("@/lib/use-permissions", () => ({ useCanDo: () => true }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@/hooks/use-server-mutation", () => ({
  useServerMutation: (o: { mutationFn: (d: unknown) => Promise<unknown>; onSuccess?: (r: unknown) => void; onError?: (e: Error) => void }) => ({
    mutate: async (d: unknown) => { try { o.onSuccess?.(await o.mutationFn(d)); } catch (e) { o.onError?.(e as Error); } },
    isPending: false,
  }),
}));
vi.mock("@/hooks/use-server-query", () => ({ useServerQuery: () => ({ data: undefined }) }));
vi.mock("@/hooks/use-native-project-writes", () => ({ useProjectWrites: () => ({ create }) }));
vi.mock("@/hooks/use-project-managers-writes", () => ({ useProjectManagerWrites: () => ({ set: vi.fn() }) }));
vi.mock("@/hooks/use-project-lock", () => ({ useProjectPricingLock: () => ({ loading: false, pricingLocked: false }) }));
vi.mock("@/hooks/use-clients", () => ({ useClientSearch: () => [], useClient: () => undefined, useClientContacts: () => [] }));
vi.mock("@/hooks/use-debounced-value", () => ({ useDebouncedValue: (v: unknown) => v }));
vi.mock("@/hooks/use-locations", () => ({ useLocations: () => [] }));
vi.mock("@/hooks/use-org-tags", () => ({ useOrgTags: () => [] }));
vi.mock("@/server/org-members", () => ({ getOrgMembers: vi.fn(async () => ({ members: [] })) }));
vi.mock("@/server/projects", () => ({ peekNextProjectNumber: vi.fn(async () => "P-1") }));
vi.mock("@/components/clients/quick-create-client", () => ({ QuickCreateClient: () => null }));
vi.mock("@/hooks/use-templates", () => ({
  useTemplates: () => ({ templates: [], total: 0, truncated: false }),
  useTemplateWrites: () => ({ archive: vi.fn(), unarchive: vi.fn(), deleteForever: vi.fn(), apply: vi.fn(), undoApply: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { TemplatesHost } from "../templates/templates-host";

beforeEach(() => {
  [push, replace, create].forEach((m) => m.mockClear());
});

describe("templates URL", () => {
  it("builds and clears the param, keeping every other param", () => {
    expect(templatesHref("/projects", "tab=x")).toBe("/projects?tab=x&templates=1");
    expect(templatesHref("/projects", "", "new")).toBe("/projects?templates=new");
    expect(templatesCloseHref("/projects", "templates=1&tab=x")).toBe("/projects?tab=x");
    expect(templatesCloseHref("/projects", "templates=1")).toBe("/projects");
  });
});

describe("TemplatesHost", () => {
  it("?templates=new opens the New template sheet: job fields, no code and no discount", async () => {
    query = "templates=new&tab=equipment";
    render(<TemplatesHost />);
    expect(await screen.findByText("New template")).toBeTruthy();
    expect(screen.getByPlaceholderText("e.g. Summer Festival 2026")).toBeTruthy();
    expect(screen.queryByText("Job code")).toBeNull();
    expect(screen.queryByText("Discount (%)")).toBeNull();
  });

  it("Create template makes a template and opens its page; Cancel drops the param", async () => {
    query = "templates=new&tab=equipment";
    render(<TemplatesHost />);
    fireEvent.change(await screen.findByPlaceholderText("e.g. Summer Festival 2026"), { target: { value: "Gala dinner — ballroom" } });
    fireEvent.click(screen.getByRole("button", { name: "Create template" }));
    await waitFor(() => expect(create).toHaveBeenCalledWith(expect.objectContaining({ name: "Gala dinner — ballroom", isTemplate: true })));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/projects/tpl9"));
    expect(replace).toHaveBeenCalledWith("/projects?tab=equipment");
  });

  it("?templates=1 opens Manage templates; no param renders nothing open", async () => {
    query = "templates=1";
    const { unmount } = render(<TemplatesHost />);
    expect(await screen.findByText("Manage templates")).toBeTruthy();
    unmount();
    query = "";
    render(<TemplatesHost />);
    expect(screen.queryByText("Manage templates")).toBeNull();
    expect(screen.queryByText("New template")).toBeNull();
  });
});
