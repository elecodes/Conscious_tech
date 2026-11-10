import React from "react";
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CalendarReminderSettings } from "../src/web/components/calendar-reminder-settings";
import { EmailSummaryCard } from "../src/web/components/email-summary-card";
import { ActiveWeekScheduleSection } from "../src/web/components/active-week-schedule-section";
import { PlanningProposalReviewFooter } from "../src/web/components/planning-proposal-review-footer";
import { WeeklySchedule } from "../src/domain/schedule";
import { StoredWeeklyPlan } from "../src/domain/repositories/types";
import { TargetWeek, createEmptyProposedWeek } from "../src/domain/week";
import {
  getStoredReminderPreferences,
  saveStoredReminderPreferences,
  REMINDER_STORAGE_KEY_OFFSET,
  REMINDER_STORAGE_KEY_INCLUDE_TASKS,
} from "../src/domain/reminders";

describe("Reminders and Email Summary UI Components", () => {
  describe("CalendarReminderSettings", () => {
    it("renders selector with 4 options and defaults to 'none'", () => {
      const html = renderToStaticMarkup(
        <CalendarReminderSettings preferences={{ offset: "none", includeTasks: false }} />
      );

      expect(html).toContain('data-testid="calendar-reminder-settings"');
      expect(html).toContain('data-testid="reminder-offset-select"');
      expect(html).toContain("Sin recordatorio");
      expect(html).toContain("15 minutos antes");
      expect(html).toContain("1 hora antes");
      expect(html).toContain("1 día antes");
      // Checkbox is hidden when offset is 'none'
      expect(html).not.toContain('data-testid="reminder-include-tasks-checkbox"');
    });

    it("displays tasks checkbox and helper text when a reminder offset is active", () => {
      const html = renderToStaticMarkup(
        <CalendarReminderSettings preferences={{ offset: "1h", includeTasks: true }} />
      );

      expect(html).toContain('data-testid="reminder-include-tasks-checkbox"');
      expect(html).toContain("Incluir también tareas");
      expect(html).toContain("Avisos en tu calendario");
      expect(html).toContain("Puedes activar el aviso por correo en sus ajustes");
      expect(html).toContain("incluye un aviso a las 9:00");
    });

    it("restores reminder preferences from local storage on clean vs configured profiles", () => {
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
        // 1. Clean profile defaults to "Sin recordatorio"
        const cleanPrefs = getStoredReminderPreferences();
        expect(cleanPrefs.offset).toBe("none");
        expect(cleanPrefs.includeTasks).toBe(false);

        const htmlClean = renderToStaticMarkup(<CalendarReminderSettings />);
        expect(htmlClean).toContain('value="none"');
        expect(htmlClean).not.toContain('data-testid="reminder-include-tasks-checkbox"');

        // 2. Set preferences: 1h before, include tasks
        saveStoredReminderPreferences({ offset: "1h", includeTasks: true });
        expect(globalThis.localStorage.getItem(REMINDER_STORAGE_KEY_OFFSET)).toBe("1h");
        expect(globalThis.localStorage.getItem(REMINDER_STORAGE_KEY_INCLUDE_TASKS)).toBe("true");

        // 3. Simulate unmount and remount (reload): asserts choice is restored from same local storage
        const restoredPrefs = getStoredReminderPreferences();
        expect(restoredPrefs.offset).toBe("1h");
        expect(restoredPrefs.includeTasks).toBe(true);

        const htmlRestored = renderToStaticMarkup(<CalendarReminderSettings />);
        expect(htmlRestored).toContain('value="1h"');
        expect(htmlRestored).toContain('data-testid="reminder-include-tasks-checkbox"');
      } finally {
        globalThis.localStorage = origStorage;
      }
    });
  });

  describe("EmailSummaryCard", () => {
    const targetWeek = {
      startDate: "2026-10-19",
      endDate: "2026-10-25",
    };
    const items = [
      { title: "Prioridad A", day: "2026-10-19", startTime: "09:00", source: "Foco" },
      { title: "Compromiso B", day: "2026-10-21", source: "Obligación" },
    ];

    it("renders preview, Gmail button with no recipient, mailto, copy button, and privacy notice", () => {
      const html = renderToStaticMarkup(
        <EmailSummaryCard
          targetWeek={targetWeek}
          items={items}
          reflections={{ notes: "Buenas reflexiones", learned: ["Aprendizaje clave"] }}
        />
      );

      expect(html).toContain('data-testid="email-summary-card"');
      expect(html).toContain('data-testid="email-summary-preview"');
      expect(html).toContain("Mi semana · 2026-10-19 al 2026-10-25");
      expect(html).toContain('data-testid="open-gmail-summary-button"');
      expect(html).toContain('rel="noopener noreferrer"');
      expect(html).toContain("https://mail.google.com/mail/?view=cm&amp;fs=1");
      expect(html).not.toContain("&amp;to=");
      expect(html).toContain('data-testid="open-mailto-summary-button"');
      expect(html).toContain("mailto:?subject=");
      expect(html).toContain('data-testid="copy-email-summary-button"');
      expect(html).toContain("Copiar resumen");
      expect(html).toContain("Ningún dato se envía automáticamente");
    });

    it("copies the FULL non-truncated text to clipboard when 'Copiar resumen' is clicked", async () => {
      const manyItems = Array.from({ length: 40 }, (_, i) => ({
        title: `Tarea extendida ${i + 1} para verificar el contenido completo en el portapapeles`,
        day: "2026-10-20",
        source: "Foco",
      }));

      let copiedText = "";
      Object.defineProperty(globalThis, "navigator", {
        value: {
          clipboard: {
            writeText: async (val: string) => {
              copiedText = val;
            },
          },
        },
        configurable: true,
      });

      function findByTestId(node: any, testId: string): any {
        if (!node) return null;
        if (node.props?.["data-testid"] === testId) return node;
        if (Array.isArray(node.props?.children)) {
          for (const child of node.props.children) {
            const found = findByTestId(child, testId);
            if (found) return found;
          }
        } else if (node.props?.children) {
          return findByTestId(node.props.children, testId);
        }
        return null;
      }

      const internals = (React as any)
        .__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
      const prevDispatcher = internals?.H;
      internals.H = {
        useState: (init: any) => [init, () => {}],
      };

      try {
        const tree = EmailSummaryCard({
          targetWeek,
          items: manyItems,
        });

        const copyBtn = findByTestId(tree, "copy-email-summary-button");
        expect(copyBtn).not.toBeNull();
        await copyBtn.props.onClick();

        expect(copiedText.length).toBeGreaterThan(1500);
        expect(copiedText).not.toContain("… (ver el resto en la app)");
        expect(copiedText).toContain("Tarea extendida 40");
        expect(copiedText).toContain("Mi semana (2026-10-19 al 2026-10-25)");
      } finally {
        if (internals) {
          internals.H = prevDispatcher;
        }
      }
    });
  });

  describe("ActiveWeekScheduleSection integration", () => {
    const targetWeek: TargetWeek = { startDate: "2026-10-19", endDate: "2026-10-25" };
    const mockSchedule = {
      scheduleId: "sched-1",
      planId: "plan-1",
      weekRange: targetWeek,
      dailyAllocations: [],
      focusItems: [],
      timeBlocks: [],
      appliedAdjustments: [],
      version: 1,
      createdAt: "2026-10-19T00:00:00Z",
      updatedAt: "2026-10-19T00:00:00Z",
    } as unknown as WeeklySchedule;
    const mockPlan = {
      planId: "plan-1",
      createdAt: "2026-10-19T00:00:00Z",
      status: "active",
      targetWeek,
      proposal: {
        foci: [],
        obligations: [],
        flexibleOptions: [],
        deferredItems: [],
        weekSummary: {
          targetWeek,
          capacity: {
            totalWeeklyCapacityHours: 40,
            totalAvailableHours: 40,
            allocatedHours: 10,
            remainingHours: 30,
            isCapacityFeasible: true,
          },
        },
      },
    } as unknown as StoredWeeklyPlan;
    const planItems = [{ itemId: "task-1", title: "Tarea 1", source: "Foco", estimatedHours: 2 }];

    it("renders one calendar download and a single calendar/sharing section", () => {
      const html = renderToStaticMarkup(
        <ActiveWeekScheduleSection
          schedule={mockSchedule}
          plan={mockPlan}
          planItems={planItems}
          selectedAdjustmentItemId=""
          setSelectedAdjustmentItemId={vi.fn()}
          isAdjustmentOpen={false}
          setIsAdjustmentOpen={vi.fn()}
          lastSavedAdjustment={null}
          setLastSavedAdjustment={vi.fn()}
          targetWeekStart="2026-10-19"
          setTargetWeekStart={vi.fn()}
          targetWeekEnd="2026-10-25"
          setTargetWeekEnd={vi.fn()}
          deadlineInput=""
          setDeadlineInput={vi.fn()}
          taskHoursInput=""
          setTaskHoursInput={vi.fn()}
          taskDayInput=""
          setTaskDayInput={vi.fn()}
          isAdjustmentPreviewOpen={false}
          setIsAdjustmentPreviewOpen={vi.fn()}
          handleSaveTaskAdjustment={vi.fn()}
          applyAdjustment={vi.fn()}
          setFeedbackMessage={vi.fn()}
        />
      );

      expect(html).toContain('data-testid="add-week-to-gcal-button"');
      expect(html).toContain("Descargar calendario (.ics)");
      expect(html.match(/data-testid="add-week-to-gcal-button"/g)).toHaveLength(1);
      expect(html).not.toContain('data-testid="open-email-summary-top-button"');
      expect(html).not.toContain('data-testid="export-week-to-gcal"');
      expect(html).not.toContain('data-testid="download-ics-from-reminders-button"');
      expect(html).toContain('data-testid="reminders-and-alerts-details"');
      expect(html).toContain("Calendario y compartir");
      expect(html).toContain("Calendario y recordatorios");
      expect(html).toContain('id="email-summary-card-wrapper"');
      expect(html).toContain('data-testid="link-gcal-settings-export"');
      expect(html).toContain("https://calendar.google.com/calendar/u/0/r/settings/export");
    });
  });

  describe("PlanningProposalReviewFooter integration", () => {
    const activeTargetWeek: TargetWeek = { startDate: "2026-10-19", endDate: "2026-10-25" };
    const mockProposedWeek = createEmptyProposedWeek("2026-10-12", activeTargetWeek);

    it("shows the activation summary and keeps export outside confirmation", () => {
      const html = renderToStaticMarkup(
        <PlanningProposalReviewFooter
          proposedWeek={mockProposedWeek}
          diagnostics={[]}
          activePlanConflict={null}
          setActivePlanConflict={vi.fn()}
          confirmationError={null}
          isConfirming={false}
          handleAdjustElements={vi.fn()}
          setIsReviewingSelection={vi.fn()}
          handleStartFreshWeek={vi.fn()}
          handleConfirmPlan={vi.fn()}
        />
      );

      expect(html).toContain('data-testid="confirmation-summary"');
      expect(html).not.toContain('data-testid="proposal-add-week-to-gcal"');
      expect(html).not.toContain("Exportar propuesta");
      expect(html).toContain("Después");
      expect(html).toContain("exportarla o compartirla desde Mi semana");
      expect(html).toContain('data-testid="proposal-more-actions-details"');
      expect(html).not.toContain('data-testid="calendar-reminder-settings"');
    });
  });
});
