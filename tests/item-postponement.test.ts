import { describe, it, expect } from "vitest";
import { applyItemActivity } from "../src/domain/item-activity";
import type { ItemActivityCommand } from "../src/domain/item-activity-types";
import { createActiveWeekFixture } from "./fixtures/active-week";
import { partitionActiveWeekItems } from "../src/web/active-week-items";

function fixture() {
  const fixture = createActiveWeekFixture();
  fixture.schedule.timeBlocks.push(
    { itemId: "a", day: "2026-12-08", startTime: "10:00", endTime: "11:00" },
    { itemId: "a", day: "2026-12-10", startTime: "10:00", endTime: "11:00" }
  );
  fixture.schedule.dailyAllocations.push(
    { itemId: "a", day: "2026-12-08", allocatedHours: 2 },
    { itemId: "a", day: "2026-12-10", allocatedHours: 1 }
  );
  return fixture;
}
const command: Extract<ItemActivityCommand, { type: "postpone" }> = {
  type: "postpone",
  itemId: "a",
  actionId: "postpone-a",
  expectedVersion: 1,
  decidedAt: "2026-12-08T08:00:00Z",
  action: {
    type: "postpone_item",
    itemId: "a",
    currentCategory: "foci",
    targetReason: "intentional_postponement",
    hoursFreed: null,
    rationale: "Esperar la respuesta",
    targetWeek: { startDate: "2026-12-14", endDate: "2026-12-20" },
  },
};
const undo: ItemActivityCommand = {
  type: "undo",
  itemId: "a",
  actionId: "undo-a",
  reversesActionId: "postpone-a",
  expectedVersion: 2,
  decidedAt: "2026-12-08T09:00:00Z",
};

