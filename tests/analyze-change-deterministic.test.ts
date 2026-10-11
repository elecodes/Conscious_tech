import { describe, it, expect } from "vitest";
import {
  validateDeltaReferences,
  classifyChangeType,
  calculateCapacityImpact,
  analyzeChangeDeterministically,
} from "../src/skills/analyze-change/deterministic";
import { ProposedWeek } from "../src/domain/week";

const testPlan: ProposedWeek = {
  weekSummary: {
    targetWeek: {
      startDate: "2026-10-12",
      endDate: "2026-10-18",
    },
    capacity: {
      totalAvailableHours: 40,
      plannableHours: 30,
      plannedHours: 20,
      knownEstimatedHours: 20,
      estimationCompleteness: "complete",
      protectedSpaceHours: 10,
      capacityStatus: "within_capacity",
      protectedSpaceStatus: "respected",
    },
  },
  foci: [
    {
      id: "focus-1",
      title: "Backend API",
      desiredOutcome: "Deploy v1",
      rationale: "Strategic priority",
      contributingItemIds: ["item-1", "item-2"],
      estimatedHours: 12,
    },
  ],
  obligations: [
    {
      itemId: "item-3",
      title: "Tax filing",
      commitmentType: "external",
      dueDate: "2026-10-15",
      rationale: "Legal obligation",
      estimatedHours: 8,
    },
  ],
  flexibleOptions: [
    {
      itemId: "item-4",
      title: "Documentation update",
      condition: "If time permits",
      estimatedHours: 4,
    },
  ],
  deferredItems: [
    {
      itemId: "item-5",
      title: "Refactor legacy module",
      reason: "out_of_capacity",
      rationale: "Deferred to preserve space",
    },
  ],
  unplannedSpace: {
    rationale: "Focus protection",
    recommendedHours: 10,
  },
  confirmationPrompt: {
    question: "Confirm plan?",
    keyTradeoffs: [],
    pendingQuestions: [],
  },
};

