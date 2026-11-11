import type { WeeklySchedule } from "./schedule-types";
import { applyAdjustmentToSchedule, isAdjustmentSupersededBy } from "./schedule-adjustment-applier";
import type { StoredWeeklyPlan } from "./repositories/types";
import type { ItemActivityCommand, MovementAction, TemporalChange } from "./item-activity-types";

function rows(schedule: WeeklySchedule, action: MovementAction): TemporalChange["before"] {
  return {
    blocks: schedule.timeBlocks.flatMap((value, index) =>
      action.type === "reassign_time_block" &&
      value.itemId === action.itemId &&
      value.day === action.currentBlock.day &&
      value.startTime === action.currentBlock.startTime &&
      value.endTime === action.currentBlock.endTime
        ? [{ index, value }]
        : []
    ),
    allocations: schedule.dailyAllocations.flatMap((value, index) =>
      action.type === "reallocate_day_work" &&
      value.itemId === action.itemId &&
      (value.day === action.sourceDay || value.day === action.targetDay)
        ? [{ index, value }]
        : []
    ),
  };
}

export function moveItem(
  plan: StoredWeeklyPlan,
  schedule: WeeklySchedule,
  command: Extract<ItemActivityCommand, { type: "move" }>
) {
  if (command.action.itemId !== command.itemId) return { reason: "invalid_movement" } as const;
  if (schedule.appliedAdjustments.some((record) => record.adjustmentId === command.actionId))
    return { reason: "action_id_reused" } as const;
  const action = command.action;
  if (
    action.type === "reassign_time_block" &&
    JSON.stringify(action.currentBlock) === JSON.stringify(action.proposedBlock)
  )
    return { reason: "unchanged_assignment" } as const;
  const result = applyAdjustmentToSchedule(schedule, {
    action,
    activePlan: plan.proposal,
    adjustmentId: command.actionId,
    proposalId: `manual-${command.actionId}`,
    expectedScheduleVersion: command.expectedVersion,
    decidedAt: command.decidedAt,
    humanDecision: "accepted",
  });
  if (result.status !== "success") return { reason: result.errorCode } as const;
  const before = rows(schedule, action);
  // The block now has its proposed coordinates; daily scope still spans source and target.
  const after = rows(
    result.schedule,
    action.type === "reassign_time_block"
      ? { ...action, currentBlock: action.proposedBlock }
      : action
  );
  const temporalChange: TemporalChange = {
    adjustmentId: command.actionId,
    before,
    after,
    supersededIds: schedule.appliedAdjustments
      .filter(
        (record) =>
          record.lifecycleStatus === "active" &&
          result.schedule.appliedAdjustments.some(
            (next) =>
              next.adjustmentId === record.adjustmentId && next.lifecycleStatus === "superseded"
          )
      )
      .map((record) => record.adjustmentId),
  };
  return { schedule: result.schedule, temporalChange } as const;
}

function restoreRows<T>(
  current: T[],
  after: { index: number; value: T }[],
  before: { index: number; value: T }[]
): T[] | null {
  if (after.some((row) => JSON.stringify(current[row.index]) !== JSON.stringify(row.value)))
    return null;
  const removed = new Set(after.map((row) => row.index));
  const restored = current.filter((_, index) => !removed.has(index));
  for (const row of [...before].sort((a, b) => a.index - b.index)) {
    if (row.index > restored.length) return null;
    restored.splice(row.index, 0, row.value);
  }
  return restored;
}

export function undoItemMovement(
  plan: StoredWeeklyPlan,
  schedule: WeeklySchedule,
  original: Extract<ItemActivityCommand, { type: "move" }>,
  evidence: TemporalChange,
  command: Extract<ItemActivityCommand, { type: "undo" }>
) {
  const action = original.action;
  const inverse: MovementAction =
    action.type === "reassign_time_block"
      ? { ...action, currentBlock: action.proposedBlock, proposedBlock: action.currentBlock }
      : { ...action, sourceDay: action.targetDay, targetDay: action.sourceDay };
  // Reuse the same collision, duration and day-capacity checks before restoring the captured scope.
  const validation = applyAdjustmentToSchedule(schedule, {
    action: inverse,
    activePlan: plan.proposal,
    adjustmentId: command.actionId,
    proposalId: `undo-${original.actionId}`,
    expectedScheduleVersion: command.expectedVersion,
    decidedAt: command.decidedAt,
    humanDecision: "accepted",
  });
  if (validation.status !== "success") return { reason: validation.errorCode } as const;
  const blocks = restoreRows(schedule.timeBlocks, evidence.after.blocks, evidence.before.blocks);
  const allocations = restoreRows(
    schedule.dailyAllocations,
    evidence.after.allocations,
    evidence.before.allocations
  );
  const applied = schedule.appliedAdjustments.find(
    (record) => record.adjustmentId === evidence.adjustmentId
  );
  if (
    !blocks ||
    !allocations ||
    !applied ||
    applied.lifecycleStatus !== "active" ||
    applied.applicationOutcome !== "applied"
  )
    return { reason: "undo_not_available" } as const;
  if (
    evidence.supersededIds.some((id) => {
      const record = schedule.appliedAdjustments.find((record) => record.adjustmentId === id);
      return (
        !record ||
        record.lifecycleStatus !== "superseded" ||
        !isAdjustmentSupersededBy({ ...record, lifecycleStatus: "active" }, original.action)
      );
    })
  )
    return { reason: "invalid_movement_evidence" } as const;
  // Captured rows must produce the same domain transformation as the validated inverse.
  const canonical = (values: unknown[]) => values.map((value) => JSON.stringify(value)).sort();
  if (
    JSON.stringify(canonical(blocks)) !==
      JSON.stringify(canonical(validation.schedule.timeBlocks)) ||
    JSON.stringify(canonical(allocations)) !==
      JSON.stringify(canonical(validation.schedule.dailyAllocations))
  )
    return { reason: "invalid_movement_evidence" } as const;
  return {
    schedule: {
      ...schedule,
      timeBlocks: blocks,
      dailyAllocations: allocations,
      appliedAdjustments: schedule.appliedAdjustments.map((record) =>
        record.adjustmentId === evidence.adjustmentId
          ? { ...record, lifecycleStatus: "reverted" as const }
          : evidence.supersededIds.includes(record.adjustmentId) &&
              record.lifecycleStatus === "superseded"
            ? { ...record, lifecycleStatus: "active" as const }
            : record
      ),
    },
  } as const;
}
