import { z } from "zod";
import { ProposedWeekSchema, TargetWeekSchema } from "./week";
import { IsoUtcTimestampSchema, StoreCandidateSchema } from "./memory";
import { WeeklyScheduleSchema, WeeklySchedule } from "./schedule";

export type {
  ProposedWeek,
  TargetWeek,
  WeeklyFocus,
  WeeklyObligation,
  WeeklyFlexibleOption,
  DeferredItem,
} from "./week";
export type { StoreCandidate } from "./memory";
export type { WeeklySchedule };
export { WeeklyScheduleSchema };

// ============================================================================
// 1. Core Outcome Statuses & Input Schemas
// ============================================================================

export const ItemOutcomeStatusSchema = z.enum([
  "completed",
  "in_progress",
  "not_started",
  "consciously_postponed",
  "dropped",
]);
export type ItemOutcomeStatus = z.infer<typeof ItemOutcomeStatusSchema>;

export const FinalItemDispositionSchema = z.enum([
  "completed",
  "in_progress",
  "not_started",
  "consciously_postponed",
  "dropped",
  "unreported",
]);
export type FinalItemDisposition = z.infer<typeof FinalItemDispositionSchema>;

export const PlanCategoryOriginSchema = z.enum([
  "focus",
  "obligation",
  "flexible_option",
  "deferred",
]);
export type PlanCategoryOrigin = z.infer<typeof PlanCategoryOriginSchema>;

export const ItemOutcomeInputSchema = z
  .object({
    itemId: z.string().min(1),
    status: ItemOutcomeStatusSchema,
    actualHours: z.number().finite().nonnegative().nullable().optional(),
    userNotes: z.string().min(1).optional(),
    postponementReason: z.string().min(1).optional(),
  })
  .strict();
export type ItemOutcomeInput = z.infer<typeof ItemOutcomeInputSchema>;

export const UserReflectionInputSchema = z
  .object({
    energyLevel: z.enum(["drained", "balanced", "energized"]).optional(),
    generalNotes: z.string().min(1).optional(),
  })
  .strict();
export type UserReflectionInput = z.infer<typeof UserReflectionInputSchema>;

export const ClosedAtTimestampSchema = z.preprocess((val) => {
  if (typeof val === "string" && /^\d{4}-\d{2}-\d{2}$/.test(val)) {
    return `${val}T23:59:59.000Z`;
  }
  return val;
}, IsoUtcTimestampSchema);

export const CloseWeekInputSchema = z
  .object({
    closedAt: ClosedAtTimestampSchema,
    activePlan: ProposedWeekSchema,
    planId: z.string().optional(),
    schedule: WeeklyScheduleSchema.optional(),
    itemOutcomes: z.array(ItemOutcomeInputSchema).default([]),
    userReflection: UserReflectionInputSchema.optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.schedule) {
      // 1. Cross-validate week range
      if (
        val.schedule.weekRange.startDate !== val.activePlan.weekSummary.targetWeek.startDate ||
        val.schedule.weekRange.endDate !== val.activePlan.weekSummary.targetWeek.endDate
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Schedule weekRange (${val.schedule.weekRange.startDate} to ${val.schedule.weekRange.endDate}) does not match activePlan targetWeek (${val.activePlan.weekSummary.targetWeek.startDate} to ${val.activePlan.weekSummary.targetWeek.endDate})`,
          path: ["schedule", "weekRange"],
        });
      }

      // 2. Cross-validate planId coherence when planId is provided
      const expectedPlanId =
        val.planId ?? (val.activePlan as Record<string, unknown>).planId;
      if (
        typeof expectedPlanId === "string" &&
        val.schedule.planId !== expectedPlanId
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Schedule planId (${val.schedule.planId}) does not match expected planId (${expectedPlanId})`,
          path: ["schedule", "planId"],
        });
      }
    }
  });
export type CloseWeekInput = z.infer<typeof CloseWeekInputSchema>;

// ============================================================================
// 2. Output Sub-Schemas
// ============================================================================

export const ClassifiedPlanItemSchema = z
  .object({
    itemId: z.string().min(1),
    title: z.string().min(1),
    originCategory: PlanCategoryOriginSchema,
    finalDisposition: FinalItemDispositionSchema,
    estimatedHours: z.number().finite().nonnegative().nullable(),
    actualHours: z.number().finite().nonnegative().nullable(),
    isReported: z.boolean(),
    userNotes: z.string().optional(),
    postponementReason: z.string().optional(),
  })
  .strict();
export type ClassifiedPlanItem = z.infer<typeof ClassifiedPlanItemSchema>;

