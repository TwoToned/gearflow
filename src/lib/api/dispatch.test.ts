import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ActorContext } from "../actor-context";
import type { OperationMeta } from "./generated/operations";

const getProjects = vi.hoisted(() => vi.fn());
const deleteProject = vi.hoisted(() => vi.fn());
const addLineItem = vi.hoisted(() => vi.fn());
const authorizeApiOperation = vi.hoisted(() => vi.fn());
const idempotencyFindUnique = vi.hoisted(() => vi.fn());
const idempotencyCreate = vi.hoisted(() => vi.fn());

const meta = (over: Partial<OperationMeta> & Pick<OperationMeta, "name">): OperationMeta => ({
  module: "projects",
  fn: "getProjects",
  kind: "read",
  resource: "project",
  action: "read",
  scope: "project:read",
  params: [],
  dangerous: false,
  summary: "",
  ...over,
});

vi.mock("./generated/operations", () => ({
  OPERATIONS: {
    "projects.getProjects": meta({
      name: "projects.getProjects",
      params: [{ name: "params", type: "object", optional: true }],
      summary: "List projects.",
    }),
    "projects.deleteProject": meta({
      name: "projects.deleteProject",
      fn: "deleteProject",
      kind: "write",
      action: "delete",
      scope: "project:delete",
      params: [{ name: "id", type: "string", optional: false }],
      dangerous: true,
    }),
    "line-items.addLineItem": meta({
      name: "line-items.addLineItem",
      module: "line-items",
      fn: "addLineItem",
      kind: "write",
      action: "manage_line_items",
      scope: "project:manage_line_items",
      params: [
        { name: "projectId", type: "string", optional: false },
        { name: "data", type: "object", optional: false },
        { name: "allowOverbook", type: "boolean", optional: true },
      ],
    }),
    "clients.updateClient": meta({
      name: "clients.updateClient",
      module: "clients",
      fn: "updateClient",
      kind: "write",
      resource: "client",
      action: "update",
      scope: "client:update",
      params: [{ name: "id", type: "string", optional: false }],
    }),
  },
  MODULE_LOADERS: {
    projects: async () => ({ getProjects, deleteProject }),
    "line-items": async () => ({ addLineItem }),
    clients: async () => ({}), // handler intentionally missing
  },
  OPERATION_COUNT: 4,
}));

vi.mock("./authorize", () => ({ authorizeApiOperation }));
vi.mock("../prisma", () => ({
  prisma: {
    apiIdempotency: { findUnique: idempotencyFindUnique, create: idempotencyCreate },
  },
}));

const {
  invokeOperation,
  listOperations,
  describeOperation,
  buildArgList,
  getOperation,
  isGuardedWrite,
} = await import("./dispatch");

const actor: ActorContext = {
  organizationId: "org_1",
  userId: "user_1",
  userName: "Agent",
  actorType: "apiKey",
  apiKeyId: "key_1",
  scopes: ["project:read", "project:delete", "project:manage_line_items"],
};

beforeEach(() => {
  vi.clearAllMocks();
  authorizeApiOperation.mockResolvedValue({
    organizationId: "org_1",
    userId: "user_1",
    userName: "Agent",
  });
  idempotencyFindUnique.mockResolvedValue(null);
  idempotencyCreate.mockResolvedValue({});
  getProjects.mockResolvedValue([{ id: "p1", name: "Gig" }]);
  deleteProject.mockResolvedValue({ success: true });
  addLineItem.mockResolvedValue({ id: "li_1" });
});

describe("getOperation", () => {
  it("throws NOT_FOUND with a discovery hint for an unknown name", () => {
    expect(() => getOperation("nope.nothing")).toThrowError(
      expect.objectContaining({ code: "NOT_FOUND" }),
    );
  });
});

