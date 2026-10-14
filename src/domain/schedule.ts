import { z } from "zod";
import {
  TargetWeekSchema,
  TargetWeek,
  DayConstraintSchema,
  DayConstraint,
  CalendarDateSchema,
  ProposedWeekSchema,
  ProposedWeek,
} from "./week";

export type CalendarDate = z.infer<typeof CalendarDateSchema>;
import {
  TimeBlockSchema,
  TimeBlock,
  DailyWorkAllocationSchema,
  DailyWorkAllocation,
} from "./conflict";
import {
  SuggestedAdjustmentActionSchema,
  SuggestedAdjustmentAction,
  AdjustmentProposal,
  PostponeItemAction,
  ReassignTimeBlockAction,
  ReallocateDayWorkAction,
  UnblockDependencyAction,
  AcceptRiskAction,
  RequestInformationAction,
} from "./adjustment";
import { IsoUtcTimestampSchema } from "./memory";

// Re-export shared temporal building blocks for convenience
export type {
  TimeBlock,
  DailyWorkAllocation,
  DayConstraint,
  TargetWeek,
  SuggestedAdjustmentAction,
  PostponeItemAction,
  ReassignTimeBlockAction,
  ReallocateDayWorkAction,
  UnblockDependencyAction,
  AcceptRiskAction,
  RequestInformationAction,
};
export {
  TimeBlockSchema,
  DailyWorkAllocationSchema,
  DayConstraintSchema,
  TargetWeekSchema,
  CalendarDateSchema,
  SuggestedAdjustmentActionSchema,
};

// ============================================================================
// 1. Adjustment Lifecycle Status Enums
// ============================================================================

/**
 * Human explicit decision on a proposed adjustment.
 * Follows the core rule: "AI proposes. The person decides."
 */
export const HumanDecisionSchema = z.enum(["accepted", "rejected"]);
export type HumanDecision = z.infer<typeof HumanDecisionSchema>;

/**
 * Technical outcome of applying an accepted adjustment onto the schedule.
 */
export const ApplicationOutcomeSchema = z.enum(["applied", "failed"]);
export type ApplicationOutcome = z.infer<typeof ApplicationOutcomeSchema>;

/**
 * Schedule lifecycle status of an applied adjustment.
 * Distinguishes the active adjustment from one superseded by a subsequent change
 * or reverted by an explicit undo action, preserving historical auditability.
 */
export const ScheduleLifecycleStatusSchema = z.enum([
  "active",
  "superseded",
  "reverted",
]);
export type ScheduleLifecycleStatus = z.infer<
  typeof ScheduleLifecycleStatusSchema
>;

// ============================================================================
// 2. Schedule Adjustment Record Schema
// ============================================================================

/**
 * Audit record of an adjustment evaluated by the human and applied to the schedule.
 * Decouples human decision from application outcome and temporal lifecycle.
 */
export const ScheduleAdjustmentRecordSchema = z
  .object({
    adjustmentId: z.string().min(1),
    proposalId: z.string().min(1),
    action: SuggestedAdjustmentActionSchema,
    expectedScheduleVersion: z.number().int().positive(),
    decidedAt: IsoUtcTimestampSchema,
    humanDecision: HumanDecisionSchema,
    userNotes: z.string().optional(),
    applicationOutcome: ApplicationOutcomeSchema,
    appliedAt: IsoUtcTimestampSchema.optional(),
    failureReason: z.string().optional(),
    lifecycleStatus: ScheduleLifecycleStatusSchema,
  })
  .strict()
  .superRefine((val, ctx) => {
    // Invariant: If human rejected, technical outcome cannot be applied
    if (val.humanDecision === "rejected" && val.applicationOutcome === "applied") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A rejected adjustment cannot have applicationOutcome 'applied'",
        path: ["applicationOutcome"],
      });
    }

    // Invariant: If applied, appliedAt is required and failureReason must be absent
    if (val.applicationOutcome === "applied") {
      if (!val.appliedAt) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "appliedAt is required when applicationOutcome is 'applied'",
          path: ["appliedAt"],
        });
      }
      if (val.failureReason) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "failureReason must be absent when applicationOutcome is 'applied'",
          path: ["failureReason"],
        });
      }
    }

    // Invariant: If failed, failureReason is required and appliedAt must be absent
    if (val.applicationOutcome === "failed") {
      if (!val.failureReason) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "failureReason is required when applicationOutcome is 'failed'",
          path: ["failureReason"],
        });
      }
      if (val.appliedAt) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "appliedAt must be absent when applicationOutcome is 'failed'",
          path: ["appliedAt"],
        });
      }
    }
    // Invariant (H-02): An adjustment that failed to apply was never active, so it cannot be superseded or reverted
    if (val.applicationOutcome === "failed" && val.lifecycleStatus !== "active") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "An adjustment that failed to apply cannot have lifecycleStatus 'superseded' or 'reverted'",
        path: ["lifecycleStatus"],
      });
    }
  });

