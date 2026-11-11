import { describe, it, expect } from "vitest";
import { createActiveWeekFixture } from "./fixtures/active-week";
import { scheduleCalendarTask } from "../src/web/schedule-calendar-task";
import { applyItemActivity } from "../src/domain/item-activity";
import { activePostponements } from "../src/domain/item-postponement";
import { WeeklyScheduleSchema } from "../src/domain/schedule";
import { buildTaskCalendar } from "../src/web/task-calendar-model";
import { extractPlanItems } from "../src/web/components/weekly-session-formatters";
const now = "2026-12-07T12:00:00.000Z";
function fixture() {
  const f = createActiveWeekFixture();
  f.schedule.timeBlocks = [];
  f.schedule.dailyAllocations = [{ itemId: "c", day: "2026-12-10", allocatedHours: 2 }];
  return f;
}
describe("Schedule tasks directly from the calendar tray", () => {
  it("includes only the dragged deferred task and preserves other tasks, counting effort once", () => {
    const { plan, schedule, items } = fixture();
    const before = structuredClone({ plan, schedule });
    const result = scheduleCalendarTask(
      plan,
      schedule,
      items.find((row) => row.itemId === "g")!,
      "2026-12-08",
      3,
      now,
      "add-g"
    );
    expect(result.plan.proposal.deferredItems.some((row) => row.itemId === "g")).toBe(false);
    expect(result.plan.proposal.flexibleOptions.filter((row) => row.itemId === "g")).toHaveLength(
      1
    );
    expect(result.schedule.dailyAllocations).toEqual([
      ...schedule.dailyAllocations,
      { itemId: "g", day: "2026-12-08", allocatedHours: 3 },
    ]);
    expect(result.plan.proposal.weekSummary.capacity.plannedHours).toBe(10);
    expect(result.schedule.version).toBe(2);
    expect({ plan, schedule }).toEqual(before);
    const repeated = scheduleCalendarTask(
      result.plan,
      result.schedule,
      items.find((row) => row.itemId === "g")!,
      "2026-12-08",
      4,
      now,
      "edit-g"
    );
    expect(repeated.plan.proposal.flexibleOptions.filter((row) => row.itemId === "g")).toHaveLength(
      1
    );
    expect(repeated.schedule.dailyAllocations.filter((row) => row.itemId === "g")).toHaveLength(1);
  });
  it("keeps an unknown estimate unknown, but displays its chosen day", () => {
    const { plan, schedule, items } = fixture();
    const result = scheduleCalendarTask(
      plan,
      schedule,
      items.find((row) => row.itemId === "g")!,
      "2026-12-08",
      null,
      now,
      "add-g"
    );
    expect(result.schedule.dailyAllocations).toEqual(schedule.dailyAllocations);
    expect(
      result.plan.proposal.flexibleOptions.find((row) => row.itemId === "g")!.estimatedHours
    ).toBeNull();
    const model = buildTaskCalendar(
      result.plan,
      result.schedule,
      extractPlanItems(result.plan, result.schedule)
    );
    expect(model.days.find((row) => row.date === "2026-12-08")!.entries[0]!.task.itemId).toBe("g");
  });
  it("recovers a postponed task after intervening activity, preserving audit and other outcomes", () => {
    const { plan, schedule, items } = fixture();
    const postponed = applyItemActivity(plan, schedule, {
      type: "postpone",
      itemId: "d",
      actionId: "postpone-d",
      expectedVersion: 1,
      decidedAt: now,
      action: {
        type: "postpone_item",
        itemId: "d",
        currentCategory: "flexible_options",
        targetReason: "intentional_postponement",
        hoursFreed: null,
        rationale: "La próxima semana",
        targetWeek: { startDate: "2026-12-14", endDate: "2026-12-20" },
      },
    });
    if (postponed.status === "rejected") throw new Error(postponed.reason);
    const other = applyItemActivity(plan, postponed.schedule, {
      type: "complete",
      itemId: "c",
      actionId: "done-c",
      expectedVersion: 2,
      decidedAt: now,
    });
    if (other.status === "rejected") throw new Error(other.reason);
    const result = scheduleCalendarTask(
      plan,
      other.schedule,
      items.find((row) => row.itemId === "d")!,
      "2026-12-08",
      2,
      now,
      "resume-d"
    );
    expect(activePostponements(result.schedule).has("d")).toBe(false);
    expect(result.schedule.itemActivity!.outcomes.find((row) => row.itemId === "d")!.status).toBe(
      "not_started"
    );
    expect(result.schedule.itemActivity!.outcomes.find((row) => row.itemId === "c")!.status).toBe(
      "completed"
    );
    expect(result.schedule.itemActivity!.history.at(-1)!.command.type).toBe("resume");
    expect(WeeklyScheduleSchema.safeParse(result.schedule).success).toBe(true);
    expect(result.schedule.version).toBe(4);
  });
  it("rejects invalid hours, out-of-week days, closed tasks, capacity and shared estimate edits", () => {
    const { plan, schedule, items } = fixture();
    const g = items.find((row) => row.itemId === "g")!;
    for (const hours of [-1, 0, NaN, Infinity])
      expect(() =>
        scheduleCalendarTask(plan, schedule, g, "2026-12-08", hours, now, "add")
      ).toThrow();
    expect(() => scheduleCalendarTask(plan, schedule, g, "2026-12-15", 1, now, "add")).toThrow();
    schedule.dayConstraints = [{ day: "2026-12-08", availableHours: 1 }];
    expect(() => scheduleCalendarTask(plan, schedule, g, "2026-12-08", 2, now, "add")).toThrow(
      "disponibles"
    );
    expect(() =>
      scheduleCalendarTask(
        plan,
        schedule,
        items.find((row) => row.itemId === "a")!,
        "2026-12-08",
        2,
        now,
        "add"
      )
    ).toThrow("comparte");
    schedule.itemActivity = { outcomes: [{ itemId: "g", status: "completed" }], history: [] };
    expect(() => scheduleCalendarTask(plan, schedule, g, "2026-12-08", 1, now, "add")).toThrow(
      "cerrada"
    );
  });
});