export const FocusOutcomeStatusSchema = z.enum([
  "achieved",
  "partially_achieved",
  "deferred",
  "dropped",
  "unreported",
]);
export type FocusOutcomeStatus = z.infer<typeof FocusOutcomeStatusSchema>;

export const FocusOutcomeSummarySchema = z
  .object({
    focusId: z.string().min(1),
    title: z.string().min(1),
    outcome: FocusOutcomeStatusSchema,
    contributingItemIds: z.array(z.string().min(1)),
    completedItemIds: z.array(z.string().min(1)),
    pendingItemIds: z.array(z.string().min(1)),
    unreportedItemIds: z.array(z.string().min(1)),
  })
  .strict();
export type FocusOutcomeSummary = z.infer<typeof FocusOutcomeSummarySchema>;

export const ObligationOutcomeStatusSchema = z.enum([
  "completed",
  "in_progress",
  "postponed",
  "dropped",
  "unreported",
]);
export type ObligationOutcomeStatus = z.infer<typeof ObligationOutcomeStatusSchema>;

export const ObligationOutcomeSummarySchema = z
  .object({
    itemId: z.string().min(1),
    title: z.string().min(1),
    outcome: ObligationOutcomeStatusSchema,
    dueDate: z.string().optional(),
  })
  .strict();
export type ObligationOutcomeSummary = z.infer<typeof ObligationOutcomeSummarySchema>;

export const CapacityAnalysisStatusSchema = z.enum([
  "complete",
  "partial",
  "no_actual_data",
  "unknown_estimates",
]);
export type CapacityAnalysisStatus = z.infer<typeof CapacityAnalysisStatusSchema>;

export const CapacityAnalysisSchema = z
  .object({
    status: CapacityAnalysisStatusSchema,
    totalPlannedHours: z.number().finite().nonnegative().nullable(),
    totalActualHours: z.number().finite().nonnegative().nullable(),
    reportedHoursItemCount: z.number().int().nonnegative(),
    totalPlanItemCount: z.number().int().nonnegative(),
    protectedSpaceHours: z.number().finite().nonnegative().nullable(),
    spaceRespected: z.boolean().nullable(),
    explanation: z.string().min(1),
  })
  .strict();
export type CapacityAnalysis = z.infer<typeof CapacityAnalysisSchema>;

export const CarryOverReasonSchema = z.enum([
  "in_progress",
  "not_started",
  "consciously_postponed",
  "not_scheduled",
  "unreported",
]);
export type CarryOverReason = z.infer<typeof CarryOverReasonSchema>;

export const CarryOverCandidateSchema = z
  .object({
    itemId: z.string().min(1),
    title: z.string().min(1),
    originCategory: PlanCategoryOriginSchema,
    reason: CarryOverReasonSchema,
    details: z.string().min(1),
  })
  .strict();
export type CarryOverCandidate = z.infer<typeof CarryOverCandidateSchema>;

export const ItemDispositionsSchema = z
  .object({
    completed: z.array(z.string().min(1)),
    carryOverCandidates: z.array(CarryOverCandidateSchema),
    dropped: z.array(z.string().min(1)),
    unreported: z.array(z.string().min(1)),
  })
  .strict();
export type ItemDispositions = z.infer<typeof ItemDispositionsSchema>;

export const ReflectiveSummarySchema = z
  .object({
    headline: z.string().min(1),
    accomplishments: z.array(z.string().min(1)),
    inProgressWork: z.array(z.string().min(1)),
    consciousPostponements: z.array(z.string().min(1)),
    droppedItems: z.array(z.string().min(1)),
    unreportedItems: z.array(z.string().min(1)),
    questionsForNextCycle: z.array(z.string().min(1)),
  })
  .strict();
export type ReflectiveSummary = z.infer<typeof ReflectiveSummarySchema>;

export const CloseWeekStatusSchema = z.enum([
  "success",
  "partial_data",
  "invalid_request",
]);
export type CloseWeekStatus = z.infer<typeof CloseWeekStatusSchema>;

export const CloseWeekOutputSchema = z
  .object({
    status: CloseWeekStatusSchema,
    closedAt: ClosedAtTimestampSchema,
    weekRange: TargetWeekSchema,
    fociOutcomes: z.array(FocusOutcomeSummarySchema),
    obligationsOutcomes: z.array(ObligationOutcomeSummarySchema),
    classifiedItems: z.array(ClassifiedPlanItemSchema),
    itemDispositions: ItemDispositionsSchema,
    capacityAnalysis: CapacityAnalysisSchema,
    memoryCandidates: z.array(StoreCandidateSchema),
    reflectiveSummary: ReflectiveSummarySchema,
    warnings: z.array(z.string().min(1)),
  })
  .strict();
export type CloseWeekOutput = z.infer<typeof CloseWeekOutputSchema>;