describe("buildArgList", () => {
  const op = getOperation("line-items.addLineItem");

  it("maps named args onto positional parameters in order", () => {
    expect(buildArgList(op, { projectId: "p1", data: { q: 1 }, allowOverbook: true })).toEqual([
      "p1",
      { q: 1 },
      true,
    ]);
  });

  it("trims trailing optionals so the action's own defaults apply", () => {
    expect(buildArgList(op, { projectId: "p1", data: { q: 1 } })).toEqual(["p1", { q: 1 }]);
  });

  it("rejects unknown arguments instead of silently dropping them", () => {
    expect(() => buildArgList(op, { projectID: "p1", data: {} })).toThrowError(
      expect.objectContaining({ code: "VALIDATION_ERROR" }),
    );
  });

  it("rejects missing required arguments and lists what was expected", () => {
    try {
      buildArgList(op, { projectId: "p1" });
      throw new Error("should have thrown");
    } catch (e) {
      const err = e as { code: string; message: string; details?: { expected?: unknown[] } };
      expect(err.code).toBe("VALIDATION_ERROR");
      expect(err.message).toContain("data");
      expect(err.details?.expected).toHaveLength(3);
    }
  });
});

describe("isGuardedWrite", () => {
  it("guards dangerous writes", () => {
    expect(isGuardedWrite(getOperation("projects.deleteProject"))).toBe(true);
  });
  it("guards availability-affecting writes", () => {
    expect(isGuardedWrite(getOperation("line-items.addLineItem"))).toBe(true);
  });
  it("does not guard ordinary writes", () => {
    expect(isGuardedWrite(getOperation("clients.updateClient"))).toBe(false);
  });
  it("does not guard reads", () => {
    expect(isGuardedWrite(getOperation("projects.getProjects"))).toBe(false);
  });
});

