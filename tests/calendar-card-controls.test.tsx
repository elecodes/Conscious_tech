import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createActiveWeekFixture } from "./fixtures/active-week";
import { calendarMovement } from "../src/web/calendar-movement";
import { applyItemActivity } from "../src/domain/item-activity";
import { calendarTaskStatus } from "../src/web/calendar-task-status";
import type { CalendarTask } from "../src/web/task-calendar-model";
import { ActiveTaskCalendar } from "../src/web/components/active-task-calendar";

function fixture() {
  const f = createActiveWeekFixture();
  f.schedule.timeBlocks = [];
  f.schedule.dailyAllocations = [
    { itemId: "a", day: "2026-12-08", allocatedHours: 2 },
    { itemId: "b", day: "2026-12-08", allocatedHours: 3 },
  ];
  f.plan.draftContext = { ...f.plan.draftContext, plannedDays: { c: "2026-12-09" } };
  return f;
}

describe("Individual task card controls", () => {
  it("keeps all task menus present during saving and disables only their actions", () => {
    const { plan, schedule, items } = fixture();
    const render = (busy: boolean) =>
      renderToStaticMarkup(
        <ActiveTaskCalendar
          plan={plan}
          schedule={schedule}
          items={items}
          onInspect={vi.fn()}
          onMove={vi.fn()}
          busy={busy}
        />
      );
    const idle = render(false),
      saving = render(true);
    for (const html of [idle, saving]) {
      expect(html).toContain('data-testid="calendar-actions-a-2026-12-08"');
      expect(html).toContain('data-testid="calendar-actions-b-2026-12-08"');
      expect(html).toContain('data-testid="calendar-actions-c-2026-12-09"');
      expect(html).toContain('data-testid="calendar-actions-d-undated"');
      expect(html).toContain("Cambiar día de Investigar el proyecto");
      expect(html).toContain("Solo esta tarea:");
      expect(html).not.toContain('class="calendar-move-select"');
    }
    expect(saving).toMatch(/<select[^>]*disabled=""/);
    expect(idle).not.toMatch(/<select[^>]*disabled=""/);
    expect(saving.match(/class="calendar-task-actions"/g)?.length).toBe(
      idle.match(/class="calendar-task-actions"/g)?.length
    );
  });
  it("moves only one of two same-day tasks sharing a focus and undo restores it exactly", () => {
    const { plan, schedule } = fixture();
    const snapshot = structuredClone({ plan, schedule });
    const action = calendarMovement(schedule, "a", "2026-12-08", "2026-12-09")!;
    const command = {
      type: "move" as const,
      itemId: "a",
      action,
      actionId: "move-selected-a",
      expectedVersion: 1,
      decidedAt: "2026-12-08T08:00:00Z",
    };
    const result = applyItemActivity(plan, schedule, command);
    if (result.status !== "success") throw new Error(JSON.stringify(result));
    expect(result.schedule.dailyAllocations.find((row) => row.itemId === "a")).toEqual({
      itemId: "a",
      day: "2026-12-09",
      allocatedHours: 2,
    });
    expect(result.schedule.dailyAllocations.find((row) => row.itemId === "b")).toEqual(
      schedule.dailyAllocations[1]
    );
    expect(result.schedule.timeBlocks).toEqual(schedule.timeBlocks);
    expect({ plan, schedule }).toEqual(snapshot);
    const undo = applyItemActivity(plan, result.schedule, {
      type: "undo",
      itemId: "a",
      actionId: "undo-selected-a",
      expectedVersion: 2,
      decidedAt: "2026-12-08T08:05:00Z",
      reversesActionId: command.actionId,
    });
    if (undo.status !== "success") throw new Error(JSON.stringify(undo));
    expect(undo.schedule.dailyAllocations).toEqual(schedule.dailyAllocations);
  });
  it("separates scheduling colour from unfinished progress and always includes text and symbols", () => {
    const task: CalendarTask = {
      itemId: "a",
      title: "Tarea",
      source: "Foco",
      kind: "priority",
      state: "pending",
    };
    expect(calendarTaskStatus(task, false)).toEqual({
      tone: "undated",
      symbol: "○",
      label: "Sin día",
    });
    expect(calendarTaskStatus(task, true)).toEqual({
      tone: "scheduled",
      symbol: "◷",
      label: "Programada",
    });
    expect(calendarTaskStatus({ ...task, state: "completed" }, true)).toMatchObject({
      tone: "completed",
      symbol: "✓",
    });
    expect(calendarTaskStatus({ ...task, kind: "postponed" }, true)).toMatchObject({
      tone: "postponed",
      symbol: "↷",
    });
    expect(calendarTaskStatus({ ...task, kind: "note" }, false).label).toBe("Nota");
    const { plan, schedule, items } = fixture();
    const html = renderToStaticMarkup(
      <ActiveTaskCalendar plan={plan} schedule={schedule} items={items} onInspect={vi.fn()} />
    );
    expect(html).toContain("Colores y símbolos del calendario");
    expect(html).toContain("calendar-tone-scheduled");
    expect(html).toContain("calendar-tone-undated");
  });
});
