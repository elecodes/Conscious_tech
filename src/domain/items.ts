import { z } from "zod";

export const ItemTypeSchema = z.enum([
  "task",
  "project",
  "idea",
  "commitment",
  "concern",
]);
export type ItemType = z.infer<typeof ItemTypeSchema>;

export const ItemStatusSchema = z.enum(["pending", "started", "exploring"]);
export type ItemStatus = z.infer<typeof ItemStatusSchema>;

export const CommitmentTypeSchema = z.enum(["external", "personal", "none"]);
export type CommitmentType = z.infer<typeof CommitmentTypeSchema>;

export const DateReferenceSchema = z.object({
  raw: z.string(),
  resolved: z.string().nullable().optional(),
  confidence: z.enum(["high", "medium", "low"]),
});
export type DateReference = z.infer<typeof DateReferenceSchema>;

export const EffortSchema = z.object({
  value: z.number().positive(),
  unit: z.enum(["hours", "minutes", "days"]),
  source: z.enum(["user", "estimated"]).default("user"),
});
export type Effort = z.infer<typeof EffortSchema>;

export const ImportanceSchema = z.enum(["high", "medium", "low"]);
export type Importance = z.infer<typeof ImportanceSchema>;

export const ExtractedItemSchema = z.object({
  id: z.string(),
  rawText: z.string().min(1),
  title: z.string().min(1),
  type: ItemTypeSchema,
  project: z.string().nullable().optional(),
  status: ItemStatusSchema.nullable().optional(),
  deadline: DateReferenceSchema.nullable().optional(),
  estimatedEffort: EffortSchema.nullable().optional(),
  importance: ImportanceSchema.nullable().optional(),
  commitment: CommitmentTypeSchema.nullable().optional(),
});
export type ExtractedItem = z.infer<typeof ExtractedItemSchema>;

export const ExtractedItemsSchema = z.object({
  items: z.array(ExtractedItemSchema),
});
export type ExtractedItems = z.infer<typeof ExtractedItemsSchema>;

export const ExtractItemsInputSchema = z.object({
  text: z.string().min(1),
  currentDate: z.string(),
  locale: z.string().optional(),
});
export type ExtractItemsInput = z.infer<typeof ExtractItemsInputSchema>;
