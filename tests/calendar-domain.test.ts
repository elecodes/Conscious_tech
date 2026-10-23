import { describe, it, expect } from "vitest";
import {
  parseIcalContent,
  parseIcalDate,
} from "../src/infrastructure/calendar/ical-parser";
import {
  calculateCalendarWeekSummary,
  filterEventsForTargetWeek,
  buildGoogleCalendarTemplateUrl,
  generateIcsCalendarExport,
} from "../src/domain/calendar";
import { TargetWeek } from "../src/domain/week";

const SAMPLE_ICS = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Google Inc//Google Calendar 70.9054//EN
CALSCALE:GREGORIAN
BEGIN:VEVENT
DTSTART:20261019T100000Z
DTEND:20261019T113000Z
DTSTAMP:20261012T120000Z
UID:meeting-client-1@google.com
SUMMARY:Reunión con cliente X
DESCRIPTION:Revisar avance trimestral\\, métricas y próximos pasos.\\nUrgente.
LOCATION:Google Meet
STATUS:CONFIRMED
END:VEVENT
BEGIN:VEVENT
DTSTART:20261020T140000Z
DTEND:20261020T160000Z
UID:workshop-team-2@google.com
SUMMARY:Workshop de arquitectura
STATUS:CONFIRMED
END:VEVENT
BEGIN:VEVENT
DTSTART;VALUE=DATE:20261022
DTEND;VALUE=DATE:20261023
UID:holiday-3@google.com
SUMMARY:Feriado nacional
STATUS:CONFIRMED
END:VEVENT
BEGIN:VEVENT
DTSTART:20261021T090000Z
DTEND:20261021T100000Z
UID:cancelled-meeting@google.com
SUMMARY:Reunión cancelada
STATUS:CANCELLED
END:VEVENT
BEGIN:VEVENT
DTSTART:20261026T100000Z
DTEND:20261026T110000Z
UID:next-week-meeting@google.com
SUMMARY:Reunión semana siguiente
STATUS:CONFIRMED
END:VEVENT
END:VCALENDAR`;

describe("Google Calendar & iCal Integration", () => {
  describe("parseIcalDate", () => {
    it("parses all-day date correctly", () => {
      const res = parseIcalDate("20261019");
      expect(res).not.toBeNull();
      expect(res?.isAllDay).toBe(true);
      expect(res?.dayStr).toBe("2026-10-19");
      expect(res?.timeStr).toBe("00:00");
    });

    it("parses UTC datetime correctly", () => {
      const res = parseIcalDate("20261019T143000Z");
      expect(res).not.toBeNull();
      expect(res?.isAllDay).toBe(false);
      expect(res?.dayStr).toBe("2026-10-19");
      expect(res?.timeStr).toBe("14:30");
    });
  });

  describe("parseIcalContent", () => {
    it("parses events, calculates durations, unescapes text, and ignores cancelled events", () => {
      const events = parseIcalContent(SAMPLE_ICS);
      // meeting-client-1, workshop-team-2, holiday-3, next-week-meeting (cancelled skipped)
      expect(events).toHaveLength(4);

      const clientMeeting = events.find((e) => e.id === "meeting-client-1@google.com");
      expect(clientMeeting).toBeDefined();
      expect(clientMeeting?.title).toBe("Reunión con cliente X");
      expect(clientMeeting?.day).toBe("2026-10-19");
      expect(clientMeeting?.startTime).toBe("10:00");
      expect(clientMeeting?.endTime).toBe("11:30");
      expect(clientMeeting?.durationHours).toBe(1.5);
      expect(clientMeeting?.allDay).toBe(false);
      expect(clientMeeting?.description).toContain("Revisar avance trimestral, métricas y próximos pasos.\nUrgente.");

      const holiday = events.find((e) => e.id === "holiday-3@google.com");
      expect(holiday).toBeDefined();
      expect(holiday?.allDay).toBe(true);
      expect(holiday?.durationHours).toBe(0);

      // Cancelled event must not exist
      expect(events.find((e) => e.id === "cancelled-meeting@google.com")).toBeUndefined();
    });

    it("filters events within target week when options are provided", () => {
      const events = parseIcalContent(SAMPLE_ICS, {
        startDate: "2026-10-19",
        endDate: "2026-10-25",
      });

      expect(events).toHaveLength(3);
      expect(events.map((e) => e.day)).toEqual(["2026-10-19", "2026-10-20", "2026-10-22"]);

      const filtered = filterEventsForTargetWeek(events, {
        startDate: "2026-10-20",
        endDate: "2026-10-21",
      });
      expect(filtered).toHaveLength(1);
      expect(filtered[0]?.day).toBe("2026-10-20");
    });
  });

  describe("calculateCalendarWeekSummary", () => {
    const targetWeek: TargetWeek = {
      startDate: "2026-10-19",
      endDate: "2026-10-25",
    };

    it("calculates committed hours, daily constraints, and time blocks for target week", () => {
      const events = parseIcalContent(SAMPLE_ICS);
      const summary = calculateCalendarWeekSummary(events, targetWeek, 8);

      expect(summary.events).toHaveLength(3);
      // Monday: 1.5h, Tuesday: 2h, Thursday: 0h (all day). Total = 3.5h
      expect(summary.totalCommittedHours).toBe(3.5);
      expect(summary.dailyCommittedHours["2026-10-19"]).toBe(1.5);
      expect(summary.dailyCommittedHours["2026-10-20"]).toBe(2);

      // Day constraints reflect remaining available hours out of 8h base
      const monConstraint = summary.dayConstraints.find((c) => c.day === "2026-10-19");
      expect(monConstraint?.availableHours).toBe(6.5);
      expect(monConstraint?.note).toContain("1.5h comprometidas en Google Calendar");

      const tueConstraint = summary.dayConstraints.find((c) => c.day === "2026-10-20");
      expect(tueConstraint?.availableHours).toBe(6);

      // Timeblocks for schedule conflict detection
      expect(summary.timeBlocks).toHaveLength(2);
      expect(summary.timeBlocks[0]?.itemId).toBe("cal-meeting-client-1@google.com");
      expect(summary.timeBlocks[0]?.day).toBe("2026-10-19");
      expect(summary.timeBlocks[0]?.startTime).toBe("10:00");
      expect(summary.timeBlocks[0]?.endTime).toBe("11:30");
    });
  });

  describe("Google Calendar Export & 1-Click URLs", () => {
    it("builds valid 1-click Google Calendar TEMPLATE URL", () => {
      const url = buildGoogleCalendarTemplateUrl({
        title: "Preparar presentación de arquitectura",
        day: "2026-10-21",
        startTime: "14:00",
        durationHours: 2,
        description: "Revisar slides y diagramas con el equipo",
      });

      expect(url).toContain("https://calendar.google.com/calendar/render");
      expect(url).toContain("action=TEMPLATE");
      expect(url).toContain("text=Preparar+presentaci%C3%B3n+de+arquitectura");
      expect(url).toContain("dates=20261021T140000%2F20261021T160000");
      expect(url).toContain("details=");
    });

    it("generates valid RFC 5545 iCalendar content for week export", () => {
      const ics = generateIcsCalendarExport([
        {
          title: "Desarrollo de feature X",
          day: "2026-10-19",
          startTime: "09:00",
          durationHours: 3,
          description: "Bloque de foco principal",
        },
        {
          title: "Revisión de pull requests",
          day: "2026-10-20",
          startTime: "11:00",
          durationHours: 1,
        },
      ]);

      expect(ics).toContain("BEGIN:VCALENDAR");
      expect(ics).toContain("PRODID:-//Conscious Tech//Weekly Planner//EN");
      expect(ics).toContain("SUMMARY:Desarrollo de feature X");
      expect(ics).toContain("DTSTART:20261019T090000");
      expect(ics).toContain("DTEND:20261019T120000");
      expect(ics).toContain("SUMMARY:Revisión de pull requests");
      expect(ics).toContain("DTSTART:20261020T110000");
      expect(ics).toContain("DTEND:20261020T120000");
      expect(ics).toContain("END:VCALENDAR");
    });
  });
});
