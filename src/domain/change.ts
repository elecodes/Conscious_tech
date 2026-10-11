import { z } from "zod";
import { ExtractedItemSchema } from "./items";
import { ProposedWeekSchema, CalendarDateSchema } from "./week";
import { RelationshipTypeSchema } from "./relationships";

// ============================================================================
// Core Enums & Primitives
// ============================================================================

export const ChangeTypeSchema = z.enum([
  "new_item",
  "drop_item",
  "modified_item",
  "deadline_change",
  "dependency_change",
  "capacity_change",
  "mixed_change",
  "none_detected",
]);
export type ChangeType = z.infer<typeof ChangeTypeSchema>;

export const ImpactCategorySchema = z.enum([
  "direct_target",
  "focus_integrity",
  "causal_dependency",
  "capacity_overload",
  "deadline_risk",
  "preparation_requirement",
  "unaffected",
]);
export type ImpactCategory = z.infer<typeof ImpactCategorySchema>;

export const ImpactCertaintySchema = z.enum([
  "confirmed",
  "potential",
  "insufficient_information",
]);
export type ImpactCertainty = z.infer<typeof ImpactCertaintySchema>;

export const DependencyStateSchema = z.enum([
  "satisfied",
  "pending",
  "unknown",
]);
export type DependencyState = z.infer<typeof DependencyStateSchema>;

export const TemporalScopeSchema = z.enum([
  "current_week",
  "future_week",
  "past",
  "timeless",
]);
export type TemporalScope = z.infer<typeof TemporalScopeSchema>;

export const CommitmentNatureSchema = z.enum([
  "external_commitment",
  "event_date",
  "preparation_task",
  "internal_deadline",
  "none",
]);
export type CommitmentNature = z.infer<typeof CommitmentNatureSchema>;

export const ArithmeticBalanceSchema = z.enum([
  "surplus_known",
  "deficit_known",
  "indeterminate",
  "unknown_capacity",
]);
export type ArithmeticBalance = z.infer<typeof ArithmeticBalanceSchema>;

export const AnalyzeChangeStatusSchema = z.enum([
  "analyzed",
  "no_impact",
  "invalid_references",
  "ambiguous_change",
]);
export type AnalyzeChangeStatus = z.infer<typeof AnalyzeChangeStatusSchema>;

// ============================================================================
// Incoming Change Delta Specification
// ============================================================================

export const ItemDeltaOperationSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("add"),
    item: ExtractedItemSchema,
  }),
  z.object({
    op: z.literal("remove"),
    itemId: z.string().min(1),
  }),
  z.object({
    op: z.literal("modify"),
    itemId: z.string().min(1),
    patch: z.object({
      title: z.string().min(1).optional(),
      description: z.string().optional(),
      estimatedHours: z.number().finite().nonnegative().nullable().optional(),
      urgency: z.string().optional(),
    }),
  }),
]);
export type ItemDeltaOperation = z.infer<typeof ItemDeltaOperationSchema>;

export const RelationshipDeltaOperationSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("add"),
    sourceItemId: z.string().min(1),
    targetItemId: z.string().min(1),
    type: RelationshipTypeSchema,
  }),
  z.object({
    op: z.literal("remove"),
    sourceItemId: z.string().min(1),
    targetItemId: z.string().min(1),
    type: RelationshipTypeSchema.optional(),
  }),
]);
export type RelationshipDeltaOperation = z.infer<typeof RelationshipDeltaOperationSchema>;

export const DeadlineDeltaOperationSchema = z.object({
  itemId: z.string().min(1),
  previousDueDate: CalendarDateSchema.nullable().optional(),
  newDueDate: CalendarDateSchema.nullable(),
});
export type DeadlineDeltaOperation = z.infer<typeof DeadlineDeltaOperationSchema>;

export const CapacityDeltaOperationSchema = z.object({
  previousAvailableHours: z.number().finite().nonnegative().nullable().optional(),
  newAvailableHours: z.number().finite().nonnegative().nullable(),
});
export type CapacityDeltaOperation = z.infer<typeof CapacityDeltaOperationSchema>;

export const IncomingChangeDeltaSchema = z.object({
  itemOperations: z.array(ItemDeltaOperationSchema).optional(),
  relationshipOperations: z.array(RelationshipDeltaOperationSchema).optional(),
  deadlineOperations: z.array(DeadlineDeltaOperationSchema).optional(),
  capacityOperations: z.array(CapacityDeltaOperationSchema).optional(),
}).strict();
export type IncomingChangeDelta = z.infer<typeof IncomingChangeDeltaSchema>;

// ============================================================================
// Input & Validation Schemas
// ============================================================================

export const AnalyzeChangeInputSchema = z.object({
  currentDate: CalendarDateSchema,
  activePlan: ProposedWeekSchema,
  changeDescription: z.string().min(1),
  incomingDelta: IncomingChangeDeltaSchema.optional(),
}).strict();
export type AnalyzeChangeInput = z.infer<typeof AnalyzeChangeInputSchema>;

export const ValidationErrorSchema = z.object({
  type: z.enum([
    "unresolved_reference",
    "invalid_operation",
    "malformed_delta",
  ]),
  referenceId: z.string().optional(),
  message: z.string().min(1),
  fatal: z.boolean(),
}).strict();
export type ValidationError = z.infer<typeof ValidationErrorSchema>;

// ============================================================================
// Detailed Impact Elements
// ============================================================================

export const AffectedElementSchema = z.object({
  elementId: z.string().min(1),
  elementType: z.enum([
    "focus",
    "obligation",
    "flexible_option",
    "deferred_item",
    "unplanned_space",
    "item",
  ]),
  category: ImpactCategorySchema,
  certainty: ImpactCertaintySchema,
  explanation: z.string().min(1),
  dependencyState: DependencyStateSchema.optional(),
  temporalScope: TemporalScopeSchema.optional(),
  commitmentNature: CommitmentNatureSchema.optional(),
}).strict();
export type AffectedElement = z.infer<typeof AffectedElementSchema>;

export const CapacityImpactAnalysisSchema = z.object({
  previousTotalHours: z.number().finite().nonnegative().nullable(),
  projectedTotalHours: z.number().finite().nonnegative().nullable(),
  deltaHours: z.number().finite().nullable(),
  arithmeticBalance: ArithmeticBalanceSchema,
  notes: z.string().min(1),
}).strict();
export type CapacityImpactAnalysis = z.infer<typeof CapacityImpactAnalysisSchema>;

export const UnaffectedAreaVerificationSchema = z.object({
  areaName: z.string().min(1),
  elementIds: z.array(z.string().min(1)),
  isolationReason: z.string().min(1),
}).strict();
export type UnaffectedAreaVerification = z.infer<typeof UnaffectedAreaVerificationSchema>;

// ============================================================================
// Output Contract: AnalyzeChangeOutput
// ============================================================================

export const AnalyzeChangeOutputSchema = z.object({
  status: AnalyzeChangeStatusSchema,
  changeType: ChangeTypeSchema,
  summary: z.string().min(1),
  affectedElements: z.array(AffectedElementSchema),
  capacityImpact: CapacityImpactAnalysisSchema,
  unaffectedAreas: z.array(UnaffectedAreaVerificationSchema),
  validationErrors: z.array(ValidationErrorSchema),
  requiresUserIntervention: z.boolean(),
  interventionReason: z.string().nullable(),
}).strict();
export type AnalyzeChangeOutput = z.infer<typeof AnalyzeChangeOutputSchema>;
