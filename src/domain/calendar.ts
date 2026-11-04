import { z } from "zod";
import { TargetWeek, CalendarDateSchema, DayConstraint } from "./week";
import { TimeBlock } from "./conflict";

export const CalendarEventSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    day: CalendarDateSchema,
    startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Must be HH:MM format"),
    endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Must be HH:MM format"),
    durationHours: z.number().finite().nonnegative(),
    allDay: z.boolean().default(false),
    location: z.string().optional(),
    description: z.string().optional(),
    alarmTrigger: z.string().optional(),
  })
  .strict();

export type CalendarEvent = z.infer<typeof CalendarEventSchema>;

export interface CalendarWeekSummary {
  targetWeek: TargetWeek;
  events: CalendarEvent[];
  totalCommittedHours: number;
  dailyCommittedHours: Record<string, number>;
  dayConstraints: DayConstraint[];
  timeBlocks: TimeBlock[];
}

/**
 * Filters calendar events that fall strictly within the target week [startDate, endDate].
 */
export function filterEventsForTargetWeek(
  events: CalendarEvent[],
  targetWeek: TargetWeek
): CalendarEvent[] {
  return events.filter((ev) => ev.day >= targetWeek.startDate && ev.day <= targetWeek.endDate);
}

/**
 * Calculates a complete summary of committed calendar hours and constraints
 * for a specific target week.
 *
 * @param events All available calendar events
 * @param targetWeek Target planning week
 * @param baseDailyHours Default daily plannable capacity (e.g. 6 or 8 hours)
 */
export function calculateCalendarWeekSummary(
  events: CalendarEvent[],
  targetWeek: TargetWeek,
  baseDailyHours: number = 8
): CalendarWeekSummary {
  const weekEvents = filterEventsForTargetWeek(events, targetWeek);

  const dailyCommittedHours: Record<string, number> = {};
  let totalCommittedHours = 0;

  for (const ev of weekEvents) {
    // Non-all-day events contribute directly to committed hours
    if (!ev.allDay && ev.durationHours > 0) {
      dailyCommittedHours[ev.day] = (dailyCommittedHours[ev.day] || 0) + ev.durationHours;
      totalCommittedHours += ev.durationHours;
    }
  }

  // Round committed totals to 2 decimal places
  totalCommittedHours = Math.round(totalCommittedHours * 100) / 100;
  for (const day of Object.keys(dailyCommittedHours)) {
    dailyCommittedHours[day] = Math.round(dailyCommittedHours[day]! * 100) / 100;
  }

  // Generate day constraints based on meetings
  const dayConstraints: DayConstraint[] = Object.entries(dailyCommittedHours).map(
    ([day, committed]) => {
      const remaining = Math.max(0, Math.round((baseDailyHours - committed) * 100) / 100);
      return {
        day,
        availableHours: remaining,
        note: `${committed}h comprometidas en Google Calendar`,
      };
    }
  );

  // Convert calendar events to time blocks for conflict detection
  const timeBlocks: TimeBlock[] = weekEvents
    .filter((ev) => !ev.allDay && ev.startTime < ev.endTime)
    .map((ev) => ({
      itemId: `cal-${ev.id}`,
      day: ev.day,
      startTime: ev.startTime,
      endTime: ev.endTime,
      note: ev.title,
    }));

  return {
    targetWeek,
    events: weekEvents,
    totalCommittedHours,
    dailyCommittedHours,
    dayConstraints,
    timeBlocks,
  };
}

export interface GoogleCalendarTemplateOptions {
  title: string;
  day: string; // YYYY-MM-DD
  startTime?: string; // HH:MM (default: "09:00")
  durationHours?: number; // default: 1
  description?: string;
  location?: string;
}

/**
 * Builds a 1-click Google Calendar web creation URL pre-populated with task details.
 */
