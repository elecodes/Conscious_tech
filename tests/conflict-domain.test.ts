import { describe, it, expect } from "vitest";
import {
  ConflictTypeSchema,
  ConflictCertaintySchema,
  ConflictScopeSchema,
  ConflictEvidenceSchema,
  TimeBlockSchema,
  DailyWorkAllocationSchema,
  DetectConflictInputSchema,
  DetectConflictOutputSchema,
} from "../src/domain/conflict";
import { ProposedWeek } from "../src/domain/week";

const testBasePlan: ProposedWeek = {
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
      title: "Core Service",
      desiredOutcome: "Deploy",
      rationale: "Strategic",
      contributingItemIds: ["item-1"],
      estimatedHours: 10,
    },
  ],
  obligations: [
    {
      itemId: "item-2",
      title: "Review audit",
      commitmentType: "external",
      dueDate: "2026-10-14",
      rationale: "Contractual",
      estimatedHours: 5,
    },
  ],
  flexibleOptions: [],
  deferredItems: [],
  unplannedSpace: {
    rationale: "Protected buffer",
    recommendedHours: 10,
  },
  confirmationPrompt: {
    question: "OK?",
    keyTradeoffs: [],
    pendingQuestions: [],
  },
};

describe("Conflict Domain Schemas", () => {
  it("validates ConflictType enum strictly", () => {
    expect(ConflictTypeSchema.parse("capacity_deficit")).toBe("capacity_deficit");
    expect(ConflictTypeSchema.parse("blocked_by_dependency")).toBe("blocked_by_dependency");
    expect(ConflictTypeSchema.parse("deadline_incompatibility")).toBe("deadline_incompatibility");
    expect(ConflictTypeSchema.parse("schedule_overlap")).toBe("schedule_overlap");
    expect(() => ConflictTypeSchema.parse("focus_fragmentation")).toThrow();
  });

  it("validates ConflictCertainty enum strictly", () => {
    expect(ConflictCertaintySchema.parse("confirmed")).toBe("confirmed");
    expect(ConflictCertaintySchema.parse("potential")).toBe("potential");
    expect(ConflictCertaintySchema.parse("insufficient_information")).toBe(
      "insufficient_information"
    );
  });

  it("validates ConflictScope and Evidence schemas", () => {
    expect(ConflictScopeSchema.parse("weekly")).toBe("weekly");
    expect(ConflictScopeSchema.parse("daily")).toBe("daily");
    expect(ConflictScopeSchema.parse("task")).toBe("task");

    const evidence = ConflictEvidenceSchema.parse({
      metric: "hours_balance",
      description: "Planned hours exceed plannable",
      availableOrRequired: 20,
      conflictingValue: 30,
    });
    expect(evidence.metric).toBe("hours_balance");
  });

  it("validates TimeBlockSchema and DailyWorkAllocationSchema", () => {
    const block = TimeBlockSchema.parse({
      itemId: "meeting-1",
      day: "2026-10-13",
      startTime: "10:00",
      endTime: "11:30",
    });
    expect(block.startTime).toBe("10:00");

    expect(() =>
      TimeBlockSchema.parse({
        itemId: "meeting-1",
        day: "2026-10-13",
        startTime: "25:00", // invalid hour
        endTime: "11:30",
      })
    ).toThrow();

    const alloc = DailyWorkAllocationSchema.parse({
      itemId: "item-1",
      day: "2026-10-15",
      allocatedHours: 4,
    });
    expect(alloc.allocatedHours).toBe(4);
  });

  it("validates TimeBlock interval ordering (startTime < endTime strictly)", () => {
    // 1. Valid interval: 09:00 - 10:00
    const validBlock = TimeBlockSchema.parse({
      itemId: "meeting-valid",
      day: "2026-10-13",
      startTime: "09:00",
      endTime: "10:00",
    });
    expect(validBlock.startTime).toBe("09:00");
    expect(validBlock.endTime).toBe("10:00");

    // 2. Inverted interval: 14:00 - 11:00 (must be rejected)
    expect(() =>
      TimeBlockSchema.parse({
        itemId: "meeting-inverted",
        day: "2026-10-13",
        startTime: "14:00",
        endTime: "11:00",
      })
    ).toThrowError(/startTime must be strictly before endTime/);

    // 3. Zero-duration interval: 14:00 - 14:00 (must be rejected)
    expect(() =>
      TimeBlockSchema.parse({
        itemId: "meeting-zero-duration",
        day: "2026-10-13",
        startTime: "14:00",
        endTime: "14:00",
      })
    ).toThrowError(/startTime must be strictly before endTime/);
  });

  it("validates DetectConflictInputSchema and DetectConflictOutputSchema", () => {
    const input = DetectConflictInputSchema.parse({
      currentDate: "2026-10-11",
      activePlan: testBasePlan,
    });
    expect(input.currentDate).toBe("2026-10-11");

    const output = DetectConflictOutputSchema.parse({
      status: "no_conflicts",
      summary: "Clean plan",
      conflicts: [],
      unconflictedAreas: [
        {
          areaName: "foci",
          elementIds: ["focus-1"],
          verificationReason: "No conflicts found",
        },
      ],
      hasBlockingConflicts: false,
    });
    expect(output.hasBlockingConflicts).toBe(false);
  });
});
