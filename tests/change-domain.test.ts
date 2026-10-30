import { describe, it, expect } from "vitest";
import {
  ChangeTypeSchema,
  ImpactCategorySchema,
  ImpactCertaintySchema,
  DependencyStateSchema,
  TemporalScopeSchema,
  CommitmentNatureSchema,
  ArithmeticBalanceSchema,
  ItemDeltaOperationSchema,
  RelationshipDeltaOperationSchema,
  DeadlineDeltaOperationSchema,
  CapacityDeltaOperationSchema,
  IncomingChangeDeltaSchema,
  AnalyzeChangeInputSchema,
  AnalyzeChangeOutputSchema,
} from "../src/domain/change";
import { ProposedWeek } from "../src/domain/week";

const validBasePlan: ProposedWeek = {
  weekSummary: {
    targetWeek: {
      startDate: "2026-10-12",
      endDate: "2026-10-18",
    },
    capacity: {
      totalAvailableHours: 40,
      plannableHours: 30,
      plannedHours: 25,
      knownEstimatedHours: 25,
      estimationCompleteness: "complete",
      protectedSpaceHours: 10,
      capacityStatus: "within_capacity",
      protectedSpaceStatus: "respected",
    },
  },
  foci: [
    {
      id: "focus-1",
      title: "Core Architecture",
      desiredOutcome: "Finish API",
      rationale: "Strategic baseline",
      contributingItemIds: ["item-1", "item-2"],
      estimatedHours: 15,
    },
  ],
  obligations: [
    {
      itemId: "item-3",
      title: "Client review",
      commitmentType: "external",
      dueDate: "2026-10-15",
      rationale: "External contractual meeting",
      estimatedHours: 5,
    },
  ],
  flexibleOptions: [
    {
      itemId: "item-4",
      title: "Doc cleanup",
      condition: "If time permits",
      estimatedHours: 5,
    },
  ],
  deferredItems: [
    {
      itemId: "item-5",
      title: "Exploratory research",
      reason: "out_of_capacity",
      rationale: "Postponed to next week",
    },
  ],
  unplannedSpace: {
    rationale: "Protected 25% focus buffer",
    recommendedHours: 10,
  },
  confirmationPrompt: {
    question: "Do you agree with this layout?",
    keyTradeoffs: ["Deferred item-5 due to capacity"],
    pendingQuestions: [],
  },
};

