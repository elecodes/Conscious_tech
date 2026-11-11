import { postponeItem, undoItemPostponement } from "./item-postponement";
import { moveItem, undoItemMovement } from "./item-movement";
import type { TemporalChange } from "./item-activity-types";
import { ItemActivityCommand, ItemActivityCommandSchema } from "./item-activity-types";
import { WeeklySchedule, WeeklyScheduleSchema, validateWeeklyScheduleInvariants } from "./schedule";
import { StoredWeeklyPlan, StoredWeeklyPlanSchema } from "./repositories/types";

export type ItemActivityResult =
  | { status: "success" | "already_applied"; schedule: WeeklySchedule }
  | { status: "rejected"; reason: string };

/** Pure daily activity. Persistence must check plan and schedule inside one transaction. */
export function applyItemActivity(
  plan: StoredWeeklyPlan,
  schedule: WeeklySchedule,
  input: ItemActivityCommand
): ItemActivityResult {
  const commandResult = ItemActivityCommandSchema.safeParse(input);
  const planResult = StoredWeeklyPlanSchema.safeParse(plan);
  const scheduleResult = WeeklyScheduleSchema.safeParse(schedule);
  if (!commandResult.success || !planResult.success || !scheduleResult.success)
    return { status: "rejected", reason: "invalid_data" };
  plan = planResult.data;
  schedule = scheduleResult.data;
  const command = commandResult.data;
  if (plan.status !== "active") return { status: "rejected", reason: "week_not_active" };
  if (
    schedule.planId !== plan.planId ||
    schedule.weekRange.startDate !== plan.targetWeek.startDate ||
    schedule.weekRange.endDate !== plan.targetWeek.endDate
  )
    return { status: "rejected", reason: "inconsistent_references" };
  const inventory = new Set([
    ...plan.proposal.obligations.map((item) => item.itemId),
    ...plan.proposal.flexibleOptions.map((item) => item.itemId),
    ...plan.proposal.deferredItems.map((item) => item.itemId),
    ...plan.proposal.foci.flatMap((focus) => focus.contributingItemIds),
    ...schedule.dailyAllocations.map((item) => item.itemId),
    ...schedule.timeBlocks.map((item) => item.itemId),
  ]);
  if (!inventory.has(command.itemId)) return { status: "rejected", reason: "item_not_found" };
  const activity = schedule.itemActivity ?? { outcomes: [], history: [] };
  const duplicate = activity.history.find((record) => record.command.actionId === command.actionId);
  if (duplicate) {
    return JSON.stringify(duplicate.command) === JSON.stringify(command)
      ? { status: "already_applied", schedule }
      : { status: "rejected", reason: "action_id_reused" };
  }
  if (command.expectedVersion !== schedule.version)
    return { status: "rejected", reason: "stale_version" };
  if (
    (command.type === "complete" || command.type === "move" || command.type === "postpone") &&
    schedule.appliedAdjustments.some(
      (record) =>
        record.action.type === "postpone_item" &&
        record.action.itemId === command.itemId &&
        record.humanDecision === "accepted" &&
        record.applicationOutcome === "applied" &&
        record.lifecycleStatus === "active"
    )
  )
    return { status: "rejected", reason: "active_postponement" };
  const before = activity.outcomes.find((outcome) => outcome.itemId === command.itemId) ?? null;
  let after = before;
  let temporalChange: TemporalChange | undefined;
  let temporalSchedule = schedule;
  if (command.type === "complete") {
    if (before?.status === "completed") return { status: "rejected", reason: "already_completed" };
    after = { ...before, itemId: command.itemId, status: "completed" };
    // A completed result must not retain a contradictory postponement reason.
    delete after.postponementReason;
  } else if (command.type === "move") {
    if (before?.status === "completed" || before?.status === "dropped")
      return { status: "rejected", reason: "item_already_resolved" };
    const movement = moveItem(plan, schedule, command);
    if (!movement.schedule)
      return { status: "rejected", reason: movement.reason ?? "invalid_movement" };
    temporalSchedule = movement.schedule;
    temporalChange = movement.temporalChange;
  } else if (command.type === "postpone") {
    if (before?.status === "completed" || before?.status === "dropped")
      return { status: "rejected", reason: "item_already_resolved" };
    const postponed = postponeItem(plan, schedule, command);
    if (!postponed.schedule)
      return { status: "rejected", reason: postponed.reason ?? "invalid_postponement" };
    temporalSchedule = postponed.schedule;
    temporalChange = postponed.temporalChange;
    after = {
      ...before,
      itemId: command.itemId,
      status: "consciously_postponed",
      postponementReason: command.action.rationale,
    };
  } else {
    const original = activity.history.find(
      (record) => record.command.actionId === command.reversesActionId
    );
    if (
      !original ||
      original.command.type === "undo" ||
      original.command.itemId !== command.itemId ||
      original.appliedVersion !== schedule.version ||
      JSON.stringify(before) !== JSON.stringify(original.after)
    )
      return { status: "rejected", reason: "undo_not_available" };
    if (original.command.type === "move") {
      if (!original.temporalChange) return { status: "rejected", reason: "undo_not_available" };
      const reverted = undoItemMovement(
        plan,
        schedule,
        original.command,
        original.temporalChange,
        command
      );
      if (!reverted.schedule)
        return { status: "rejected", reason: reverted.reason ?? "undo_not_available" };
      temporalSchedule = reverted.schedule;
    }
    if (original.command.type === "postpone") {
      if (!original.temporalChange) return { status: "rejected", reason: "undo_not_available" };
      const reverted = undoItemPostponement(schedule, original.command, original.temporalChange);
      if (!reverted.schedule)
        return { status: "rejected", reason: reverted.reason ?? "undo_not_available" };
      temporalSchedule = reverted.schedule;
    }
    after = original.before;
  }
  const next: WeeklySchedule = {
    ...temporalSchedule,
    version: schedule.version + 1,
    updatedAt: command.decidedAt,
    itemActivity: {
      ...activity,
      outcomes: [
        ...activity.outcomes.filter((outcome) => outcome.itemId !== command.itemId),
        ...(after ? [after] : []),
      ],
      history: [
        ...activity.history,
        {
          command,
          appliedVersion: schedule.version + 1,
          before,
          after,
          ...(temporalChange ? { temporalChange } : {}),
        },
      ],
    },
  };
  if (
    !WeeklyScheduleSchema.safeParse(next).success ||
    !validateWeeklyScheduleInvariants(next).valid
  )
    return { status: "rejected", reason: "invalid_schedule" };
  return { status: "success", schedule: next };
}
