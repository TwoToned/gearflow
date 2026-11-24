// @vitest-environment node
//
// `getProject`, `getProjects` and `getTemplates` read the project row with the
// service identity, so they decide JOB COST (`serviceCostTotal`,
// `labourCostTotal`, `margin`) for the real caller with `callerSeesJobCost`
// (owner ruling 2026-11-24: invoice:read, and not a noFinancials key): absent,
// never zeroed, for a caller who fails it — and `getProjects` won't sort on one.
import { beforeEach, describe, expect, it, vi } from "vitest";

const role = vi.hoisted(() => ({ value: "member" as string }));
const ambient = vi.hoisted(() => ({ value: null as null | { actorType: string } }));
const ROW = (id: string, margin: number, createdAt: number, over: Record<string, unknown> = {}) => ({
  id, organizationId: "org1", projectNumber: id, name: id, status: "CONFIRMED", type: "DRY_HIRE", isTemplate: false,
  clientId: null, locationId: null, total: 5000, subtotal: 4545, serviceCostTotal: 650, labourCostTotal: 300, margin,
  createdAt: new Date(createdAt), updatedAt: new Date(createdAt), rentalStartDate: null, rentalEndDate: null, ...over,
});
const rows = vi.hoisted(() => ({ list: [] as Record<string, unknown>[] }));

vi.mock("@/lib/org-context", () => ({
  getOrgContext: vi.fn(async () => ({ organizationId: "org1", userId: "u1", userName: "Ann" })),
  getCurrentRole: vi.fn(async () => role.value),
}));
vi.mock("@/lib/request-actor", () => ({ getAmbientActor: vi.fn(() => ambient.value) }));
vi.mock("@/lib/prisma", () => ({ prisma: { user: { findMany: vi.fn(async () => []) } } }));
vi.mock("@/lib/projects-read", () => ({
  getCallSheetData: vi.fn(),
  getProjectsByOrgMapped: vi.fn(async () => rows.list),
  getProjectByIdMapped: vi.fn(async (id: string) => rows.list.find((r) => r.id === id) ?? null),
}));
vi.mock("@/lib/clients-read", () => ({
  getClientById: vi.fn(async () => null),
  getClientMap: vi.fn(async () => new Map()),
  attachClient: vi.fn(async (_org: string, xs: unknown[]) => xs),
}));
vi.mock("@/lib/project-line-item-read", () => ({ buildProjectEquipmentTree: vi.fn(async () => ({ categories: [], lineItems: [] })) }));
vi.mock("@/lib/line-item-count-read", () => ({
  getLineItemsByProjectIds: vi.fn(async () => []),
  buildIncludeLineItemsByProject: vi.fn(() => new Map()),
  groupActiveLineItemsByProject: vi.fn(() => new Map()),
  countTopLevelLineItemsByProject: vi.fn(() => new Map()),
}));
vi.mock("@/lib/availability", () => ({ computeOverbookedStatus: vi.fn(async () => new Map()) }));
vi.mock("@/lib/convex-client", () => ({
  getConvexClient: vi.fn(async () => ({ query: vi.fn(async () => []) })),
  withConvexReadRetry: (f: () => unknown) => f(),
}));
vi.mock("@/lib/media-read", () => ({ getProjectMediaFromConvex: vi.fn(async () => []), withResolvedFile: (x: unknown) => x }));
vi.mock("@/lib/locations-read", () => ({ getLocationMap: vi.fn(async () => new Map()), getMappedLocationsByOrg: vi.fn(async () => []), mapLocation: (x: unknown) => x }));

import { getProject, getProjects, getTemplates } from "../projects";

const JOB_COST = ["serviceCostTotal", "labourCostTotal", "margin"];
/** A role with no invoice:read: every built-in role holds it, so an unknown (removed) role stands in. */
const NO_INVOICE_READ = "custom:legacy";
type Row = Record<string, unknown>;

beforeEach(() => {
  role.value = "member";
  ambient.value = null;
  // p1: margin 4050, older; p2: margin 99999, newer. By margin asc p1 < p2; by createdAt desc p2 < p1.
  rows.list = [ROW("p1", 4050, 1000), ROW("p2", 99999, 2000), ROW("t1", 1, 500, { isTemplate: true })];
});

describe("project server actions follow the job-cost rule", () => {
  it("getProject: a member WITH invoice:read gets job cost and margin; a role without it gets them ABSENT, the rest stays", async () => {
    expect(await getProject("p1")).toMatchObject({ serviceCostTotal: 650, labourCostTotal: 300, margin: 4050 });
    role.value = NO_INVOICE_READ;
    const p = (await getProject("p1")) as Row;
    for (const f of JOB_COST) expect(p, f).not.toHaveProperty(f);
    expect(p).toMatchObject({ id: "p1", total: 5000 });
  });

  it("getProject: an API key (noFinancials, fail closed) as an owner gets none", async () => {
    role.value = "owner";
    ambient.value = { actorType: "apiKey" };
    expect(await getProject("p1")).not.toHaveProperty("margin");
  });

  it("getProjects: a member's rows carry job cost; a role without invoice:read gets none", async () => {
    const res = (await getProjects({})) as unknown as { projects: Row[] };
    expect(res.projects.length).toBeGreaterThan(0);
    for (const p of res.projects) expect(p).toHaveProperty("margin");
    role.value = NO_INVOICE_READ;
    const none = (await getProjects({})) as unknown as { projects: Row[] };
    for (const p of none.projects) for (const f of JOB_COST) expect(p, f).not.toHaveProperty(f);
  });

  it("getProjects: a member sorts by margin; a caller without job cost asking the same gets the default order (the two differ)", async () => {
    rows.list = [ROW("p1", 99999, 1000), ROW("p2", 1, 2000)]; // margin asc: p2, p1; createdAt asc: p1, p2
    const res = (await getProjects({ sortBy: "margin", sortOrder: "asc" })) as unknown as { projects: Row[] };
    expect(res.projects.map((p) => p.id)).toEqual(["p2", "p1"]);
    expect(res.projects[0]).toMatchObject({ margin: 1 });
    role.value = NO_INVOICE_READ;
    const none = (await getProjects({ sortBy: "margin", sortOrder: "asc" })) as unknown as { projects: Row[] };
    expect(none.projects.map((p) => p.id)).toEqual(["p1", "p2"]); // createdAt, not margin
  });

  it("getTemplates: job cost for a member, absent without invoice:read", async () => {
    expect(((await getTemplates()) as unknown as Row[])[0]).toMatchObject({ id: "t1", margin: 1 });
    role.value = NO_INVOICE_READ;
    const [t] = (await getTemplates()) as unknown as Row[];
    for (const f of JOB_COST) expect(t, f).not.toHaveProperty(f);
  });
});
