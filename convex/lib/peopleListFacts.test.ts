import { describe, expect, it } from "vitest";
import { clientFacts, inClientSegment } from "./clientListFacts";
import { crewMemberFacts, dayNumber, inCrewSegment, DAY_MS, type CrewFactCall } from "./crewListFacts";

const TODAY = dayNumber(Date.UTC(2026, 10, 24));
const at = (offset: number) => (TODAY + offset) * DAY_MS;
const call = (over: Partial<CrewFactCall>): CrewFactCall => ({ id: "c", crewMemberId: "m", projectId: "p", status: "CONFIRMED", startDate: at(0), endDate: at(0), ...over });
const member = { id: "m", status: "ACTIVE" };

describe("crewMemberFacts", () => {
  it("is Available with no calls", () => {
    const f = crewMemberFacts(member, [], TODAY);
    expect(f.status).toBe("AVAILABLE");
    expect(f.next).toBeNull();
    expect(inCrewSegment(f, "available")).toBe(true);
  });
  it("this week is the next seven days: day 6 counts, day 7 does not (D40)", () => {
    expect(crewMemberFacts(member, [call({ startDate: at(6), endDate: at(6) })], TODAY).status).toBe("ON_JOB");
    expect(crewMemberFacts(member, [call({ startDate: at(7), endDate: at(7) })], TODAY).status).toBe("AVAILABLE");
  });
  it("a confirmed call that ended yesterday is ignored; one running through today counts", () => {
    expect(crewMemberFacts(member, [call({ startDate: at(-3), endDate: at(-1) })], TODAY).status).toBe("AVAILABLE");
    expect(crewMemberFacts(member, [call({ startDate: at(-3), endDate: at(0) })], TODAY).status).toBe("ON_JOB");
  });
  it("Unconfirmed outranks On a job; ACCEPTED is not yet confirmed", () => {
    const f = crewMemberFacts(member, [call({ id: "a" }), call({ id: "b", status: "ACCEPTED", startDate: at(10), endDate: at(10) })], TODAY);
    expect(f.status).toBe("UNCONFIRMED");
    expect(inCrewSegment(f, "onjob")).toBe(true);
    expect(inCrewSegment(f, "available")).toBe(false);
  });
  it("cancelled and declined calls are not live", () => {
    const f = crewMemberFacts(member, [call({ status: "CANCELLED" }), call({ status: "DECLINED" })], TODAY);
    expect(f.status).toBe("AVAILABLE");
    expect(f.next).toBeNull();
  });
  it("stored Inactive / On leave win over calls", () => {
    expect(crewMemberFacts({ id: "m", status: "INACTIVE" }, [call({})], TODAY).status).toBe("INACTIVE");
    expect(crewMemberFacts({ id: "m", isActive: false }, [], TODAY).status).toBe("INACTIVE");
    expect(crewMemberFacts({ id: "m", status: "ON_LEAVE" }, [call({ status: "PENDING" })], TODAY).status).toBe("ON_LEAVE");
    expect(inCrewSegment(crewMemberFacts({ id: "m", status: "ARCHIVED" }, [], TODAY), "inactive")).toBe(true);
    expect(inCrewSegment(crewMemberFacts({ id: "m", status: "ARCHIVED" }, [], TODAY), "all")).toBe(false);
  });
  it("counts confirmed days in the window and finds the first clash", () => {
    const f = crewMemberFacts(member, [call({ id: "a", startDate: at(1), endDate: at(3) }), call({ id: "b", status: "PENDING", startDate: at(3), endDate: at(4) })], TODAY);
    expect(f.daysThisWeek).toBe(3);
    expect(f.clashDay).toBe(TODAY + 3);
    expect(f.next?.callId).toBe("a");
  });
  it("two calls on separate days do not clash", () => {
    expect(crewMemberFacts(member, [call({ id: "a" }), call({ id: "b", startDate: at(1), endDate: at(1) })], TODAY).clashDay).toBeNull();
  });
});

describe("clientFacts", () => {
  const projects = [
    { id: "p1", projectNumber: "#1", status: "CONFIRMED", total: 1000, rentalStartDate: at(5) },
    { id: "p2", projectNumber: "#2", status: "QUOTED", total: 400 },
    { id: "p3", projectNumber: "#3", status: "COMPLETED", total: 2000, rentalStartDate: at(-30) },
    { id: "p4", projectNumber: "#4", status: "ENQUIRY", total: 50, isTemplate: true },
    { id: "p5", projectNumber: "#5", status: "CANCELLED", total: 999 },
  ];
  const invoices = [
    { clientId: "k", status: "ISSUED", paymentStatus: "PARTIALLY_PAID", total: 500, amountPaid: 100, dueDate: at(-4) },
    { clientId: "k", status: "ISSUED", paymentStatus: "UNPAID", total: 300, dueDate: at(10) },
    { clientId: "k", status: "ISSUED", paymentStatus: "PAID", total: 700, amountPaid: 700, dueDate: at(-40) },
    { clientId: "k", status: "DRAFT", total: 900 },
    { clientId: "k", status: "VOID", total: 900, dueDate: at(-9) },
  ];
  it("derives open jobs, quoted, outstanding and overdue days", () => {
    const f = clientFacts(projects, invoices, TODAY, true);
    expect(f.openJobs.map((j) => j.projectNumber)).toEqual(["#1", "#2"]);
    expect(f.quoted).toBe(400);
    expect(f.outstanding).toBe(700);
    expect(f.overdueDays).toBe(4);
    expect(f.lifetime).toBe(3400);
    expect(f.lastJobAt).toBe(at(5));
    expect(f.nextDue).toBe(at(-4));
  });
  it("money is ABSENT (not zero) without the invoice-read line", () => {
    const f = clientFacts(projects, invoices, TODAY, false);
    for (const k of ["quoted", "outstanding", "overdueDays", "lifetime", "nextDue"]) expect(k in f).toBe(false);
    expect(f.openJobCount).toBe(2);
  });
  it("segments", () => {
    const f = clientFacts(projects, invoices, TODAY, true);
    expect(inClientSegment(f, true, "active")).toBe(true);
    expect(inClientSegment(f, true, "quoting")).toBe(true);
    expect(inClientSegment(f, true, "overdue")).toBe(true);
    expect(inClientSegment(f, false, "all")).toBe(false);
    expect(inClientSegment(f, false, "archived")).toBe(true);
    const none = clientFacts([], [], TODAY, true);
    expect(inClientSegment(none, true, "active")).toBe(false);
    expect(inClientSegment(none, true, "overdue")).toBe(false);
  });
});
