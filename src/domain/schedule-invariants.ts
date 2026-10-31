import type { TimeBlock } from "./conflict";
import type { WeeklySchedule } from "./schedule-types";

export interface ScheduleInvariantValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Checks domain invariants across a WeeklySchedule instance:
 * 1. Timestamp monotonicity: updatedAt >= createdAt.
 * 2. Range containment: all time blocks, daily allocations, and day constraints
 *    must have dates within weekRange.startDate and weekRange.endDate.
 * 3. Schedule collision absence: no two time blocks may overlap on the same day.
 * 4. Daily allocation uniqueness: at most one allocation per (itemId, day).
 * 5. Day constraint uniqueness: at most one constraint per day.
 * 6. Explicit day capacity enforcement (H-01):
 *    - If availableHours === 0, no time blocks or non-zero daily allocations are allowed.
 *    - If availableHours > 0, the sum of daily allocatedHours must not exceed availableHours.
 *    - Days without constraints are not restricted by universal limits.
 * 7. Version sanity: each historical adjustment record must have expectedScheduleVersion <= schedule.version.
 *
 * Architectural Note on Cross-Domain Referential Integrity:
 * WeeklySchedule is strictly decoupled from ProposedWeek per ADR 0012 to avoid monolithic bloat.
 * Therefore, validating that each itemId in timeBlocks and dailyAllocations belongs to the active
 * ProposedWeek (planId) cannot be performed within this pure isolated domain model validator.
 * That cross-check belongs to the integration layer (e.g. validateScheduleAgainstPlan(schedule, plan))
 * which receives both objects simultaneously.
 */
export function validateWeeklyScheduleInvariants(
  schedule: WeeklySchedule
): ScheduleInvariantValidationResult {
  const errors: string[] = [];

  // 1. Timestamp monotonicity
  if (schedule.updatedAt < schedule.createdAt) {
    errors.push(
      `updatedAt (${schedule.updatedAt}) cannot be earlier than createdAt (${schedule.createdAt})`
    );
  }

  const { startDate, endDate } = schedule.weekRange;

  // Helper: Date range check
  function isDateInWeek(date: string): boolean {
    return date >= startDate && date <= endDate;
  }

  // 2. Range containment
  for (const tb of schedule.timeBlocks) {
    if (!isDateInWeek(tb.day)) {
      errors.push(
        `TimeBlock '${tb.itemId}' has day '${tb.day}' outside weekRange (${startDate} to ${endDate})`
      );
    }
  }

  for (const alloc of schedule.dailyAllocations) {
    if (!isDateInWeek(alloc.day)) {
      errors.push(
        `DailyWorkAllocation '${alloc.itemId}' has day '${alloc.day}' outside weekRange (${startDate} to ${endDate})`
      );
    }
  }

  if (schedule.dayConstraints) {
    for (const dc of schedule.dayConstraints) {
      if (!isDateInWeek(dc.day)) {
        errors.push(
          `DayConstraint on '${dc.day}' is outside weekRange (${startDate} to ${endDate})`
        );
      }
    }
  }

  // 3. Schedule collision absence (pairwise comparison per day)
  const blocksByDay = new Map<string, TimeBlock[]>();
  for (const tb of schedule.timeBlocks) {
    const list = blocksByDay.get(tb.day) ?? [];
    list.push(tb);
    blocksByDay.set(tb.day, list);
  }

  for (const [day, dayBlocks] of blocksByDay.entries()) {
    for (let i = 0; i < dayBlocks.length; i++) {
      for (let j = i + 1; j < dayBlocks.length; j++) {
        const b1 = dayBlocks[i]!;
        const b2 = dayBlocks[j]!;

        // Overlap condition for half-open intervals [start, end)
        const overlaps = !(b1.endTime <= b2.startTime || b2.endTime <= b1.startTime);
        if (overlaps) {
          errors.push(
            `Schedule collision on ${day}: block '${b1.itemId}' (${b1.startTime}-${b1.endTime}) overlaps with '${b2.itemId}' (${b2.startTime}-${b2.endTime})`
          );
        }
      }
    }
  }

  // 4. Daily allocation uniqueness: at most one allocation per (itemId, day) & accumulation by day (H-01)
  const seenAllocKeys = new Set<string>();
  const allocatedHoursByDay = new Map<string, number>();
  for (const alloc of schedule.dailyAllocations) {
    const key = `${alloc.itemId}::${alloc.day}`;
    if (seenAllocKeys.has(key)) {
      errors.push(`Duplicate DailyWorkAllocation for item '${alloc.itemId}' on day '${alloc.day}'`);
    }
    seenAllocKeys.add(key);

    const currentHours = allocatedHoursByDay.get(alloc.day) ?? 0;
    allocatedHoursByDay.set(alloc.day, currentHours + alloc.allocatedHours);
  }

  // 5. Day constraint uniqueness & explicit capacity mapping (H-01)
  const explicitCapacityByDay = new Map<string, number>();
  if (schedule.dayConstraints) {
    const seenConstraintDays = new Set<string>();
    for (const dc of schedule.dayConstraints) {
      if (seenConstraintDays.has(dc.day)) {
        errors.push(`Duplicate DayConstraint for day '${dc.day}'`);
      }
      seenConstraintDays.add(dc.day);
      explicitCapacityByDay.set(dc.day, dc.availableHours);
    }
  }

  // 6. Day capacity limit enforcement (H-01)
  // For each day with an explicit DayConstraint:
  // a) If availableHours === 0, no time blocks or non-zero daily allocations are allowed.
  // b) If availableHours > 0, the sum of daily allocatedHours must not exceed availableHours.
  // Note: Days WITHOUT an explicit DayConstraint are NOT checked against any arbitrary universal limit,
  // delegating potential risk detection to detect_conflict per ADR 0012 §6.
  for (const [day, availableHours] of explicitCapacityByDay.entries()) {
    if (availableHours === 0) {
      for (const tb of schedule.timeBlocks) {
        if (tb.day === day) {
          errors.push(`TimeBlock '${tb.itemId}' scheduled on declared zero-capacity day '${day}'`);
        }
      }
      for (const alloc of schedule.dailyAllocations) {
        if (alloc.day === day && alloc.allocatedHours > 0) {
          errors.push(
            `DailyWorkAllocation '${alloc.itemId}' has ${alloc.allocatedHours}h scheduled on declared zero-capacity day '${day}'`
          );
        }
      }
    } else {
      const dayAllocated = allocatedHoursByDay.get(day) ?? 0;
      if (dayAllocated > availableHours) {
        errors.push(
          `Explicit capacity exceeded on '${day}': total allocated hours (${dayAllocated}h) exceeds availableHours (${availableHours}h)`
        );
      }
    }
  }

  // 7. Version sanity on historical adjustment records
  // Note on versioning:
  // - Retrospective/Historical model invariant: each historical adjustment record must have
  //   expectedScheduleVersion <= schedule.version (a past record cannot refer to a future version).
  // - Strict precondition for application: when a NEW adjustment is applied via applyAdjustmentToSchedule,
  //   it must strictly require expectedScheduleVersion === schedule.version (optimistic concurrency lock).
  for (const adj of schedule.appliedAdjustments) {
    if (adj.expectedScheduleVersion > schedule.version) {
      errors.push(
        `ScheduleAdjustmentRecord '${adj.adjustmentId}' has expectedScheduleVersion (${adj.expectedScheduleVersion}) greater than current schedule version (${schedule.version})`
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
