import {
  ReassignTimeBlockActionSchema,
  ReallocateDayWorkActionSchema,
  PostponeItemActionSchema,
} from "./adjustment";
import { TimeBlockSchema, DailyWorkAllocationSchema } from "./conflict";
import { z } from "zod";
import { ItemOutcomeInputSchema } from "./item-outcome";
import { IsoUtcTimestampSchema } from "./memory";

const actionBase = {
  actionId: z.string().min(1),
  itemId: z.string().min(1),
  expectedVersion: z.number().int().positive(),
  decidedAt: IsoUtcTimestampSchema,
};

export const MovementActionSchema = z.discriminatedUnion("type", [
  ReassignTimeBlockActionSchema,
  ReallocateDayWorkActionSchema,
]);
export const PostponementActionSchema = PostponeItemActionSchema.extend({
  rationale: z.string().trim().min(1),
}).strict();
export type PostponementAction = z.infer<typeof PostponementActionSchema>;
export type MovementAction = z.infer<typeof MovementActionSchema>;
const TemporalRowsSchema = z
  .object({
    blocks: z.array(
      z.object({ index: z.number().int().nonnegative(), value: TimeBlockSchema }).strict()
    ),
    allocations: z.array(
      z.object({ index: z.number().int().nonnegative(), value: DailyWorkAllocationSchema }).strict()
    ),
  })
  .strict();
const TemporalChangeSchema = z
  .object({
    adjustmentId: z.string().min(1),
    before: TemporalRowsSchema,
    after: TemporalRowsSchema,
    supersededIds: z.array(z.string().min(1)),
  })
  .strict();
export type TemporalChange = z.infer<typeof TemporalChangeSchema>;

export const ItemActivityCommandSchema = z.discriminatedUnion("type", [
  z.object({ ...actionBase, type: z.literal("complete") }).strict(),
  z.object({ ...actionBase, type: z.literal("resume") }).strict(),
  z.object({ ...actionBase, type: z.literal("move"), action: MovementActionSchema }).strict(),
  z
    .object({ ...actionBase, type: z.literal("postpone"), action: PostponementActionSchema })
    .strict(),
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
    temporalChange: TemporalChangeSchema.optional(),
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
      if (command.type === "resume" && after?.status !== "not_started")
        ctx.addIssue({ code: "custom", message: "Resumption must record not_started" });
      if (command.type === "complete" && after?.status !== "completed")
        ctx.addIssue({ code: "custom", message: "Completion must record completed" });
      if (command.type === "move" || command.type === "postpone") {
        const change = record.temporalChange;
        const scoped =
          change &&
          [change.before, change.after].every(
            (rows) =>
              [...rows.blocks, ...rows.allocations].every(
                (row) => row.value.itemId === command.itemId
              ) &&
              new Set(rows.blocks.map((row) => row.index)).size === rows.blocks.length &&
              new Set(rows.allocations.map((row) => row.index)).size === rows.allocations.length
          );
        if (
          !change ||
          !scoped ||
          command.action.itemId !== command.itemId ||
          change.adjustmentId !== command.actionId ||
          (command.type === "move"
            ? JSON.stringify(before) !== JSON.stringify(after)
            : after?.status !== "consciously_postponed" ||
              after.postponementReason !== command.action.rationale ||
              !!change?.after.blocks.length ||
              !!change?.after.allocations.length)
        )
          ctx.addIssue({ code: "custom", message: "Invalid movement evidence" });
      } else if (record.temporalChange)
        ctx.addIssue({ code: "custom", message: "Only temporal actions capture temporal rows" });
      if (command.type === "undo") {
        const original = actions.get(command.reversesActionId);
        if (
          !original ||
          original.command.type === "undo" ||
          original.command.type === "resume" ||
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
