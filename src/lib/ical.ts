/**
 * iCalendar (.ics) generation helpers.
 * Generates RFC 5545-compliant VCALENDAR/VEVENT content with proper
 * timezone anchoring (TZID + VTIMEZONE block) so subscribers like
 * Google Calendar render events at the right local time regardless
 * of the viewer's own timezone.
 *
 * Timezone strategy:
 *   - Each VCALENDAR is built for a single TZID (the org's configured
 *     timezone, default Australia/Sydney).
 *   - DTSTART / DTEND carry `;TZID=...` and are formatted in that zone
 *     using Intl.DateTimeFormat (no external dep, no server-local leakage).
 *   - DTSTAMP is always UTC (`Z` suffix) per RFC 5545.
 *   - All-day events use `VALUE=DATE` (no time, no TZID).
 *   - A VTIMEZONE block is emitted for known zones (Australia + a few
 *     common international ones). Unknown zones fall back to UTC `Z`-form
 *     output and no VTIMEZONE block.
 */

export interface ICalEvent {
  uid: string;
  summary: string;
  description?: string;
  location?: string;
  dtstart: Date;
  dtend: Date;
  /**
   * Mark this event as all-day. When true, DTSTART/DTEND are emitted as
   * `VALUE=DATE` (no time, no TZID) and DTEND is shifted +1 day per RFC 5545
   * (DTEND is exclusive for date-only events).
   */
  allDay?: boolean;
  status?: "CONFIRMED" | "TENTATIVE" | "CANCELLED";
  categories?: string[];
}

// ─── Timezone formatting ────────────────────────────────────────────────────

/**
 * Format a Date as `YYYYMMDDTHHMMSS` in the given IANA timezone using
 * Intl.DateTimeFormat. No external dep, DST-correct, no server-local leakage.
 */
function formatICalDateInTz(date: Date, tzid: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tzid,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const m: Record<string, string> = {};
  for (const p of parts) m[p.type] = p.value;

  // Some Intl implementations return "24" for midnight; normalize to "00".
  const hour = m.hour === "24" ? "00" : m.hour;

  return `${m.year}${m.month}${m.day}T${hour}${m.minute}${m.second}`;
}