export type ScheduleAdjustmentRecord = z.infer<
  typeof ScheduleAdjustmentRecordSchema
>;

/**
 * Canonical selector to obtain all adjustments that are currently applied and active on the schedule (H-05).
 * Excludes rejected, failed, superseded, and reverted adjustment records.
 * Returns a new array without mutating the schedule's historical record.
 */
export function getActiveAppliedAdjustments(
  schedule: WeeklySchedule
): ScheduleAdjustmentRecord[] {
  return schedule.appliedAdjustments.filter(
    (adj) =>
      adj.humanDecision === "accepted" &&
      adj.applicationOutcome === "applied" &&
      adj.lifecycleStatus === "active"
  );
}

// ============================================================================
// 3. Weekly Schedule Schema
// ============================================================================

/**
 * Representation of the temporal schedule state for a week.
 * Independent from ProposedWeek to avoid monolithic bloat and keep macro planning clean.
 */
export const WeeklyScheduleSchema = z
  .object({
    scheduleId: z.string().min(1),
    planId: z.string().min(1),
    weekRange: TargetWeekSchema,
    timeBlocks: z.array(TimeBlockSchema).default([]),
    dailyAllocations: z.array(DailyWorkAllocationSchema).default([]),
    dayConstraints: z.array(DayConstraintSchema).optional(),
    appliedAdjustments: z.array(ScheduleAdjustmentRecordSchema).default([]),
    version: z.number().int().positive().default(1),
    createdAt: IsoUtcTimestampSchema,
    updatedAt: IsoUtcTimestampSchema,
  })
  .strict();

export type WeeklySchedule = z.infer<typeof WeeklyScheduleSchema>;

// ============================================================================
// 4. Domain Invariant Validation Engine
// ============================================================================

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
      errors.push(
        `Duplicate DailyWorkAllocation for item '${alloc.itemId}' on day '${alloc.day}'`
      );
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
          errors.push(
            `TimeBlock '${tb.itemId}' scheduled on declared zero-capacity day '${day}'`
          );
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

// ============================================================================
// 5. Deterministic Adjustment Application Engine (applyAdjustmentToSchedule)
// ============================================================================

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
export type ApplyAdjustmentErrorCode = z.infer<
  typeof ApplyAdjustmentErrorCodeSchema
>;

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

export type ApplyAdjustmentResult =
  | ApplyAdjustmentSuccess
  | ApplyAdjustmentFailure;

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
      newAction.sourceDay === prevAdj.sourceDay &&
      newAction.targetDay === prevAdj.targetDay;

    // b) Reverse pair (reversing / moving back)
    const reversePair =
      newAction.sourceDay === prevAdj.targetDay &&
      newAction.targetDay === prevAdj.sourceDay;

    // c) Chaining from the previous target day
    const chainFromTarget =
      newAction.sourceDay === prevAdj.targetDay;

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

  const resolvedAdjustmentId =
    input.adjustmentId ?? `adj-${proposalId}-${action.type}`;

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
      const targetConstraint = schedule.dayConstraints?.find(
        (dc) => dc.day === action.targetDay
      );
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

