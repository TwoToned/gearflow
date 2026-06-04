import { describe, it, expect, vi } from "vitest";
import { convergeProject, handleEvent, pollOnce, type ConsumerDeps } from "./outbox-consumer.js";
import type { ChannelGateway } from "./channel-gateway.js";
import type { GearFlowApiClient } from "./types.js";
import type { OutboxEvent, ProjectChannelSpec } from "./outbox-types.js";

function fakeGateway(overrides: Partial<ChannelGateway> = {}): ChannelGateway {
  return {
    createChannel: overrides.createChannel ?? vi.fn().mockResolvedValue("chan-new"),
    deleteChannel: overrides.deleteChannel ?? vi.fn().mockResolvedValue(undefined),
    syncMembers: overrides.syncMembers ?? vi.fn().mockResolvedValue(undefined),
    archiveChannel: overrides.archiveChannel ?? vi.fn().mockResolvedValue(undefined),
  };
}

function spec(overrides: Partial<ProjectChannelSpec> = {}): ProjectChannelSpec {
  return {
    projectId: "p1",
    projectNumber: "TTP001",
    name: "Pippin",
    status: "CONFIRMED",
    isTemplate: false,
    archived: false,
    channelId: null,
    members: ["alice", "bob"],
    pendingCount: 0,
    ...overrides,
  };
}

/** Fake api routing by path prefix. */
function fakeApi(routes: {
  spec?: ProjectChannelSpec;
  record?: { channelId: string | null; created: boolean };
  crew?: { discordUserId: string | null; projectIds: string[] };
  outbox?: { events: OutboxEvent[]; cursor: number };
}): { api: GearFlowApiClient; posts: { path: string; body: unknown }[] } {
  const posts: { path: string; body: unknown }[] = [];
  const api: GearFlowApiClient = {
    get: vi.fn(async (path: string) => {
      if (path.includes("/channel-spec")) return routes.spec as never;
      if (path.includes("/channels")) return routes.crew as never;
      if (path.includes("/outbox")) return routes.outbox as never;
      return {} as never;
    }),
    post: vi.fn(async (path: string, body: unknown) => {
      posts.push({ path, body });
      if (path.includes("/channel")) return (routes.record ?? { channelId: "chan-new", created: true }) as never;
      return {} as never;
    }),
  };
  return { api, posts };
}

describe("convergeProject", () => {
  it("creates a channel, records the id, and syncs the member set", async () => {
    const gateway = fakeGateway();
    const { api, posts } = fakeApi({ spec: spec({ projectId: "pc1" }), record: { channelId: "chan-new", created: true } });
    await convergeProject("pc1", { api, gateway, categoryId: "cat1" });

    expect(gateway.createChannel).toHaveBeenCalledWith({ name: "ttp001-pippin", categoryId: "cat1" });
    expect(posts[0]).toEqual({ path: "/project/pc1/channel", body: { discordChannelId: "chan-new" } });
    expect(gateway.syncMembers).toHaveBeenCalledWith("chan-new", ["alice", "bob"]);
  });

  it("does NOT create a second channel when one already exists (idempotent)", async () => {
    const gateway = fakeGateway();
    const { api } = fakeApi({ spec: spec({ projectId: "pc2", channelId: "existing" }) });
    await convergeProject("pc2", { api, gateway, categoryId: "cat1" });

    expect(gateway.createChannel).not.toHaveBeenCalled();
    expect(gateway.syncMembers).toHaveBeenCalledWith("existing", ["alice", "bob"]);
  });

  it("discards its channel and uses the winner's id when it loses the create race", async () => {
    const gateway = fakeGateway({ createChannel: vi.fn().mockResolvedValue("mine") });
    const { api } = fakeApi({ spec: spec({ projectId: "pc3" }), record: { channelId: "theirs", created: false } });
    await convergeProject("pc3", { api, gateway, categoryId: "cat1" });

    expect(gateway.deleteChannel).toHaveBeenCalledWith("mine");
    expect(gateway.syncMembers).toHaveBeenCalledWith("theirs", ["alice", "bob"]);
  });

  it("archives a terminal project's channel and skips member sync", async () => {
    const gateway = fakeGateway();
    const { api } = fakeApi({ spec: spec({ projectId: "pc4", archived: true, channelId: "old" }) });
    await convergeProject("pc4", { api, gateway, categoryId: "cat1" });

    expect(gateway.archiveChannel).toHaveBeenCalledWith("old");
    expect(gateway.syncMembers).not.toHaveBeenCalled();
  });

  it("skips templates entirely", async () => {
    const gateway = fakeGateway();
    const { api } = fakeApi({ spec: spec({ projectId: "pc5", isTemplate: true }) });
    await convergeProject("pc5", { api, gateway, categoryId: "cat1" });
    expect(gateway.createChannel).not.toHaveBeenCalled();
    expect(gateway.syncMembers).not.toHaveBeenCalled();
  });
});

