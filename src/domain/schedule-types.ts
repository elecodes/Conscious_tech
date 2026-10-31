import { z } from "zod";
import {
  TargetWeekSchema,
  TargetWeek,
  DayConstraintSchema,
  DayConstraint,
  CalendarDateSchema,
} from "./week";
import {
  TimeBlockSchema,
  TimeBlock,
  DailyWorkAllocationSchema,
  DailyWorkAllocation,
} from "./conflict";
import {
  SuggestedAdjustmentActionSchema,
  SuggestedAdjustmentAction,
  PostponeItemAction,
  ReassignTimeBlockAction,
  ReallocateDayWorkAction,
  UnblockDependencyAction,
  AcceptRiskAction,
  RequestInformationAction,
} from "./adjustment";
import { IsoUtcTimestampSchema } from "./memory";

export type CalendarDate = z.infer<typeof CalendarDateSchema>;

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
export const ScheduleLifecycleStatusSchema = z.enum(["active", "superseded", "reverted"]);
export type ScheduleLifecycleStatus = z.infer<typeof ScheduleLifecycleStatusSchema>;

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
        message:
          "An adjustment that failed to apply cannot have lifecycleStatus 'superseded' or 'reverted'",
        path: ["lifecycleStatus"],
      });
    }
  });

export type ScheduleAdjustmentRecord = z.infer<typeof ScheduleAdjustmentRecordSchema>;

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
