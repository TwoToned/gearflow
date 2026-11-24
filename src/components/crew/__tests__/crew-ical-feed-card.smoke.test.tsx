// @vitest-environment jsdom
//
// The crew record's iCal feed card. The feed URL embeds a bearer secret, so it
// renders only from the token `crew.memberDetail` hands back — present for the
// member themself (and crew:update), absent for a plain crew:read viewer
// (convex/lib/crewMemberRedaction.ts, tested in convex/crewReadRedaction.test.ts).
// `getIcalSettings` carries only the switches, never the token.
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const can = vi.hoisted(() => ({ update: false }));
vi.mock("@/components/auth/permission-gate", () => ({
  CanDo: ({ children }: { children: React.ReactNode }) => (can.update ? <>{children}</> : null),
}));
vi.mock("@/hooks/use-server-query", () => ({
  useServerQuery: () => ({ data: { icalEnabled: true, icalIncludeTentative: false }, refetch: vi.fn() }),
}));
vi.mock("@/hooks/use-server-mutation", () => ({ useServerMutation: () => ({ mutate: vi.fn(), isPending: false }) }));
vi.mock("@/server/crew-calendar", () => ({
  getIcalSettings: vi.fn(), enableIcalFeed: vi.fn(), disableIcalFeed: vi.fn(), regenerateIcalToken: vi.fn(), setIcalIncludeTentative: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { CrewIcalFeedCard } from "../crew-ical-feed-card";

beforeEach(() => {
  can.update = false;
});

describe("CrewIcalFeedCard (smoke)", () => {
  it("the member themself: memberDetail sent the token, so the feed URL renders", () => {
    render(<CrewIcalFeedCard memberId="cm1" feedToken="self-token" onTokenChanged={() => {}} />);
    const url = screen.getByRole("textbox", { name: "Feed URL" }) as HTMLInputElement;
    expect(url.value).toMatch(/\/api\/crew\/calendar\/self-token$/);
    expect(screen.getByRole("button", { name: "Copy feed URL" })).toBeTruthy();
  });

  it("a plain crew:read viewer: no token from the server, so no URL anywhere — only that the feed is on", () => {
    const { container } = render(<CrewIcalFeedCard memberId="cm1" feedToken={undefined} onTokenChanged={() => {}} />);
    expect(screen.queryByRole("textbox", { name: "Feed URL" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Copy feed URL" })).toBeNull();
    expect(container.textContent).not.toMatch(/\/api\/crew\/calendar\//);
    expect(screen.getByTestId("ical-feed-on").textContent).toMatch(/feed is on/);
  });

  it("crew:update sees the URL and the manage buttons; the regenerate confirm opens", async () => {
    can.update = true;
    render(<CrewIcalFeedCard memberId="cm1" feedToken="mgr-token" onTokenChanged={() => {}} />);
    expect((screen.getByRole("textbox", { name: "Feed URL" }) as HTMLInputElement).value).toMatch(/mgr-token$/);
    screen.getByRole("button", { name: /Regenerate URL/ }).click();
    expect(await screen.findByText("Regenerate self-service token?")).toBeTruthy();
  });
});
