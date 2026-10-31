import { z } from "zod";
import {
  SuggestedAdjustmentActionSchema,
  SuggestedAdjustmentAction,
  AdjustmentProposal,
} from "./adjustment";
import { ProposedWeekSchema, ProposedWeek } from "./week";
import { IsoUtcTimestampSchema } from "./memory";
import {
  WeeklySchedule,
  ScheduleAdjustmentRecord,
  ScheduleAdjustmentRecordSchema,
  HumanDecisionSchema,
  HumanDecision,
} from "./schedule-types";
import { validateWeeklyScheduleInvariants } from "./schedule-invariants";

export const ApplyAdjustmentErrorCodeSchema = z.enum([
  "stale_schedule_version",
  "decision_rejected",
  "unsupported_action",
  "item_not_found",
  "schedule_overlap",
  "constraint_violation",
  "insufficient_source_hours",
  "duration_mismatch",
  "invariant_violation",
]);
export type ApplyAdjustmentErrorCode = z.infer<typeof ApplyAdjustmentErrorCodeSchema>;

export const ApplyAdjustmentInputSchema = z
  .object({
    proposalId: z.string().min(1),
    action: SuggestedAdjustmentActionSchema,
    expectedScheduleVersion: z.number().int().positive(),
    decidedAt: IsoUtcTimestampSchema,
    humanDecision: HumanDecisionSchema,
    userNotes: z.string().optional(),
    adjustmentId: z.string().min(1).optional(),
    appliedAt: IsoUtcTimestampSchema.optional(),
    activePlan: ProposedWeekSchema.optional(),
  })
  .strict();
export type ApplyAdjustmentInput = z.infer<typeof ApplyAdjustmentInputSchema>;

export interface ApplyAdjustmentOptions {
  humanDecision?: HumanDecision;
  decidedAt?: string;
  userNotes?: string;
  adjustmentId?: string;
  appliedAt?: string;
  activePlan?: ProposedWeek;
}

export interface ApplyAdjustmentSuccess {
  status: "success";
  schedule: WeeklySchedule;
  appliedRecord: ScheduleAdjustmentRecord;
}

export interface ApplyAdjustmentFailure {
  status: "failed";
  schedule: WeeklySchedule;
  failedRecord: ScheduleAdjustmentRecord;
  errorCode: ApplyAdjustmentErrorCode;
  failureReason: string;
}

export type ApplyAdjustmentResult = ApplyAdjustmentSuccess | ApplyAdjustmentFailure;

/**
 * Helper to parse time string "HH:MM" to total minutes from start of day.
 */
function parseTimeToMinutes(timeStr: string): number {
  const parts = timeStr.split(":");
  const h = Number(parts[0]);
  const m = Number(parts[1]);
  return h * 60 + m;
}

/**
 * Deterministically checks if a new accepted adjustment supersedes a previously applied active adjustment record (D-01).
 * Follows ADR 0012 §3 & §7 rules on granular real-scope supersession:
 *
 * 1. Scope Guard: A previous adjustment can only be superseded if it targeted the same item.
 * 2. Postpone Item: Postponing an item removes all its temporal commitments from the week,
 *    so it supersedes all previous active temporal adjustments on that item (reassign_time_block,
 *    reallocate_day_work, or previous postpone_item).
 * 3. Reassign Time Block: Only supersedes a previous reassign_time_block on the SAME logical block
 *    (i.e. the block being moved currently matches the proposed or original slot of the previous adjustment).
 *    Independent time blocks for the same item are NOT superseded.
 * 4. Reallocate Day Work: Detects overlapping day pairs (exact match, reversal, or chained target-to-source).
 *    Note on chained reallocations (ADR 0012 §9): While chaining identifies an operational relationship,
 *    it does not necessarily mean the previous adjustment was superseded if both describe valid active changes.
 *    Future refinements may preserve chained moves as active unless explicitly superseded or reverted.
 *    Independent reallocations on disjoint days strictly remain active.
 * 5. Structural Block Identity: TimeBlock is matched structurally by (itemId, day, startTime, endTime).
 *    If duplicated concurrent blocks for the same item/slot are supported in the future, a persistent blockId
 *    will be required to avoid ambiguity (ADR 0012 §9).
 * 6. Invariant: Only previously applied and active records can ever transition to superseded.
 *    Rejected, failed, or reverted records are NEVER modified.
 * 7. Conservative Default: If the history does not prove a direct overlap on the same scope,
 *    the previous adjustment remains "active".
 */
