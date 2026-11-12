import { calculateWeeklyCapacity } from "../skills/build-week/deterministic";
import { applyItemActivity } from "../domain/item-activity";
import { activePostponements } from "../domain/item-postponement";
import type { StoredWeeklyPlan } from "../domain/repositories/types";
import { WeeklyScheduleSchema, type WeeklySchedule } from "../domain/schedule";
import { editDraftCalendarHours, includedDraftItemIds } from "./draft-calendar-edits";
import { replaceTaskDistribution, taskHoursBudget } from "./task-distribution";
import type { PlanItemSummary } from "./components/weekly-reflective-closing-section";

/** Explicitly include one calendar task and assign only its chosen day, atomically. */
export function scheduleCalendarTask(
  plan: StoredWeeklyPlan,
  schedule: WeeklySchedule,
  item: PlanItemSummary,
  day: string,
  hours: number | null,
  now: string,
  actionId: string
) {
  if (plan.status !== "active" || schedule.planId !== plan.planId)
    throw new Error("Abre la semana activa para organizar esta tarea.");
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
    !Number.isFinite(Date.parse(day)) ||
    day < plan.targetWeek.startDate ||
    day > plan.targetWeek.endDate
  )
    throw new Error("Elige un día dentro de esta semana.");
  if (hours !== null && (!Number.isFinite(hours) || hours <= 0))
    throw new Error("Introduce horas mayores que cero o déjalas sin estimar.");
  const included = includedDraftItemIds(plan.proposal).has(item.itemId);
  const deferred = plan.proposal.deferredItems.find((row) => row.itemId === item.itemId);
  if (!included && !deferred) throw new Error("Esta tarea ya no está en la semana.");
  const outcome = schedule.itemActivity?.outcomes.find((row) => row.itemId === item.itemId);
  if (outcome?.status === "completed" || outcome?.status === "dropped")
    throw new Error("Esta tarea está cerrada.");
  let nextSchedule = schedule;
  if (
    outcome?.status === "consciously_postponed" ||
    activePostponements(schedule).has(item.itemId)
  ) {
    const resumed = applyItemActivity(plan, schedule, {
      type: "resume",
      itemId: item.itemId,
      actionId,
      expectedVersion: schedule.version,
      decidedAt: now,
    });
    if (resumed.status === "rejected") throw new Error("No se pudo recuperar la tarea aplazada.");
    nextSchedule = resumed.schedule;
  }
  const proposal = included
    ? plan.proposal
    : {
        ...plan.proposal,
        deferredItems: plan.proposal.deferredItems.filter((row) => row.itemId !== item.itemId),
        flexibleOptions: [
          ...plan.proposal.flexibleOptions,
          {
            itemId: item.itemId,
            title: item.title,
            estimatedHours: hours,
            condition: "Incluida directamente por la persona desde el calendario.",
          },
        ],
      };
  const sources = plan.draftContext?.extractedItems ?? [];
  const shared = proposal.foci.some(
    (focus) =>
      focus.contributingItemIds.length > 1 && focus.contributingItemIds.includes(item.itemId)
  );
  const estimateChanged =
    !included ||
    (!shared &&
      taskHoursBudget(
        plan.proposal,
        sources,
        item.itemId,
        schedule.dailyAllocations.filter((row) => row.itemId === item.itemId)
      ) !== hours);
  const edited =
    shared || !estimateChanged
      ? { proposal, items: sources }
      : editDraftCalendarHours(proposal, sources, item.itemId, hours);
  const entries = [
    ...edited.proposal.foci,
    ...edited.proposal.obligations,
    ...edited.proposal.flexibleOptions,
  ];
  const known = entries.filter((row) => row.estimatedHours != null);
  const oldCapacity = plan.proposal.weekSummary.capacity;
  const capacity = calculateWeeklyCapacity({
    foci: edited.proposal.foci,
    obligations: edited.proposal.obligations,
    explicitKnownEstimatedHours: known.length
      ? known.reduce((sum, row) => sum + row.estimatedHours!, 0)
      : null,
    explicitCompleteness:
      known.length === entries.length ? "complete" : known.length ? "partial" : "none",
    capacityConfig:
      oldCapacity.totalAvailableHours != null
        ? {
            totalAvailableHours: oldCapacity.totalAvailableHours,
            minProtectedSpaceRatio:
              oldCapacity.totalAvailableHours > 0 && oldCapacity.protectedSpaceHours != null
                ? oldCapacity.protectedSpaceHours / oldCapacity.totalAvailableHours
                : 0.25,
          }
        : undefined,
  });
  edited.proposal = {
    ...edited.proposal,
    weekSummary: {
      ...edited.proposal.weekSummary,
      capacity: estimateChanged ? capacity : oldCapacity,
    },
    ...(!estimateChanged ? { unplannedSpace: plan.proposal.unplannedSpace } : {}),
  };
  const rows = hours === null ? [] : [{ itemId: item.itemId, day, allocatedHours: hours }];
  const allocations = replaceTaskDistribution(
    edited.proposal,
    edited.items,
    nextSchedule.dailyAllocations,
    item.itemId,
    rows,
    nextSchedule
  );
  return {
    plan: {
      ...plan,
      proposal: edited.proposal,
      updatedAt: now,
      draftContext: {
        ...plan.draftContext,
        extractedItems: edited.items,
        plannedDays: { ...plan.draftContext?.plannedDays, [item.itemId]: day },
      },
    },
    schedule: WeeklyScheduleSchema.parse({
      ...nextSchedule,
      dailyAllocations: allocations,
      updatedAt: now,
      version: schedule.version + 1,
    }),
  };
}
