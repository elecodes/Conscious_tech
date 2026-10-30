import { describe, it, expect } from "vitest";
import {
  PostponeItemActionSchema,
  ReassignTimeBlockActionSchema,
  ReallocateDayWorkActionSchema,
  UnblockDependencyActionSchema,
  AcceptRiskActionSchema,
  RequestInformationActionSchema,
  AdjustmentProposalSchema,
  validateProposalInvariants,
  getAllPlanItemIds,
  AdjustmentProposal,
} from "../src/domain/adjustment";
import { ProposedWeek } from "../src/domain/week";

const samplePlan: ProposedWeek = {
  weekSummary: {
    targetWeek: { startDate: "2026-10-12", endDate: "2026-10-18" },
    capacity: {
      totalAvailableHours: 40,
      plannableHours: 30,
      plannedHours: 24,
      knownEstimatedHours: 24,
      estimationCompleteness: "complete",
      protectedSpaceHours: 10,
      capacityStatus: "within_capacity",
      protectedSpaceStatus: "respected",
    },
  },
  foci: [
    {
      id: "focus-1",
      title: "Core Feature",
      desiredOutcome: "Finish MVP",
      rationale: "Priority",
      contributingItemIds: ["task-A"],
      estimatedHours: 8,
    },
  ],
  obligations: [
    {
      itemId: "task-B",
      title: "Client review",
      commitmentType: "external",
      dueDate: "2026-10-14",
      rationale: "External client",
      estimatedHours: 4,
    },
  ],
  flexibleOptions: [
    {
      itemId: "task-C",
      title: "Refactor docs",
      condition: "If time permits",
      estimatedHours: 4,
    },
  ],
  deferredItems: [
    {
      itemId: "task-D",
      title: "Old backlog item",
      reason: "out_of_capacity",
      rationale: "Postponed last week",
    },
  ],
  unplannedSpace: {
    rationale: "6h buffer",
    recommendedHours: 6,
  },
  confirmationPrompt: {
    question: "Confirm?",
    keyTradeoffs: [],
    pendingQuestions: [],
  },
};

