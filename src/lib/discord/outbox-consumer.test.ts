import { describe, it, expect, vi, beforeEach } from "vitest";
import { convergeProject, handleEvent, pollOnce, type ConsumerDeps } from "./outbox-consumer";
import type { ChannelGateway } from "./channel-gateway";
import * as channelSync from "@/lib/services/channel-sync-service";
import * as outboxService from "@/lib/services/outbox-service";
import type { ProjectChannelSpec } from "@/lib/services/channel-sync-service";
import type { DiscordOutboxEventDto } from "./outbox-events";

function fakeGateway(overrides: Partial<ChannelGateway> = {}): ChannelGateway {
  return {
    createChannel: overrides.createChannel ?? vi.fn().mockResolvedValue("chan-new"),
    deleteChannel: overrides.deleteChannel ?? vi.fn().mockResolvedValue(undefined),
    syncMembers: overrides.syncMembers ?? vi.fn().mockResolvedValue(undefined),
    moveToCategory: overrides.moveToCategory ?? vi.fn().mockResolvedValue(undefined),
    archiveChannel: overrides.archiveChannel ?? vi.fn().mockResolvedValue(undefined),
    postWelcome: overrides.postWelcome ?? vi.fn().mockResolvedValue(undefined),
  };
}

function spec(overrides: Partial<ProjectChannelSpec> = {}): ProjectChannelSpec {
  return {
    projectId: "p1",
    projectNumber: "TTP001",
    name: "Pippin",
    status: "CONFIRMED",
    isTemplate: false,
    shouldExist: true,
    shouldArchive: false,
    targetCategoryId: "cat-active",
    channelId: null,
    members: ["alice", "bob"],
    pendingCount: 0,
    postWelcomeOnCreate: false,
    ...overrides,
  };
}

const baseDeps = (gateway: ChannelGateway): ConsumerDeps => ({
  organizationId: "org_1",
  gateway,
});

beforeEach(() => vi.restoreAllMocks());

describe("convergeProject", () => {
  it("creates a channel, records the id, and syncs members", async () => {
    const gateway = fakeGateway();
    const specMock = vi.spyOn(channelSync, "getProjectChannelSpec").mockResolvedValue(spec());
    const recMock = vi
      .spyOn(channelSync, "recordProjectChannelId")
      .mockResolvedValue({ channelId: "chan-new", created: true });
    await convergeProject("p1", baseDeps(gateway));
    expect(specMock).toHaveBeenCalledWith("p1", "org_1");
    expect(gateway.createChannel).toHaveBeenCalledWith({ name: "ttp001-pippin", categoryId: "cat-active" });
    expect(recMock).toHaveBeenCalledWith("p1", "org_1", "chan-new");
    expect(gateway.syncMembers).toHaveBeenCalledWith("chan-new", ["alice", "bob"]);
  });

  it("does NOT create a second channel when one already exists", async () => {
    const gateway = fakeGateway();
    vi.spyOn(channelSync, "getProjectChannelSpec").mockResolvedValue(spec({ channelId: "existing" }));
    await convergeProject("p2", baseDeps(gateway));
    expect(gateway.createChannel).not.toHaveBeenCalled();
    expect(gateway.syncMembers).toHaveBeenCalledWith("existing", ["alice", "bob"]);
  });

  it("skips creating when below the create threshold (no channel + !shouldExist)", async () => {
    const gateway = fakeGateway();
    vi.spyOn(channelSync, "getProjectChannelSpec").mockResolvedValue(spec({ shouldExist: false }));
    await convergeProject("p3", baseDeps(gateway));
    expect(gateway.createChannel).not.toHaveBeenCalled();
    expect(gateway.syncMembers).not.toHaveBeenCalled();
  });

  it("discards its channel and uses the winner's id when it loses the create race", async () => {
    const gateway = fakeGateway({ createChannel: vi.fn().mockResolvedValue("mine") });
    vi.spyOn(channelSync, "getProjectChannelSpec").mockResolvedValue(spec());
    vi.spyOn(channelSync, "recordProjectChannelId").mockResolvedValue({ channelId: "theirs", created: false });
    await convergeProject("p4", baseDeps(gateway));
    expect(gateway.deleteChannel).toHaveBeenCalledWith("mine");
    expect(gateway.syncMembers).toHaveBeenCalledWith("theirs", ["alice", "bob"]);
  });

  it("archives a project whose status is in the archive set", async () => {
    const gateway = fakeGateway();
    vi.spyOn(channelSync, "getProjectChannelSpec").mockResolvedValue(
      spec({ shouldArchive: true, targetCategoryId: "cat-archive", channelId: "old" }),
    );
    await convergeProject("p5", baseDeps(gateway));
    expect(gateway.archiveChannel).toHaveBeenCalledWith("old", "cat-archive");
    expect(gateway.syncMembers).not.toHaveBeenCalled();
  });

  it("skips templates", async () => {
    const gateway = fakeGateway();
    vi.spyOn(channelSync, "getProjectChannelSpec").mockResolvedValue(spec({ isTemplate: true }));
    await convergeProject("p6", baseDeps(gateway));
    expect(gateway.createChannel).not.toHaveBeenCalled();
  });
});