describe("handleEvent", () => {
  it("converges every active project when a crew member links (retroactive grant)", async () => {
    const gateway = fakeGateway();
    const { api } = fakeApi({
      crew: { discordUserId: "alice", projectIds: ["pa", "pb"] },
      spec: spec({ channelId: "c", members: ["alice"] }),
    });
    const deps: ConsumerDeps = { api, gateway, categoryId: null };
    await handleEvent(
      { id: 1, eventType: "discord.link.confirmed", payload: { crewMemberId: "cm1" }, dedupeKey: "k", createdAt: "" },
      deps,
    );
    expect((api.get as ReturnType<typeof vi.fn>).mock.calls.filter((c) => String(c[0]).includes("channel-spec"))).toHaveLength(2);
  });
});

describe("pollOnce", () => {
  const ev = (id: number): OutboxEvent => ({
    id,
    eventType: "crew.assignment.changed",
    payload: { projectId: `p${id}` },
    dedupeKey: `k${id}`,
    createdAt: "",
  });

  it("returns the same cursor and does nothing when there are no events", async () => {
    const { api } = fakeApi({ outbox: { events: [], cursor: 5 } });
    const res = await pollOnce(5, { api, gateway: fakeGateway(), categoryId: null });
    expect(res).toEqual({ cursor: 5, processed: 0, failed: false });
  });

  it("processes events, acks them, and advances the cursor to the last id", async () => {
    const { api, posts } = fakeApi({
      outbox: { events: [ev(6), ev(7)], cursor: 7 },
      spec: spec({ channelId: "c", members: [] }),
      record: { channelId: "c", created: false },
    });
    const res = await pollOnce(5, { api, gateway: fakeGateway(), categoryId: null });
    expect(res).toMatchObject({ cursor: 7, processed: 2, failed: false });
    const ack = posts.find((p) => p.path === "/outbox/ack");
    expect(ack?.body).toEqual({ ids: [6, 7] });
  });

  it("stops on the first failure, acking only the prefix and holding the cursor there", async () => {
    const gateway = fakeGateway({
      syncMembers: vi
        .fn()
        .mockResolvedValueOnce(undefined) // event 6 ok
        .mockRejectedValueOnce(new Error("discord 500")), // event 7 fails
    });
    const { api, posts } = fakeApi({
      outbox: { events: [ev(6), ev(7), ev(8)], cursor: 8 },
      spec: spec({ channelId: "c", members: [] }),
      record: { channelId: "c", created: false },
    });
    const res = await pollOnce(5, { api, gateway, categoryId: null });
    expect(res).toMatchObject({ cursor: 6, processed: 1, failed: true });
    const ack = posts.find((p) => p.path === "/outbox/ack");
    expect(ack?.body).toEqual({ ids: [6] }); // 7 and 8 stay PENDING for retry
  });
});
