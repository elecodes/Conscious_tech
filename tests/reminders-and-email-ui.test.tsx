import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CalendarReminderSettings } from "../src/web/components/calendar-reminder-settings";
import { EmailSummaryCard } from "../src/web/components/email-summary-card";
import { ActiveWeekScheduleSection } from "../src/web/components/active-week-schedule-section";
import { PlanningProposalReviewFooter } from "../src/web/components/planning-proposal-review-footer";
import { WeeklySchedule } from "../src/domain/schedule";
import { StoredWeeklyPlan } from "../src/domain/repositories/types";
import { ProposedWeek, TargetWeek } from "../src/domain/week";

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
      expect(html).toContain("Tu calendario te avisará");
      expect(html).toContain(
        "Google Calendar te avisará con una notificación; puedes activar el aviso por correo en sus ajustes."
      );
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
      expect(html).toContain("https://mail.google.com/mail/?view=cm&amp;fs=1");
      expect(html).not.toContain("&amp;to=");
      expect(html).toContain('data-testid="open-mailto-summary-button"');
      expect(html).toContain("mailto:?subject=");
      expect(html).toContain('data-testid="copy-email-summary-button"');
      expect(html).toContain("Copiar resumen");
      expect(html).toContain("Ningún dato se envía automáticamente");
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

    it("renders prominent 'Añadir semana a Google Calendar' button and 'Recordatorios y avisos' details", () => {
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
      expect(html).toContain("Añadir semana a Google Calendar");
      expect(html).toContain('data-testid="reminders-and-alerts-details"');
      expect(html).toContain("Recordatorios y avisos");
    });
  });

  describe("PlanningProposalReviewFooter integration", () => {
    const activeTargetWeek: TargetWeek = { startDate: "2026-10-19", endDate: "2026-10-25" };
    const mockProposedWeek = {
      foci: [
        {
          id: "f-1",
          title: "Foco principal",
          desiredOutcome: "Resultado",
          contributingItemIds: [],
        },
      ],
      obligations: [],
      flexibleOptions: [],
      deferredItems: [],
      weekSummary: {
        targetWeek: activeTargetWeek,
      },
    } as unknown as ProposedWeek;

    it("renders prominent 'Añadir semana a Google Calendar' button and reminder settings inside actions", () => {
      const html = renderToStaticMarkup(
        <PlanningProposalReviewFooter
          proposedWeek={mockProposedWeek}
          activeTargetWeek={activeTargetWeek}
          diagnostics={[]}
          activePlanConflict={null}
          setActivePlanConflict={vi.fn()}
          confirmationError={null}
          userIntent=""
          setUserIntent={vi.fn()}
          isConfirming={false}
          handleAdjustElements={vi.fn()}
          setIsReviewingSelection={vi.fn()}
          handleStartFreshWeek={vi.fn()}
          handleConfirmPlan={vi.fn()}
        />
      );

      expect(html).toContain('data-testid="proposal-add-week-to-gcal"');
      expect(html).toContain("Añadir semana a Google Calendar");
      expect(html).toContain('data-testid="proposal-more-actions-details"');
      expect(html).toContain('data-testid="calendar-reminder-settings"');
    });
  });
});
