import { activePostponements } from "../domain/item-postponement";
import type { StoredWeeklyPlan } from "../domain/repositories/types";
import type { WeeklySchedule } from "../domain/schedule";
import type { PlanItemSummary } from "./components/weekly-reflective-closing-section";

/** Presentation only: active human postponements take precedence over the original proposal. */
export function partitionActiveWeekItems(
  plan: StoredWeeklyPlan | null,
  schedule: WeeklySchedule,
  items: readonly PlanItemSummary[]
) {
  const byId = new Map(items.map((item) => [item.itemId, item]));
  const used = new Set<string>();
  const take = (ids: string[]) =>
    ids.flatMap((id) => {
      const item = byId.get(id);
      if (!item || used.has(id)) return [];
      used.add(id);
      return [item];
    });
  const activePostponed = activePostponements(schedule);
  const postponed = take([...activePostponed.keys()]);
  const obligations = take((plan?.proposal?.obligations ?? []).map((item) => item.itemId));
  const focuses = (plan?.proposal?.foci ?? [])
    .map((focus) => ({
      focus,
      items: take(focus.contributingItemIds),
      postponedCount: focus.contributingItemIds.filter((id) => activePostponed.has(id)).length,
    }))
    .filter((group) => group.items.length > 0 || group.focus.contributingItemIds.length === 0);
  const flexible = take((plan?.proposal?.flexibleOptions ?? []).map((item) => item.itemId));
  const deferred = take((plan?.proposal?.deferredItems ?? []).map((item) => item.itemId));
  const agendaIds = new Set([
    ...schedule.dailyAllocations.map((item) => item.itemId),
    ...schedule.timeBlocks.map((item) => item.itemId),
  ]);
  const agenda = take(
    items.filter((item) => agendaIds.has(item.itemId)).map((item) => item.itemId)
  );
  const unclassified = take(items.map((item) => item.itemId));
  return { focuses, obligations, flexible, deferred, agenda, unclassified, postponed };
}
