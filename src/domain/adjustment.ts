import { z } from "zod";
import { ProposedWeekSchema, CalendarDateSchema, DayConstraintSchema, ProposedWeek } from "./week";
import {
  DetectConflictOutputSchema,
  TimeBlockSchema,
  DailyWorkAllocationSchema,
  DetectedConflict,
  TimeBlock,
  DailyWorkAllocation,
} from "./conflict";
import { RelationshipSchema } from "./relationships";
import { AnalyzeChangeOutputSchema } from "./change";

// ============================================================================
// 1. Typed Adjustment Actions (Discriminated Union)
// ============================================================================

export const PostponeItemActionSchema = z
  .object({
    type: z.literal("postpone_item"),
    itemId: z.string().min(1),
    currentCategory: z.enum(["foci", "obligations", "flexible_options"]),
    targetReason: z.enum([
      "out_of_capacity",
      "waiting_dependency",
      "intentional_postponement",
    ]),
    hoursFreed: z.number().finite().positive().nullable(),
    rationale: z.string().min(1),
  })
  .strict();
export type PostponeItemAction = z.infer<typeof PostponeItemActionSchema>;

export const ReassignTimeBlockActionSchema = z
  .object({
    type: z.literal("reassign_time_block"),
    itemId: z.string().min(1),
    currentBlock: TimeBlockSchema,
    proposedBlock: TimeBlockSchema,
    rationale: z.string().min(1),
  })
  .strict();
export type ReassignTimeBlockAction = z.infer<typeof ReassignTimeBlockActionSchema>;

export const ReallocateDayWorkActionSchema = z
  .object({
    type: z.literal("reallocate_day_work"),
    itemId: z.string().min(1),
    sourceDay: CalendarDateSchema,
    targetDay: CalendarDateSchema,
    hoursToMove: z.number().finite().positive(),
    rationale: z.string().min(1),
  })
  .strict();
export type ReallocateDayWorkAction = z.infer<typeof ReallocateDayWorkActionSchema>;

export const UnblockDependencyActionSchema = z
  .object({
    type: z.literal("unblock_dependency"),
    dependentItemId: z.string().min(1),
    prerequisiteItemId: z.string().min(1),
    requiredAction: z.string().min(1),
    externalActor: z.string().min(1).optional(),
    rationale: z.string().min(1),
  })
  .strict();
export type UnblockDependencyAction = z.infer<typeof UnblockDependencyActionSchema>;

export const AcceptRiskActionSchema = z
  .object({
    type: z.literal("accept_risk"),
    conflictId: z.string().min(1),
    toleratedRisk: z.string().min(1),
    rationale: z.string().min(1),
  })
  .strict();
export type AcceptRiskAction = z.infer<typeof AcceptRiskActionSchema>;

export const RequestInformationActionSchema = z
  .object({
    type: z.literal("request_information"),
    targetItemId: z.string().min(1).optional(),
    missingField: z.enum([
      "estimated_hours",
      "calendar_date",
      "prerequisite_status",
      "capacity_availability",
    ]),
    question: z.string().min(1),
  })
  .strict();
export type RequestInformationAction = z.infer<typeof RequestInformationActionSchema>;

export const SuggestedAdjustmentActionSchema = z.discriminatedUnion("type", [
  PostponeItemActionSchema,
  ReassignTimeBlockActionSchema,
  ReallocateDayWorkActionSchema,
  UnblockDependencyActionSchema,
  AcceptRiskActionSchema,
  RequestInformationActionSchema,
]);
export type SuggestedAdjustmentAction = z.infer<typeof SuggestedAdjustmentActionSchema>;

// ============================================================================
// 2. Breakdown of Unresolved Conflicts Preserving Certainty
// ============================================================================

export const UnresolvedConflictsBreakdownSchema = z
  .object({
    confirmed: z.array(z.string().min(1)),
    potential: z.array(z.string().min(1)),
    insufficientInformation: z.array(z.string().min(1)),
  })
  .strict();
export type UnresolvedConflictsBreakdown = z.infer<typeof UnresolvedConflictsBreakdownSchema>;

// ============================================================================
// 3. Adjustment Proposal Schema
// ============================================================================

export const AdjustmentStrategySchema = z.enum([
  "postpone_foci",
  "postpone_flexible",
  "reallocate_time_blocks",
  "reallocate_daily_work",
  "unblock_prerequisite",
  "accept_tradeoff",
  "clarify_missing_data",
]);
export type AdjustmentStrategy = z.infer<typeof AdjustmentStrategySchema>;

export const ProposalViabilitySchema = z.enum([
  "viable",
  "conditional",
  "requires_clarification",
  "risk_accepted",
]);
export type ProposalViability = z.infer<typeof ProposalViabilitySchema>;

