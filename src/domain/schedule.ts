import type { WeeklySchedule, ScheduleAdjustmentRecord } from "./schedule-types";

// Re-export shared temporal building blocks, schemas, and types
export * from "./schedule-types";

/**
 * Canonical selector to obtain all adjustments that are currently applied and active on the schedule (H-05).
 * Excludes rejected, failed, superseded, and reverted adjustment records.
 * Returns a new array without mutating the schedule's historical record.
 */
export function getActiveAppliedAdjustments(schedule: WeeklySchedule): ScheduleAdjustmentRecord[] {
  return schedule.appliedAdjustments.filter(
    (adj) =>
      adj.humanDecision === "accepted" &&
      adj.applicationOutcome === "applied" &&
      adj.lifecycleStatus === "active"
  );
}

// Re-export invariant validation and adjustment application engines
export * from "./schedule-invariants";
export * from "./schedule-adjustment-applier";
