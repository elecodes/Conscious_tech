import type { StoredWeeklyPlan } from "../domain/repositories/types";
import type { WeeklySchedule } from "../domain/schedule";
import { activePostponements } from "../domain/item-postponement";
import type { PlanItemSummary } from "./components/weekly-reflective-closing-section";

export type CalendarTask = PlanItemSummary & {
  kind: "priority" | "optional" | "other" | "outside" | "postponed" | "note";
  state: "pending" | "in_progress" | "completed" | "dropped" | "consciously_postponed";
  destination?: { startDate: string; endDate: string };
};
export interface CalendarEntry {
  task: CalendarTask;
  day: string;
  hours?: number;
  blocks: WeeklySchedule["timeBlocks"];
}
const stamp = (date: string) => new Date(`${date}T00:00:00Z`).getTime();
const iso = (time: number) => new Date(time).toISOString().slice(0, 10);
const DAY = 86400000;

/** Read-only projection: deadlines never become scheduled days; original group estimates are not divided. */
export function buildTaskCalendar(
  plan: StoredWeeklyPlan,
  schedule: WeeklySchedule | null,
  items: readonly PlanItemSummary[],
  page = 0
) {
  const range = plan.targetWeek;
  const totalDays = Math.floor((stamp(range.endDate) - stamp(range.startDate)) / DAY) + 1;
  const pages = Math.max(1, Math.ceil(totalDays / 7));
  const currentPage = Math.min(Math.max(0, page), pages - 1);
  const days = Array.from({ length: Math.min(7, totalDays - currentPage * 7) }, (_, index) => ({
    date: iso(stamp(range.startDate) + (currentPage * 7 + index) * DAY),
    entries: [] as CalendarEntry[],
  }));
  const priorities = new Set([
    ...plan.proposal.obligations.map((item) => item.itemId),
    ...plan.proposal.foci.flatMap((focus) => focus.contributingItemIds),
  ]);
  const optional = new Set(plan.proposal.flexibleOptions.map((item) => item.itemId));
  const outside = new Set(plan.proposal.deferredItems.map((item) => item.itemId));
  const thoughts = new Set(
    plan.draftContext?.extractedItems
      ?.filter((item) => item.type === "idea" || item.type === "concern")
      .map((item) => item.id)
  );
  const postponed = schedule ? activePostponements(schedule) : new Map();
  const tasks: CalendarTask[] = [...new Map(items.map((item) => [item.itemId, item])).values()].map(
    (item) => {
      const outcome = schedule?.itemActivity?.outcomes.find(
        (entry) => entry.itemId === item.itemId
      );
      const decision = postponed.get(item.itemId);
      const kind: CalendarTask["kind"] =
        decision || outcome?.status === "consciously_postponed"
          ? "postponed"
          : priorities.has(item.itemId)
            ? "priority"
            : optional.has(item.itemId)
              ? "optional"
              : thoughts.has(item.itemId)
                ? "note"
                : outside.has(item.itemId)
                  ? "outside"
                  : "other";
      return {
        ...item,
        kind,
        state:
          outcome?.status === "not_started"
            ? "pending"
            : (outcome?.status ?? (decision ? "consciously_postponed" : "pending")),
        destination: decision?.targetWeek,
      };
    }
  );
  const undated: CalendarTask[] = [];
  const extras: CalendarTask[] = [];
  const outOfRange: CalendarEntry[] = [];
  for (const task of tasks) {
    if (task.kind === "outside" || task.kind === "postponed" || task.kind === "note") {
      extras.push(task);
      continue;
    }
    const blocks = schedule?.timeBlocks.filter((row) => row.itemId === task.itemId) ?? [];
    const allocations =
      schedule?.dailyAllocations.filter((row) => row.itemId === task.itemId) ?? [];
    const dates = new Set([...blocks.map((row) => row.day), ...allocations.map((row) => row.day)]);
    if (!dates.size) undated.push(task);
    for (const date of dates) {
      const daily = allocations.filter((row) => row.day === date);
      const entry: CalendarEntry = {
        task,
        day: date,
        blocks: blocks
          .filter((row) => row.day === date)
          .sort((a, b) => a.startTime.localeCompare(b.startTime)),
        ...(daily.length ? { hours: daily.reduce((sum, row) => sum + row.allocatedHours, 0) } : {}),
      };
      if (date < range.startDate || date > range.endDate) outOfRange.push(entry);
      else days.find((day) => day.date === date)?.entries.push(entry);
    }
  }
  for (const day of days)
    day.entries.sort(
      (a, b) =>
        (a.blocks[0]?.startTime ?? "99:99").localeCompare(b.blocks[0]?.startTime ?? "99:99") ||
        a.task.title.localeCompare(b.task.title, "es")
    );
  undated.sort((a, b) => Number(a.kind === "optional") - Number(b.kind === "optional"));
  const unresolved = (task: CalendarTask) => task.state !== "completed" && task.state !== "dropped";
  return {
    range,
    days,
    pages,
    currentPage,
    undated,
    extras,
    outOfRange,
    pending: tasks.filter(
      (task) => (task.kind === "priority" || task.kind === "other") && unresolved(task)
    ).length,
    optional: tasks.filter((task) => task.kind === "optional" && unresolved(task)).length,
    completed: tasks.filter((task) => task.state === "completed").length,
    postponed: tasks.filter((task) => task.kind === "postponed").length,
  };
}