describe("Skill 09: Domain & Invariant Unit Tests", () => {
  it("getAllPlanItemIds returns all 4 plan items accurately", () => {
    const ids = getAllPlanItemIds(samplePlan);
    expect(ids).toEqual(new Set(["task-A", "task-B", "task-C", "task-D"]));
  });

  describe("Typed Actions", () => {
    it("validates PostponeItemActionSchema", () => {
      const valid = PostponeItemActionSchema.parse({
        type: "postpone_item",
        itemId: "task-A",
        currentCategory: "foci",
        targetReason: "out_of_capacity",
        hoursFreed: 8,
        rationale: "Free up 8h",
      });
      expect(valid.itemId).toBe("task-A");
    });

    it("validates ReassignTimeBlockActionSchema with valid interval", () => {
      const valid = ReassignTimeBlockActionSchema.parse({
        type: "reassign_time_block",
        itemId: "task-B",
        currentBlock: {
          itemId: "task-B",
          day: "2026-10-13",
          startTime: "10:00",
          endTime: "11:00",
        },
        proposedBlock: {
          itemId: "task-B",
          day: "2026-10-14",
          startTime: "14:00",
          endTime: "15:00",
        },
        rationale: "Move to Wednesday afternoon",
      });
      expect(valid.proposedBlock.day).toBe("2026-10-14");
    });

    it("rejects ReassignTimeBlockActionSchema if startTime >= endTime", () => {
      expect(() =>
        ReassignTimeBlockActionSchema.parse({
          type: "reassign_time_block",
          itemId: "task-B",
          currentBlock: {
            itemId: "task-B",
            day: "2026-10-13",
            startTime: "10:00",
            endTime: "11:00",
          },
          proposedBlock: {
            itemId: "task-B",
            day: "2026-10-14",
            startTime: "15:00",
            endTime: "14:00", // Invalid!
          },
          rationale: "Inverted",
        })
      ).toThrow();
    });

    it("validates ReallocateDayWorkActionSchema", () => {
      const valid = ReallocateDayWorkActionSchema.parse({
        type: "reallocate_day_work",
        itemId: "task-A",
        sourceDay: "2026-10-13",
        targetDay: "2026-10-14",
        hoursToMove: 2,
        rationale: "Rebalance Thursday to Friday",
      });
      expect(valid.hoursToMove).toBe(2);
    });

    it("validates UnblockDependencyActionSchema", () => {
      const valid = UnblockDependencyActionSchema.parse({
        type: "unblock_dependency",
        dependentItemId: "task-A",
        prerequisiteItemId: "mockup-01",
        requiredAction: "Deliver mockup",
        externalActor: "Designer",
        rationale: "Waiting on design assets",
      });
      expect(valid.externalActor).toBe("Designer");
    });

    it("validates AcceptRiskActionSchema", () => {
      const valid = AcceptRiskActionSchema.parse({
        type: "accept_risk",
        conflictId: "conf-risk-01",
        toleratedRisk: "Risk of slight delay",
        rationale: "User explicitly chooses to keep schedule",
      });
      expect(valid.conflictId).toBe("conf-risk-01");
    });

    it("validates RequestInformationActionSchema", () => {
      const valid = RequestInformationActionSchema.parse({
        type: "request_information",
        targetItemId: "task-A",
        missingField: "estimated_hours",
        question: "How many hours will this take?",
      });
      expect(valid.missingField).toBe("estimated_hours");
    });
  });

  describe("AdjustmentProposalSchema Refinements", () => {
    const baseProposal: AdjustmentProposal = {
      id: "prop-01",
      strategy: "postpone_foci",
      title: "Postpone focus",
      explanation: "Free 8 hours",
      viability: "viable",
      viabilityCondition: null,
      addressedConflictIds: ["conf-01"],
      resolvedConflictIds: ["conf-01"],
      unresolvedConflictIds: [],
      unresolvedBreakdown: {
        confirmed: [],
        potential: [],
        insufficientInformation: [],
      },
      netHoursFreed: 8,
      resultingPlannedHours: 16,
      affectedPlanItemIds: ["task-A"],
      retainedPlanItemIds: ["task-B", "task-C"],
      previouslyDeferredItemIds: ["task-D"],
      actions: [
        {
          type: "postpone_item",
          itemId: "task-A",
          currentCategory: "foci",
          targetReason: "out_of_capacity",
          hoursFreed: 8,
          rationale: "Free up capacity",
        },
      ],
      tradeoffs: ["Focus is postponed"],
    };

    it("validates a sound viable proposal", () => {
      expect(() => AdjustmentProposalSchema.parse(baseProposal)).not.toThrow();
    });

    it("rejects conditional proposal without viabilityCondition", () => {
      const invalid = {
        ...baseProposal,
        viability: "conditional",
        viabilityCondition: null, // missing!
        resolvedConflictIds: [],
      };
      expect(() => AdjustmentProposalSchema.parse(invalid)).toThrow(
        "viabilityCondition must be non-empty when viability is 'conditional'"
      );
    });

    it("rejects non-viable proposal claiming resolvedConflictIds", () => {
      const invalid = {
        ...baseProposal,
        viability: "conditional",
        viabilityCondition: "Client approval required",
        resolvedConflictIds: ["conf-01"], // Cannot claim resolved!
      };
      expect(() => AdjustmentProposalSchema.parse(invalid)).toThrow(
        "Only 'viable' proposals can declare resolvedConflictIds"
      );
    });

    it("rejects resolvedConflictIds that are not in addressedConflictIds", () => {
      const invalid = {
        ...baseProposal,
        addressedConflictIds: ["conf-01"],
        resolvedConflictIds: ["conf-99"], // Not addressed!
      };
      expect(() => AdjustmentProposalSchema.parse(invalid)).toThrow(
        "resolvedConflictIds must be a subset of addressedConflictIds"
      );
    });
  });

  describe("validateProposalInvariants Engine", () => {
    const validProposal: AdjustmentProposal = {
      id: "prop-01",
      strategy: "postpone_foci",
      title: "Postpone focus",
      explanation: "Free 8 hours",
      viability: "viable",
      viabilityCondition: null,
      addressedConflictIds: ["conf-01"],
      resolvedConflictIds: ["conf-01"],
      unresolvedConflictIds: [],
      unresolvedBreakdown: {
        confirmed: [],
        potential: [],
        insufficientInformation: [],
      },
      netHoursFreed: 8,
      resultingPlannedHours: 16,
      affectedPlanItemIds: ["task-A"],
      retainedPlanItemIds: ["task-B", "task-C"],
      previouslyDeferredItemIds: ["task-D"],
      actions: [
        {
          type: "postpone_item",
          itemId: "task-A",
          currentCategory: "foci",
          targetReason: "out_of_capacity",
          hoursFreed: 8,
          rationale: "Free up capacity",
        },
      ],
      tradeoffs: ["Focus is postponed"],
    };

    it("passes for perfectly partitioned proposal", () => {
      const res = validateProposalInvariants(validProposal, samplePlan, [
        {
          id: "conf-01",
          type: "capacity_deficit",
          certainty: "confirmed",
          scope: "weekly",
          title: "Capacity deficit",
          explanation: "Overloaded",
          involvedElementIds: ["task-A"],
          evidence: {
            metric: "hours_balance",
            description: "test",
            availableOrRequired: 20,
            conflictingValue: 24,
          },
        },
      ]);
      expect(res.valid).toBe(true);
      expect(res.errors).toEqual([]);
    });

    it("fails when an item is omitted from partition", () => {
      const invalid = {
        ...validProposal,
        retainedPlanItemIds: ["task-B"], // task-C omitted!
      };
      const res = validateProposalInvariants(invalid, samplePlan);
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes("omitted from the proposal partition"))).toBe(true);
    });

    it("fails when a phantom item is included in partition", () => {
      const invalid = {
        ...validProposal,
        affectedPlanItemIds: ["task-A", "phantom-task"],
      };
      const res = validateProposalInvariants(invalid, samplePlan);
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes('Phantom itemId "phantom-task"'))).toBe(true);
    });

    it("fails when an item is duplicated across partition subsets", () => {
      const invalid = {
        ...validProposal,
        retainedPlanItemIds: ["task-A", "task-B", "task-C"], // task-A is in both affected and retained!
      };
      const res = validateProposalInvariants(invalid, samplePlan);
      expect(res.valid).toBe(false);
      expect(
        res.errors.some((e) => e.includes("present in both affected and retained lists"))
      ).toBe(true);
    });

    it("fails when raw balance is negative", () => {
      const invalid = {
        ...validProposal,
        netHoursFreed: 30, // 24 - 30 = -6
        resultingPlannedHours: -6,
      };
      const res = validateProposalInvariants(invalid, samplePlan);
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes("raw balance (-6) is negative"))).toBe(true);
    });

    it("fails when reassign_time_block collides with another block of the same item (intra-item collision)", () => {
      const timeBlocks = [
        {
          itemId: "task-A",
          day: "2026-10-13",
          startTime: "10:00",
          endTime: "11:00",
        },
        {
          itemId: "task-A",
          day: "2026-10-15",
          startTime: "10:00",
          endTime: "11:00",
        },
      ];

      const reassignProposal: AdjustmentProposal = {
        ...validProposal,
        strategy: "reallocate_time_blocks",
        actions: [
          {
            type: "reassign_time_block",
            itemId: "task-A",
            currentBlock: {
              itemId: "task-A",
              day: "2026-10-13",
              startTime: "10:00",
              endTime: "11:00",
            },
            proposedBlock: {
              itemId: "task-A",
              day: "2026-10-15",
              startTime: "10:00",
              endTime: "11:00", // Collides with task-A's own second block!
            },
            rationale: "Move block 1 to Thursday",
          },
        ],
      };

      const res = validateProposalInvariants(reassignProposal, samplePlan, [], timeBlocks);
      expect(res.valid).toBe(false);
      expect(
        res.errors.some((e) =>
          e.includes('Proposed block for "task-A" collides with existing block for "task-A"')
        )
      ).toBe(true);
    });

    it("fails when unblock_dependency references nonexistent dependentItemId", () => {
      const invalidDepProposal: AdjustmentProposal = {
        ...validProposal,
        strategy: "unblock_prerequisite",
        actions: [
          {
            type: "unblock_dependency",
            dependentItemId: "nonexistent-task", // Invalid!
            prerequisiteItemId: "task-B",
            requiredAction: "Deliver assets",
            rationale: "Unblock",
          },
        ],
      };

      const res = validateProposalInvariants(invalidDepProposal, samplePlan);
      expect(res.valid).toBe(false);
      expect(
        res.errors.some((e) =>
          e.includes('unblock_dependency references nonexistent dependentItemId "nonexistent-task"')
        )
      ).toBe(true);
    });

    it("fails when unblock_dependency references nonexistent prerequisiteItemId", () => {
      const invalidDepProposal: AdjustmentProposal = {
        ...validProposal,
        strategy: "unblock_prerequisite",
        actions: [
          {
            type: "unblock_dependency",
            dependentItemId: "task-A",
            prerequisiteItemId: "nonexistent-prereq", // Invalid!
            requiredAction: "Deliver assets",
            rationale: "Unblock",
          },
        ],
      };

      const res = validateProposalInvariants(invalidDepProposal, samplePlan);
      expect(res.valid).toBe(false);
      expect(
        res.errors.some((e) =>
          e.includes(
            'unblock_dependency references nonexistent prerequisiteItemId "nonexistent-prereq"'
          )
        )
      ).toBe(true);
    });
  });
});