describe("invokeOperation", () => {
  it("authorizes before running the handler", async () => {
    await invokeOperation(actor, { operation: "projects.getProjects" });
    expect(authorizeApiOperation).toHaveBeenCalledWith(actor, "project", "read");
  });

  it("does not run the handler when authorization fails", async () => {
    authorizeApiOperation.mockRejectedValue(new Error("You don't have permission"));
    await expect(invokeOperation(actor, { operation: "projects.getProjects" })).rejects.toThrow();
    expect(getProjects).not.toHaveBeenCalled();
  });

  it("runs a read and returns the serialized result", async () => {
    const res = await invokeOperation(actor, { operation: "projects.getProjects" });
    expect(res).toEqual({
      operation: "projects.getProjects",
      kind: "read",
      replayed: false,
      result: [{ id: "p1", name: "Gig" }],
    });
  });

  it("serializes Dates to ISO strings", async () => {
    getProjects.mockResolvedValue([{ id: "p1", start: new Date("2026-01-02T03:04:05Z") }]);
    const res = await invokeOperation(actor, { operation: "projects.getProjects" });
    expect(res.result).toEqual([{ id: "p1", start: "2026-01-02T03:04:05.000Z" }]);
  });

  it("refuses a dangerous write without confirm", async () => {
    await expect(
      invokeOperation(actor, { operation: "projects.deleteProject", arguments: { id: "p1" } }),
    ).rejects.toMatchObject({ code: "CONFIRMATION_REQUIRED" });
    expect(deleteProject).not.toHaveBeenCalled();
  });

  it("refuses an availability-affecting write without confirm, and points at reserve_items", async () => {
    try {
      await invokeOperation(actor, {
        operation: "line-items.addLineItem",
        arguments: { projectId: "p1", data: {} },
      });
      throw new Error("should have thrown");
    } catch (e) {
      const err = e as { code: string; details?: { hint?: string } };
      expect(err.code).toBe("CONFIRMATION_REQUIRED");
      expect(err.details?.hint).toContain("reserve_items");
    }
    expect(addLineItem).not.toHaveBeenCalled();
  });

  it("refuses a confirmed dangerous write with no idempotencyKey", async () => {
    await expect(
      invokeOperation(actor, {
        operation: "projects.deleteProject",
        arguments: { id: "p1" },
        confirm: true,
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REQUIRED" });
    expect(deleteProject).not.toHaveBeenCalled();
  });

  it("commits a confirmed dangerous write and records idempotency", async () => {
    const res = await invokeOperation(actor, {
      operation: "projects.deleteProject",
      arguments: { id: "p1" },
      confirm: true,
      idempotencyKey: "idem-1",
    });
    expect(deleteProject).toHaveBeenCalledWith("p1");
    expect(res.replayed).toBe(false);
    expect(idempotencyCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ apiKeyId: "key_1", key: "idem-1", verb: "projects.deleteProject" }),
      }),
    );
  });

  it("replays a prior idempotent write without re-running the handler", async () => {
    idempotencyFindUnique.mockResolvedValue({ result: JSON.stringify({ success: true }) });
    const res = await invokeOperation(actor, {
      operation: "projects.deleteProject",
      arguments: { id: "p1" },
      confirm: true,
      idempotencyKey: "idem-1",
    });
    expect(res.replayed).toBe(true);
    expect(res.result).toEqual({ success: true });
    expect(deleteProject).not.toHaveBeenCalled();
  });

  it("returns the winner's result when a concurrent commit loses the idempotency race", async () => {
    idempotencyCreate.mockRejectedValue(new Error("unique constraint"));
    idempotencyFindUnique
      .mockResolvedValueOnce(null) // pre-flight: no prior record
      .mockResolvedValueOnce({ result: JSON.stringify({ success: "winner" }) });

    const res = await invokeOperation(actor, {
      operation: "projects.deleteProject",
      arguments: { id: "p1" },
      confirm: true,
      idempotencyKey: "idem-1",
    });
    expect(res.replayed).toBe(true);
    expect(res.result).toEqual({ success: "winner" });
  });

  it("commits an ordinary write with no confirm ceremony", async () => {
    // clients.updateClient has no handler exported -> proves we got past the gates.
    await expect(
      invokeOperation(actor, { operation: "clients.updateClient", arguments: { id: "c1" } }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("maps a permission error from the guarded action to FORBIDDEN", async () => {
    getProjects.mockRejectedValue(new Error("You don't have permission to perform this action."));
    await expect(invokeOperation(actor, { operation: "projects.getProjects" })).rejects.toMatchObject(
      { code: "FORBIDDEN" },
    );
  });

  it("maps an unexpected error to an opaque INTERNAL, leaking nothing", async () => {
    getProjects.mockRejectedValue(new Error("connect ECONNREFUSED 10.0.0.5:5432"));
    try {
      await invokeOperation(actor, { operation: "projects.getProjects" });
      throw new Error("should have thrown");
    } catch (e) {
      const err = e as { code: string; message: string };
      expect(err.code).toBe("INTERNAL");
      expect(err.message).not.toContain("ECONNREFUSED");
    }
  });
});

describe("listOperations", () => {
  it("hides operations the key has no scope for", () => {
    const res = listOperations(actor);
    const names = res.operations.map((o) => o.name);
    expect(names).toContain("projects.getProjects");
    expect(names).not.toContain("clients.updateClient"); // no client:update scope
  });

  it("honours a resource wildcard scope", () => {
    const wide: ActorContext = { ...actor, scopes: ["client:*"] };
    expect(listOperations(wide).operations.map((o) => o.name)).toContain("clients.updateClient");
  });

  it("shows everything to a session actor", () => {
    const session: ActorContext = { ...actor, actorType: "session", scopes: undefined };
    expect(listOperations(session).total).toBe(4);
  });

  it("filters by kind and search", () => {
    expect(listOperations(actor, { kind: "read" }).operations).toHaveLength(1);
    expect(listOperations(actor, { search: "delete" }).operations[0].name).toBe(
      "projects.deleteProject",
    );
  });

  it("flags which operations need confirmation", () => {
    const del = listOperations(actor).operations.find((o) => o.name === "projects.deleteProject");
    expect(del).toMatchObject({ dangerous: true, requiresConfirmation: true });
  });
});

describe("describeOperation", () => {
  it("returns the full call signature", () => {
    expect(describeOperation("line-items.addLineItem")).toEqual({
      name: "line-items.addLineItem",
      module: "line-items",
      kind: "write",
      scope: "project:manage_line_items",
      dangerous: false,
      requiresConfirmation: true,
      summary: "",
      parameters: [
        { name: "projectId", type: "string", required: true },
        { name: "data", type: "object", required: true },
        { name: "allowOverbook", type: "boolean", required: false },
      ],
    });
  });
});
