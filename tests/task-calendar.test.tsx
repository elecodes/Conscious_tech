import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createActiveWeekFixture } from "./fixtures/active-week";
import { buildTaskCalendar } from "../src/web/task-calendar-model";
import { ActiveTaskCalendar } from "../src/web/components/active-task-calendar";
import { extractPlanItems } from "../src/web/components/weekly-session-formatters";

describe("Read-only active task calendar", () => {
  it("uses real assignments, consolidates blocks/hours and never schedules a deadline", () => {
    const { plan, schedule, items } = createActiveWeekFixture();
    schedule.timeBlocks.push(
      { itemId: "a", day: "2026-12-08", startTime: "09:00", endTime: "10:00" },
      { itemId: "a", day: "2026-12-08", startTime: "14:00", endTime: "15:00" }
    );
    schedule.dailyAllocations.push({ itemId: "a", day: "2026-12-08", allocatedHours: 2 });
    const snapshot = structuredClone({ plan, schedule, items });
    const model = buildTaskCalendar(plan, schedule, items);
    const day = model.days.find((day) => day.date === "2026-12-08")!;
    expect(day.entries).toHaveLength(1);
    expect(day.entries[0]?.blocks).toHaveLength(2);
    expect(day.entries[0]?.hours).toBe(2);
    expect(model.undated.find((task) => task.itemId === "c")?.dueDate).toBe("2026-12-10");
    expect(model.days.find((day) => day.date === "2026-12-10")?.entries).toEqual([]);
    expect({ plan, schedule, items }).toEqual(snapshot);
  });
  it("keeps deferred residual allocations out of the grid and treats notes separately", () => {
    const { plan, schedule, items } = createActiveWeekFixture();
    const model = buildTaskCalendar(plan, schedule, items);
    expect(model.days.flatMap((day) => day.entries)).toEqual([]);
    expect(model.extras.find((task) => task.itemId === "g")?.kind).toBe("outside");
    expect(model.extras.find((task) => task.itemId === "f")?.kind).toBe("note");
    expect(model.pending).toBe(3);
    expect(model.optional).toBe(1);
  });
  it("counts distinct unfinished work and excludes completion/dropped outcomes from pending", () => {
    const { plan, schedule, items } = createActiveWeekFixture();
    schedule.itemActivity = {
      outcomes: [
        { itemId: "a", status: "completed" },
        { itemId: "b", status: "dropped" },
        { itemId: "c", status: "in_progress" },
      ],
      history: [],
    };
    schedule.timeBlocks.push(
      { itemId: "c", day: "2026-12-08", startTime: "09:00", endTime: "10:00" },
      { itemId: "c", day: "2026-12-09", startTime: "09:00", endTime: "10:00" }
    );
    const model = buildTaskCalendar(plan, schedule, items);
    expect(model.pending).toBe(1);
    expect(model.completed).toBe(1);
    expect(
      model.days.flatMap((day) => day.entries).filter((entry) => entry.task.itemId === "c")
    ).toHaveLength(2);
    const html = renderToStaticMarkup(
      <ActiveTaskCalendar plan={plan} schedule={schedule} items={items} onInspect={vi.fn()} />
    );
    expect(html).not.toContain('data-testid="calendar-task-a-undated"');
    expect(html).not.toContain('data-testid="calendar-task-b-undated"');
    expect(html).toContain("En curso");
  });
  it("shows human postponement with its destination rather than as an active assigned task", () => {
    const { plan, schedule, items } = createActiveWeekFixture();
    schedule.appliedAdjustments = [
      {
        adjustmentId: "post-c",
        proposalId: "manual",
        expectedScheduleVersion: 1,
        decidedAt: "2026-12-08T10:00:00Z",
        appliedAt: "2026-12-08T10:00:00Z",
        humanDecision: "accepted",
        applicationOutcome: "applied",
        lifecycleStatus: "active",
        action: {
          type: "postpone_item",
          itemId: "c",
          currentCategory: "obligations",
          targetReason: "intentional_postponement",
          hoursFreed: null,
          rationale: "Después",
          targetWeek: { startDate: "2026-12-14", endDate: "2026-12-20" },
        },
      },
    ];
    const model = buildTaskCalendar(plan, schedule, items);
    expect(model.postponed).toBe(1);
    expect(model.pending).toBe(2);
    expect(model.undated.some((task) => task.itemId === "c")).toBe(false);
    expect(model.extras.find((task) => task.itemId === "c")).toMatchObject({
      kind: "postponed",
      state: "consciously_postponed",
      destination: { startDate: "2026-12-14", endDate: "2026-12-20" },
    });
  });
  it("handles legacy weeks without a schedule and longer/shorter date ranges without invented dates", () => {
    const { plan, items } = createActiveWeekFixture();
    plan.targetWeek = { startDate: "2026-12-08", endDate: "2026-12-10" };
    expect(buildTaskCalendar(plan, null, items).days.map((day) => day.date)).toEqual([
      "2026-12-08",
      "2026-12-09",
      "2026-12-10",
    ]);
    plan.targetWeek.endDate = "2026-12-17";
    const next = buildTaskCalendar(plan, null, items, 1);
    expect(next.pages).toBe(2);
    expect(next.days.map((day) => day.date)).toEqual(["2026-12-15", "2026-12-16", "2026-12-17"]);
    expect(next.undated.map((task) => task.itemId)).toEqual(["c", "a", "b", "d"]);
  });
  it("keeps schedule-only items inspectable and exposes an out-of-range assignment instead of dropping it", () => {
    const { plan, schedule } = createActiveWeekFixture();
    schedule.dailyAllocations.push(
      { itemId: "legacy", day: "2026-12-09", allocatedHours: 1 },
      { itemId: "c", day: "2026-12-14", allocatedHours: 2 }
    );
    const model = buildTaskCalendar(plan, schedule, extractPlanItems(plan, schedule));
    expect(
      model.days
        .find((day) => day.date === "2026-12-09")
        ?.entries.find((entry) => entry.task.itemId === "legacy")?.task.kind
    ).toBe("other");
    expect(model.outOfRange.find((entry) => entry.task.itemId === "c")?.day).toBe("2026-12-14");
  });
});