describe("Change Domain Schemas", () => {
  it("validates ChangeType enum values strictly", () => {
    expect(ChangeTypeSchema.parse("new_item")).toBe("new_item");
    expect(ChangeTypeSchema.parse("drop_item")).toBe("drop_item");
    expect(ChangeTypeSchema.parse("modified_item")).toBe("modified_item");
    expect(ChangeTypeSchema.parse("deadline_change")).toBe("deadline_change");
    expect(ChangeTypeSchema.parse("dependency_change")).toBe("dependency_change");
    expect(ChangeTypeSchema.parse("capacity_change")).toBe("capacity_change");
    expect(ChangeTypeSchema.parse("mixed_change")).toBe("mixed_change");
    expect(ChangeTypeSchema.parse("none_detected")).toBe("none_detected");
    expect(() => ChangeTypeSchema.parse("invalid_type")).toThrow();
  });

  it("validates ImpactCategory and ImpactCertainty", () => {
    expect(ImpactCategorySchema.parse("direct_target")).toBe("direct_target");
    expect(ImpactCategorySchema.parse("focus_integrity")).toBe("focus_integrity");
    expect(ImpactCategorySchema.parse("causal_dependency")).toBe("causal_dependency");
    expect(ImpactCategorySchema.parse("capacity_overload")).toBe("capacity_overload");
    expect(ImpactCategorySchema.parse("deadline_risk")).toBe("deadline_risk");
    expect(ImpactCategorySchema.parse("unaffected")).toBe("unaffected");

    expect(ImpactCertaintySchema.parse("confirmed")).toBe("confirmed");
    expect(ImpactCertaintySchema.parse("potential")).toBe("potential");
    expect(ImpactCertaintySchema.parse("insufficient_information")).toBe(
      "insufficient_information"
    );
  });

  it("validates DependencyState, TemporalScope, CommitmentNature, ArithmeticBalance", () => {
    expect(DependencyStateSchema.parse("satisfied")).toBe("satisfied");
    expect(DependencyStateSchema.parse("pending")).toBe("pending");
    expect(DependencyStateSchema.parse("unknown")).toBe("unknown");

    expect(TemporalScopeSchema.parse("current_week")).toBe("current_week");
    expect(TemporalScopeSchema.parse("future_week")).toBe("future_week");
    expect(TemporalScopeSchema.parse("past")).toBe("past");
    expect(TemporalScopeSchema.parse("timeless")).toBe("timeless");

    expect(CommitmentNatureSchema.parse("external_commitment")).toBe("external_commitment");
    expect(CommitmentNatureSchema.parse("event_date")).toBe("event_date");
    expect(CommitmentNatureSchema.parse("preparation_task")).toBe("preparation_task");

    expect(ArithmeticBalanceSchema.parse("surplus_known")).toBe("surplus_known");
    expect(ArithmeticBalanceSchema.parse("deficit_known")).toBe("deficit_known");
    expect(ArithmeticBalanceSchema.parse("indeterminate")).toBe("indeterminate");
    expect(ArithmeticBalanceSchema.parse("unknown_capacity")).toBe("unknown_capacity");
  });

  it("validates ItemDeltaOperationSchema discriminated union", () => {
    const addOp = ItemDeltaOperationSchema.parse({
      op: "add",
      item: {
        id: "new-item",
        rawText: "New task text",
        title: "New Task",
        type: "task",
      },
    });
    expect(addOp.op).toBe("add");

    const removeOp = ItemDeltaOperationSchema.parse({
      op: "remove",
      itemId: "item-1",
    });
    expect(removeOp.op).toBe("remove");

    const modifyOp = ItemDeltaOperationSchema.parse({
      op: "modify",
      itemId: "item-2",
      patch: {
        title: "Updated Title",
        estimatedHours: 4,
      },
    });
    expect(modifyOp.op).toBe("modify");
  });

  it("validates RelationshipDeltaOperationSchema with unambiguous removal", () => {
    const addRel = RelationshipDeltaOperationSchema.parse({
      op: "add",
      sourceItemId: "item-1",
      targetItemId: "item-2",
      type: "depends_on",
    });
    expect(addRel.op).toBe("add");

    const removeRel = RelationshipDeltaOperationSchema.parse({
      op: "remove",
      sourceItemId: "item-1",
      targetItemId: "item-2",
      type: "depends_on",
    });
    expect(removeRel.op).toBe("remove");
    expect(removeRel.targetItemId).toBe("item-2");
  });

  it("validates DeadlineDeltaOperationSchema and CapacityDeltaOperationSchema", () => {
    const deadlineOp = DeadlineDeltaOperationSchema.parse({
      itemId: "item-3",
      previousDueDate: "2026-10-15",
      newDueDate: "2026-10-22",
    });
    expect(deadlineOp.newDueDate).toBe("2026-10-22");

    const capOp = CapacityDeltaOperationSchema.parse({
      previousAvailableHours: 40,
      newAvailableHours: 32,
    });
    expect(capOp.newAvailableHours).toBe(32);
  });

  it("validates IncomingChangeDeltaSchema strictness", () => {
    const delta = IncomingChangeDeltaSchema.parse({
      itemOperations: [{ op: "remove", itemId: "item-1" }],
      capacityOperations: [{ previousAvailableHours: 40, newAvailableHours: 30 }],
    });
    expect(delta.itemOperations?.length).toBe(1);
    expect(delta.capacityOperations?.length).toBe(1);

    expect(() =>
      IncomingChangeDeltaSchema.parse({
        unknownField: true,
      })
    ).toThrow();
  });

  it("validates AnalyzeChangeInputSchema and AnalyzeChangeOutputSchema", () => {
    const input = AnalyzeChangeInputSchema.parse({
      currentDate: "2026-10-11",
      activePlan: validBasePlan,
      changeDescription: "Team meeting moved to Friday",
    });
    expect(input.currentDate).toBe("2026-10-11");

    const output = AnalyzeChangeOutputSchema.parse({
      status: "analyzed",
      changeType: "deadline_change",
      summary: "Meeting deadline moved to Friday",
      affectedElements: [
        {
          elementId: "item-3",
          elementType: "obligation",
          category: "deadline_risk",
          certainty: "confirmed",
          explanation: "Obligation date moved within target week.",
          temporalScope: "current_week",
          commitmentNature: "external_commitment",
        },
      ],
      capacityImpact: {
        previousTotalHours: 40,
        projectedTotalHours: 40,
        deltaHours: 0,
        arithmeticBalance: "surplus_known",
        notes: "No capacity change",
      },
      unaffectedAreas: [
        {
          areaName: "foci",
          elementIds: ["focus-1"],
          isolationReason: "Focus items untouched",
        },
      ],
      validationErrors: [],
      requiresUserIntervention: false,
      interventionReason: null,
    });
    expect(output.status).toBe("analyzed");
  });
});
