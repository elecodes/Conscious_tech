import { describe, it, expect } from "vitest";
import {
  generateIcsCalendarExport,
  foldIcalLine,
  escapeIcalText,
  PlanItemExportInput,
} from "../src/domain/calendar";
import { parseIcalContent } from "../src/infrastructure/calendar/ical-parser";
import {
  getStoredReminderPreferences,
  saveStoredReminderPreferences,
  REMINDER_STORAGE_KEY_OFFSET,
  REMINDER_STORAGE_KEY_INCLUDE_TASKS,
} from "../src/domain/reminders";

describe("Calendar ICS reminders and RFC 5545 compliance", () => {
  const sampleItems: PlanItemExportInput[] = [
    {
      id: "item-focus-1",
      title: "Diseñar arquitectura de eventos, con notas; y detalles",
      day: "2026-10-19",
      startTime: "10:00",
      durationHours: 2,
      description: "Línea 1\nLínea 2; con punto y coma, y coma",
      isCommitment: true,
      hasDeadline: true,
    },
    {
      id: "item-task-2",
      title: "Tarea secundaria sin fecha límite",
      day: "2026-10-20",
      startTime: "14:00",
      durationHours: 1,
      description: "Descripción simple",
      isCommitment: false,
      hasDeadline: false,
    },
    {
      id: "item-allday-3",
      title: "Jornada completa de revisión estratégica",
      day: "2026-10-21",
      allDay: true,
      isCommitment: true,
      hasDeadline: false,
    },
  ];

  it("escapes commas, semicolons, backslashes and newlines according to RFC 5545", () => {
    const raw = "Texto con , comas; punto y coma\\ barras\ny saltos de línea";
    const escaped = escapeIcalText(raw);
    expect(escaped).toBe("Texto con \\, comas\\; punto y coma\\\\ barras\\ny saltos de línea");
  });

  it("folds lines longer than 75 octets without breaking multi-byte UTF-8 sequences", () => {
    // 80 characters of Spanish text with accents (multi-byte UTF-8)
    const longLine =
      "DESCRIPTION:Esta es una línea muy larga diseñada para comprobar el plegado de líneas según el estándar RFC 5545 con acentos: áéíóú";
    const folded = foldIcalLine(longLine);
    const lines = folded.split("\r\n");
    expect(lines.length).toBeGreaterThan(1);
    expect(lines[1]?.startsWith(" ")).toBe(true);

    // Each folded line must be <= 75 octets
    const encoder = new TextEncoder();
    for (const l of lines) {
      expect(encoder.encode(l).length).toBeLessThanOrEqual(75);
    }
  });

  it("exports ICS with CRLF endings, DTSTAMP, and valid VCALENDAR structure", () => {
    const ics = generateIcsCalendarExport(sampleItems, {
      calendarName: "Conscious Tech — Test",
      timeZone: "Europe/Madrid",
      dtstamp: "20261019T080000Z",
    });

    expect(ics).toContain("BEGIN:VCALENDAR\r\n");
    expect(ics).toContain("END:VCALENDAR");
    expect(ics).toContain("DTSTAMP:20261019T080000Z");
    expect(ics).toContain("TZID=Europe/Madrid");
    expect(ics).not.toMatch(/[^\r]\n/); // Every newline must be preceded by \r
  });

  it("maintains stable UID per item across multiple exports", () => {
    const ics1 = generateIcsCalendarExport(sampleItems, {
      reminderOffset: "1h",
      dtstamp: "20261019T080000Z",
    });
    const ics2 = generateIcsCalendarExport(sampleItems, {
      reminderOffset: "15m",
      dtstamp: "20261019T090000Z",
    });

    const parsed1 = parseIcalContent(ics1);
    const parsed2 = parseIcalContent(ics2);

    expect(parsed1.length).toBe(3);
    expect(parsed2.length).toBe(3);
    for (let i = 0; i < parsed1.length; i++) {
      expect(parsed1[i]?.id).toBe(parsed2[i]?.id);
      expect(parsed1[i]?.id).toContain(sampleItems[i]?.id);
    }
  });

  it("does not include VALARM when reminderOffset is 'none' (default)", () => {
    const ics = generateIcsCalendarExport(sampleItems, {
      reminderOffset: "none",
    });
    expect(ics).not.toContain("BEGIN:VALARM");
  });

  it("adds VALARM with -PT15M, -PT1H, or -P1D only to commitments/deadlines by default", () => {
    const ics1h = generateIcsCalendarExport(sampleItems, {
      reminderOffset: "1h",
      includeTasksInAlarms: false,
    });

    expect(ics1h).toContain("BEGIN:VALARM");
    expect(ics1h).toContain("TRIGGER:-PT1H");
    expect(ics1h).toContain("ACTION:DISPLAY");

    const events = parseIcalContent(ics1h);
    expect(events.length).toBe(3);

    // Focus 1 (commitment + deadline): has alarm
    expect(events[0]?.alarmTrigger).toBe("-PT1H");
    // Task 2 (task without deadline): no alarm when includeTasksInAlarms is false
    expect(events[1]?.alarmTrigger).toBeUndefined();
    // All-day 3 (commitment): has alarm
    expect(events[2]?.alarmTrigger).toBe("-PT1H");
  });

  it("adds VALARM to ordinary tasks when includeTasksInAlarms is true", () => {
    const ics15m = generateIcsCalendarExport(sampleItems, {
      reminderOffset: "15m",
      includeTasksInAlarms: true,
    });

    const events = parseIcalContent(ics15m);
    expect(events[0]?.alarmTrigger).toBe("-PT15M");
    expect(events[1]?.alarmTrigger).toBe("-PT15M");
    expect(events[2]?.alarmTrigger).toBe("-PT15M");
  });

  it("handles 1 day before alarm (-P1D)", () => {
    const ics1d = generateIcsCalendarExport(sampleItems, {
      reminderOffset: "1d",
      includeTasksInAlarms: true,
    });

    const events = parseIcalContent(ics1d);
    expect(events[0]?.alarmTrigger).toBe("-P1D");
  });

  it("formats all-day events with VALUE=DATE", () => {
    const ics = generateIcsCalendarExport(sampleItems);
    expect(ics).toContain("DTSTART;VALUE=DATE:20261021");
    expect(ics).toContain("DTEND;VALUE=DATE:20261022");
  });

  it("loads and persists reminder preferences locally in localStorage", () => {
    const store = new Map<string, string>();
    const mockStorage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, val: string) => store.set(key, val),
      removeItem: (key: string) => store.delete(key),
      clear: () => store.clear(),
      key: (i: number) => Array.from(store.keys())[i] ?? null,
      length: 0,
    };
    const origStorage = globalThis.localStorage;
    globalThis.localStorage = mockStorage as unknown as Storage;

    try {
      const defaults = getStoredReminderPreferences();
      expect(defaults.offset).toBe("none");
      expect(defaults.includeTasks).toBe(false);

      saveStoredReminderPreferences({ offset: "1h", includeTasks: true });
      expect(globalThis.localStorage.getItem(REMINDER_STORAGE_KEY_OFFSET)).toBe("1h");
      expect(globalThis.localStorage.getItem(REMINDER_STORAGE_KEY_INCLUDE_TASKS)).toBe("true");

      const loaded = getStoredReminderPreferences();
      expect(loaded.offset).toBe("1h");
      expect(loaded.includeTasks).toBe(true);
    } finally {
      globalThis.localStorage = origStorage;
    }
  });
});
