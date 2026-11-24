// @vitest-environment node
//
// The timeline PDF prints a project's services and crew. It needs `project:read`
// in the caller's org for a project in that org, and `?showCost=true` prints
// costs (a service's cost rolls up its crew's pay) only for a caller who sees
// crew pay — for anyone else the param is ignored and no cost reaches the
// template (UX Phase 15).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  permitted: true,
  pay: false,
  project: { id: "p1" } as unknown,
  buildTimelineInputs: vi.fn((..._a: unknown[]) => ({ inputs: [], template: {} })),
}));
vi.mock("@/lib/auth-server", () => ({ requireOrganization: vi.fn(async () => ({ organizationId: "org1" })) }));
vi.mock("@/lib/org-context", () => ({
  requirePermission: vi.fn(async () => {
    if (!h.permitted) throw new Error("Forbidden");
    return { organizationId: "org1", userId: "u1", userName: "Ann" };
  }),
}));
vi.mock("@/lib/crew-pay-caller", () => ({ callerSeesCrewPay: vi.fn(async () => h.pay) }));
vi.mock("@/lib/projects-read", () => ({ getProjectByIdMapped: vi.fn(async () => h.project) }));
vi.mock("@/lib/pdfme/build-document-data", () => ({ buildDocumentData: vi.fn(async () => ({ project_number: "2341" })) }));
vi.mock("@/lib/project-service-read", () => ({
  getProjectServicesFromConvex: vi.fn(async () => [
    { id: "s1", type: "LABOUR", title: "Rig", status: "PLANNED", date: null, startTime: null, endTime: null, address: null, notes: null, crewAssignments: [], lineTotal: 900, costTotal: 650 },
  ]),
}));
vi.mock("@/lib/pdfme/templates/timeline", async (orig) => ({ ...(await orig<object>()), buildTimelineInputs: h.buildTimelineInputs }));
vi.mock("@/lib/pdfme/pdf-render", () => ({ renderPdfTemplate: vi.fn(async () => new Uint8Array([1])) }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn() } }));

import { GET } from "../route";

const call = (q = "") => GET(new NextRequest(`http://x/api/documents/timeline/p1${q}`), { params: Promise.resolve({ projectId: "p1" }) });
type Settings = { showCost: boolean };
type Svc = { costTotal: number | null };
const lastArgs = () => h.buildTimelineInputs.mock.calls.at(-1) as unknown as [unknown, Svc[], Settings];

beforeEach(() => {
  h.permitted = true;
  h.pay = false;
  h.project = { id: "p1" };
  h.buildTimelineInputs.mockClear();
});

describe("timeline PDF route", () => {
  it("without project:read: 403, nothing rendered", async () => {
    h.permitted = false;
    expect((await call()).status).toBe(403);
    expect(h.buildTimelineInputs).not.toHaveBeenCalled();
  });

  it("a project outside the caller's org: 404", async () => {
    h.project = null;
    expect((await call()).status).toBe(404);
  });

  it("below the crew-pay line ?showCost=true is ignored and no cost reaches the template", async () => {
    expect((await call("?showCost=true")).status).toBe(200);
    const [, services, settings] = lastArgs();
    expect(settings.showCost).toBe(false);
    expect(services[0].costTotal).toBeNull();
  });

  it("a caller who sees crew pay gets the costs with ?showCost=true", async () => {
    h.pay = true;
    await call("?showCost=true");
    const [, services, settings] = lastArgs();
    expect(settings.showCost).toBe(true);
    expect(services[0].costTotal).toBe(650);
  });
});
