import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createActiveWeekFixture } from "./fixtures/active-week";
import { createReviewFixture } from "./fixtures/review-proposal";
import { calendarMovement } from "../src/web/calendar-movement";
import { monthCalendar, weekContaining } from "../src/web/month-calendar-model";
import { MonthTaskCalendar } from "../src/web/components/month-task-calendar";
import { moveItem } from "../src/domain/item-movement";

describe("Calendar movement and month projection", () => {
  it("keeps fixed hours on a simple block move and rejects a collision using existing domain rules", () => {
    const { plan, schedule } = createActiveWeekFixture();
    schedule.timeBlocks = [
      { itemId: "c", day: "2026-12-08", startTime: "09:00", endTime: "10:00" },
    ];
    const action = calendarMovement(schedule, "c", "2026-12-08", "2026-12-09")!;
    expect(action).toMatchObject({
      type: "reassign_time_block",
      proposedBlock: { day: "2026-12-09", startTime: "09:00", endTime: "10:00" },
    });
    const command = {
      type: "move" as const,
      itemId: "c",
      action,
      actionId: "calendar-move",
      expectedVersion: 1,
      decidedAt: "2026-12-08T10:00:00Z",
    };
    expect(moveItem(plan, schedule, command)).toHaveProperty("schedule");
    schedule.timeBlocks.push({
      itemId: "d",
      day: "2026-12-09",
      startTime: "09:00",
      endTime: "10:00",
    });
    expect(moveItem(plan, schedule, command)).toHaveProperty("reason");
  });
  it("moves the complete daily allocation without fabricating effort or ambiguously splitting blocks", () => {
    const { schedule } = createActiveWeekFixture();
    schedule.timeBlocks = [];
    expect(calendarMovement(schedule, "g", "2026-12-09", "2026-12-10")).toMatchObject({
      type: "reallocate_day_work",
      hoursToMove: 1,
    });
    expect(calendarMovement(schedule, "c", "2026-12-09", "2026-12-10")).toBeNull();
    expect(calendarMovement(schedule, "g", "2026-12-09", "2026-12-09")).toBeNull();
    schedule.timeBlocks.push({
      itemId: "g",
      day: "2026-12-09",
      startTime: "09:00",
      endTime: "10:00",
    });
    expect(calendarMovement(schedule, "g", "2026-12-09", "2026-12-10")).toBeNull();
  });
  it("finds Monday–Sunday weeks across month and year boundaries", () => {
    expect(weekContaining("2027-01-01")).toEqual({
      startDate: "2026-12-28",
      endDate: "2027-01-03",
    });
    expect(weekContaining("2026-11-30")).toEqual({
      startDate: "2026-11-30",
      endDate: "2026-12-06",
    });
  });
  it("shows active and future drafts, keeping undated work, deadlines and postponed notes distinct", () => {
    const { plan, schedule } = createActiveWeekFixture();
    plan.draftContext = { ...plan.draftContext, plannedDays: { c: "2026-12-08" } };
    const future = createReviewFixture().plan;
    future.planId = "future";
    future.targetWeek = { startDate: "2026-12-28", endDate: "2027-01-03" };
    future.proposal.weekSummary.targetWeek = future.targetWeek;
    future.draftContext = { ...future.draftContext, plannedDays: { d: "2027-01-02" } };
    const snapshot = structuredClone({ plan, schedule, future });
    const dec = monthCalendar("2026-12", [plan, future], schedule);
    expect(dec.entries.map((row) => row.itemId)).toEqual(["c"]);
    expect(dec.undated).toHaveLength(2);
    expect(dec.entries.some((row) => row.day === "2026-12-10")).toBe(false);
    expect(monthCalendar("2027-01", [plan, future], schedule).entries[0]?.itemId).toBe("d");
    expect({ plan, schedule, future }).toEqual(snapshot);
    expect(monthCalendar("2028-02", [], null).cells).toHaveLength(29);
  });
  it("exposes week opening and truthful statuses without activating a monthly plan", () => {
    const { plan, schedule } = createActiveWeekFixture();
    const html = renderToStaticMarkup(
      <MonthTaskCalendar
        initialMonth="2026-12"
        plans={[plan]}
        schedule={schedule}
        onOpenWeek={vi.fn()}
      />
    );
    expect(html).toContain("Semana activa");
    expect(html).toContain("sin día");
    expect(html).toContain("month-day-2026-12-31");
    expect(html).not.toContain("confirm-plan-button");
  });
});
