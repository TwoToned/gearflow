// Follow-up automation — the morning brief's pure logic (FEATUREDOCS/82).
import { describe, it, expect } from "vitest";
import { briefDedupeKey, groupBrief, isBriefWindow, localClock, type BriefRow } from "./follow-up-brief";
import { followUpBriefEmail } from "./notification-emails";

const TZ = "Australia/Sydney";

describe("localClock / isBriefWindow", () => {
  it("reads the org's wall clock, not UTC", () => {
    // Tue 2026-09-22 21:30 UTC = Wed 2026-09-23 07:30 AEST
    const at = Date.UTC(2026, 8, 22, 21, 30);
    expect(localClock(at, TZ)).toEqual({ hour: 7, weekday: 3, dateKey: "2026-09-23" });
    expect(isBriefWindow(at, TZ)).toBe(true);
  });

  it("stays quiet before 07:00 and on weekends", () => {
    expect(isBriefWindow(Date.UTC(2026, 8, 22, 19, 30), TZ)).toBe(false); // Wed 05:30
    expect(isBriefWindow(Date.UTC(2026, 8, 25, 23, 0), TZ)).toBe(false); // Sat 09:00
  });

  it("dedupes per org, person and local day", () => {
    expect(briefDedupeKey("o1", "u1", "2026-09-23")).toBe("follow-up-brief:o1:u1:2026-09-23");
    expect(briefDedupeKey("o2", "u1", "2026-09-23")).not.toBe(briefDedupeKey("o1", "u1", "2026-09-23"));
  });
});

describe("groupBrief", () => {
  const now = Date.UTC(2026, 8, 22, 21, 30); // Wed 07:30 AEST
  const row = (p: Partial<BriefRow>): BriefRow => ({
    id: "t", title: "Follow up on quote P v1", why: "P v1 sent 18 Sep · no reply logged.", urgent: false, rung: 1,
    dueDate: now, assigneeUserId: "u1", projectId: "p1", ...p,
  });

  it("splits chasing rungs from decisions, per person, urgent first", () => {
    const out = groupBrief(
      [
        row({ id: "a", dueDate: now - 3 * 86_400_000 }),
        row({ id: "b", urgent: true, title: "Urgent one" }),
        row({ id: "c", rung: 3, title: "Decide on quote P v1" }),
        row({ id: "d", assigneeUserId: "u2" }),
      ],
      now,
      TZ,
    );
    const u1 = out.get("u1")!;
    expect(u1.chase.map((i) => i.title)).toEqual(["Urgent one", "Follow up on quote P v1"]);
    expect(u1.chase[1].overdue).toBe(true);
    expect(u1.decide.map((i) => i.title)).toEqual(["Decide on quote P v1"]);
    expect(u1.chase[0].href).toBe("/projects/p1?tab=work");
    expect(out.get("u2")!.chase).toHaveLength(1);
  });
});

describe("followUpBriefEmail", () => {
  it("names what's due, escapes titles, caps each section", () => {
    const items = Array.from({ length: 7 }, (_, i) => ({ title: `<b>Q${i}</b>`, why: "why", href: "/projects/p1", urgent: false, overdue: false }));
    const email = followUpBriefEmail({
      recipientName: "Jay", orgName: "RVLT", appBaseUrl: "https://flow.rvlt.app", href: "/dashboard", notificationKey: "k",
      chase: items, decide: [],
    });
    expect(email.subject).toBe("7 follow-ups due today");
    expect(email.html).toContain("and 2 more in Flow");
    expect(email.html).not.toContain("<b>Q0</b>");
    expect(email.html).toContain("https://flow.rvlt.app/projects/p1");
  });
});
