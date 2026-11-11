import type { StoredWeeklyPlan } from "../domain/repositories/types";
import type { WeeklySchedule } from "../domain/schedule";
import { buildTaskCalendar } from "./task-calendar-model";
import { extractPlanItems } from "./components/weekly-session-formatters";

export function weekContaining(day: string) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  const startDate = date.toISOString().slice(0, 10);
  date.setUTCDate(date.getUTCDate() + 6);
  return { startDate, endDate: date.toISOString().slice(0, 10) };
}

/** Month view is a projection, never an allocation or activation operation. */
export function monthCalendar(
  month: string,
  plans: readonly StoredWeeklyPlan[],
  schedule: WeeklySchedule | null
) {
  const first = new Date(`${month}-01T00:00:00Z`);
  const end = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0));
  const last = end.toISOString().slice(0, 10);
  const cells = Array.from(
    { length: end.getUTCDate() },
    (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`
  );
  const weeks = plans.filter(
    (plan) =>
      plan.status !== "closed" &&
      plan.targetWeek.startDate <= last &&
      plan.targetWeek.endDate >= cells[0]!
  );
  const entries: { day: string; itemId: string; title: string; plan: StoredWeeklyPlan }[] = [];
  const undated: { plan: StoredWeeklyPlan; count: number }[] = [];
  for (const plan of weeks) {
    const realSchedule = schedule?.planId === plan.planId ? schedule : null;
    const items = extractPlanItems(plan, realSchedule);
    const initial = buildTaskCalendar(plan, realSchedule, items);
    const pending = (state: string) => state !== "completed" && state !== "dropped";
    undated.push({ plan, count: initial.undated.filter((task) => pending(task.state)).length });
    for (let page = 0; page < initial.pages; page++) {
      const model = page === 0 ? initial : buildTaskCalendar(plan, realSchedule, items, page);
      for (const day of model.days)
        for (const entry of day.entries) {
          if (day.date.startsWith(month) && pending(entry.task.state))
            entries.push({
              day: day.date,
              itemId: entry.task.itemId,
              title: entry.task.title,
              plan,
            });
        }
    }
  }
  return { cells, offset: (first.getUTCDay() + 6) % 7, entries, undated };
}
