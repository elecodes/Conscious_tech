import { ItemActivityCommand, ItemActivityCommandSchema } from "./item-activity-types";
import { WeeklySchedule, WeeklyScheduleSchema, validateWeeklyScheduleInvariants } from "./schedule";
import { StoredWeeklyPlan, StoredWeeklyPlanSchema } from "./repositories/types";

export type ItemActivityResult =
  | { status: "success" | "already_applied"; schedule: WeeklySchedule }
  | { status: "rejected"; reason: string };

/** Pure completion/reversal. Persistence must check plan and schedule inside one transaction. */
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
    command.type === "complete" &&
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
  if (command.type === "complete") {
    if (before?.status === "completed") return { status: "rejected", reason: "already_completed" };
    after = { ...before, itemId: command.itemId, status: "completed" };
    // A completed result must not retain a contradictory postponement reason.
    delete after.postponementReason;
  } else {
    const original = activity.history.find(
      (record) => record.command.actionId === command.reversesActionId
    );
    if (
      !original ||
      original.command.type !== "complete" ||
      original.command.itemId !== command.itemId ||
      original.appliedVersion !== schedule.version ||
      JSON.stringify(before) !== JSON.stringify(original.after)
    )
      return { status: "rejected", reason: "undo_not_available" };
    after = original.before;
  }
  const next: WeeklySchedule = {
    ...schedule,
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
        { command, appliedVersion: schedule.version + 1, before, after },
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
