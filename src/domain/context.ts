import { z } from "zod";
import { ExtractedItemSchema } from "./items";
import { RelationshipSchema } from "./relationships";
import { GroupedWorkSchema } from "./work-groups";
import { DetectedDeadlinesSchema } from "./deadlines";

export const DeclaredGoalSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
});
export type DeclaredGoal = z.infer<typeof DeclaredGoalSchema>;

export const ContextAttentionLevelSchema = z.enum(["high", "medium", "low", "unclear"]);
export type ContextAttentionLevel = z.infer<typeof ContextAttentionLevelSchema>;

export const ContextRelevanceLevelSchema = z.enum(["high", "medium", "low", "unclear"]);
export type ContextRelevanceLevel = z.infer<typeof ContextRelevanceLevelSchema>;

export const ContextSignalSchema = z.enum([
  "external_commitment",
  "approaching_deadline",
  "overdue_deadline",
  "explicit_importance",
  "already_started",
  "dependency",
  "supports_declared_goal",
  "waiting",
  "insufficient_information",
]);
export type ContextSignal = z.infer<typeof ContextSignalSchema>;

export const ItemContextAssessmentSchema = z.object({
  itemId: z.string().min(1),
  attention: ContextAttentionLevelSchema,
  signals: z.array(ContextSignalSchema),
  rationale: z.string().min(1),
});
export type ItemContextAssessment = z.infer<typeof ItemContextAssessmentSchema>;

export const GroupContextAssessmentSchema = z.object({
  groupId: z.string().min(1),
  relevance: ContextRelevanceLevelSchema,
  rationale: z.string().min(1),
});
export type GroupContextAssessment = z.infer<typeof GroupContextAssessmentSchema>;

export const OpenQuestionSchema = z.object({
  topic: z.string().min(1),
  question: z.string().min(1),
  relatedItemIds: z.array(z.string().min(1)),
  reason: z.string().min(1),
});
export type OpenQuestion = z.infer<typeof OpenQuestionSchema>;

export const EvaluateContextOutputSchema = z.object({
  itemAssessments: z.array(ItemContextAssessmentSchema),
  groupAssessments: z.array(GroupContextAssessmentSchema),
  openQuestions: z.array(OpenQuestionSchema),
});
export type EvaluateContextOutput = z.infer<typeof EvaluateContextOutputSchema>;

export const EvaluateContextInputSchema = z.object({
  currentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "currentDate must be ISO YYYY-MM-DD"),
  locale: z.string().optional(),
  items: z.array(ExtractedItemSchema),
  relationships: z.array(RelationshipSchema),
  groupedWork: GroupedWorkSchema,
  deadlines: DetectedDeadlinesSchema,
  declaredGoals: z.array(DeclaredGoalSchema).optional(),
});
export type EvaluateContextInput = z.infer<typeof EvaluateContextInputSchema>;
