import { z } from "zod";
import { TargetWeek, CalendarDateSchema, DayConstraint } from "./week";
import { TimeBlock } from "./conflict";

export const CalendarEventSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  day: CalendarDateSchema,
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Must be HH:MM format"),
  endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Must be HH:MM format"),
  durationHours: z.number().finite().nonnegative(),
  allDay: z.boolean().default(false),
  location: z.string().optional(),
  description: z.string().optional(),
}).strict();

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
  return events.filter(
    (ev) => ev.day >= targetWeek.startDate && ev.day <= targetWeek.endDate
  );
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
