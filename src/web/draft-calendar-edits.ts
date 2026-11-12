import type { ProposedWeek } from "../domain/week";
import type { ExtractedItem } from "../domain/items";
import { extractItemHours, calculateWeeklyCapacity } from "../skills/build-week/deterministic";

/** A direct hours edit changes only its source and a single-item proposal estimate. */
export function editDraftCalendarHours(
  proposal: ProposedWeek,
  items: ExtractedItem[],
  id: string,
  hours: number | null
) {
  if (hours !== null && (!Number.isFinite(hours) || hours < 0))
    throw new Error("Introduce horas válidas o deja el campo sin estimar.");
  const group = proposal.foci.find(
    (focus) => focus.contributingItemIds.includes(id) && focus.contributingItemIds.length > 1
  );
  if (group)
    throw new Error(
      "Este elemento comparte una estimación con su foco. Ajusta el foco completo en las opciones avanzadas."
    );
  // Source estimates require positive effort; zero clears the estimate consistently.
  if (hours === 0) hours = null;
  const nextItems = items.map((item) =>
    item.id === id
      ? {
          ...item,
          estimatedEffort:
            hours !== null && hours > 0
              ? { value: hours, unit: "hours" as const, source: "user" as const }
              : undefined,
        }
      : item
  );
  const foci = proposal.foci.map((focus) =>
    focus.contributingItemIds.includes(id) ? { ...focus, estimatedHours: hours } : focus
  );
  const obligations = proposal.obligations.map((item) =>
    item.itemId === id ? { ...item, estimatedHours: hours } : item
  );
  const flexibleOptions = proposal.flexibleOptions.map((item) =>
    item.itemId === id ? { ...item, estimatedHours: hours } : item
  );
  const old = proposal.weekSummary.capacity;
  const capacity = calculateWeeklyCapacity({
    foci,
    obligations,
    flexibleOptions,
    capacityConfig:
      old.totalAvailableHours != null
        ? {
            totalAvailableHours: old.totalAvailableHours,
            minProtectedSpaceRatio:
              old.totalAvailableHours > 0 && old.protectedSpaceHours != null
                ? old.protectedSpaceHours / old.totalAvailableHours
                : 0.25,
          }
        : undefined,
  });
  return {
    items: nextItems,
    proposal: {
      ...proposal,
      foci,
      obligations,
      flexibleOptions,
      weekSummary: { ...proposal.weekSummary, capacity },
      unplannedSpace: {
        ...proposal.unplannedSpace,
        recommendedHours: capacity.protectedSpaceHours,
      },
    },
  };
}

export function includedDraftItemIds(proposal: ProposedWeek) {
  return new Set([
    ...proposal.foci.flatMap((focus) => focus.contributingItemIds),
    ...proposal.obligations.map((item) => item.itemId),
    ...proposal.flexibleOptions.map((item) => item.itemId),
  ]);
}

/** The proposal is authoritative after advanced corrections, including unknown hours. */
export function draftItemHours(proposal: ProposedWeek, item: ExtractedItem): number | null {
  const obligation = proposal.obligations.find((row) => row.itemId === item.id);
  if (obligation) return obligation.estimatedHours;
  const flexible = proposal.flexibleOptions.find((row) => row.itemId === item.id);
  if (flexible) return flexible.estimatedHours;
  const focus = proposal.foci.find((row) => row.contributingItemIds.includes(item.id));
  if (focus) return focus.contributingItemIds.length === 1 ? focus.estimatedHours : null;
  return extractItemHours(item);
}

/** Provider IDs can be reused after rewriting notes; retain days only for unchanged sources. */
export function retainDraftDays(
  previous: ExtractedItem[],
  next: ExtractedItem[],
  days: Record<string, string>
) {
  return Object.fromEntries(
    Object.entries(days).filter(([id]) => {
      const before = previous.find((item) => item.id === id);
      const after = next.find((item) => item.id === id);
      return before && after && before.rawText === after.rawText && before.title === after.title;
    })
  );
}

/** Rename one source without changing its identity, provenance, decisions or assignments. */
export function renameDraftTask(
  proposal: ProposedWeek,
  items: ExtractedItem[],
  id: string,
  value: string
) {
  const title = value.trim();
  if (!title) throw new Error("Escribe un nombre para cada tarea.");
  if (!items.some((item) => item.id === id)) throw new Error("La tarea ya no existe.");
  return {
    items: items.map((item) => (item.id === id ? { ...item, title } : item)),
    proposal: {
      ...proposal,
      foci: proposal.foci.map((focus) =>
        focus.contributingItemIds.length === 1 && focus.contributingItemIds[0] === id
          ? { ...focus, title }
          : focus
      ),
      obligations: proposal.obligations.map((item) =>
        item.itemId === id ? { ...item, title } : item
      ),
      flexibleOptions: proposal.flexibleOptions.map((item) =>
        item.itemId === id ? { ...item, title } : item
      ),
      deferredItems: proposal.deferredItems.map((item) =>
        item.itemId === id ? { ...item, title } : item
      ),
    },
  };
}
