import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createActiveWeekFixture } from "./fixtures/active-week";
import { editDraftCalendarHours } from "../src/web/draft-calendar-edits";
import {
  distributionHours,
  moveDistributionPortion,
  replaceTaskDistribution,
  taskHoursBudget,
  validateDistribution,
  retainDraftAllocations,
} from "../src/web/task-distribution";
import { buildTaskCalendar } from "../src/web/task-calendar-model";
import { TaskDaySplitEditor } from "../src/web/components/task-day-split-editor";
import { WeeklyPlanDraftContextSchema } from "../src/domain/repositories/types";

function fixture() {
  const f = createActiveWeekFixture();
  const edited = editDraftCalendarHours(
    f.plan.proposal,
    f.plan.draftContext!.extractedItems!,
    "c",
    5
  );
  f.plan.proposal = edited.proposal;
  f.plan.draftContext!.extractedItems = edited.items;
  return f;
}
const parts = [
  { itemId: "c", day: "2026-12-07", allocatedHours: 2 },
  { itemId: "c", day: "2026-12-09", allocatedHours: 2 },
  { itemId: "c", day: "2026-12-11", allocatedHours: 1 },
];
describe("Hours distributed across a task's week", () => {
  it("replaces only the chosen task's rows, preserving estimates, other tasks and weekly workload", () => {
    const { plan, schedule } = fixture();
    const before = structuredClone({ plan, schedule });
    const next = replaceTaskDistribution(
      plan.proposal,
      plan.draftContext?.extractedItems,
      schedule.dailyAllocations,
      "c",
      parts
    );
    expect(next.filter((row) => row.itemId !== "c")).toEqual(schedule.dailyAllocations);
    expect(distributionHours(next.filter((row) => row.itemId === "c"))).toBe(5);
    expect({ plan, schedule }).toEqual(before);
    expect(plan.proposal.obligations[0]?.estimatedHours).toBe(5);
  });
  it("allows partial planning and rejects over-allocation, invalid dates and duplicate days", () => {
    const { plan } = fixture();
    const week = plan.targetWeek;
    expect(() => validateDistribution(week, "c", parts.slice(0, 1), 5)).not.toThrow();
    expect(() => validateDistribution(week, "c", [{ ...parts[0]!, allocatedHours: 6 }], 5)).toThrow(
      "total"
    );
    expect(() => validateDistribution(week, "c", [parts[0]!, parts[0]!], 5)).toThrow(
      "una sola vez"
    );
    for (const allocatedHours of [0, -1, NaN, Infinity])
      expect(() =>
        validateDistribution(week, "c", [{ ...parts[0]!, allocatedHours }], 5)
      ).toThrow();
    expect(() => validateDistribution(week, "c", [{ ...parts[0]!, day: "2026-12-14" }], 5)).toThrow(
      "dentro"
    );
    expect(() => validateDistribution(week, "c", parts, null)).toThrow("primero");
    expect(() =>
      validateDistribution(
        week,
        "c",
        [
          { ...parts[0]!, allocatedHours: 2.502 },
          { ...parts[1]!, allocatedHours: 2.502 },
        ],
        5
      )
    ).toThrow();
    const html = renderToStaticMarkup(
      <TaskDaySplitEditor
        id="c"
        title="Informe"
        week={week}
        totalHours={5}
        rows={parts.slice(0, 1)}
        onSave={vi.fn()}
      />
    );
    expect(html).toContain("3 h por repartir");
  });
  it("moves only a dragged portion, merging its destination without losing fractional hours", () => {
    const snapshot = structuredClone(parts);
    const next = moveDistributionPortion(parts, "c", "2026-12-07", "2026-12-09");
    expect(next).toEqual([
      { itemId: "c", day: "2026-12-11", allocatedHours: 1 },
      { itemId: "c", day: "2026-12-09", allocatedHours: 4 },
    ]);
    expect(distributionHours(next)).toBe(5);
    expect(distributionHours(moveDistributionPortion(parts, "c", "2026-12-07", null))).toBe(3);
    const fractions = [
      { ...parts[0]!, allocatedHours: 0.332 },
      { ...parts[1]!, allocatedHours: 0.332 },
    ];
    expect(
      distributionHours(moveDistributionPortion(fractions, "c", parts[0]!.day, parts[1]!.day))
    ).toBe(0.664);
    expect(parts).toEqual(snapshot);
  });
  it("keeps shared focus estimates intact and respects explicit daily capacity and fixed blocks", () => {
    const { plan, schedule } = fixture();
    expect(taskHoursBudget(plan.proposal, plan.draftContext?.extractedItems, "a")).toBe(2);
    expect(taskHoursBudget(plan.proposal, undefined, "a")).toBeNull();
    expect(() =>
      replaceTaskDistribution(plan.proposal, plan.draftContext?.extractedItems, [], "a", [
        { ...parts[0]!, itemId: "a", allocatedHours: 3 },
      ])
    ).toThrow();
    schedule.dailyAllocations = [{ itemId: "d", day: "2026-12-07", allocatedHours: 2 }];
    schedule.timeBlocks = [];
    schedule.dayConstraints = [{ day: "2026-12-07", availableHours: 3 }];
    expect(() =>
      replaceTaskDistribution(
        plan.proposal,
        plan.draftContext?.extractedItems,
        schedule.dailyAllocations,
        "c",
        parts,
        schedule
      )
    ).toThrow("disponibles");
    schedule.timeBlocks = [
      { itemId: "c", day: "2026-12-08", startTime: "09:00", endTime: "10:00" },
    ];
    expect(() =>
      replaceTaskDistribution(
        plan.proposal,
        plan.draftContext?.extractedItems,
        [],
        "c",
        parts,
        schedule
      )
    ).toThrow("horarios fijos");
  });
  it("preserves old context compatibility and drops reused source IDs from a different capture", () => {
    const { plan } = fixture();
    const items = plan.draftContext!.extractedItems!;
    expect(WeeklyPlanDraftContextSchema.safeParse({}).success).toBe(true);
    expect(WeeklyPlanDraftContextSchema.safeParse({ plannedAllocations: parts }).success).toBe(
      true
    );
    expect(retainDraftAllocations(items, items, parts)).toEqual(parts);
    expect(
      retainDraftAllocations(
        items,
        items.map((item) => (item.id === "c" ? { ...item, rawText: "Otra nota" } : item)),
        parts
      )
    ).toEqual([]);
  });
  it("projects every assigned day without multiplying the pending count or using deadlines", () => {
    const { plan, items } = fixture();
    const draft = { ...plan, status: "draft" as const };
    draft.draftContext!.plannedAllocations = parts;
    const model = buildTaskCalendar(draft, null, items);
    expect(
      model.days.flatMap((day) =>
        day.entries
          .filter((entry) => entry.task.itemId === "c")
          .map((entry) => [day.date, entry.hours])
      )
    ).toEqual(parts.map((row) => [row.day, row.allocatedHours]));
    expect(model.pending).toBe(3);
    expect(model.undated.some((item) => item.itemId === "c")).toBe(false);
  });
});