export function isAdjustmentSupersededBy(
  prevRecord: ScheduleAdjustmentRecord,
  newAction: SuggestedAdjustmentAction
): boolean {
  // Only applied and active records can ever transition to superseded
  if (prevRecord.applicationOutcome !== "applied" || prevRecord.lifecycleStatus !== "active") {
    return false;
  }

  // If previous action or new action has no itemId, or itemIds differ, they cannot supersede
  if (!("itemId" in prevRecord.action) || !("itemId" in newAction)) {
    return false;
  }
  if (prevRecord.action.itemId !== newAction.itemId) {
    return false;
  }

  // Case 1: Postpone item affects the whole item
  if (newAction.type === "postpone_item") {
    return true;
  }

  // Case 2: Reassign time block
  if (newAction.type === "reassign_time_block") {
    if (prevRecord.action.type !== "reassign_time_block") {
      return false;
    }
    const prevAdj = prevRecord.action;
    // Checks if newAction is moving the same block:
    // Either moving from the result of the previous move (prevAdj.proposedBlock)
    // or referencing the same original slot (prevAdj.currentBlock)
    const matchesPreviousProposedSlot =
      newAction.currentBlock.day === prevAdj.proposedBlock.day &&
      newAction.currentBlock.startTime === prevAdj.proposedBlock.startTime &&
      newAction.currentBlock.endTime === prevAdj.proposedBlock.endTime;

    const matchesPreviousCurrentSlot =
      newAction.currentBlock.day === prevAdj.currentBlock.day &&
      newAction.currentBlock.startTime === prevAdj.currentBlock.startTime &&
      newAction.currentBlock.endTime === prevAdj.currentBlock.endTime;

    return matchesPreviousProposedSlot || matchesPreviousCurrentSlot;
  }

  // Case 3: Reallocate day work
  if (newAction.type === "reallocate_day_work") {
    if (prevRecord.action.type !== "reallocate_day_work") {
      return false;
    }
    const prevAdj = prevRecord.action;

    // Checks if the reallocation touches the same day relationship:
    // a) Exact same source and target day pair
    const samePair =
      newAction.sourceDay === prevAdj.sourceDay && newAction.targetDay === prevAdj.targetDay;

    // b) Reverse pair (reversing / moving back)
    const reversePair =
      newAction.sourceDay === prevAdj.targetDay && newAction.targetDay === prevAdj.sourceDay;

    // c) Chaining from the previous target day
    const chainFromTarget = newAction.sourceDay === prevAdj.targetDay;

    return samePair || reversePair || chainFromTarget;
  }

  return false;
}

/**
 * Pure, deterministic function to apply an accepted adjustment to a WeeklySchedule instance.
 *
 * Invariants & Guarantees (per ADR 0012):
 * 1. Optimistic Concurrency: Requires expectedScheduleVersion === schedule.version.
 *    Stale versions fail immediately with "stale_schedule_version" without mutating the schedule.
 * 2. Human Sovereignty: Only "accepted" decisions may alter the schedule.
 *    Rejected decisions record a failed audit record without mutating the schedule.
 * 3. Action Support: Directly applies "postpone_item", "reassign_time_block", and "reallocate_day_work".
 *    Actions without concrete temporal schedule transformations ("unblock_dependency", "accept_risk",
 *    "request_information") return "unsupported_action" without mutating the schedule.
 * 4. Temporal Integrity:
 *    - Preserves duration on time block reassignment.
 *    - Prevents schedule collisions on destination days.
 *    - Preserves exact total allocated hours on day work reallocation.
 *    - Enforces explicit DayConstraint limits (availableHours) on target days.
 *    - Does NOT invent synthetic universal limits on unconstrained days.
 * 5. Full Atomicity: Any validation error leaves the original schedule completely untouched.
 * 6. Historical Lifecycle: Previous active adjustments on the same scope transition to "superseded",
 *    preserving historical evidence without data loss.
 */
