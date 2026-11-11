import { z } from "zod";

export const ItemOutcomeStatusSchema = z.enum([
  "completed",
  "in_progress",
  "not_started",
  "consciously_postponed",
  "dropped",
]);
export type ItemOutcomeStatus = z.infer<typeof ItemOutcomeStatusSchema>;

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