describe("Reversible conscious postponement", () => {
  it("removes only this member's assignments, preserves proposal and records reason/destination", () => {
    const { plan, schedule, items } = fixture();
    const snapshot = structuredClone({ plan, schedule });
    const result = applyItemActivity(plan, schedule, command);
    if (result.status !== "success") throw new Error(JSON.stringify(result));
    expect(result.schedule.timeBlocks).toEqual(
      schedule.timeBlocks.filter((row) => row.itemId !== "a")
    );
    expect(result.schedule.dailyAllocations).toEqual(
      schedule.dailyAllocations.filter((row) => row.itemId !== "a")
    );
    expect(result.schedule.itemActivity?.outcomes).toEqual([
      { itemId: "a", status: "consciously_postponed", postponementReason: "Esperar la respuesta" },
    ]);
    expect(result.schedule.appliedAdjustments[0]?.action).toEqual(command.action);
    expect({ plan, schedule }).toEqual(snapshot);
    const groups = partitionActiveWeekItems(plan, result.schedule, items);
    expect(groups.postponed.map((item) => item.itemId)).toEqual(["a"]);
    expect(groups.focuses[0]?.items.map((item) => item.itemId)).toEqual(["b"]);
    expect(groups.focuses[0]?.postponedCount).toBe(1);
  });
  it("restores exact assignments and an existing outcome without altering another member", () => {
    const { plan, schedule } = fixture();
    schedule.itemActivity = {
      outcomes: [
        { itemId: "a", status: "in_progress", actualHours: 0.5, userNotes: "Primera parte" },
      ],
      history: [],
    };
    const result = applyItemActivity(plan, schedule, command);
    if (result.status !== "success") throw new Error("postpone failed");
    const restored = applyItemActivity(plan, result.schedule, undo);
    if (restored.status !== "success") throw new Error(JSON.stringify(restored));
    expect(restored.schedule.timeBlocks).toEqual(schedule.timeBlocks);
    expect(restored.schedule.dailyAllocations).toEqual(schedule.dailyAllocations);
    expect(restored.schedule.itemActivity?.outcomes).toEqual(schedule.itemActivity.outcomes);
    expect(restored.schedule.appliedAdjustments[0]?.lifecycleStatus).toBe("reverted");
  });
  it("postpones an unallocated item without inventing hours or a destination", () => {
    const { plan, schedule } = fixture();
    const action = { ...command.action, itemId: "c", currentCategory: "obligations" as const };
    delete action.targetWeek;
    const result = applyItemActivity(plan, schedule, { ...command, itemId: "c", action });
    if (result.status !== "success") throw new Error(JSON.stringify(result));
    expect(result.schedule.timeBlocks).toEqual(schedule.timeBlocks);
    expect(result.schedule.dailyAllocations).toEqual(schedule.dailyAllocations);
    const restored = applyItemActivity(plan, result.schedule, { ...undo, itemId: "c" });
    if (restored.status !== "success") throw new Error(JSON.stringify(restored));
    expect(restored.schedule.itemActivity?.outcomes).toEqual([]);
  });
  it("blocks completion and another postponement until the current one is undone", () => {
    const { plan, schedule } = fixture();
    const result = applyItemActivity(plan, schedule, command);
    if (result.status !== "success") throw new Error("failed");
    expect(applyItemActivity(plan, result.schedule, command).status).toBe("already_applied");
    expect(
      applyItemActivity(plan, result.schedule, {
        ...command,
        actionId: "again",
        expectedVersion: 2,
      })
    ).toEqual({ status: "rejected", reason: "active_postponement" });
    const complete: ItemActivityCommand = {
      type: "complete",
      itemId: "a",
      actionId: "complete-a",
      expectedVersion: 2,
      decidedAt: undo.decidedAt,
    };
    expect(applyItemActivity(plan, result.schedule, complete)).toEqual({
      status: "rejected",
      reason: "active_postponement",
    });
    const restored = applyItemActivity(plan, result.schedule, undo);
    if (restored.status !== "success") throw new Error("failed");
    expect(
      applyItemActivity(plan, restored.schedule, { ...complete, expectedVersion: 3 }).status
    ).toBe("success");
  });
  it("rejects empty reasons, nonfuture destinations, wrong categories and resolved items", () => {
    const { plan, schedule } = fixture();
    for (const action of [
      { ...command.action, rationale: "  " },
      { ...command.action, targetWeek: { startDate: "2026-12-13", endDate: "2026-12-20" } },
      { ...command.action, currentCategory: "obligations" as const },
      { ...command.action, hoursFreed: 4 },
    ])
      expect(applyItemActivity(plan, schedule, { ...command, action }).status).toBe("rejected");
    for (const status of ["completed", "dropped"] as const) {
      schedule.itemActivity = { outcomes: [{ itemId: "a", status }], history: [] };
      expect(applyItemActivity(plan, schedule, command).status).toBe("rejected");
    }
  });
  it("refuses stale undo and unsafe restoration instead of overwriting later work", () => {
    const { plan, schedule } = fixture();
    const result = applyItemActivity(plan, schedule, command);
    if (result.status !== "success") throw new Error("failed");
    expect(
      applyItemActivity(plan, { ...result.schedule, version: 3 }, { ...undo, expectedVersion: 3 })
    ).toEqual({ status: "rejected", reason: "undo_not_available" });
    const conflicting = structuredClone(result.schedule);
    conflicting.timeBlocks.push({
      itemId: "b",
      day: "2026-12-08",
      startTime: "10:00",
      endTime: "11:00",
    });
    expect(applyItemActivity(plan, conflicting, undo)).toEqual({
      status: "rejected",
      reason: "restoration_conflict",
    });
  });
  it("hides a focus only when all its individual members have been postponed", () => {
    const { plan, schedule, items } = fixture();
    const first = applyItemActivity(plan, schedule, command);
    if (first.status !== "success") throw new Error("failed");
    const second = applyItemActivity(plan, first.schedule, {
      ...command,
      itemId: "b",
      actionId: "postpone-b",
      expectedVersion: 2,
      action: { ...command.action, itemId: "b" },
    });
    if (second.status !== "success") throw new Error(JSON.stringify(second));
    const groups = partitionActiveWeekItems(plan, second.schedule, items);
    expect(groups.focuses).toEqual([]);
    expect(groups.postponed.map((item) => item.itemId)).toEqual(["a", "b"]);
    expect(plan.proposal.foci[0]?.contributingItemIds).toEqual(["a", "b"]);
  });
  it("restores the superseded movement and its exact current assignments", () => {
    const { plan, schedule } = fixture();
    const block = schedule.timeBlocks[1]!;
    const moved = applyItemActivity(plan, schedule, {
      type: "move",
      itemId: "a",
      actionId: "move-a",
      expectedVersion: 1,
      decidedAt: command.decidedAt,
      action: {
        type: "reassign_time_block",
        itemId: "a",
        currentBlock: block,
        proposedBlock: { ...block, day: "2026-12-09" },
        rationale: "Otro día",
      },
    });
    if (moved.status !== "success") throw new Error(JSON.stringify(moved));
    const postponed = applyItemActivity(plan, moved.schedule, { ...command, expectedVersion: 2 });
    if (postponed.status !== "success") throw new Error(JSON.stringify(postponed));
    const restored = applyItemActivity(plan, postponed.schedule, { ...undo, expectedVersion: 3 });
    if (restored.status !== "success") throw new Error(JSON.stringify(restored));
    expect(restored.schedule.timeBlocks).toEqual(moved.schedule.timeBlocks);
    expect(restored.schedule.appliedAdjustments.map((record) => record.lifecycleStatus)).toEqual([
      "active",
      "reverted",
    ]);
  });
});
