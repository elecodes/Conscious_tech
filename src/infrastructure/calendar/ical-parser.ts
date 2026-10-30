import { CalendarEvent } from "../../domain/calendar";

interface RawVEvent {
  uid?: string;
  summary?: string;
  dtstart?: string;
  dtstartParams?: string;
  dtend?: string;
  dtendParams?: string;
  duration?: string;
  status?: string;
  rrule?: string;
  location?: string;
  description?: string;
}

/**
 * Unescapes RFC 5545 text sequences.
 */
function unescapeIcalText(text: string): string {
  return text
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}

/**
 * Parses an iCal date string (e.g. "20261019T143000Z", "20261019T113000", or "20261019").
 * Returns an object with { date: Date, isAllDay: boolean, dayStr: string, timeStr: string }.
 */
export function parseIcalDate(val: string): {
  date: Date;
  isAllDay: boolean;
  dayStr: string;
  timeStr: string;
} | null {
  const trimmed = val.trim();
  if (!trimmed) return null;

  // All-day date: YYYYMMDD (8 digits)
  if (/^\d{8}$/.test(trimmed)) {
    const y = parseInt(trimmed.slice(0, 4), 10);
    const m = parseInt(trimmed.slice(4, 6), 10);
    const d = parseInt(trimmed.slice(6, 8), 10);
    const date = new Date(Date.UTC(y, m - 1, d));
    const dayStr = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    return { date, isAllDay: true, dayStr, timeStr: "00:00" };
  }

  // DateTime format: YYYYMMDDTHHMMSS or YYYYMMDDTHHMMSSZ
  const match = trimmed.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/);
  if (!match) return null;

  const y = parseInt(match[1]!, 10);
  const m = parseInt(match[2]!, 10);
  const d = parseInt(match[3]!, 10);
  const hh = parseInt(match[4]!, 10);
  const mm = parseInt(match[5]!, 10);
  const ss = parseInt(match[6]!, 10);
  const isUtc = Boolean(match[7]);

  // Construct Date
  const date = isUtc
    ? new Date(Date.UTC(y, m - 1, d, hh, mm, ss))
    : new Date(y, m - 1, d, hh, mm, ss);

  const dayStr = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const timeStr = `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;

  return { date, isAllDay: false, dayStr, timeStr };
}

/**
 * Parses an ISO 8601 duration string (e.g. "PT1H30M", "PT45M").
 * Returns duration in hours.
 */
function parseIcalDuration(val: string): number {
  const match = val.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!match) return 0;
  const days = parseInt(match[1] || "0", 10);
  const hours = parseInt(match[2] || "0", 10);
  const minutes = parseInt(match[3] || "0", 10);
  const seconds = parseInt(match[4] || "0", 10);
  return days * 24 + hours + minutes / 60 + seconds / 3600;
}

/**
 * Expands basic weekly RRULE occurrences for a given target range.
 */
function expandWeeklyOccurrences(
  baseStart: { dayStr: string; timeStr: string; isAllDay: boolean; date: Date },
  baseEnd: { dayStr: string; timeStr: string; isAllDay: boolean; date: Date } | null,
  durationHours: number,
  rrule: string,
  rangeStart?: string,
  rangeEnd?: string
): Array<{ day: string; startTime: string; endTime: string; durationHours: number }> {
  const occurrences: Array<{
    day: string;
    startTime: string;
    endTime: string;
    durationHours: number;
  }> = [];

  const parts = rrule.split(";").reduce<Record<string, string>>((acc, part) => {
    const [k, v] = part.split("=");
    if (k && v) acc[k.toUpperCase()] = v.toUpperCase();
    return acc;
  }, {});

  if (parts["FREQ"] !== "WEEKLY") {
    // Only weekly recurring rules are automatically expanded for simplicity
    return occurrences;
  }

  const byDay = parts["BYDAY"] ? parts["BYDAY"].split(",") : null;
  const until = parts["UNTIL"] ? parseIcalDate(parts["UNTIL"]) : null;

  const dayMap: Record<string, number> = {
    SU: 0,
    MO: 1,
    TU: 2,
    WE: 3,
    TH: 4,
    FR: 5,
    SA: 6,
  };

  const startLimit = rangeStart ? new Date(`${rangeStart}T00:00:00Z`) : baseStart.date;
  const endLimit = rangeEnd
    ? new Date(`${rangeEnd}T23:59:59Z`)
    : new Date(baseStart.date.getTime() + 60 * 86400000);

  // Iterate up to 12 weeks
  for (let w = 0; w < 12; w++) {
    const targetDays = byDay ? byDay.map((d) => dayMap[d]!) : [baseStart.date.getUTCDay()];
    for (const targetDayOfWeek of targetDays) {
      const curDate = new Date(baseStart.date);
      curDate.setUTCDate(
        curDate.getUTCDate() + w * 7 + ((targetDayOfWeek - baseStart.date.getUTCDay() + 7) % 7)
      );

      if (until && curDate > until.date) continue;
      if (curDate < startLimit || curDate > endLimit) continue;

      const y = curDate.getUTCFullYear();
      const m = String(curDate.getUTCMonth() + 1).padStart(2, "0");
      const d = String(curDate.getUTCDate()).padStart(2, "0");
      const dayStr = `${y}-${m}-${d}`;

      occurrences.push({
        day: dayStr,
        startTime: baseStart.timeStr,
        endTime: baseEnd ? baseEnd.timeStr : baseStart.timeStr,
        durationHours,
      });
    }
  }

  return occurrences;
}

/**
 * Parses raw iCalendar (.ics) text into an array of structured CalendarEvent objects.
 *
 * @param icsContent Raw text content of an .ics file or feed
 * @param options Optional filter range (startDate and endDate in YYYY-MM-DD)
 */
export function parseIcalContent(
  icsContent: string,
  options?: { startDate?: string; endDate?: string }
): CalendarEvent[] {
  if (!icsContent || typeof icsContent !== "string") return [];

  // 1. Unfold lines according to RFC 5545 (lines beginning with space or tab)
  const unfolded = icsContent.replace(/\r?\n[ \t]/g, "");

  // 2. Extract VEVENT blocks
  const lines = unfolded.split(/\r?\n/);
  const events: CalendarEvent[] = [];

  let inVevent = false;
  let currentEvent: RawVEvent = {};

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed === "BEGIN:VEVENT") {
      inVevent = true;
      currentEvent = {};
      continue;
    }

    if (trimmed === "END:VEVENT") {
      inVevent = false;
      if (currentEvent.status?.toUpperCase() === "CANCELLED") {
        continue;
      }

      const uid = currentEvent.uid || `event-${events.length + 1}`;
      const title = unescapeIcalText(currentEvent.summary || "Evento sin título");

      if (!currentEvent.dtstart) continue;

      const parsedStart = parseIcalDate(currentEvent.dtstart);
      if (!parsedStart) continue;

      let parsedEnd = currentEvent.dtend ? parseIcalDate(currentEvent.dtend) : null;
      let durationHours = 0;

      if (parsedEnd && !parsedStart.isAllDay) {
        const diffMs = parsedEnd.date.getTime() - parsedStart.date.getTime();
        durationHours = Math.max(0, Math.round((diffMs / (1000 * 60 * 60)) * 100) / 100);
      } else if (currentEvent.duration) {
        durationHours = parseIcalDuration(currentEvent.duration);
        if (!parsedEnd) {
          const endMs = parsedStart.date.getTime() + durationHours * 3600000;
          const endDate = new Date(endMs);
          const hh = String(endDate.getUTCHours()).padStart(2, "0");
          const mm = String(endDate.getUTCMinutes()).padStart(2, "0");
          parsedEnd = {
            date: endDate,
            isAllDay: parsedStart.isAllDay,
            dayStr: parsedStart.dayStr,
            timeStr: `${hh}:${mm}`,
          };
        }
      } else if (parsedStart.isAllDay) {
        durationHours = 0;
      } else {
        // Default 1 hour if end is missing
        durationHours = 1;
        const [h, m] = parsedStart.timeStr.split(":").map(Number);
        const nextHour = String(Math.min(23, (h || 0) + 1)).padStart(2, "0");
        parsedEnd = {
          date: new Date(parsedStart.date.getTime() + 3600000),
          isAllDay: false,
          dayStr: parsedStart.dayStr,
          timeStr: `${nextHour}:${String(m || 0).padStart(2, "0")}`,
        };
      }

      // Handle recurrence if present
      if (currentEvent.rrule) {
        const expanded = expandWeeklyOccurrences(
          parsedStart,
          parsedEnd,
          durationHours,
          currentEvent.rrule,
          options?.startDate,
          options?.endDate
        );

        if (expanded.length > 0) {
          for (let i = 0; i < expanded.length; i++) {
            const exp = expanded[i]!;
            events.push({
              id: `${uid}-${i}`,
              title,
              day: exp.day,
              startTime: exp.startTime,
              endTime: exp.endTime,
              durationHours: exp.durationHours,
              allDay: parsedStart.isAllDay,
              location: currentEvent.location ? unescapeIcalText(currentEvent.location) : undefined,
              description: currentEvent.description
                ? unescapeIcalText(currentEvent.description)
                : undefined,
            });
          }
          continue;
        }
      }

      // Normal single event
      const eventItem: CalendarEvent = {
        id: uid,
        title,
        day: parsedStart.dayStr,
        startTime: parsedStart.timeStr,
        endTime: parsedEnd ? parsedEnd.timeStr : parsedStart.timeStr,
        durationHours,
        allDay: parsedStart.isAllDay,
        location: currentEvent.location ? unescapeIcalText(currentEvent.location) : undefined,
        description: currentEvent.description
          ? unescapeIcalText(currentEvent.description)
          : undefined,
      };

      // Filter by date range if provided
      if (options?.startDate && eventItem.day < options.startDate) continue;
      if (options?.endDate && eventItem.day > options.endDate) continue;

      events.push(eventItem);
      continue;
    }

    if (!inVevent) continue;

    // Parse VEVENT property
    const colonIdx = trimmed.indexOf(":");
    if (colonIdx === -1) continue;

    const propNameAndParams = trimmed.slice(0, colonIdx);
    const propValue = trimmed.slice(colonIdx + 1);

    const semiIdx = propNameAndParams.indexOf(";");
    const propName = (
      semiIdx === -1 ? propNameAndParams : propNameAndParams.slice(0, semiIdx)
    ).toUpperCase();
    const propParams = semiIdx === -1 ? "" : propNameAndParams.slice(semiIdx + 1);

    switch (propName) {
      case "UID":
        currentEvent.uid = propValue;
        break;
      case "SUMMARY":
        currentEvent.summary = propValue;
        break;
      case "DTSTART":
        currentEvent.dtstart = propValue;
        currentEvent.dtstartParams = propParams;
        break;
      case "DTEND":
        currentEvent.dtend = propValue;
        currentEvent.dtendParams = propParams;
        break;
      case "DURATION":
        currentEvent.duration = propValue;
        break;
      case "STATUS":
        currentEvent.status = propValue;
        break;
      case "RRULE":
        currentEvent.rrule = propValue;
        break;
      case "LOCATION":
        currentEvent.location = propValue;
        break;
      case "DESCRIPTION":
        currentEvent.description = propValue;
        break;
    }
  }

  return events;
}
