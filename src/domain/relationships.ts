import { z } from "zod";
import { ExtractedItemSchema } from "./items";

export const RelationshipTypeSchema = z.enum([
  "same_project",
  "same_objective",
  "related_to",
  "part_of",
  "depends_on",
  "blocks",
  "duplicate",
]);
export type RelationshipType = z.infer<typeof RelationshipTypeSchema>;

export const RelationshipConfidenceSchema = z.enum(["high", "medium", "low"]);
export type RelationshipConfidence = z.infer<typeof RelationshipConfidenceSchema>;

export const RelationshipSchema = z.object({
  sourceItemId: z.string().min(1),
  targetItemId: z.string().min(1),
  type: RelationshipTypeSchema,
  confidence: RelationshipConfidenceSchema,
  reason: z.string().min(1),
});
export type Relationship = z.infer<typeof RelationshipSchema>;

export const DetectedRelationshipsSchema = z.object({
  relationships: z.array(RelationshipSchema),
});
export type DetectedRelationships = z.infer<typeof DetectedRelationshipsSchema>;

export const DetectRelationshipsInputSchema = z.object({
  items: z.array(ExtractedItemSchema),
});
export type DetectRelationshipsInput = z.infer<typeof DetectRelationshipsInputSchema>;
