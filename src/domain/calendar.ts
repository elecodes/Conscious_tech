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

export interface PlanItemExportInput {
  title: string;
  day: string; // YYYY-MM-DD
  durationHours?: number | null;
  startTime?: string; // HH:MM
  description?: string;
}

/**
 * Generates RFC 5545 iCalendar format content containing all planned week items
 * for 1-click import into Google Calendar or Apple Calendar.
 */
export function generateIcsCalendarExport(
  items: PlanItemExportInput[],
  calendarName: string = "Conscious Tech — Plan Semanal"
): string {
  const nowUtc = new Date().toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Conscious Tech//Weekly Planner//EN",
    "CALSCALE:GREGORIAN",
    `X-WR-CALNAME:${calendarName}`,
    "METHOD:PUBLISH",
  ];

  for (let i = 0; i < items.length; i++) {
    const it = items[i]!;
    const cleanDay = it.day.replace(/-/g, "");
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
    const uid = `conscious-tech-${cleanDay}-${i + 1}@conscioustech.local`;

    lines.push(
      "BEGIN:VEVENT",
      `UID:${uid}`,
      `DTSTAMP:${nowUtc}`,
      `DTSTART:${startStr}`,
      `DTEND:${endStr}`,
      `SUMMARY:${it.title.replace(/[,;\\]/g, " ")}`,
      `DESCRIPTION:${(it.description || "Planificado con Conscious Tech").replace(/\n/g, "\\n")}`,
      "STATUS:CONFIRMED",
      "END:VEVENT"
    );
  }

  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}
