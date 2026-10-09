import { z } from "zod";
import { ExtractedItemSchema } from "./items";

export const DeadlineKindSchema = z.enum([
  "exact_date",
  "relative_date",
  "date_range",
  "recurring",
  "unspecified",
]);
export type DeadlineKind = z.infer<typeof DeadlineKindSchema>;

export const DeadlineConfidenceSchema = z.enum(["high", "medium", "low"]);
export type DeadlineConfidence = z.infer<typeof DeadlineConfidenceSchema>;

export const DetectedDeadlineSchema = z.object({
  itemId: z.string().min(1),
  raw: z.string().min(1),
  kind: DeadlineKindSchema,
  resolvedStart: z.string().nullable().optional(),
  resolvedEnd: z.string().nullable().optional(),
  confidence: DeadlineConfidenceSchema,
});
export type DetectedDeadline = z.infer<typeof DetectedDeadlineSchema>;

export const DetectedDeadlinesSchema = z.object({
  deadlines: z.array(DetectedDeadlineSchema),
});
export type DetectedDeadlines = z.infer<typeof DetectedDeadlinesSchema>;

export const DetectDeadlinesInputSchema = z.object({
  items: z.array(ExtractedItemSchema),
  currentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "currentDate must be ISO YYYY-MM-DD"),
  locale: z.string().optional(),
});
export type DetectDeadlinesInput = z.infer<typeof DetectDeadlinesInputSchema>;
