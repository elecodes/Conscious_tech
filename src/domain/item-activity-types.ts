import { z } from "zod";
import { ItemOutcomeInputSchema } from "./item-outcome";
import { IsoUtcTimestampSchema } from "./memory";

const actionBase = {
  actionId: z.string().min(1),
  itemId: z.string().min(1),
  expectedVersion: z.number().int().positive(),
  decidedAt: IsoUtcTimestampSchema,
};

export const ItemActivityCommandSchema = z.discriminatedUnion("type", [
  z.object({ ...actionBase, type: z.literal("complete") }).strict(),
  z
    .object({ ...actionBase, type: z.literal("undo"), reversesActionId: z.string().min(1) })
    .strict(),
]);
export type ItemActivityCommand = z.infer<typeof ItemActivityCommandSchema>;

export const ItemActivityRecordSchema = z
  .object({
    command: ItemActivityCommandSchema,
    appliedVersion: z.number().int().positive(),
    before: ItemOutcomeInputSchema.nullable(),
    after: ItemOutcomeInputSchema.nullable(),
  })
  .strict();
export type ItemActivityRecord = z.infer<typeof ItemActivityRecordSchema>;

export const ItemActivitySchema = z
  .object({
    outcomes: z.array(ItemOutcomeInputSchema),
    history: z.array(ItemActivityRecordSchema),
    reviewCheckpoint: z
      .object({
        reportId: z.string().min(1),
        appliedVersion: z.number().int().positive(),
        before: z.array(ItemOutcomeInputSchema),
        after: z.array(ItemOutcomeInputSchema),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((activity, ctx) => {
    const ids = activity.outcomes.map((outcome) => outcome.itemId);
    const actionIds = activity.history.map((record) => record.command.actionId);
    if (new Set(ids).size !== ids.length || new Set(actionIds).size !== actionIds.length)
      ctx.addIssue({ code: "custom", message: "Duplicate item or action identifiers" });
    if (activity.reviewCheckpoint) {
      for (const outcomes of [activity.reviewCheckpoint.before, activity.reviewCheckpoint.after]) {
        if (new Set(outcomes.map((outcome) => outcome.itemId)).size !== outcomes.length)
          ctx.addIssue({ code: "custom", message: "Duplicate reviewed outcomes" });
      }
    }
    let previousVersion = 0;
    const actions = new Map<string, ItemActivityRecord>();
    for (const record of activity.history) {
      const { command, before, after } = record;
      const sameItem =
        (!before || before.itemId === command.itemId) &&
        (!after || after.itemId === command.itemId);
      if (
        !sameItem ||
        record.appliedVersion !== command.expectedVersion + 1 ||
        record.appliedVersion <= previousVersion
      )
        ctx.addIssue({ code: "custom", message: "Invalid activity scope or version sequence" });
      if (command.type === "complete" && after?.status !== "completed")
        ctx.addIssue({ code: "custom", message: "Completion must record completed" });
      if (command.type === "undo") {
        const original = actions.get(command.reversesActionId);
        if (
          !original ||
          original.command.type !== "complete" ||
          original.command.itemId !== command.itemId ||
          original.appliedVersion !== command.expectedVersion ||
          JSON.stringify(before) !== JSON.stringify(original.after) ||
          JSON.stringify(after) !== JSON.stringify(original.before)
        )
          ctx.addIssue({ code: "custom", message: "Invalid activity reversal" });
      }
      previousVersion = record.appliedVersion;
      actions.set(command.actionId, record);
    }
    // Each item's latest event must agree with its current stored outcome.
    const latest = new Map(
      activity.reviewCheckpoint?.after.map((outcome) => [outcome.itemId, outcome]) ?? []
    );
    for (const record of activity.history) {
      if (record.appliedVersion > (activity.reviewCheckpoint?.appliedVersion ?? 0))
        latest.set(record.command.itemId, record.after!);
    }
    for (const [id, after] of latest) {
      const current = activity.outcomes.find((outcome) => outcome.itemId === id) ?? null;
      if (JSON.stringify(current) !== JSON.stringify(after))
        ctx.addIssue({ code: "custom", message: "Outcome disagrees with activity history" });
    }
  });
