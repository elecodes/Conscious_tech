import { describe, it, expect } from "vitest";
import { applyItemActivity } from "../src/domain/item-activity";
import type { ItemActivityCommand } from "../src/domain/item-activity-types";
import { createActiveWeekFixture } from "./fixtures/active-week";

function fixture() {
  const value = createActiveWeekFixture();
  value.schedule.timeBlocks = [
    { itemId: "a", day: "2026-12-08", startTime: "09:00", endTime: "10:00", note: "Original" },
    { itemId: "b", day: "2026-12-08", startTime: "11:00", endTime: "12:00" },
    { itemId: "a", day: "2026-12-10", startTime: "14:00", endTime: "15:00" },
  ];
  value.schedule.dailyAllocations = [
    { itemId: "a", day: "2026-12-08", allocatedHours: 2 },
    { itemId: "c", day: "2026-12-09", allocatedHours: 1 },
    { itemId: "a", day: "2026-12-10", allocatedHours: 1 },
  ];
  return value;
}
const base = {
  actionId: "move-a",
  itemId: "a",
  expectedVersion: 1,
  decidedAt: "2026-12-08T08:00:00Z",
};
function blockMove(): Extract<ItemActivityCommand, { type: "move" }> {
  const currentBlock = fixture().schedule.timeBlocks[0]!;
  return {
    ...base,
    type: "move",
    action: {
      type: "reassign_time_block",
      itemId: "a",
      currentBlock,
      proposedBlock: { ...currentBlock, day: "2026-12-09", startTime: "10:00", endTime: "11:00" },
      rationale: "Otro momento",
    },
  };
}
function dayMove(
  hoursToMove = 2,
  targetDay = "2026-12-10"
): Extract<ItemActivityCommand, { type: "move" }> {
  return {
    ...base,
    type: "move",
    action: {
      type: "reallocate_day_work",
      itemId: "a",
      sourceDay: "2026-12-08",
      targetDay,
      hoursToMove,
      rationale: "Otro día",
    },
  };
}
const undo: ItemActivityCommand = {
  type: "undo",
  itemId: "a",
  actionId: "undo-a",
  reversesActionId: "move-a",
  expectedVersion: 2,
  decidedAt: "2026-12-08T08:05:00Z",
};

