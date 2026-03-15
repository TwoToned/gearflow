/**
 * iCalendar (.ics) generation helpers.
 * Generates RFC 5545-compliant VCALENDAR/VEVENT content.
 */

export interface ICalEvent {
  uid: string;
  summary: string;
  description?: string;
  location?: string;
  dtstart: Date;
  dtend: Date;
  status?: "CONFIRMED" | "TENTATIVE" | "CANCELLED";
  categories?: string[];
}

function formatICalDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const h = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  const s = String(date.getSeconds()).padStart(2, "0");
  return `${y}${m}${d}T${h}${min}${s}`;
}

function formatICalDateAllDay(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

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

export function generateVEvent(event: ICalEvent): string {
  const lines: string[] = [];
  addLine(lines, "BEGIN:VEVENT");
  addLine(lines, `UID:${event.uid}`);

  // Use all-day format if times are midnight-to-midnight
  const isAllDay =
    event.dtstart.getHours() === 0 &&
    event.dtstart.getMinutes() === 0 &&
    event.dtend.getHours() === 0 &&
    event.dtend.getMinutes() === 0;

  if (isAllDay) {
    addLine(lines, `DTSTART;VALUE=DATE:${formatICalDateAllDay(event.dtstart)}`);
    // For all-day events, DTEND is exclusive (next day)
    const endPlusOne = new Date(event.dtend);
    endPlusOne.setDate(endPlusOne.getDate() + 1);
    addLine(lines, `DTEND;VALUE=DATE:${formatICalDateAllDay(endPlusOne)}`);
  } else {
    addLine(lines, `DTSTART:${formatICalDate(event.dtstart)}`);
    addLine(lines, `DTEND:${formatICalDate(event.dtend)}`);
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
  addLine(lines, `DTSTAMP:${formatICalDate(new Date())}`);
  addLine(lines, "END:VEVENT");
  return lines.join("\r\n");
}

export function generateVCalendar(
  calName: string,
  events: ICalEvent[]
): string {
  const lines: string[] = [];
  addLine(lines, "BEGIN:VCALENDAR");
  addLine(lines, "VERSION:2.0");
  addLine(lines, "PRODID:-//GearFlow//Calendar//EN");
  addLine(lines, "CALSCALE:GREGORIAN");
  addLine(lines, "METHOD:PUBLISH");
  addLine(lines, `X-WR-CALNAME:${escapeICalText(calName)}`);

  for (const event of events) {
    lines.push(generateVEvent(event));
  }

  addLine(lines, "END:VCALENDAR");
  return lines.join("\r\n");
}

/**
 * Build a start Date from a date and optional time string ("HH:mm").
 */
export function buildDateTime(
  date: Date | string,
  time?: string | null
): Date {
  const d = new Date(date);
  if (time && time.length >= 5) {
    const [h, m] = time.split(":").map(Number);
    d.setHours(h, m, 0, 0);
  } else {
    d.setHours(0, 0, 0, 0);
  }
  return d;
}
