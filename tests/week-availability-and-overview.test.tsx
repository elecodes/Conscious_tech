import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createActiveWeekFixture } from "./fixtures/active-week";
import { editWeekAvailability } from "../src/web/week-availability";
import { WeekAvailabilityEditor } from "../src/web/components/week-availability-editor";
import { weeksOverview } from "../src/web/weeks-overview";
import { WeeksSidebar } from "../src/web/components/weeks-sidebar";

describe("Editable weekly availability and week navigation", () => {
  it("adds availability later without rewriting tasks, estimates or unknown effort", () => {
    const { plan } = createActiveWeekFixture();
    plan.proposal.weekSummary.capacity = {
      ...plan.proposal.weekSummary.capacity,
      totalAvailableHours: null,
      plannableHours: null,
      protectedSpaceHours: null,
      capacityStatus: "unknown",
      protectedSpaceStatus: "unknown",
    };
    const before = structuredClone(plan.proposal);
    const next = editWeekAvailability(plan.proposal, "20", "25");
    expect(next.weekSummary.capacity).toMatchObject({
      totalAvailableHours: 20,
      plannableHours: 15,
      protectedSpaceHours: 5,
      knownEstimatedHours: 6,
      plannedHours: 6,
    });
    expect(next.foci).toEqual(before.foci);
    expect(next.obligations).toEqual(before.obligations);
    expect(next.flexibleOptions).toEqual(before.flexibleOptions);
    expect(plan.proposal).toEqual(before);
    const zero = editWeekAvailability(next, "0", "25");
    expect(zero.weekSummary.capacity.totalAvailableHours).toBe(0);
    expect(
      editWeekAvailability(zero, "", "25").weekSummary.capacity.totalAvailableHours
    ).toBeNull();
    expect(() => editWeekAvailability(next, "-1", "25")).toThrow();
    expect(() => editWeekAvailability(next, "20", "101")).toThrow();
  });
  it("does not turn partial estimates into complete ones when changing availability", () => {
    const { plan } = createActiveWeekFixture();
    plan.proposal.weekSummary.capacity = {
      ...plan.proposal.weekSummary.capacity,
      knownEstimatedHours: 2,
      plannedHours: null,
      estimationCompleteness: "partial",
    };
    expect(editWeekAvailability(plan.proposal, "10", "30").weekSummary.capacity).toMatchObject({
      knownEstimatedHours: 2,
      plannedHours: null,
      estimationCompleteness: "partial",
      protectedSpaceHours: 3,
    });
  });
  it("offers an immediately open editor for undefined availability", () => {
    const { plan } = createActiveWeekFixture();
    const capacity = { ...plan.proposal.weekSummary.capacity, totalAvailableHours: null };
    const html = renderToStaticMarkup(
      <WeekAvailabilityEditor capacity={capacity} week={plan.targetWeek} onSave={vi.fn()} />
    );
    expect(html).toContain("Añadir horas disponibles");
    expect(html).toContain('open=""');
    expect(html).toContain("Guardar disponibilidad");
  });
  it("uses the corrected proposal effort for a rescheduled optional task", () => {
    const { plan, schedule } = createActiveWeekFixture();
    plan.proposal.flexibleOptions[0]!.estimatedHours = 4;
    schedule.appliedAdjustments = [
      {
        adjustmentId: "next-d",
        proposalId: "manual",
        expectedScheduleVersion: 1,
        decidedAt: "2026-12-08T10:00:00Z",
        humanDecision: "accepted",
        applicationOutcome: "applied",
        lifecycleStatus: "active",
        appliedAt: "2026-12-08T10:00:00Z",
        action: {
          type: "postpone_item",
          itemId: "d",
          currentCategory: "flexible_options",
          targetReason: "intentional_postponement",
          hoursFreed: null,
          rationale: "Después",
          targetWeek: { startDate: "2026-12-14", endDate: "2026-12-20" },
        },
      },
    ];
    expect(
      weeksOverview(plan, schedule, [])
        .find((week) => !week.active)
        ?.items.find((item) => item.id === "d")?.hours
    ).toBe(4);
  });
  it("keeps future postponements findable without inventing a draft or duplicating sources", () => {
    const { plan, schedule } = createActiveWeekFixture();
    const destination = { startDate: "2026-12-14", endDate: "2026-12-20" };
    schedule.appliedAdjustments = [
      {
        adjustmentId: "next-a",
        proposalId: "manual",
        expectedScheduleVersion: 1,
        decidedAt: "2026-12-08T10:00:00Z",
        humanDecision: "accepted",
        applicationOutcome: "applied",
        lifecycleStatus: "active",
        appliedAt: "2026-12-08T10:00:00Z",
        action: {
          type: "postpone_item",
          itemId: "a",
          currentCategory: "foci",
          targetReason: "intentional_postponement",
          hoursFreed: null,
          rationale: "La próxima semana",
          targetWeek: destination,
        },
      },
    ];
    const snapshot = structuredClone({ plan, schedule });
    const overview = weeksOverview(plan, schedule, []);
    const future = overview.find((week) => week.week.startDate === destination.startDate)!;
    expect(future).toMatchObject({ active: false, draft: false, hours: null });
    expect(future.items).toEqual([
      { id: "a", title: "Investigar el proyecto", hours: 2, carried: true },
    ]);
    expect(overview.find((week) => week.active)?.items.some((item) => item.id === "a")).toBe(false);
    const draft = {
      ...structuredClone(plan),
      status: "draft" as const,
      planId: "future",
      targetWeek: destination,
    };
    draft.proposal.weekSummary.targetWeek = destination;
    expect(
      weeksOverview(plan, schedule, [draft])
        .find((week) => !week.active)
        ?.items.filter((item) => item.id === "a")
    ).toHaveLength(1);
    expect({ plan, schedule }).toEqual(snapshot);
    const html = renderToStaticMarkup(
      <WeeksSidebar active={plan} schedule={schedule} drafts={[]} onOpen={vi.fn()} />
    );
    expect(html).toContain("Reprogramada · por incluir");
    expect(html).toContain("Semana activa");
    expect(html).toContain("Horas disponibles por definir");
  });
});