describe("Individual reversible assignment movement", () => {
  it("moves only the selected block, preserving other blocks, daily hours, outcome and proposal", () => {
    const { plan, schedule } = fixture();
    const snapshot = structuredClone({ plan, schedule });
    const command = blockMove();
    const result = applyItemActivity(plan, schedule, command);
    if (result.status !== "success") throw new Error(JSON.stringify(result));
    expect(result.schedule.version).toBe(2);
    expect(result.schedule.timeBlocks[0]).toEqual(
      command.action.type === "reassign_time_block" ? command.action.proposedBlock : null
    );
    expect(result.schedule.timeBlocks.slice(1)).toEqual(schedule.timeBlocks.slice(1));
    expect(result.schedule.dailyAllocations).toEqual(schedule.dailyAllocations);
    expect(result.schedule.itemActivity?.outcomes).toEqual([]);
    expect({ plan, schedule }).toEqual(snapshot);
    const restored = applyItemActivity(plan, result.schedule, undo);
    if (restored.status !== "success") throw new Error(JSON.stringify(restored));
    expect(restored.schedule.timeBlocks).toEqual(schedule.timeBlocks);
    expect(restored.schedule.dailyAllocations).toEqual(schedule.dailyAllocations);
    expect(restored.schedule.appliedAdjustments[0]?.lifecycleStatus).toBe("reverted");
    expect(restored.schedule.appliedAdjustments[0]?.humanDecision).toBe("accepted");
  });
  it.each([
    [2, "2026-12-10"],
    [1, "2026-12-11"],
    [2, "2026-12-11"],
  ])("conserves and exactly restores %s hours moved to %s", (hours, target) => {
    const { plan, schedule } = fixture();
    const result = applyItemActivity(plan, schedule, dayMove(Number(hours), String(target)));
    if (result.status !== "success") throw new Error(JSON.stringify(result));
    expect(result.schedule.dailyAllocations.reduce((sum, row) => sum + row.allocatedHours, 0)).toBe(
      4
    );
    expect(result.schedule.timeBlocks).toEqual(schedule.timeBlocks);
    expect(result.schedule.dailyAllocations.find((row) => row.itemId === "c")).toEqual(
      schedule.dailyAllocations[1]
    );
    const restored = applyItemActivity(plan, result.schedule, undo);
    if (restored.status !== "success") throw new Error(JSON.stringify(restored));
    expect(restored.schedule.dailyAllocations).toEqual(schedule.dailyAllocations);
  });
  it("rejects collisions, duration changes, missing source and out-of-week targets without mutation", () => {
    const { plan, schedule } = fixture();
    const snapshot = structuredClone(schedule);
    const command = blockMove();
    if (command.action.type !== "reassign_time_block") return;
    const proposed = command.action.proposedBlock;
    for (const proposedBlock of [
      { ...proposed, day: "2026-12-08", startTime: "11:00", endTime: "12:00" },
      { ...proposed, endTime: "11:30" },
      { ...proposed, day: "2026-12-14" },
    ])
      expect(
        applyItemActivity(plan, schedule, {
          ...command,
          action: { ...command.action, proposedBlock },
        }).status
      ).toBe("rejected");
    expect(
      applyItemActivity(plan, schedule, {
        ...command,
        action: {
          ...command.action,
          currentBlock: { ...command.action.currentBlock, startTime: "08:00" },
        },
      }).status
    ).toBe("rejected");
    expect(schedule).toEqual(snapshot);
  });
  it("rejects excess hours, same day, capacity overload, wrong identity and no-op movement", () => {
    const { plan, schedule } = fixture();
    expect(applyItemActivity(plan, schedule, dayMove(3)).status).toBe("rejected");
    expect(applyItemActivity(plan, schedule, dayMove(1, "2026-12-08")).status).toBe("rejected");
    schedule.dayConstraints = [{ day: "2026-12-10", availableHours: 1 }];
    expect(applyItemActivity(plan, schedule, dayMove(1)).status).toBe("rejected");
    const command = blockMove();
    expect(applyItemActivity(plan, schedule, { ...command, itemId: "b" }).status).toBe("rejected");
    if (command.action.type === "reassign_time_block")
      expect(
        applyItemActivity(plan, schedule, {
          ...command,
          action: { ...command.action, proposedBlock: command.action.currentBlock },
        }).status
      ).toBe("rejected");
  });
  it("protects resolved work and stale reversals, and deduplicates a move retry", () => {
    const { plan, schedule } = fixture();
    schedule.itemActivity = { outcomes: [{ itemId: "a", status: "completed" }], history: [] };
    expect(applyItemActivity(plan, schedule, blockMove())).toEqual({
      status: "rejected",
      reason: "item_already_resolved",
    });
    delete schedule.itemActivity;
    const result = applyItemActivity(plan, schedule, blockMove());
    if (result.status !== "success") throw new Error("move failed");
    expect(applyItemActivity(plan, result.schedule, blockMove()).status).toBe("already_applied");
    expect(
      applyItemActivity(plan, { ...result.schedule, version: 3 }, { ...undo, expectedVersion: 3 })
    ).toEqual({ status: "rejected", reason: "undo_not_available" });
  });
  it("restores prior adjustment lifecycle when the latest move is undone", () => {
    const { plan, schedule } = fixture();
    const first = applyItemActivity(plan, schedule, blockMove());
    if (first.status !== "success") throw new Error("move failed");
    const original = blockMove();
    if (original.action.type !== "reassign_time_block") return;
    const secondCommand: ItemActivityCommand = {
      ...base,
      type: "move",
      actionId: "move-again",
      expectedVersion: 2,
      action: {
        ...original.action,
        currentBlock: original.action.proposedBlock,
        proposedBlock: { ...original.action.proposedBlock, day: "2026-12-11" },
      },
    };
    const second = applyItemActivity(plan, first.schedule, secondCommand);
    if (second.status !== "success") throw new Error(JSON.stringify(second));
    expect(second.schedule.appliedAdjustments[0]?.lifecycleStatus).toBe("superseded");
    const reverted = applyItemActivity(plan, second.schedule, {
      ...undo,
      actionId: "undo-second",
      expectedVersion: 3,
      reversesActionId: "move-again",
    });
    if (reverted.status !== "success") throw new Error(JSON.stringify(reverted));
    expect(reverted.schedule.timeBlocks).toEqual(first.schedule.timeBlocks);
    expect(reverted.schedule.appliedAdjustments.map((record) => record.lifecycleStatus)).toEqual([
      "active",
      "reverted",
    ]);
  });
  it("rejects tampered movement snapshots instead of restoring unproven rows", () => {
    const { plan, schedule } = fixture();
    const result = applyItemActivity(plan, schedule, blockMove());
    if (result.status !== "success") throw new Error("move failed");
    const corrupted = structuredClone(result.schedule);
    corrupted.itemActivity!.history[0]!.temporalChange!.before.blocks[0]!.value.startTime = "08:00";
    const snapshot = structuredClone(corrupted);
    expect(applyItemActivity(plan, corrupted, undo).status).toBe("rejected");
    expect(corrupted).toEqual(snapshot);
  });
});
