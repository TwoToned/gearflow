import { describe, it, expect } from "vitest";
import {
  generateVCalendar,
  generateVEvent,
  buildDateTime,
  type ICalEvent,
} from "./ical";

describe("ical timezone handling", () => {
  describe("buildDateTime", () => {
    it("interprets a HH:mm time in the target timezone (Sydney AEST)", () => {
      // 15 July 2026 is AEST (UTC+10, no DST)
      const d = buildDateTime("2026-07-15", "09:00", "Australia/Sydney");
      // 09:00 Sydney AEST = 23:00 UTC the previous day
      expect(d.toISOString()).toBe("2026-07-14T23:00:00.000Z");
    });

    it("handles DST (Sydney AEDT, summer)", () => {
      // 15 January 2026 is AEDT (UTC+11)
      const d = buildDateTime("2026-01-15", "09:00", "Australia/Sydney");
      // 09:00 Sydney AEDT = 22:00 UTC the previous day
      expect(d.toISOString()).toBe("2026-01-14T22:00:00.000Z");
    });

    it("interprets time in Brisbane (no DST, AEST year-round)", () => {
      const d = buildDateTime("2026-01-15", "09:00", "Australia/Brisbane");
      expect(d.toISOString()).toBe("2026-01-14T23:00:00.000Z");
    });

    it("defaults to midnight in target zone when no time provided", () => {
      const d = buildDateTime("2026-07-15", null, "Australia/Sydney");
      // Midnight Sydney AEST = 14:00 UTC the previous day
      expect(d.toISOString()).toBe("2026-07-14T14:00:00.000Z");
    });
  });

  describe("generateVEvent", () => {
    const baseEvent: ICalEvent = {
      uid: "test-1@gearflow",
      summary: "Test Event",
      dtstart: new Date("2026-07-14T23:00:00.000Z"), // 09:00 Sydney AEST
      dtend: new Date("2026-07-15T01:00:00.000Z"), // 11:00 Sydney AEST
    };

    it("emits DTSTART with TZID for a known zone", () => {
      const out = generateVEvent(baseEvent, "Australia/Sydney");
      expect(out).toContain(
        "DTSTART;TZID=Australia/Sydney:20260715T090000"
      );
      expect(out).toContain("DTEND;TZID=Australia/Sydney:20260715T110000");
    });

    it("never emits a bare DTSTART (floating time) for a known zone", () => {
      const out = generateVEvent(baseEvent, "Australia/Sydney");
      expect(out).not.toMatch(/^DTSTART:\d/m);
      expect(out).not.toMatch(/^DTEND:\d/m);
    });

    it("DTSTAMP is always UTC (Z suffix) per RFC 5545", () => {
      const out = generateVEvent(baseEvent, "Australia/Sydney");
      expect(out).toMatch(/DTSTAMP:\d{8}T\d{6}Z/);
    });

    it("falls back to UTC Z-form for unknown timezones", () => {
      const out = generateVEvent(baseEvent, "Mars/Olympus");
      expect(out).toContain("DTSTART:20260714T230000Z");
      expect(out).toContain("DTEND:20260715T010000Z");
      expect(out).not.toContain("TZID=");
    });

    it("emits VALUE=DATE for all-day events (no TZID, +1 day for DTEND)", () => {
      const allDay: ICalEvent = {
        ...baseEvent,
        allDay: true,
        dtstart: new Date("2026-07-14T14:00:00.000Z"), // midnight Sydney
        dtend: new Date("2026-07-14T14:00:00.000Z"),
      };
      const out = generateVEvent(allDay, "Australia/Sydney");
      expect(out).toContain("DTSTART;VALUE=DATE:20260715");
      // DTEND is exclusive for all-day → next calendar day in target zone
      expect(out).toContain("DTEND;VALUE=DATE:20260716");
      expect(out).not.toContain("TZID=");
    });
  });

  describe("generateVCalendar", () => {
    const events: ICalEvent[] = [
      {
        uid: "test-1@gearflow",
        summary: "Sydney Gig",
        dtstart: new Date("2026-07-14T23:00:00.000Z"),
        dtend: new Date("2026-07-15T07:00:00.000Z"),
      },
    ];

    it("emits a VTIMEZONE block for a known zone", () => {
      const cal = generateVCalendar("Test", events, "Australia/Sydney");
      expect(cal).toContain("BEGIN:VTIMEZONE");
      expect(cal).toContain("TZID:Australia/Sydney");
      expect(cal).toContain("END:VTIMEZONE");
      expect(cal).toContain("X-WR-TIMEZONE:Australia/Sydney");
    });

    it("VTIMEZONE block includes both STANDARD and DAYLIGHT for DST zones", () => {
      const cal = generateVCalendar("Test", events, "Australia/Sydney");
      expect(cal).toContain("BEGIN:STANDARD");
      expect(cal).toContain("BEGIN:DAYLIGHT");
      expect(cal).toContain("TZNAME:AEST");
      expect(cal).toContain("TZNAME:AEDT");
    });

    it("VTIMEZONE block has only STANDARD for non-DST zones (Brisbane)", () => {
      const cal = generateVCalendar("Test", events, "Australia/Brisbane");
      expect(cal).toContain("BEGIN:STANDARD");
      expect(cal).not.toContain("BEGIN:DAYLIGHT");
    });

    it("omits VTIMEZONE block for unknown zones (UTC fallback)", () => {
      const cal = generateVCalendar("Test", events, "Mars/Olympus");
      expect(cal).not.toContain("BEGIN:VTIMEZONE");
      expect(cal).not.toContain("X-WR-TIMEZONE:");
      // Events should be UTC Z-form
      expect(cal).toContain("DTSTART:20260714T230000Z");
    });

    it("defaults to Australia/Sydney when no tzid passed", () => {
      const cal = generateVCalendar("Test", events);
      expect(cal).toContain("TZID:Australia/Sydney");
    });

    it("uses CRLF line endings (RFC 5545)", () => {
      const cal = generateVCalendar("Test", events, "Australia/Sydney");
      expect(cal).toContain("\r\n");
      expect(cal).not.toMatch(/[^\r]\n/);
    });
  });

  describe("regression: server-tz independence", () => {
    // The previous implementation used Date.getHours() which returns server-
    // local time. On a UTC server (Vercel), a Sydney 9am event came out as
    // "DTSTART:...T230000" (floating) and shifted by ~10h in Google Calendar.
    it("Sydney 9am event renders as 09:00:00 with TZID regardless of server tz", () => {
      const event: ICalEvent = {
        uid: "regression-1@gearflow",
        summary: "Sydney 9am",
        dtstart: new Date("2026-07-14T23:00:00.000Z"),
        dtend: new Date("2026-07-15T01:00:00.000Z"),
      };
      const out = generateVEvent(event, "Australia/Sydney");
      expect(out).toContain(
        "DTSTART;TZID=Australia/Sydney:20260715T090000"
      );
      // Should NOT contain the buggy floating-time form
      expect(out).not.toContain("DTSTART:20260714T230000");
    });
  });
});