describe("handleEvent", () => {
  it("converges every active project on discord.link.confirmed", async () => {
    const gateway = fakeGateway();
    vi.spyOn(channelSync, "getCrewActiveProjects").mockResolvedValue({
      discordUserId: "alice",
      projectIds: ["pa", "pb"],
    });
    const specMock = vi.spyOn(channelSync, "getProjectChannelSpec").mockResolvedValue(
      spec({ channelId: "c", members: ["alice"] }),
    );
    await handleEvent(
      { id: 1, eventType: "discord.link.confirmed", payload: { crewMemberId: "cm1" }, dedupeKey: "k", createdAt: "" },
      baseDeps(gateway),
    );
    expect(specMock).toHaveBeenCalledTimes(2);
  });
});

const ev = (id: number): DiscordOutboxEventDto => ({
  id,
  eventType: "crew.assignment.changed",
  payload: { projectId: `p${id}` },
  dedupeKey: `k${id}`,
  createdAt: "",
});

describe("pollOnce", () => {
  it("returns the same cursor and does nothing when there are no events", async () => {
    vi.spyOn(outboxService, "readOutboxEvents").mockResolvedValue([]);
    vi.spyOn(outboxService, "recordDiscordHeartbeat").mockResolvedValue(undefined);
    const ack = vi.spyOn(outboxService, "ackOutboxEvents").mockResolvedValue(0);
    const res = await pollOnce(5, baseDeps(fakeGateway()));
    expect(res).toEqual({ cursor: 5, processed: 0, failed: false });
    expect(ack).not.toHaveBeenCalled();
  });

  it("processes events, acks them, advances the cursor to the last id", async () => {
    vi.spyOn(outboxService, "readOutboxEvents").mockResolvedValue([ev(6), ev(7)]);
    vi.spyOn(outboxService, "recordDiscordHeartbeat").mockResolvedValue(undefined);
    const ack = vi.spyOn(outboxService, "ackOutboxEvents").mockResolvedValue(2);
    vi.spyOn(channelSync, "getProjectChannelSpec").mockResolvedValue(spec({ channelId: "c", members: [] }));
    vi.spyOn(channelSync, "recordProjectChannelId").mockResolvedValue({ channelId: "c", created: false });
    const res = await pollOnce(5, baseDeps(fakeGateway()));
    expect(res).toMatchObject({ cursor: 7, processed: 2, failed: false });
    expect(ack).toHaveBeenCalledWith("org_1", [6, 7]);
  });

  it("stops on the first failure, acking only the prefix", async () => {
    vi.spyOn(outboxService, "readOutboxEvents").mockResolvedValue([ev(6), ev(7), ev(8)]);
    vi.spyOn(outboxService, "recordDiscordHeartbeat").mockResolvedValue(undefined);
    const ack = vi.spyOn(outboxService, "ackOutboxEvents").mockResolvedValue(1);
    vi.spyOn(channelSync, "getProjectChannelSpec").mockResolvedValue(spec({ channelId: "c", members: [] }));
    vi.spyOn(channelSync, "recordProjectChannelId").mockResolvedValue({ channelId: "c", created: false });
    const gateway = fakeGateway({
      syncMembers: vi
        .fn()
        .mockResolvedValueOnce(undefined) // event 6 ok
        .mockRejectedValueOnce(new Error("discord 500")), // event 7 fails
    });
    const res = await pollOnce(5, baseDeps(gateway));
    expect(res).toMatchObject({ cursor: 6, processed: 1, failed: true });
    expect(ack).toHaveBeenCalledWith("org_1", [6]);
  });
});
