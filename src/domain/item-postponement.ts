import type { WeeklySchedule } from "./schedule-types";
import { validateWeeklyScheduleInvariants } from "./schedule-invariants";
import { applyAdjustmentToSchedule, isAdjustmentSupersededBy } from "./schedule-adjustment-applier";
import type { StoredWeeklyPlan } from "./repositories/types";
import type { ItemActivityCommand, TemporalChange } from "./item-activity-types";
import { restoreRows } from "./item-movement";

export function activePostponements(schedule: WeeklySchedule) {
  const records = schedule.appliedAdjustments.filter(
    (record) =>
      record.action.type === "postpone_item" &&
      record.humanDecision === "accepted" &&
      record.applicationOutcome === "applied" &&
      record.lifecycleStatus === "active"
  );
  return new Map(
    records.flatMap((record) =>
      record.action.type === "postpone_item" ? [[record.action.itemId, record.action] as const] : []
    )
  );
}

export function postponeItem(
  plan: StoredWeeklyPlan,
  schedule: WeeklySchedule,
  command: Extract<ItemActivityCommand, { type: "postpone" }>
) {
  const action = command.action;
  const category = plan.proposal.obligations.some((item) => item.itemId === command.itemId)
    ? "obligations"
    : plan.proposal.foci.some((focus) => focus.contributingItemIds.includes(command.itemId))
      ? "foci"
      : plan.proposal.flexibleOptions.some((item) => item.itemId === command.itemId)
        ? "flexible_options"
        : plan.proposal.deferredItems.some((item) => item.itemId === command.itemId)
          ? "deferred_items"
          : undefined;
  if (
    !category ||
    action.currentCategory !== category ||
    action.itemId !== command.itemId ||
    action.targetReason !== "intentional_postponement" ||
    action.hoursFreed !== null
  )
    return { reason: "invalid_postponement" } as const;
  if (action.targetWeek && action.targetWeek.startDate <= schedule.weekRange.endDate)
    return { reason: "target_week_not_future" } as const;
  if (schedule.appliedAdjustments.some((record) => record.adjustmentId === command.actionId))
    return { reason: "action_id_reused" } as const;
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
  const temporalChange: TemporalChange = {
    adjustmentId: command.actionId,
    before: {
      blocks: schedule.timeBlocks.flatMap((value, index) =>
        value.itemId === command.itemId ? [{ index, value }] : []
      ),
      allocations: schedule.dailyAllocations.flatMap((value, index) =>
        value.itemId === command.itemId ? [{ index, value }] : []
      ),
    },
    after: { blocks: [], allocations: [] },
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

export function undoItemPostponement(
  schedule: WeeklySchedule,
  original: Extract<ItemActivityCommand, { type: "postpone" }>,
  evidence: TemporalChange
) {
  const applied = schedule.appliedAdjustments.find(
    (record) => record.adjustmentId === evidence.adjustmentId
  );
  if (
    !applied ||
    applied.lifecycleStatus !== "active" ||
    applied.applicationOutcome !== "applied" ||
    JSON.stringify(applied.action) !== JSON.stringify(original.action) ||
    schedule.timeBlocks.some((row) => row.itemId === original.itemId) ||
    schedule.dailyAllocations.some((row) => row.itemId === original.itemId)
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
    return { reason: "invalid_postponement_evidence" } as const;
  const blocks = restoreRows(schedule.timeBlocks, [], evidence.before.blocks);
  const allocations = restoreRows(schedule.dailyAllocations, [], evidence.before.allocations);
  if (!blocks || !allocations) return { reason: "invalid_postponement_evidence" } as const;
  const restored: WeeklySchedule = {
    ...schedule,
    timeBlocks: blocks,
    dailyAllocations: allocations,
    appliedAdjustments: schedule.appliedAdjustments.map((record) =>
      record.adjustmentId === evidence.adjustmentId
        ? { ...record, lifecycleStatus: "reverted" }
        : evidence.supersededIds.includes(record.adjustmentId)
          ? { ...record, lifecycleStatus: "active" }
          : record
    ),
  };
  if (!validateWeeklyScheduleInvariants(restored).valid)
    return { reason: "restoration_conflict" } as const;
  return { schedule: restored } as const;
}
