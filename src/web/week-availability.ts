import type { ProposedWeek } from "../domain/week";
import { calculateWeeklyCapacity } from "../skills/build-week/deterministic";
import { parsePlanningContext } from "./planning-context-inputs";

/** Availability edits preserve task decisions, effort completeness and weekly assignments. */
export function editWeekAvailability(
  proposal: ProposedWeek,
  hours: string,
  protectedPercent: string
) {
  const week = proposal.weekSummary.targetWeek;
  const { capacity: config } = parsePlanningContext({
    targetWeekStart: week.startDate,
    targetWeekEnd: week.endDate,
    availableHoursInput: hours,
    protectedSpacePercentInput: protectedPercent,
  });
  const previous = proposal.weekSummary.capacity;
  const capacity = calculateWeeklyCapacity({
    capacityConfig: config,
    explicitKnownEstimatedHours: previous.knownEstimatedHours,
    explicitCompleteness: previous.estimationCompleteness,
  });
  return {
    ...proposal,
    weekSummary: { ...proposal.weekSummary, capacity },
    unplannedSpace: { ...proposal.unplannedSpace, recommendedHours: capacity.protectedSpaceHours },
  };
}
