import type { ExtractedItem } from "../domain/items";
import type { ProposedWeek, TargetWeek } from "../domain/week";
import {
  DailyWorkAllocationSchema,
  type DailyWorkAllocation,
  type WeeklySchedule,
} from "../domain/schedule";
import { extractItemHours } from "../skills/build-week/deterministic";
import { retainDraftDays, includedDraftItemIds } from "./draft-calendar-edits";

export const distributionHours = (rows: readonly DailyWorkAllocation[]) =>
  Number(rows.reduce((sum, row) => sum + row.allocatedHours, 0).toFixed(9));
export function taskHoursBudget(
  proposal: ProposedWeek,
  sources: readonly ExtractedItem[] | undefined,
  id: string,
  existing: readonly DailyWorkAllocation[] = []
) {
  const obligation = proposal.obligations.find((row) => row.itemId === id);
  const flexible = proposal.flexibleOptions.find((row) => row.itemId === id);
  const focus = proposal.foci.find((row) => row.contributingItemIds.includes(id));
  const source = sources?.find((row) => row.id === id);
  const estimate = obligation
    ? obligation.estimatedHours
    : flexible
      ? flexible.estimatedHours
      : focus?.contributingItemIds.length === 1
        ? focus.estimatedHours
        : source
          ? extractItemHours(source)
          : null;
  return estimate ?? (distributionHours(existing) > 0 ? distributionHours(existing) : null);
}
export function validateDistribution(
  week: TargetWeek,
  id: string,
  rows: readonly DailyWorkAllocation[],
  budget: number | null
) {
  const days = new Set<string>();
  for (const row of rows) {
    if (
      !DailyWorkAllocationSchema.safeParse(row).success ||
      row.itemId !== id ||
      row.allocatedHours <= 0
    )
      throw new Error("Introduce horas válidas para esta tarea.");
    if (row.day < week.startDate || row.day > week.endDate)
      throw new Error("Elige días dentro de esta semana.");
    if (days.has(row.day)) throw new Error("Reparte las horas una sola vez por día.");
    days.add(row.day);
  }
  const sum = distributionHours(rows);
  if (sum > 0 && (budget == null || !Number.isFinite(budget)))
    throw new Error("Indica primero las horas totales de esta tarea.");
  if (budget != null && sum > budget + 0.000001)
    throw new Error(`Has repartido ${sum} h, pero la tarea tiene ${budget} h en total.`);
}
export function replaceTaskDistribution(
  proposal: ProposedWeek,
  sources: readonly ExtractedItem[] | undefined,
  existing: readonly DailyWorkAllocation[],
  id: string,
  rows: readonly DailyWorkAllocation[],
  schedule?: WeeklySchedule | null
) {
  if (!includedDraftItemIds(proposal).has(id))
    throw new Error("Incluye primero esta tarea en la semana.");
  if (schedule?.timeBlocks.some((row) => row.itemId === id))
    throw new Error(
      "Esta tarea tiene horarios fijos. Ajusta sus bloques desde los controles de la tarea."
    );
  const budget = taskHoursBudget(
    proposal,
    sources,
    id,
    existing.filter((row) => row.itemId === id)
  );
  validateDistribution(proposal.weekSummary.targetWeek, id, rows, budget);
  const next = [...existing.filter((row) => row.itemId !== id), ...rows.map((row) => ({ ...row }))];
  for (const focus of proposal.foci) {
    if (
      focus.estimatedHours != null &&
      focus.contributingItemIds.includes(id) &&
      focus.contributingItemIds.length > 1 &&
      distributionHours(next.filter((row) => focus.contributingItemIds.includes(row.itemId))) >
        focus.estimatedHours + 0.000001
    )
      throw new Error(
        "El reparto supera las horas compartidas del foco. Revisa su estimación antes de guardar."
      );
  }
  for (const constraint of schedule?.dayConstraints ?? []) {
    if (
      rows.some((row) => row.day === constraint.day) &&
      distributionHours(next.filter((row) => row.day === constraint.day)) >
        constraint.availableHours + 0.000001
    )
      throw new Error(`El reparto supera las horas disponibles del ${constraint.day}.`);
  }
  return next;
}

export function moveDistributionPortion(
  existing: readonly DailyWorkAllocation[],
  id: string,
  source: string,
  target: string | null
) {
  const hours = distributionHours(
    existing.filter((row) => row.itemId === id && row.day === source)
  );
  if (!hours || source === target) return [...existing];
  const next = existing.filter(
    (row) =>
      !(row.itemId === id && row.day === source) &&
      !(target && row.itemId === id && row.day === target)
  );
  if (target)
    next.push({
      itemId: id,
      day: target,
      allocatedHours: Number(
        (
          hours +
          distributionHours(existing.filter((row) => row.itemId === id && row.day === target))
        ).toFixed(9)
      ),
    });
  return next;
}

export function retainDraftAllocations(
  previous: ExtractedItem[],
  next: ExtractedItem[],
  rows: DailyWorkAllocation[]
) {
  const retained = retainDraftDays(
    previous,
    next,
    Object.fromEntries(rows.map((row) => [row.itemId, row.day]))
  );
  return rows.filter((row) => !!retained[row.itemId]);
}
