// @vitest-environment jsdom
//
// Follow-up automation (docs/designs/follow-up-automation.md §8.3/§8.7) — the
// peek's follow-up panel and the row badges, actually rendered and clicked:
// "No reply yet" and "Park until…" call back with the right outcome/date,
// "Won or lost" deep-links to the job's Finance tab (accept/decline live on the
// quote), and a viewer sees the why line but no actions.
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { FollowUpPanel } from "../follow-up-panel";
import { TodayRow } from "../today-row";
import type { TodayItem } from "../today-types";

const item: TodayItem = {
  key: "task:t1",
  kind: "task",
  bucket: "today",
  title: "Follow up on quote 260901 v1",
  contextLine: "260901 · Gig · Quote · 8 Oct",
  href: "/projects/p1",
  overdue: false,
  done: false,
  followUp: { why: "260901 v1 sent 6 Oct · no reply logged · event 20 Oct.", urgent: true, rung: 1 },
  raw: { id: "t1" },
};

describe("FollowUpPanel", () => {
  it("shows why the item exists", () => {
    render(<FollowUpPanel item={item} canEdit onOutcome={vi.fn()} />);
    expect(screen.getByText(/sent 6 Oct · no reply logged/)).toBeTruthy();
  });

  it("'No reply yet' records a no_reply outcome", () => {
    const onOutcome = vi.fn();
    render(<FollowUpPanel item={item} canEdit onOutcome={onOutcome} />);
    fireEvent.click(screen.getByRole("button", { name: /no reply yet/i }));
    expect(onOutcome).toHaveBeenCalledWith(item, "no_reply");
  });

  it("'Park until…' needs a date, then records parked with it", () => {
    const onOutcome = vi.fn();
    render(<FollowUpPanel item={item} canEdit onOutcome={onOutcome} />);
    fireEvent.click(screen.getByRole("button", { name: /park until/i }));
    const park = screen.getByRole("button", { name: /^park$/i }) as HTMLButtonElement;
    expect(park.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/come back to it on/i), { target: { value: "2026-11-02" } });
    fireEvent.click(park);
    expect(onOutcome).toHaveBeenCalledWith(item, "parked", "2026-11-02");
  });

  it("'Won or lost' opens the job's Finance tab rather than accepting here", () => {
    render(<FollowUpPanel item={item} canEdit onOutcome={vi.fn()} />);
    expect(screen.getByRole("link", { name: /won or lost/i }).getAttribute("href")).toBe("/projects/p1?tab=finance");
  });

  it("a read-only viewer sees the why line and no actions", () => {
    render(<FollowUpPanel item={item} canEdit={false} onOutcome={vi.fn()} />);
    expect(screen.getByText(/no reply logged/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /no reply yet/i })).toBeNull();
  });
});

describe("TodayRow follow-up badges", () => {
  it("marks an automated row 'auto' and an urgent one 'soon'", () => {
    render(<TodayRow item={item} active={false} canEdit onOpen={vi.fn()} onToggleDone={vi.fn()} />);
    expect(screen.getByText("auto")).toBeTruthy();
    expect(screen.getByText("soon")).toBeTruthy();
  });

  it("a human task carries neither", () => {
    render(<TodayRow item={{ ...item, followUp: null }} active={false} canEdit onOpen={vi.fn()} onToggleDone={vi.fn()} />);
    expect(screen.queryByText("auto")).toBeNull();
  });
});