export const AdjustmentProposalSchema = z
  .object({
    id: z.string().min(1),
    strategy: AdjustmentStrategySchema,
    title: z.string().min(1),
    explanation: z.string().min(1),
    viability: ProposalViabilitySchema,
    viabilityCondition: z.string().min(1).nullable(),

    addressedConflictIds: z.array(z.string().min(1)).min(1),
    resolvedConflictIds: z.array(z.string().min(1)),
    unresolvedConflictIds: z.array(z.string().min(1)),
    unresolvedBreakdown: UnresolvedConflictsBreakdownSchema,

    netHoursFreed: z.number().finite().nullable(),
    resultingPlannedHours: z.number().finite().nonnegative().nullable(),

    affectedPlanItemIds: z.array(z.string().min(1)),
    retainedPlanItemIds: z.array(z.string().min(1)),
    previouslyDeferredItemIds: z.array(z.string().min(1)),

    actions: z.array(SuggestedAdjustmentActionSchema).min(1),
    tradeoffs: z.array(z.string().min(1)).min(1),
  })
  .strict()
  .refine(
    (data) => {
      if (data.viability === "conditional") {
        return data.viabilityCondition !== null && data.viabilityCondition.trim().length > 0;
      }
      return true;
    },
    {
      message: "viabilityCondition must be non-empty when viability is 'conditional'",
      path: ["viabilityCondition"],
    }
  )
  .refine(
    (data) => {
      if (data.viability !== "viable" && data.resolvedConflictIds.length > 0) {
        return false;
      }
      return true;
    },
    {
      message: "Only 'viable' proposals can declare resolvedConflictIds",
      path: ["resolvedConflictIds"],
    }
  )
  .refine(
    (data) => {
      return data.resolvedConflictIds.every((id) => data.addressedConflictIds.includes(id));
    },
    {
      message: "resolvedConflictIds must be a subset of addressedConflictIds",
      path: ["resolvedConflictIds"],
    }
  );
export type AdjustmentProposal = z.infer<typeof AdjustmentProposalSchema>;

// ============================================================================
// 4. Input & Output Contracts
// ============================================================================

export const ProposeAdjustmentUserPreferencesSchema = z
  .object({
    maxProposals: z.number().int().min(1).max(3).default(3),
    preferredStrategy: z
      .enum(["postpone", "reallocate", "unblock", "minimize_changes"])
      .optional(),
  })
  .strict();
export type ProposeAdjustmentUserPreferences = z.infer<
  typeof ProposeAdjustmentUserPreferencesSchema
>;

export const ProposeAdjustmentInputSchema = z
  .object({
    activePlan: ProposedWeekSchema,
    conflictReport: DetectConflictOutputSchema.optional(),
    changeAnalysis: AnalyzeChangeOutputSchema.optional(),
    timeBlocks: z.array(TimeBlockSchema).optional(),
    dailyAllocations: z.array(DailyWorkAllocationSchema).optional(),
    relationships: z.array(RelationshipSchema).optional(),
    dayConstraints: z.array(DayConstraintSchema).optional(),
    userPreferences: ProposeAdjustmentUserPreferencesSchema.optional(),
  })
  .strict();
export type ProposeAdjustmentInput = z.infer<typeof ProposeAdjustmentInputSchema>;

export const ProposeAdjustmentStatusSchema = z.enum([
  "adjustments_proposed",
  "no_adjustment_needed",
  "clarification_required",
  "no_viable_alternatives",
]);
export type ProposeAdjustmentStatus = z.infer<typeof ProposeAdjustmentStatusSchema>;

export const ProposeAdjustmentOutputSchema = z
  .object({
    status: ProposeAdjustmentStatusSchema,
    unaddressedConflictIds: z.array(z.string().min(1)),
    proposals: z.array(AdjustmentProposalSchema).max(3),
    clarificationQuestions: z.array(z.string().min(1)),
    summary: z.string().min(1),
  })
  .strict();
export type ProposeAdjustmentOutput = z.infer<typeof ProposeAdjustmentOutputSchema>;

// ============================================================================
// 5. Invariant Validation Helper Utilities
// ============================================================================

export function getAllPlanItemIds(activePlan: ProposedWeek): Set<string> {
  const ids = new Set<string>();
  for (const focus of activePlan.foci) {
    for (const id of focus.contributingItemIds) {
      ids.add(id);
    }
  }
  for (const ob of activePlan.obligations) {
    ids.add(ob.itemId);
  }
  for (const opt of activePlan.flexibleOptions) {
    ids.add(opt.itemId);
  }
  for (const def of activePlan.deferredItems) {
    ids.add(def.itemId);
  }
  return ids;
}