export function buildGoogleCalendarTemplateUrl(options: GoogleCalendarTemplateOptions): string {
  const {
    title,
    day,
    startTime = "09:00",
    durationHours = 1,
    description = "",
    location = "",
  } = options;
  const cleanDay = day.replace(/-/g, "");
  const [sh, sm] = startTime.split(":").map(Number);
  const startHour = Number.isFinite(sh) ? sh! : 9;
  const startMinute = Number.isFinite(sm) ? sm! : 0;

  const totalMinutes = Math.max(15, Math.round((durationHours || 1) * 60));
  const endHour = Math.min(23, startHour + Math.floor((startMinute + totalMinutes) / 60));
  const endMinute = (startMinute + totalMinutes) % 60;

  const startStr = `${cleanDay}T${String(startHour).padStart(2, "0")}${String(startMinute).padStart(2, "0")}00`;
  const endStr = `${cleanDay}T${String(endHour).padStart(2, "0")}${String(endMinute).padStart(2, "0")}00`;

  const detailsText = description
    ? `${description}\n\nPlanificado conscientemente con Conscious Tech`
    : "Planificado conscientemente con Conscious Tech";

  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: title,
    dates: `${startStr}/${endStr}`,
    details: detailsText,
  });

  if (location) {
    params.set("location", location);
  }

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

import { ReminderOffset } from "./reminders";

export interface PlanItemExportInput {
  id?: string;
  title: string;
  day: string; // YYYY-MM-DD
  durationHours?: number | null;
  startTime?: string; // HH:MM
  description?: string;
  allDay?: boolean;
  isCommitment?: boolean;
  hasDeadline?: boolean;
}

export interface IcsExportOptions {
  calendarName?: string;
  reminderOffset?: ReminderOffset;
  includeTasksInAlarms?: boolean;
  timeZone?: string;
  dtstamp?: string;
}

/**
 * Escapes RFC 5545 special text characters: backslash, semicolon, comma, and newline.
 */
