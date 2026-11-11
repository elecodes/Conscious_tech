import type { StoredWeeklyPlan } from "../domain/repositories/types";
import type { WeeklySchedule } from "../domain/schedule";
import type { TargetWeek } from "../domain/week";
import { activePostponements } from "../domain/item-postponement";
import { extractPlanItems } from "./components/weekly-session-formatters";
import { buildTaskCalendar } from "./task-calendar-model";
import { extractItemHours } from "../skills/build-week/deterministic";

export interface WeekOverview {
  key: string;
  week: TargetWeek;
  active: boolean;
  draft: boolean;
  hours: number | null;
  items: { id: string; title: string; day?: string; hours: number | null; carried: boolean }[];
}
const key = (week: TargetWeek) => `${week.startDate}/${week.endDate}`;
export function weeksOverview(
  active: StoredWeeklyPlan | null,
  schedule: WeeklySchedule | null,
  drafts: StoredWeeklyPlan[],
  previous?: { plan: StoredWeeklyPlan; schedule: WeeklySchedule | null } | null
) {
  const result = new Map<string, WeekOverview>();
  for (const plan of [...(active?.status === "active" ? [active] : []), ...drafts]) {
    if (result.get(key(plan.targetWeek))?.active) continue;
    const actual = schedule?.planId === plan.planId ? schedule : null;
    const descriptors = extractPlanItems(plan, actual);
    const model = buildTaskCalendar(plan, actual, descriptors);
    const candidates = [...model.undated];
    for (let page = 0; page < model.pages; page++)
      candidates.push(
        ...(page === 0 ? model : buildTaskCalendar(plan, actual, descriptors, page)).days.flatMap(
          (day) => day.entries.map((entry) => entry.task)
        )
      );
    const included = [
      ...new Map(
        candidates
          .filter((item) => item.state !== "completed" && item.state !== "dropped")
          .map((item) => [item.itemId, item])
      ).values(),
    ];
    result.set(key(plan.targetWeek), {
      key: key(plan.targetWeek),
      week: plan.targetWeek,
      active: plan.status === "active",
      draft: plan.status === "draft",
      hours: plan.proposal.weekSummary.capacity.totalAvailableHours,
      items: included.map((item) => ({
        id: item.itemId,
        title: item.title,
        hours: plan.proposal.foci.some(
          (f) => f.contributingItemIds.includes(item.itemId) && f.contributingItemIds.length > 1
        )
          ? extractItemHours(
              plan.draftContext?.extractedItems?.find((source) => source.id === item.itemId) ?? {
                id: item.itemId,
                title: item.title,
                rawText: item.title,
                type: "task",
                status: "pending",
              }
            )
          : (item.estimatedHours ?? null),
        day:
          actual?.dailyAllocations.find((row) => row.itemId === item.itemId)?.day ??
          actual?.timeBlocks.find((row) => row.itemId === item.itemId)?.day ??
          plan.draftContext?.plannedDays?.[item.itemId],
        carried: false,
      })),
    });
  }
  for (const origin of [
    ...(active && schedule?.planId === active.planId ? [{ plan: active, schedule }] : []),
    ...(previous?.schedule ? [previous] : []),
  ]) {
    const active = origin.plan;
    const schedule = origin.schedule!;
    const sources = extractPlanItems(active, schedule);
    for (const [id, action] of activePostponements(schedule)) {
      if (!action.targetWeek) continue;
      const outcome = schedule.itemActivity?.outcomes.find((row) => row.itemId === id);
      if (outcome?.status === "completed" || outcome?.status === "dropped") continue;
      const week = action.targetWeek;
      const destination = result.get(key(week)) ?? {
        key: key(week),
        week,
        active: false,
        draft: false,
        hours: null,
        items: [],
      };
      if (!destination.items.some((item) => item.id === id)) {
        const source = sources.find((item) => item.itemId === id);
        const original = active.draftContext?.extractedItems?.find((item) => item.id === id);
        const grouped = active.proposal.foci.some(
          (f) => f.contributingItemIds.includes(id) && f.contributingItemIds.length > 1
        );
        destination.items.push({
          id,
          title: source?.title ?? original?.title ?? "Tarea reprogramada",
          hours: grouped
            ? original
              ? extractItemHours(original)
              : null
            : (source?.estimatedHours ?? (original ? extractItemHours(original) : null)),
          carried: true,
        });
      }
      result.set(key(week), destination);
    }
  }
  return [...result.values()].sort(
    (a, b) =>
      Number(b.active) - Number(a.active) || a.week.startDate.localeCompare(b.week.startDate)
  );
}