export function validateProposalInvariants(
  proposal: AdjustmentProposal,
  activePlan: ProposedWeek,
  conflicts: DetectedConflict[] = [],
  timeBlocks: TimeBlock[] = [],
  dailyAllocations: DailyWorkAllocation[] = []
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const planItemIds = getAllPlanItemIds(activePlan);

  // 1. Strict Item Partition: affected + retained + previouslyDeferred === 100% of planItemIds
  const affectedSet = new Set(proposal.affectedPlanItemIds);
  const retainedSet = new Set(proposal.retainedPlanItemIds);
  const previouslyDeferredSet = new Set(proposal.previouslyDeferredItemIds);

  if (proposal.affectedPlanItemIds.length !== affectedSet.size) {
    errors.push("affectedPlanItemIds contains duplicate IDs");
  }
  if (proposal.retainedPlanItemIds.length !== retainedSet.size) {
    errors.push("retainedPlanItemIds contains duplicate IDs");
  }
  if (proposal.previouslyDeferredItemIds.length !== previouslyDeferredSet.size) {
    errors.push("previouslyDeferredItemIds contains duplicate IDs");
  }

  // Check pairwise disjointness
  for (const id of affectedSet) {
    if (retainedSet.has(id)) {
      errors.push(`Item "${id}" is present in both affected and retained lists`);
    }
    if (previouslyDeferredSet.has(id)) {
      errors.push(`Item "${id}" is present in both affected and previouslyDeferred lists`);
    }
  }
  for (const id of retainedSet) {
    if (previouslyDeferredSet.has(id)) {
      errors.push(`Item "${id}" is present in both retained and previouslyDeferred lists`);
    }
  }

  // Check that union equals planItemIds exactly
  const unionSet = new Set([
    ...proposal.affectedPlanItemIds,
    ...proposal.retainedPlanItemIds,
    ...proposal.previouslyDeferredItemIds,
  ]);

  for (const id of unionSet) {
    if (!planItemIds.has(id)) {
      errors.push(`Phantom itemId "${id}" not found in activePlan`);
    }
  }
  for (const id of planItemIds) {
    if (!unionSet.has(id)) {
      errors.push(`Item "${id}" is omitted from the proposal partition`);
    }
  }

  // 2. Mathematical Consistency (Raw balance check)
  const origPlanned = activePlan.weekSummary.capacity.plannedHours;
  if (proposal.netHoursFreed !== null && origPlanned !== null) {
    const rawBalance = origPlanned - proposal.netHoursFreed;
    if (rawBalance < 0) {
      errors.push(
        `Mathematical inconsistency: raw balance (${rawBalance}) is negative. Freed hours exceed planned hours.`
      );
    }
    if (proposal.resultingPlannedHours !== null && proposal.resultingPlannedHours !== rawBalance) {
      errors.push(
        `resultingPlannedHours (${proposal.resultingPlannedHours}) does not match raw balance (${rawBalance})`
      );
    }
  }

  // 3. Action Reference Validation
  const conflictMap = new Map(conflicts.map((c) => [c.id, c]));

  for (const action of proposal.actions) {
    if ("itemId" in action && action.itemId && !planItemIds.has(action.itemId)) {
      errors.push(`Action references nonexistent itemId "${action.itemId}"`);
    }
    if ("targetItemId" in action && action.targetItemId && !planItemIds.has(action.targetItemId)) {
      errors.push(`Action references nonexistent targetItemId "${action.targetItemId}"`);
    }
    if (action.type === "unblock_dependency") {
      if (!planItemIds.has(action.dependentItemId)) {
        errors.push(`unblock_dependency references nonexistent dependentItemId "${action.dependentItemId}"`);
      }
      if (!planItemIds.has(action.prerequisiteItemId)) {
        errors.push(`unblock_dependency references nonexistent prerequisiteItemId "${action.prerequisiteItemId}"`);
      }
    }
    if ("conflictId" in action && action.conflictId && !conflictMap.has(action.conflictId)) {
      errors.push(`Action references nonexistent conflictId "${action.conflictId}"`);
    }

    if (action.type === "reassign_time_block") {
      // Proposed block must not collide with other existing blocks
      for (const tb of timeBlocks) {
        const isOriginalBlockBeingReassigned =
          tb.itemId === action.currentBlock.itemId &&
          tb.day === action.currentBlock.day &&
          tb.startTime === action.currentBlock.startTime &&
          tb.endTime === action.currentBlock.endTime;

        if (
          !isOriginalBlockBeingReassigned &&
          tb.day === action.proposedBlock.day &&
          action.proposedBlock.startTime < tb.endTime &&
          tb.startTime < action.proposedBlock.endTime
        ) {
          errors.push(
            `Proposed block for "${action.itemId}" collides with existing block for "${tb.itemId}" on ${tb.day} (${tb.startTime}-${tb.endTime})`
          );
        }
      }
    }

    if (action.type === "reallocate_day_work") {
      const sourceAllocation = dailyAllocations.find(
        (a) => a.itemId === action.itemId && a.day === action.sourceDay
      );
      if (!sourceAllocation || sourceAllocation.allocatedHours < action.hoursToMove) {
        errors.push(
          `reallocate_day_work requires allocation of at least ${action.hoursToMove}h for "${action.itemId}" on source day ${action.sourceDay}`
        );
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
