import { z } from "zod";
import { ExtractedItemSchema } from "./items";
import { RelationshipSchema } from "./relationships";

export const WorkGroupSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  itemIds: z.array(z.string().min(1)),
  rationale: z.string().min(1),
});
export type WorkGroup = z.infer<typeof WorkGroupSchema>;

export const GroupedWorkSchema = z.object({
  groups: z.array(WorkGroupSchema),
  ungroupedItemIds: z.array(z.string().min(1)),
});
export type GroupedWork = z.infer<typeof GroupedWorkSchema>;

export const GroupWorkInputSchema = z.object({
  items: z.array(ExtractedItemSchema),
  relationships: z.array(RelationshipSchema),
});
export type GroupWorkInput = z.infer<typeof GroupWorkInputSchema>;