/** Format a Date as UTC `YYYYMMDDTHHMMSSZ` (for DTSTAMP). */
function formatICalDateUtc(date: Date): string {
  const iso = date.toISOString(); // 2026-06-14T23:00:00.000Z
  return iso.replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** Format a Date as `YYYYMMDD` in the given timezone (for all-day events). */
function formatICalDateOnly(date: Date, tzid: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tzid,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const m: Record<string, string> = {};
  for (const p of parts) m[p.type] = p.value;
  return `${m.year}${m.month}${m.day}`;
}

// ─── VTIMEZONE blocks ───────────────────────────────────────────────────────

/**
 * Hardcoded VTIMEZONE definitions for common IANA zones. RFC 5545 lets us
 * embed the DST rules so subscribers don't need their own tz database. We
 * cover AU (the operator's market) plus a few international zones likely
 * to appear on cross-border productions. Unknown zones return null and the
 * caller falls back to UTC output.
 *
 * DST rules sourced from IANA tzdata. Keep in sync if Australia changes DST
 * legislation (last federal change was 2008).
 */
const VTIMEZONE_BLOCKS: Record<string, string> = {
  // Australia — DST observers (NSW, VIC, TAS, ACT, SA)
  "Australia/Sydney": [
    "BEGIN:VTIMEZONE",
    "TZID:Australia/Sydney",
    "BEGIN:STANDARD",
    "DTSTART:19700405T030000",
    "TZOFFSETFROM:+1100",
    "TZOFFSETTO:+1000",
    "TZNAME:AEST",
    "RRULE:FREQ=YEARLY;BYMONTH=4;BYDAY=1SU",
    "END:STANDARD",
    "BEGIN:DAYLIGHT",
    "DTSTART:19701004T020000",
    "TZOFFSETFROM:+1000",
    "TZOFFSETTO:+1100",
    "TZNAME:AEDT",
    "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=1SU",
    "END:DAYLIGHT",
    "END:VTIMEZONE",
  ].join("\r\n"),
  "Australia/Melbourne": [
    "BEGIN:VTIMEZONE",
    "TZID:Australia/Melbourne",
    "BEGIN:STANDARD",
    "DTSTART:19700405T030000",
    "TZOFFSETFROM:+1100",
    "TZOFFSETTO:+1000",
    "TZNAME:AEST",
    "RRULE:FREQ=YEARLY;BYMONTH=4;BYDAY=1SU",
    "END:STANDARD",
    "BEGIN:DAYLIGHT",
    "DTSTART:19701004T020000",
    "TZOFFSETFROM:+1000",
    "TZOFFSETTO:+1100",
    "TZNAME:AEDT",
    "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=1SU",
    "END:DAYLIGHT",
    "END:VTIMEZONE",
  ].join("\r\n"),
  "Australia/Hobart": [
    "BEGIN:VTIMEZONE",
    "TZID:Australia/Hobart",
    "BEGIN:STANDARD",
    "DTSTART:19700405T030000",
    "TZOFFSETFROM:+1100",
    "TZOFFSETTO:+1000",
    "TZNAME:AEST",
    "RRULE:FREQ=YEARLY;BYMONTH=4;BYDAY=1SU",
    "END:STANDARD",
    "BEGIN:DAYLIGHT",
    "DTSTART:19701004T020000",
    "TZOFFSETFROM:+1000",
    "TZOFFSETTO:+1100",
    "TZNAME:AEDT",
    "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=1SU",
    "END:DAYLIGHT",
    "END:VTIMEZONE",
  ].join("\r\n"),
  "Australia/Adelaide": [
    "BEGIN:VTIMEZONE",
    "TZID:Australia/Adelaide",
    "BEGIN:STANDARD",
    "DTSTART:19700405T030000",
    "TZOFFSETFROM:+1030",
    "TZOFFSETTO:+0930",
    "TZNAME:ACST",
    "RRULE:FREQ=YEARLY;BYMONTH=4;BYDAY=1SU",
    "END:STANDARD",
    "BEGIN:DAYLIGHT",
    "DTSTART:19701004T020000",
    "TZOFFSETFROM:+0930",
    "TZOFFSETTO:+1030",
    "TZNAME:ACDT",
    "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=1SU",
    "END:DAYLIGHT",
    "END:VTIMEZONE",
  ].join("\r\n"),
  // Australia — no-DST observers (QLD, WA, NT)
  "Australia/Brisbane": [
    "BEGIN:VTIMEZONE",
    "TZID:Australia/Brisbane",
    "BEGIN:STANDARD",
    "DTSTART:19700101T000000",
    "TZOFFSETFROM:+1000",
    "TZOFFSETTO:+1000",
    "TZNAME:AEST",
    "END:STANDARD",
    "END:VTIMEZONE",
  ].join("\r\n"),
  "Australia/Perth": [
    "BEGIN:VTIMEZONE",
    "TZID:Australia/Perth",
    "BEGIN:STANDARD",
    "DTSTART:19700101T000000",
    "TZOFFSETFROM:+0800",
    "TZOFFSETTO:+0800",
    "TZNAME:AWST",
    "END:STANDARD",
    "END:VTIMEZONE",
  ].join("\r\n"),
  "Australia/Darwin": [
    "BEGIN:VTIMEZONE",
    "TZID:Australia/Darwin",
    "BEGIN:STANDARD",
    "DTSTART:19700101T000000",
    "TZOFFSETFROM:+0930",
    "TZOFFSETTO:+0930",
    "TZNAME:ACST",
    "END:STANDARD",
    "END:VTIMEZONE",
  ].join("\r\n"),
  // Common international zones (touring, freight, suppliers)
  "Pacific/Auckland": [
    "BEGIN:VTIMEZONE",
    "TZID:Pacific/Auckland",
    "BEGIN:STANDARD",
    "DTSTART:19700405T030000",
    "TZOFFSETFROM:+1300",
    "TZOFFSETTO:+1200",
    "TZNAME:NZST",
    "RRULE:FREQ=YEARLY;BYMONTH=4;BYDAY=1SU",
    "END:STANDARD",
    "BEGIN:DAYLIGHT",
    "DTSTART:19700927T020000",
    "TZOFFSETFROM:+1200",
    "TZOFFSETTO:+1300",
    "TZNAME:NZDT",
    "RRULE:FREQ=YEARLY;BYMONTH=9;BYDAY=-1SU",
    "END:DAYLIGHT",
    "END:VTIMEZONE",
  ].join("\r\n"),
  "Europe/London": [
    "BEGIN:VTIMEZONE",
    "TZID:Europe/London",
    "BEGIN:STANDARD",
    "DTSTART:19701025T020000",
    "TZOFFSETFROM:+0100",
    "TZOFFSETTO:+0000",
    "TZNAME:GMT",
    "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU",
    "END:STANDARD",
    "BEGIN:DAYLIGHT",
    "DTSTART:19700329T010000",
    "TZOFFSETFROM:+0000",
    "TZOFFSETTO:+0100",
    "TZNAME:BST",
    "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU",
    "END:DAYLIGHT",
    "END:VTIMEZONE",
  ].join("\r\n"),
  "America/Los_Angeles": [
    "BEGIN:VTIMEZONE",
    "TZID:America/Los_Angeles",
    "BEGIN:STANDARD",
    "DTSTART:19701101T020000",
    "TZOFFSETFROM:-0700",
    "TZOFFSETTO:-0800",
    "TZNAME:PST",
    "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU",
    "END:STANDARD",
    "BEGIN:DAYLIGHT",
    "DTSTART:19700308T020000",
    "TZOFFSETFROM:-0800",
    "TZOFFSETTO:-0700",
    "TZNAME:PDT",
    "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU",
    "END:DAYLIGHT",
    "END:VTIMEZONE",
  ].join("\r\n"),
  "America/New_York": [
    "BEGIN:VTIMEZONE",
    "TZID:America/New_York",
    "BEGIN:STANDARD",
    "DTSTART:19701101T020000",
    "TZOFFSETFROM:-0400",
    "TZOFFSETTO:-0500",
    "TZNAME:EST",
    "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU",
    "END:STANDARD",
    "BEGIN:DAYLIGHT",
    "DTSTART:19700308T020000",
    "TZOFFSETFROM:-0500",
    "TZOFFSETTO:-0400",
    "TZNAME:EDT",
    "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU",
    "END:DAYLIGHT",
    "END:VTIMEZONE",
  ].join("\r\n"),
  UTC: [
    "BEGIN:VTIMEZONE",
    "TZID:UTC",
    "BEGIN:STANDARD",
    "DTSTART:19700101T000000",
    "TZOFFSETFROM:+0000",
    "TZOFFSETTO:+0000",
    "TZNAME:UTC",
    "END:STANDARD",
    "END:VTIMEZONE",
  ].join("\r\n"),
};

/** Whether a given IANA timezone has a hardcoded VTIMEZONE block. */
function hasVTimezone(tzid: string): boolean {
  return tzid in VTIMEZONE_BLOCKS;
}

// ─── Line helpers ───────────────────────────────────────────────────────────

function escapeICalText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

function foldLine(line: string): string {
  const maxLen = 75;
  if (line.length <= maxLen) return line;
  let result = line.substring(0, maxLen);
  let remaining = line.substring(maxLen);
  while (remaining.length > 0) {
    result += "\r\n " + remaining.substring(0, maxLen - 1);
    remaining = remaining.substring(maxLen - 1);
  }
  return result;
}

function addLine(lines: string[], line: string): void {
  lines.push(foldLine(line));
}

// ─── VEVENT / VCALENDAR ─────────────────────────────────────────────────────

export function generateVEvent(event: ICalEvent, tzid: string): string {
  const useTzid = hasVTimezone(tzid);
  const lines: string[] = [];
  addLine(lines, "BEGIN:VEVENT");
  addLine(lines, `UID:${event.uid}`);

  if (event.allDay) {
    addLine(
      lines,
      `DTSTART;VALUE=DATE:${formatICalDateOnly(event.dtstart, tzid)}`
    );
    // For all-day events, DTEND is exclusive (next day) per RFC 5545.
    const endPlusOne = new Date(event.dtend);
    endPlusOne.setUTCDate(endPlusOne.getUTCDate() + 1);
    addLine(
      lines,
      `DTEND;VALUE=DATE:${formatICalDateOnly(endPlusOne, tzid)}`
    );
  } else if (useTzid) {
    addLine(
      lines,
      `DTSTART;TZID=${tzid}:${formatICalDateInTz(event.dtstart, tzid)}`
    );
    addLine(
      lines,
      `DTEND;TZID=${tzid}:${formatICalDateInTz(event.dtend, tzid)}`
    );
  } else {
    // Unknown timezone — fall back to UTC (`Z` suffix). Spec-correct and
    // universally interpreted, just shows in the viewer's local time rather
    // than the org's.
    addLine(lines, `DTSTART:${formatICalDateUtc(event.dtstart)}`);
    addLine(lines, `DTEND:${formatICalDateUtc(event.dtend)}`);
  }

  addLine(lines, `SUMMARY:${escapeICalText(event.summary)}`);

  if (event.description) {
    addLine(lines, `DESCRIPTION:${escapeICalText(event.description)}`);
  }
  if (event.location) {
    addLine(lines, `LOCATION:${escapeICalText(event.location)}`);
  }
  if (event.status) {
    addLine(lines, `STATUS:${event.status}`);
  }
  if (event.categories && event.categories.length > 0) {
    addLine(
      lines,
      `CATEGORIES:${event.categories.map(escapeICalText).join(",")}`
    );
  }
  // DTSTAMP MUST be UTC per RFC 5545.
  addLine(lines, `DTSTAMP:${formatICalDateUtc(new Date())}`);
  addLine(lines, "END:VEVENT");
  return lines.join("\r\n");
}

export function generateVCalendar(
  calName: string,
  events: ICalEvent[],
  tzid: string = "Australia/Sydney"
): string {
  const lines: string[] = [];
  addLine(lines, "BEGIN:VCALENDAR");
  addLine(lines, "VERSION:2.0");
  addLine(lines, "PRODID:-//GearFlow//Calendar//EN");
  addLine(lines, "CALSCALE:GREGORIAN");
  addLine(lines, "METHOD:PUBLISH");
  addLine(lines, `X-WR-CALNAME:${escapeICalText(calName)}`);
  if (hasVTimezone(tzid)) {
    addLine(lines, `X-WR-TIMEZONE:${tzid}`);
    // VTIMEZONE block is already CRLF-joined internally; push raw.
    lines.push(VTIMEZONE_BLOCKS[tzid]);
  }

  for (const event of events) {
    lines.push(generateVEvent(event, tzid));
  }

  addLine(lines, "END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}

// ─── Date helpers ───────────────────────────────────────────────────────────

/**
 * Build a Date from a date and optional time string ("HH:mm"), interpreting
 * the time in the given IANA timezone.
 *
 * The input `date` is typically a Prisma Date (UTC midnight in the DB). The
 * time string represents wall-clock time in the org's local timezone. We need
 * to return a `Date` whose UTC instant corresponds to that wall-clock time in
 * the target zone.
 *
 * When no time is supplied, returns the date at midnight local-to-tzid. The
 * caller is responsible for setting `allDay: true` on the ICalEvent if that's
 * the intent.
 */
export function buildDateTime(
  date: Date | string,
  time?: string | null,
  tzid: string = "Australia/Sydney"
): Date {
  const d = typeof date === "string" ? new Date(date) : new Date(date.getTime());

  // Pull the calendar Y/M/D in the target zone (avoids server-tz drift if the
  // input Date is e.g. UTC midnight which is the previous day in Sydney).
  const dateParts = new Intl.DateTimeFormat("en-US", {
    timeZone: tzid,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const m: Record<string, string> = {};
  for (const p of dateParts) m[p.type] = p.value;
  const year = Number(m.year);
  const month = Number(m.month);
  const day = Number(m.day);

  let hour = 0;
  let minute = 0;
  if (time && time.length >= 5) {
    const [h, mm] = time.split(":").map(Number);
    hour = h;
    minute = mm;
  }

  // Compute the UTC instant for the desired wall-clock time in `tzid`.
  return wallClockInZoneToUtc(year, month, day, hour, minute, tzid);
}

/**
 * Given a wall-clock Y/M/D/H/M in a target timezone, return the Date (UTC
 * instant) that renders as that wall-clock time. Uses a single-pass offset
 * lookup via Intl — accurate within a minute, DST-aware.
 */
function wallClockInZoneToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  tzid: string
): Date {
  // First guess: treat the wall-clock numbers as UTC. The result is off by
  // the zone's offset at that instant. Look up the offset and correct.
  const guessUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
  const offsetMs = getTimeZoneOffsetMs(new Date(guessUtc), tzid);
  return new Date(guessUtc - offsetMs);
}

/**
 * Returns the offset (in ms) of `tzid` from UTC at the given instant.
 * Positive for zones east of UTC (e.g. Sydney +10h or +11h with DST).
 */
function getTimeZoneOffsetMs(instant: Date, tzid: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tzid,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(instant);
  const m: Record<string, string> = {};
  for (const p of parts) m[p.type] = p.value;
  const hour = m.hour === "24" ? "00" : m.hour;
  const asUtc = Date.UTC(
    Number(m.year),
    Number(m.month) - 1,
    Number(m.day),
    Number(hour),
    Number(m.minute),
    Number(m.second)
  );
  return asUtc - instant.getTime();
}