export function escapeIcalText(str: string): string {
  return str
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/**
 * Folds iCalendar lines according to RFC 5545 section 3.1:
 * lines SHOULD NOT exceed 75 octets (excluding CRLF).
 * Continuation lines start with a space (ASCII 32).
 * Splitting accounts for multi-byte UTF-8 character boundaries.
 */
export function foldIcalLine(line: string): string {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(line);
  if (bytes.length <= 75) {
    return line;
  }

  const decoder = new TextDecoder("utf-8");
  const chunks: string[] = [];
  let offset = 0;
  let isFirst = true;

  while (offset < bytes.length) {
    const maxChunkBytes = isFirst ? 75 : 74;
    let end = Math.min(offset + maxChunkBytes, bytes.length);

    // If end lands in the middle of a multi-byte UTF-8 sequence, back up
    if (end < bytes.length) {
      while (end > offset && (bytes[end]! & 0xc0) === 0x80) {
        end--;
      }
    }

    const chunkStr = decoder.decode(bytes.subarray(offset, end));
    chunks.push(isFirst ? chunkStr : ` ${chunkStr}`);
    offset = end;
    isFirst = false;
  }

  return chunks.join("\r\n");
}

/**
 * Generates RFC 5545 iCalendar format content containing all planned week items
 * for 1-click import into Google Calendar or Apple Calendar.
 *
 * Supported capabilities:
 * - Deterministic, stable UID per item to ensure updating existing events rather than duplicating.
 * - CRLF line endings and RFC 5545 75-octet line folding.
 * - Timezone support (Europe/Madrid) and all-day items (VALUE=DATE).
 * - Optional VALARM generation based on user preferences.
 * - For all-day events with VALUE=DATE, relative triggers (-PT15M, -PT1H, -P1D) are calculated relative
 *   to the start of the day (00:00:00 local time). A -P1D trigger fires at 00:00 on the preceding day,
 *   while -PT1H / -PT15M fire the evening before, adhering to standard RFC 5545 calendar client alarm
 *   behavior without assuming arbitrary morning times.
 */
export function generateIcsCalendarExport(
  items: PlanItemExportInput[],
  calendarNameOrOptions: string | IcsExportOptions = "Conscious Tech — Plan Semanal"
): string {
  const opts: IcsExportOptions =
    typeof calendarNameOrOptions === "string"
      ? { calendarName: calendarNameOrOptions }
      : calendarNameOrOptions;

  const calendarName = opts.calendarName || "Conscious Tech — Plan Semanal";
  const reminderOffset = opts.reminderOffset || "none";
  const includeTasks = opts.includeTasksInAlarms ?? false;
  const timeZone = opts.timeZone;
  const nowUtc = opts.dtstamp || new Date().toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";

  const rawLines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Conscious Tech//Weekly Planner//EN",
    "CALSCALE:GREGORIAN",
    `X-WR-CALNAME:${escapeIcalText(calendarName)}`,
    "METHOD:PUBLISH",
  ];

  for (let i = 0; i < items.length; i++) {
    const it = items[i]!;
    if (!it.day) continue;

    const cleanDay = it.day.replace(/-/g, "");

    // Deterministic stable UID: prefer item ID, fallback to slugified title + day
    let cleanUid = "";
    if (it.id && it.id.trim().length > 0) {
      cleanUid = it.id.trim().replace(/[^a-zA-Z0-9_-]/g, "_");
    } else {
      const slug = it.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 32);
      cleanUid = `${cleanDay}-${slug || `item-${i + 1}`}`;
    }
    const uid = `conscious-tech-${cleanUid}@conscioustech.local`;

    const isAllDay = Boolean(it.allDay);

    rawLines.push("BEGIN:VEVENT");
    rawLines.push(`UID:${uid}`);
    rawLines.push(`DTSTAMP:${nowUtc}`);

    if (isAllDay) {
      // Calculate next day for exclusive RFC 5545 DATE DTEND
      const [y, m, d] = it.day.split("-").map(Number);
      const nextDate = new Date(Date.UTC(y!, m! - 1, d! + 1));
      const nextY = nextDate.getUTCFullYear();
      const nextM = String(nextDate.getUTCMonth() + 1).padStart(2, "0");
      const nextD = String(nextDate.getUTCDate()).padStart(2, "0");
      const cleanNextDay = `${nextY}${nextM}${nextD}`;

      rawLines.push(`DTSTART;VALUE=DATE:${cleanDay}`);
      rawLines.push(`DTEND;VALUE=DATE:${cleanNextDay}`);
    } else {
      const startTime = it.startTime || "09:00";
      const duration = it.durationHours || 1;
      const [sh, sm] = startTime.split(":").map(Number);
      const startHour = Number.isFinite(sh) ? sh! : 9;
      const startMinute = Number.isFinite(sm) ? sm! : 0;

      const totalMinutes = Math.max(15, Math.round(duration * 60));
      const endHour = Math.min(23, startHour + Math.floor((startMinute + totalMinutes) / 60));
      const endMinute = (startMinute + totalMinutes) % 60;

      const startStr = `${cleanDay}T${String(startHour).padStart(2, "0")}${String(startMinute).padStart(2, "0")}00`;
      const endStr = `${cleanDay}T${String(endHour).padStart(2, "0")}${String(endMinute).padStart(2, "0")}00`;

      if (timeZone) {
        rawLines.push(`DTSTART;TZID=${timeZone}:${startStr}`);
        rawLines.push(`DTEND;TZID=${timeZone}:${endStr}`);
      } else {
        rawLines.push(`DTSTART:${startStr}`);
        rawLines.push(`DTEND:${endStr}`);
      }
    }

    rawLines.push(`SUMMARY:${escapeIcalText(it.title)}`);
    rawLines.push(
      `DESCRIPTION:${escapeIcalText(it.description || "Planificado con Conscious Tech")}`
    );
    rawLines.push("STATUS:CONFIRMED");

    // Check reminder alarm
    if (reminderOffset !== "none") {
      const shouldAlarm = Boolean(it.isCommitment || it.hasDeadline || includeTasks);
      if (shouldAlarm) {
        const trigger =
          reminderOffset === "15m" ? "-PT15M" : reminderOffset === "1h" ? "-PT1H" : "-P1D";
        rawLines.push("BEGIN:VALARM");
        rawLines.push("ACTION:DISPLAY");
        rawLines.push("DESCRIPTION:Recordatorio de Conscious Tech");
        rawLines.push(`TRIGGER:${trigger}`);
        rawLines.push("END:VALARM");
      }
    }

    rawLines.push("END:VEVENT");
  }

  rawLines.push("END:VCALENDAR");

  // Apply line folding to every line and join with CRLF
  const foldedLines = rawLines.map((line) => foldIcalLine(line));
  return foldedLines.join("\r\n");
}
