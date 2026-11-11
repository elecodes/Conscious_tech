import { describe, expect, it } from "vitest";
import { applyItemActivity } from "../src/domain/item-activity";
import { ItemActivityCommand } from "../src/domain/item-activity-types";
import { WeeklySchedule, WeeklyScheduleSchema } from "../src/domain/schedule";
import { createActiveWeekFixture } from "./fixtures/active-week";

const command: ItemActivityCommand = {
  type: "complete",
  itemId: "a",
  actionId: "complete-a",
  expectedVersion: 1,
  decidedAt: "2026-12-08T10:00:00Z",
};
function completed() {
  const { plan, schedule } = createActiveWeekFixture();
  const result = applyItemActivity(plan, schedule, command);
  if (result.status !== "success") throw new Error(JSON.stringify(result));
  return { plan, schedule: result.schedule };
}
const undo: ItemActivityCommand = {
  type: "undo",
  itemId: "a",
  actionId: "undo-a",
  reversesActionId: "complete-a",
  expectedVersion: 2,
  decidedAt: "2026-12-08T11:00:00Z",
};

describe("Daily activity foundation", () => {
  it("records one group member without changing proposal, hours, allocations or the original", () => {
    const { plan, schedule } = createActiveWeekFixture();
    const snapshot = structuredClone({ plan, schedule });
    const result = applyItemActivity(plan, schedule, command);
    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.schedule.version).toBe(2);
    expect(result.schedule.itemActivity?.outcomes).toEqual([{ itemId: "a", status: "completed" }]);
    expect(result.schedule.timeBlocks).toEqual(schedule.timeBlocks);
    expect(result.schedule.dailyAllocations).toEqual(schedule.dailyAllocations);
    expect({ plan, schedule }).toEqual(snapshot);
  });
  it("restores absence instead of inventing not_started, retaining history", () => {
    const { plan, schedule } = completed();
    const result = applyItemActivity(plan, schedule, undo);
    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.schedule.itemActivity?.outcomes).toEqual([]);
    expect(result.schedule.itemActivity?.history).toHaveLength(2);
    expect(result.schedule.version).toBe(3);
    expect(schedule.itemActivity?.outcomes).toHaveLength(1);
  });
  it("restores an existing result including notes and actual hours", () => {
    const { plan, schedule } = createActiveWeekFixture();
    const before = {
      itemId: "a",
      status: "in_progress" as const,
      actualHours: 0.5,
      userNotes: "Primera parte",
    };
    schedule.itemActivity = { outcomes: [before], history: [] };
    const result = applyItemActivity(plan, schedule, command);
    if (result.status !== "success") throw new Error("completion failed");
    const reverted = applyItemActivity(plan, result.schedule, undo);
    if (reverted.status !== "success") throw new Error("undo failed");
    expect(reverted.schedule.itemActivity?.outcomes).toEqual([before]);
  });
  it("retries the same action once, and rejects reused identifiers with another command", () => {
    const { plan, schedule } = completed();
    expect(applyItemActivity(plan, schedule, command).status).toBe("already_applied");
    expect(applyItemActivity(plan, schedule, { ...command, itemId: "b" })).toEqual({
      status: "rejected",
      reason: "action_id_reused",
    });
    expect(
      applyItemActivity(plan, schedule, { ...command, actionId: "another", expectedVersion: 2 })
    ).toEqual({ status: "rejected", reason: "already_completed" });
  });
  it.each(["closed", "draft"] as const)("rejects a %s week", (status) => {
    const { plan, schedule } = createActiveWeekFixture();
    expect(applyItemActivity({ ...plan, status }, schedule, command)).toEqual({
      status: "rejected",
      reason: "week_not_active",
    });
  });
  it("rejects stale versions, nonmembers and mismatched plans", () => {
    const { plan, schedule } = createActiveWeekFixture();
    expect(applyItemActivity(plan, schedule, { ...command, expectedVersion: 2 })).toEqual({
      status: "rejected",
      reason: "stale_version",
    });
    expect(applyItemActivity(plan, schedule, { ...command, itemId: "missing" })).toEqual({
      status: "rejected",
      reason: "item_not_found",
    });
    expect(applyItemActivity(plan, { ...schedule, planId: "other" }, command)).toEqual({
      status: "rejected",
      reason: "inconsistent_references",
    });
  });
  it("refuses undo after any later schedule change or for another item", () => {
    const { plan, schedule } = completed();
    expect(
      applyItemActivity(plan, { ...schedule, version: 3 }, { ...undo, expectedVersion: 3 })
    ).toEqual({ status: "rejected", reason: "undo_not_available" });
    expect(applyItemActivity(plan, schedule, { ...undo, itemId: "b" })).toEqual({
      status: "rejected",
      reason: "undo_not_available",
    });
  });
  it("rejects completion under a live postponement", () => {
    const { plan, schedule } = createActiveWeekFixture();
    schedule.appliedAdjustments = [
      {
        adjustmentId: "postpone-a",
        proposalId: "manual",
        action: {
          type: "postpone_item",
          itemId: "a",
          currentCategory: "foci",
          targetReason: "intentional_postponement",
          hoursFreed: null,
          rationale: "Otra semana",
        },
        expectedScheduleVersion: 1,
        decidedAt: command.decidedAt,
        humanDecision: "accepted",
        applicationOutcome: "applied",
        appliedAt: command.decidedAt,
        lifecycleStatus: "active",
      },
    ];
    expect(applyItemActivity(plan, schedule, command)).toEqual({
      status: "rejected",
      reason: "active_postponement",
    });
  });
  it("validates old schedules and rejects corrupted activity and unknown command fields", () => {
    const { plan, schedule } = createActiveWeekFixture();
    expect(WeeklyScheduleSchema.parse(schedule).itemActivity).toBeUndefined();
    const active = completed().schedule;
    const malformed = structuredClone(active);
    malformed.itemActivity!.outcomes = [];
    expect(WeeklyScheduleSchema.safeParse(malformed).success).toBe(false);
    expect(WeeklyScheduleSchema.safeParse({ ...active, version: 1 }).success).toBe(false);
    expect(
      applyItemActivity(plan, schedule, { ...command, extra: true } as ItemActivityCommand).status
    ).toBe("rejected");
    const duplicate: WeeklySchedule = {
      ...active,
      itemActivity: {
        outcomes: [...active.itemActivity!.outcomes, ...active.itemActivity!.outcomes],
        history: active.itemActivity!.history,
      },
    };
    expect(WeeklyScheduleSchema.safeParse(duplicate).success).toBe(false);
  });
});