describe("Analyze Change Deterministic Engine", () => {
  describe("Reference Validation", () => {
    it("reports fatal error if referencing non-existent item to remove", () => {
      const { errors, fatal } = validateDeltaReferences(
        {
          itemOperations: [{ op: "remove", itemId: "non-existent-id" }],
        },
        testPlan
      );
      expect(fatal).toBe(true);
      expect(errors.length).toBe(1);
      expect(errors[0].type).toBe("unresolved_reference");
    });

    it("allows adding a new item and referencing it in a relationship operation within the same delta", () => {
      const { errors, fatal } = validateDeltaReferences(
        {
          itemOperations: [
            {
              op: "add",
              item: {
                id: "new-item",
                rawText: "New task",
                title: "New Task",
                type: "task",
              },
            },
          ],
          relationshipOperations: [
            {
              op: "add",
              sourceItemId: "item-1",
              targetItemId: "new-item",
              type: "depends_on",
            },
          ],
        },
        testPlan
      );
      expect(fatal).toBe(false);
      expect(errors.length).toBe(0);
    });
  });

  describe("ChangeType Classification", () => {
    it("classifies pure date change as deadline_change", () => {
      const ct = classifyChangeType({
        deadlineOperations: [
          { itemId: "item-3", previousDueDate: "2026-10-15", newDueDate: "2026-10-17" },
        ],
      });
      expect(ct).toBe("deadline_change");
    });

    it("classifies pure item modification as modified_item", () => {
      const ct = classifyChangeType({
        itemOperations: [
          { op: "modify", itemId: "item-1", patch: { title: "Updated Backend API" } },
        ],
      });
      expect(ct).toBe("modified_item");
    });

    it("classifies item add as new_item", () => {
      const ct = classifyChangeType({
        itemOperations: [
          {
            op: "add",
            item: {
              id: "item-99",
              rawText: "Test",
              title: "Test",
              type: "task",
            },
          },
        ],
      });
      expect(ct).toBe("new_item");
    });

    it("classifies item remove as drop_item", () => {
      const ct = classifyChangeType({
        itemOperations: [{ op: "remove", itemId: "item-1" }],
      });
      expect(ct).toBe("drop_item");
    });

    it("classifies date change combined with attribute change as mixed_change", () => {
      const ct = classifyChangeType({
        deadlineOperations: [
          { itemId: "item-3", previousDueDate: "2026-10-15", newDueDate: "2026-10-17" },
        ],
        itemOperations: [
          { op: "modify", itemId: "item-3", patch: { title: "Renamed tax filing" } },
        ],
      });
      expect(ct).toBe("mixed_change");
    });

    it("classifies pure capacity change as capacity_change", () => {
      const ct = classifyChangeType({
        capacityOperations: [{ previousAvailableHours: 40, newAvailableHours: 30 }],
      });
      expect(ct).toBe("capacity_change");
    });

    it("classifies pure dependency change as dependency_change", () => {
      const ct = classifyChangeType({
        relationshipOperations: [
          { op: "add", sourceItemId: "item-1", targetItemId: "item-2", type: "depends_on" },
        ],
      });
      expect(ct).toBe("dependency_change");
    });
  });

  describe("Capacity Arithmetic Balance", () => {
    it("returns unknown_capacity when plan totalAvailableHours is null", () => {
      const nullCapPlan: ProposedWeek = {
        ...testPlan,
        weekSummary: {
          ...testPlan.weekSummary,
          capacity: {
            ...testPlan.weekSummary.capacity,
            totalAvailableHours: null,
            plannableHours: null,
          },
        },
      };

      const res = calculateCapacityImpact(nullCapPlan, undefined);
      expect(res.arithmeticBalance).toBe("unknown_capacity");
      expect(res.projectedTotalHours).toBeNull();
    });

    it("returns surplus_known when estimates complete and planned <= plannable", () => {
      const res = calculateCapacityImpact(testPlan, undefined);
      expect(res.arithmeticBalance).toBe("surplus_known");
      expect(res.projectedTotalHours).toBe(40);
    });

    it("returns deficit_known when available hours drop below planned hours", () => {
      const res = calculateCapacityImpact(testPlan, {
        capacityOperations: [{ previousAvailableHours: 40, newAvailableHours: 15 }],
      });
      // Previous plannable was 30h. With new total 15h, planned 20h exceeds 15h (or plannable).
      expect(res.arithmeticBalance).toBe("deficit_known");
      expect(res.projectedTotalHours).toBe(15);
      expect(res.deltaHours).toBe(-25);
    });

    it("returns indeterminate when estimation completeness is partial and no deficit yet", () => {
      const partialPlan: ProposedWeek = {
        ...testPlan,
        weekSummary: {
          ...testPlan.weekSummary,
          capacity: {
            ...testPlan.weekSummary.capacity,
            estimationCompleteness: "partial",
          },
        },
      };

      const res = calculateCapacityImpact(partialPlan, undefined);
      expect(res.arithmeticBalance).toBe("indeterminate");
    });
  });

  describe("End-to-end Deterministic Analysis", () => {
    it("detects no impact when delta is empty and description is neutral", () => {
      const res = analyzeChangeDeterministically({
        currentDate: "2026-10-11",
        activePlan: testPlan,
        changeDescription: "Just checking in, no changes.",
      });

      expect(res.status).toBe("no_impact");
      expect(res.changeType).toBe("none_detected");
      expect(res.requiresUserIntervention).toBe(false);
      expect(res.affectedElements.length).toBe(0);
      expect(res.unaffectedAreas.length).toBeGreaterThan(0);
    });

    it("triggers user intervention when a scheduled focus loses a contributing item", () => {
      const res = analyzeChangeDeterministically({
        currentDate: "2026-10-11",
        activePlan: testPlan,
        changeDescription: "Drop item-1 from the project",
        incomingDelta: {
          itemOperations: [{ op: "remove", itemId: "item-1" }],
        },
      });

      expect(res.status).toBe("analyzed");
      expect(res.changeType).toBe("drop_item");
      expect(res.requiresUserIntervention).toBe(true);
      expect(res.affectedElements.some((ae) => ae.category === "focus_integrity")).toBe(true);
    });

    it("does NOT trigger user intervention when a dependency is removed (unblocked)", () => {
      const res = analyzeChangeDeterministically({
        currentDate: "2026-10-11",
        activePlan: testPlan,
        changeDescription: "Prerequisite finished early",
        incomingDelta: {
          relationshipOperations: [
            { op: "remove", sourceItemId: "item-1", targetItemId: "item-2", type: "depends_on" },
          ],
        },
      });

      expect(res.status).toBe("analyzed");
      expect(res.changeType).toBe("dependency_change");
      expect(res.requiresUserIntervention).toBe(false);
      expect(res.affectedElements[0].dependencyState).toBe("satisfied");
    });
  });
});