export function applyAdjustmentToSchedule(
  schedule: WeeklySchedule,
  decisionOrProposal: ApplyAdjustmentInput | AdjustmentProposal,
  expectedScheduleVersionOrOptions?: number | ApplyAdjustmentOptions,
  maybeOptions?: ApplyAdjustmentOptions
): ApplyAdjustmentResult {
  // 1. Normalize input arguments
  let input: ApplyAdjustmentInput;

  if ("actions" in decisionOrProposal && Array.isArray(decisionOrProposal.actions)) {
    const proposal = decisionOrProposal as AdjustmentProposal;
    const action = proposal.actions[0]!;
    const expectedVersion =
      typeof expectedScheduleVersionOrOptions === "number"
        ? expectedScheduleVersionOrOptions
        : schedule.version;
    const options =
      (typeof expectedScheduleVersionOrOptions === "object"
        ? expectedScheduleVersionOrOptions
        : maybeOptions) ?? {};

    if (!options.decidedAt || typeof options.decidedAt !== "string") {
      throw new Error(
        "Explicit 'decidedAt' ISO UTC timestamp is required for deterministic schedule adjustment application (R-03)"
      );
    }

    input = {
      proposalId: proposal.id,
      action,
      expectedScheduleVersion: expectedVersion,
      decidedAt: options.decidedAt,
      humanDecision: options.humanDecision ?? "accepted",
      userNotes: options.userNotes,
      adjustmentId: options.adjustmentId,
      appliedAt: options.appliedAt,
      activePlan: options.activePlan,
    };
  } else {
    input = { ...(decisionOrProposal as ApplyAdjustmentInput) };
    if (typeof expectedScheduleVersionOrOptions === "number") {
      input.expectedScheduleVersion = expectedScheduleVersionOrOptions;
    }
    const options =
      typeof expectedScheduleVersionOrOptions === "object"
        ? expectedScheduleVersionOrOptions
        : maybeOptions;
    if (options) {
      if (options.humanDecision !== undefined) input.humanDecision = options.humanDecision;
      if (options.decidedAt !== undefined) input.decidedAt = options.decidedAt;
      if (options.userNotes !== undefined) input.userNotes = options.userNotes;
      if (options.adjustmentId !== undefined) input.adjustmentId = options.adjustmentId;
      if (options.appliedAt !== undefined) input.appliedAt = options.appliedAt;
      if (options.activePlan !== undefined) input.activePlan = options.activePlan;
    }

    if (!input.decidedAt || typeof input.decidedAt !== "string") {
      throw new Error(
        "Explicit 'decidedAt' ISO UTC timestamp is required for deterministic schedule adjustment application (R-03)"
      );
    }
  }

  const {
    proposalId,
    action,
    expectedScheduleVersion,
    decidedAt,
    humanDecision,
    userNotes,
    activePlan,
  } = input;

  const resolvedAdjustmentId = input.adjustmentId ?? `adj-${proposalId}-${action.type}`;

  // Helper to create an immutable failure result with a valid diagnostic record
  function makeFailure(
    errorCode: ApplyAdjustmentErrorCode,
    failureReason: string
  ): ApplyAdjustmentFailure {
    const rawRecord = {
      adjustmentId: resolvedAdjustmentId,
      proposalId,
      action,
      expectedScheduleVersion,
      decidedAt,
      humanDecision,
      userNotes,
      applicationOutcome: "failed" as const,
      failureReason,
      lifecycleStatus: "active" as const,
    };

    const parseRes = ScheduleAdjustmentRecordSchema.safeParse(rawRecord);
    const failedRecord = parseRes.success ? parseRes.data : (rawRecord as ScheduleAdjustmentRecord);

    return {
      status: "failed",
      schedule, // Strictly original untouched schedule
      failedRecord,
      errorCode,
      failureReason,
    };
  }

  // 2. Concurrency Lock: Optimistic Concurrency check
  if (expectedScheduleVersion !== schedule.version) {
    return makeFailure(
      "stale_schedule_version",
      `Expected schedule version (${expectedScheduleVersion}) does not match current schedule version (${schedule.version})`
    );
  }

  // 3. Human Sovereignty: Explicit Acceptance check
  if (humanDecision !== "accepted") {
    return makeFailure(
      "decision_rejected",
      "Adjustment proposal was not accepted by the user (humanDecision is 'rejected')"
    );
  }

  // 4. Cross-domain validation against activePlan (when provided)
  if (activePlan) {
    if (
      schedule.weekRange.startDate !== activePlan.weekSummary.targetWeek.startDate ||
      schedule.weekRange.endDate !== activePlan.weekSummary.targetWeek.endDate
    ) {
      return makeFailure(
        "constraint_violation",
        `Schedule weekRange (${schedule.weekRange.startDate} to ${schedule.weekRange.endDate}) does not match activePlan targetWeek (${activePlan.weekSummary.targetWeek.startDate} to ${activePlan.weekSummary.targetWeek.endDate})`
      );
    }

    const planItemIds = new Set<string>([
      ...activePlan.foci.flatMap((f) => [f.id, ...f.contributingItemIds]),
      ...activePlan.obligations.map((o) => o.itemId),
      ...activePlan.flexibleOptions.map((opt) => opt.itemId),
      ...activePlan.deferredItems.map((d) => d.itemId),
    ]);

    if ("itemId" in action && action.itemId && !planItemIds.has(action.itemId)) {
      return makeFailure(
        "item_not_found",
        `Item '${action.itemId}' targeted by adjustment action '${action.type}' does not exist in activePlan`
      );
    }
  }

  // 5. Action Transformation
  let nextTimeBlocks = [...schedule.timeBlocks];
  let nextDailyAllocations = [...schedule.dailyAllocations];

  switch (action.type) {
    case "reassign_time_block": {
      // R-01: Ensure item identity matches across action and proposedBlock/currentBlock
      if (action.proposedBlock.itemId !== action.itemId) {
        return makeFailure(
          "constraint_violation",
          `Proposed block itemId '${action.proposedBlock.itemId}' does not match action itemId '${action.itemId}'`
        );
      }
      if (action.currentBlock.itemId !== action.itemId) {
        return makeFailure(
          "constraint_violation",
          `Current block itemId '${action.currentBlock.itemId}' does not match action itemId '${action.itemId}'`
        );
      }

      // Locate current block
      const currentIdx = schedule.timeBlocks.findIndex(
        (tb) =>
          tb.itemId === action.itemId &&
          tb.day === action.currentBlock.day &&
          tb.startTime === action.currentBlock.startTime &&
          tb.endTime === action.currentBlock.endTime
      );

      if (currentIdx === -1) {
        return makeFailure(
          "item_not_found",
          `Current time block for item '${action.itemId}' on ${action.currentBlock.day} (${action.currentBlock.startTime}-${action.currentBlock.endTime}) not found in schedule`
        );
      }

      // Check duration preservation
      const curDur =
        parseTimeToMinutes(action.currentBlock.endTime) -
        parseTimeToMinutes(action.currentBlock.startTime);
      const propDur =
        parseTimeToMinutes(action.proposedBlock.endTime) -
        parseTimeToMinutes(action.proposedBlock.startTime);

      if (curDur !== propDur) {
        return makeFailure(
          "duration_mismatch",
          `Proposed block duration (${propDur}m) does not match current block duration (${curDur}m)`
        );
      }

      // Check proposed block day within weekRange
      if (
        action.proposedBlock.day < schedule.weekRange.startDate ||
        action.proposedBlock.day > schedule.weekRange.endDate
      ) {
        return makeFailure(
          "constraint_violation",
          `Proposed block day '${action.proposedBlock.day}' is outside schedule weekRange (${schedule.weekRange.startDate} to ${schedule.weekRange.endDate})`
        );
      }

      // Check proposed block time order
      if (action.proposedBlock.startTime >= action.proposedBlock.endTime) {
        return makeFailure(
          "constraint_violation",
          `Proposed block startTime (${action.proposedBlock.startTime}) must be strictly before endTime (${action.proposedBlock.endTime})`
        );
      }

      // Check target day capacity constraints (zero-capacity day)
      const targetDayConstraint = schedule.dayConstraints?.find(
        (dc) => dc.day === action.proposedBlock.day
      );
      if (targetDayConstraint && targetDayConstraint.availableHours === 0) {
        return makeFailure(
          "constraint_violation",
          `Target day '${action.proposedBlock.day}' has 0 available hours declared in DayConstraint`
        );
      }

      // Check collision with existing blocks on proposed day (excluding the block being moved)
      for (let i = 0; i < schedule.timeBlocks.length; i++) {
        if (i === currentIdx) continue;
        const existing = schedule.timeBlocks[i]!;
        if (existing.day === action.proposedBlock.day) {
          const overlaps = !(
            action.proposedBlock.endTime <= existing.startTime ||
            existing.endTime <= action.proposedBlock.startTime
          );
          if (overlaps) {
            return makeFailure(
              "schedule_overlap",
              `Proposed block (${action.proposedBlock.startTime}-${action.proposedBlock.endTime}) overlaps with existing block for '${existing.itemId}' (${existing.startTime}-${existing.endTime}) on ${action.proposedBlock.day}`
            );
          }
        }
      }

      nextTimeBlocks[currentIdx] = action.proposedBlock;
      break;
    }

    case "reallocate_day_work": {
      // R-02: Forbid reflexive reallocation on the same day
      if (action.sourceDay === action.targetDay) {
        return makeFailure(
          "constraint_violation",
          `sourceDay and targetDay must be different in reallocate_day_work ('${action.sourceDay}')`
        );
      }

      // Check dates within weekRange
      if (
        action.sourceDay < schedule.weekRange.startDate ||
        action.sourceDay > schedule.weekRange.endDate ||
        action.targetDay < schedule.weekRange.startDate ||
        action.targetDay > schedule.weekRange.endDate
      ) {
        return makeFailure(
          "constraint_violation",
          `Source day '${action.sourceDay}' or target day '${action.targetDay}' is outside schedule weekRange (${schedule.weekRange.startDate} to ${schedule.weekRange.endDate})`
        );
      }

      // Locate source allocation
      const sourceAlloc = schedule.dailyAllocations.find(
        (a) => a.itemId === action.itemId && a.day === action.sourceDay
      );

      if (!sourceAlloc || sourceAlloc.allocatedHours < action.hoursToMove) {
        return makeFailure(
          "insufficient_source_hours",
          `Item '${action.itemId}' on source day '${action.sourceDay}' has ${sourceAlloc?.allocatedHours ?? 0}h allocated, insufficient for requested move of ${action.hoursToMove}h`
        );
      }

      // Check target day zero capacity
      const targetConstraint = schedule.dayConstraints?.find((dc) => dc.day === action.targetDay);
      if (targetConstraint && targetConstraint.availableHours === 0) {
        return makeFailure(
          "constraint_violation",
          `Target day '${action.targetDay}' has 0 available hours declared in DayConstraint`
        );
      }

      // Check target day explicit capacity limit
      if (targetConstraint && targetConstraint.availableHours > 0) {
        const currentTargetTotal = schedule.dailyAllocations
          .filter((a) => a.day === action.targetDay)
          .reduce((sum, a) => sum + a.allocatedHours, 0);

        const newTargetTotal = currentTargetTotal + action.hoursToMove;
        if (newTargetTotal > targetConstraint.availableHours) {
          return makeFailure(
            "constraint_violation",
            `Moving ${action.hoursToMove}h to '${action.targetDay}' would bring total allocated hours (${newTargetTotal}h) above availableHours (${targetConstraint.availableHours}h)`
          );
        }
      }

      // Reallocate with exact conservation of hours
      const remainingSourceHours = sourceAlloc.allocatedHours - action.hoursToMove;

      nextDailyAllocations = schedule.dailyAllocations.map((a) => {
        if (a.itemId === action.itemId && a.day === action.sourceDay) {
          return { ...a, allocatedHours: remainingSourceHours };
        }
        return a;
      });

      // Filter out zero-hour source allocation to avoid clutter and zero-capacity friction
      if (remainingSourceHours === 0) {
        nextDailyAllocations = nextDailyAllocations.filter(
          (a) => !(a.itemId === action.itemId && a.day === action.sourceDay)
        );
      }

      const existingTargetAlloc = nextDailyAllocations.find(
        (a) => a.itemId === action.itemId && a.day === action.targetDay
      );

      if (existingTargetAlloc) {
        nextDailyAllocations = nextDailyAllocations.map((a) =>
          a === existingTargetAlloc
            ? { ...a, allocatedHours: a.allocatedHours + action.hoursToMove }
            : a
        );
      } else {
        nextDailyAllocations.push({
          itemId: action.itemId,
          day: action.targetDay,
          allocatedHours: action.hoursToMove,
        });
      }

      // Mathematical conservation check
      const oldTotalHours = schedule.dailyAllocations.reduce((sum, a) => sum + a.allocatedHours, 0);
      const newTotalHours = nextDailyAllocations.reduce((sum, a) => sum + a.allocatedHours, 0);
      if (Math.abs(newTotalHours - oldTotalHours) > 1e-9) {
        return makeFailure(
          "invariant_violation",
          `Conservation of allocated hours violated: was ${oldTotalHours}h, resulting in ${newTotalHours}h`
        );
      }

      break;
    }

    case "postpone_item": {
      const hasTimeBlocks = schedule.timeBlocks.some((tb) => tb.itemId === action.itemId);
      const hasAllocations = schedule.dailyAllocations.some((da) => da.itemId === action.itemId);

      if (!hasTimeBlocks && !hasAllocations && !activePlan) {
        return makeFailure(
          "item_not_found",
          `Item '${action.itemId}' not found in schedule time blocks or daily allocations`
        );
      }

      nextTimeBlocks = schedule.timeBlocks.filter((tb) => tb.itemId !== action.itemId);
      nextDailyAllocations = schedule.dailyAllocations.filter((da) => da.itemId !== action.itemId);
      break;
    }

    case "unblock_dependency":
    case "accept_risk":
    case "request_information":
    default: {
      return makeFailure(
        "unsupported_action",
        `Action type '${action.type}' does not specify a concrete, verifiable temporal transformation on WeeklySchedule`
      );
    }
  }

  // 6. Lifecycle transition: supersede only genuinely overlapping adjustments on real scope (D-01)
  const resolvedAppliedAt = input.appliedAt ?? decidedAt;

  const updatedAdjustments: ScheduleAdjustmentRecord[] = schedule.appliedAdjustments.map((rec) => {
    if (isAdjustmentSupersededBy(rec, action)) {
      return {
        ...rec,
        lifecycleStatus: "superseded" as const,
      };
    }
    return rec;
  });

  const appliedRecord: ScheduleAdjustmentRecord = {
    adjustmentId: resolvedAdjustmentId,
    proposalId,
    action,
    expectedScheduleVersion,
    decidedAt,
    humanDecision: "accepted",
    userNotes,
    applicationOutcome: "applied",
    appliedAt: resolvedAppliedAt,
    lifecycleStatus: "active",
  };

  updatedAdjustments.push(appliedRecord);

  // 7. Assemble new schedule instance (version = schedule.version + 1)
  const newSchedule: WeeklySchedule = {
    ...schedule,
    version: schedule.version + 1,
    timeBlocks: nextTimeBlocks,
    dailyAllocations: nextDailyAllocations,
    appliedAdjustments: updatedAdjustments,
    updatedAt: resolvedAppliedAt,
  };

  // 8. Validate domain invariants on the resulting schedule
  const invariantCheck = validateWeeklyScheduleInvariants(newSchedule);
  if (!invariantCheck.valid) {
    return makeFailure(
      "invariant_violation",
      `Resulting schedule violates domain invariants: ${invariantCheck.errors.join("; ")}`
    );
  }

  return {
    status: "success",
    schedule: newSchedule,
    appliedRecord,
  };
}
