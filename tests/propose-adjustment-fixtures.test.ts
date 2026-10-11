import { describe, it, expect } from "vitest";
import { ProposedWeek, DayConstraint } from "../src/domain/week";
import {
  TimeBlock,
  DailyWorkAllocation,
} from "../src/domain/conflict";
import { ProposeAdjustmentInput, validateProposalInvariants } from "../src/domain/adjustment";
import { proposeAdjustmentsDeterministically } from "../src/skills/propose-adjustment/deterministic";

const basePlan: ProposedWeek = {
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
      rationale: "Strategic milestone",
      contributingItemIds: ["task-A"],
      estimatedHours: 10,
    },
  ],
  obligations: [
    {
      itemId: "task-B",
      title: "Deliver audit report",
      commitmentType: "external",
      dueDate: "2026-10-14",
      rationale: "Contractual",
      estimatedHours: 6,
    },
  ],
  flexibleOptions: [
    {
      itemId: "task-C",
      title: "Optional documentation polish",
      condition: "If time allows",
      estimatedHours: 4,
    },
  ],
  deferredItems: [
    {
      itemId: "task-D",
      title: "Archived backlog item",
      reason: "out_of_capacity",
      rationale: "Deferred last week",
    },
  ],
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

describe("Skill 09: propose_adjustment - 10 Canonical Fixture Suite (adj-01 to adj-10)", () => {
  // --------------------------------------------------------------------------
  // adj-01: Weekly capacity deficit with estimable focus
  // --------------------------------------------------------------------------
  it("adj-01: proposes viable focus postponement for weekly capacity deficit", () => {
    const overloadedPlan: ProposedWeek = {
      ...basePlan,
      weekSummary: {
        ...basePlan.weekSummary,
        capacity: {
          ...basePlan.weekSummary.capacity,
          plannableHours: 20,
          plannedHours: 24,
          capacityStatus: "over_capacity",
        },
      },
      foci: [
        {
          ...basePlan.foci[0],
          estimatedHours: 8, // Frees 8h >= deficit 4h
        },
      ],
    };

    const input: ProposeAdjustmentInput = {
      activePlan: overloadedPlan,
    };

    const res = proposeAdjustmentsDeterministically(input);

    expect(res.status).toBe("adjustments_proposed");
    expect(res.proposals.length).toBeGreaterThan(0);

    const prop = res.proposals.find((p) => p.strategy === "postpone_foci");
    expect(prop).toBeDefined();
    expect(prop?.viability).toBe("viable");
    expect(prop?.resolvedConflictIds).toContain("conflict-weekly-capacity-deficit");
    expect(prop?.unresolvedConflictIds).not.toContain("conflict-weekly-capacity-deficit");
    expect(prop?.netHoursFreed).toBe(8);
    expect(prop?.resultingPlannedHours).toBe(16);
    expect(prop?.affectedPlanItemIds).toEqual(["task-A"]);
    expect(prop?.retainedPlanItemIds.sort()).toEqual(["task-B", "task-C"].sort());
    expect(prop?.previouslyDeferredItemIds).toEqual(["task-D"]);
  });

  // --------------------------------------------------------------------------
  // adj-02: Weekly capacity deficit with missing estimates
  // --------------------------------------------------------------------------
  it("adj-02: generates clarification request when focus has missing estimate", () => {
    const uncertainPlan: ProposedWeek = {
      ...basePlan,
      weekSummary: {
        ...basePlan.weekSummary,
        capacity: {
          ...basePlan.weekSummary.capacity,
          plannableHours: 20,
          plannedHours: 24,
          capacityStatus: "over_capacity",
          estimationCompleteness: "partial",
        },
      },
      foci: [
        {
          ...basePlan.foci[0],
          estimatedHours: null, // Unknown!
        },
      ],
    };

    const input: ProposeAdjustmentInput = {
      activePlan: uncertainPlan,
    };

    const res = proposeAdjustmentsDeterministically(input);

    expect(res.status).toBe("adjustments_proposed");
    const clarifyProp = res.proposals.find((p) => p.strategy === "clarify_missing_data");
    expect(clarifyProp).toBeDefined();
    expect(clarifyProp?.viability).toBe("requires_clarification");
    expect(clarifyProp?.resolvedConflictIds).toEqual([]);
    expect(clarifyProp?.unresolvedConflictIds).toContain("conflict-weekly-capacity-deficit");
    expect(clarifyProp?.netHoursFreed).toBeNull();
    expect(clarifyProp?.resultingPlannedHours).toBeNull();
  });

  // --------------------------------------------------------------------------
  // adj-03: Two independent conflicts with two distinct proposals
  // --------------------------------------------------------------------------
  it("adj-03: handles multiple independent conflicts where each proposal resolves one and keeps the other unresolved", () => {
    const multiConflictPlan: ProposedWeek = {
      ...basePlan,
      weekSummary: {
        ...basePlan.weekSummary,
        capacity: {
          ...basePlan.weekSummary.capacity,
          plannableHours: 20,
          plannedHours: 24, // Deficit 4h
          capacityStatus: "over_capacity",
        },
      },
      foci: [
        {
          ...basePlan.foci[0],
          estimatedHours: 8,
        },
      ],
    };

    const timeBlocks: TimeBlock[] = [
      {
        itemId: "task-B",
        day: "2026-10-13",
        startTime: "10:00",
        endTime: "11:00",
      },
      {
        itemId: "task-C",
        day: "2026-10-13",
        startTime: "10:00",
        endTime: "11:00",
      },
    ];

    const input: ProposeAdjustmentInput = {
      activePlan: multiConflictPlan,
      timeBlocks,
    };

    const res = proposeAdjustmentsDeterministically(input);

    expect(res.status).toBe("adjustments_proposed");
    expect(res.proposals.length).toBeGreaterThanOrEqual(2);

    // Proposal 1: postpone foci -> resolves capacity deficit, but leaves schedule overlap unresolved
    const prop1 = res.proposals.find((p) => p.strategy === "postpone_foci")!;
    expect(prop1).toBeDefined();
    expect(prop1.resolvedConflictIds).toContain("conflict-weekly-capacity-deficit");
    expect(prop1.unresolvedConflictIds).toContain("conflict-schedule-overlap-task-B-task-C");
    expect(prop1.unresolvedBreakdown.confirmed).toContain(
      "conflict-schedule-overlap-task-B-task-C"
    );

    // Proposal 2: reassign time block -> resolves schedule overlap, but leaves capacity deficit unresolved
    const prop2 = res.proposals.find((p) => p.strategy === "reallocate_time_blocks")!;
    expect(prop2).toBeDefined();
    expect(prop2.resolvedConflictIds).toContain("conflict-schedule-overlap-task-B-task-C");
    expect(prop2.unresolvedConflictIds).toContain("conflict-weekly-capacity-deficit");
    expect(prop2.unresolvedBreakdown.confirmed).toContain(
      "conflict-weekly-capacity-deficit"
    );

    // Global unaddressed conflict IDs should be empty because both were addressed across the proposals
    expect(res.unaddressedConflictIds).toEqual([]);
  });

  // --------------------------------------------------------------------------
  // adj-04: Daily capacity deficit with available target day
  // --------------------------------------------------------------------------
  it("adj-04: proposes viable daily reallocation when destination has available margin", () => {
    const dailyAllocations: DailyWorkAllocation[] = [
      {
        itemId: "task-A",
        day: "2026-10-15",
        allocatedHours: 6,
      },
    ];

    const dayConstraints: DayConstraint[] = [
      {
        day: "2026-10-15",
        availableHours: 4, // 6h > 4h -> Daily conflict!
      },
      {
        day: "2026-10-16",
        availableHours: 8, // 8h available, 0h allocated -> 8h margin >= 6h
      },
    ];

    const input: ProposeAdjustmentInput = {
      activePlan: basePlan,
      dailyAllocations,
      dayConstraints,
    };

    const res = proposeAdjustmentsDeterministically(input);

    expect(res.status).toBe("adjustments_proposed");
    const reallocProp = res.proposals.find((p) => p.strategy === "reallocate_daily_work");
    expect(reallocProp).toBeDefined();
    expect(reallocProp?.viability).toBe("viable");
    expect(reallocProp?.resolvedConflictIds).toContain("conflict-daily-capacity-2026-10-15");
    expect(reallocProp?.actions[0].type).toBe("reallocate_day_work");
  });

  // --------------------------------------------------------------------------
  // adj-05: Daily capacity deficit when target day has no margin
  // --------------------------------------------------------------------------
  it("adj-05: refuses daily reallocation when destination day has 0 available margin", () => {
    const dailyAllocations: DailyWorkAllocation[] = [
      {
        itemId: "task-C",
        day: "2026-10-15",
        allocatedHours: 6,
      },
    ];

    const dayConstraints: DayConstraint[] = [
      {
        day: "2026-10-15",
        availableHours: 4, // Overloaded
      },
      {
        day: "2026-10-16",
        availableHours: 0, // No room at all!
      },
    ];

    const input: ProposeAdjustmentInput = {
      activePlan: basePlan,
      dailyAllocations,
      dayConstraints,
    };

    const res = proposeAdjustmentsDeterministically(input);

    // Should NOT have a viable reallocate_daily_work to 2026-10-16
    const invalidRealloc = res.proposals.find(
      (p) =>
        p.strategy === "reallocate_daily_work" &&
        p.actions.some(
          (a) => a.type === "reallocate_day_work" && a.targetDay === "2026-10-16"
        )
    );
    expect(invalidRealloc).toBeUndefined();
  });

  // --------------------------------------------------------------------------
  // adj-06: Blocked by external dependency
  // --------------------------------------------------------------------------
  it("adj-06: generates conditional unblock proposal for external dependency", () => {
    const input: ProposeAdjustmentInput = {
      activePlan: basePlan,
      relationships: [
        {
          sourceItemId: "task-A",
          targetItemId: "task-D", // task-D is deferred!
          type: "depends_on",
          confidence: "high",
          reason: "task-A requires task-D",
        },
      ],
    };

    const res = proposeAdjustmentsDeterministically(input);

    expect(res.status).toBe("adjustments_proposed");
    const depProp = res.proposals.find((p) => p.strategy === "unblock_prerequisite");
    expect(depProp).toBeDefined();
    expect(depProp?.viability).toBe("conditional");
    expect(depProp?.viabilityCondition).toBeTruthy();
    expect(depProp?.resolvedConflictIds).toEqual([]);
    expect(depProp?.unresolvedConflictIds).toContain("conflict-blocked-dep-task-A-task-D");
    expect(depProp?.unresolvedBreakdown.confirmed).toContain("conflict-blocked-dep-task-A-task-D");
  });

  // --------------------------------------------------------------------------
  // adj-07: Strict obligations in schedule overlap with no viable alternative
  // --------------------------------------------------------------------------
  it("adj-07: returns no_viable_alternatives when only strict obligations conflict with no open slots", () => {
    // Only two strict obligations that collide on the only available day
    const strictPlan: ProposedWeek = {
      ...basePlan,
      foci: [],
      flexibleOptions: [],
      obligations: [
        {
          itemId: "task-ob-1",
          title: "Court hearing",
          commitmentType: "strict_deadline",
          dueDate: "2026-10-13",
          rationale: "Legal mandate",
          estimatedHours: 4,
        },
        {
          itemId: "task-ob-2",
          title: "Audit inspection",
          commitmentType: "external",
          dueDate: "2026-10-13",
          rationale: "Inspector visit",
          estimatedHours: 4,
        },
      ],
    };

    const timeBlocks: TimeBlock[] = [
      {
        itemId: "task-ob-1",
        day: "2026-10-13",
        startTime: "10:00",
        endTime: "11:00",
      },
      {
        itemId: "task-ob-2",
        day: "2026-10-13",
        startTime: "10:00",
        endTime: "11:00",
      },
      // Packing candidate slots to ensure no open slot exists
      {
        itemId: "dummy-1",
        day: "2026-10-13",
        startTime: "14:00",
        endTime: "15:00",
      },
      {
        itemId: "dummy-2",
        day: "2026-10-13",
        startTime: "15:00",
        endTime: "16:00",
      },
      {
        itemId: "dummy-3",
        day: "2026-10-13",
        startTime: "11:00",
        endTime: "12:00",
      },
    ];

    const input: ProposeAdjustmentInput = {
      activePlan: strictPlan,
      timeBlocks,
    };

    const res = proposeAdjustmentsDeterministically(input);

    expect(res.status).toBe("no_viable_alternatives");
    expect(res.proposals).toEqual([]);
    expect(res.summary).toContain("ninguna alternativa es viable sin renegociar");
  });

  // --------------------------------------------------------------------------
  // adj-08: Plan with no conflicts but unknown capacity
  // --------------------------------------------------------------------------
  it("adj-08: returns clarification_required when capacity is completely unknown", () => {
    const unknownCapPlan: ProposedWeek = {
      ...basePlan,
      weekSummary: {
        ...basePlan.weekSummary,
        capacity: {
          ...basePlan.weekSummary.capacity,
          totalAvailableHours: null,
          plannableHours: null,
          capacityStatus: "unknown",
        },
      },
    };

    const input: ProposeAdjustmentInput = {
      activePlan: unknownCapPlan,
    };

    const res = proposeAdjustmentsDeterministically(input);

    expect(res.status).toBe("clarification_required");
    expect(res.proposals).toEqual([]);
    expect(res.clarificationQuestions.length).toBeGreaterThan(0);
  });

  // --------------------------------------------------------------------------
  // adj-09: Clean balanced plan with no adjustments needed
  // --------------------------------------------------------------------------
  it("adj-09: returns no_adjustment_needed for perfectly balanced plan", () => {
    const input: ProposeAdjustmentInput = {
      activePlan: basePlan,
    };

    const res = proposeAdjustmentsDeterministically(input);

    expect(res.status).toBe("no_adjustment_needed");
    expect(res.proposals).toEqual([]);
    expect(res.unaddressedConflictIds).toEqual([]);
  });

  // --------------------------------------------------------------------------
  // adj-10: Integrity check and strict invariant violation rejection
  // --------------------------------------------------------------------------
  it("adj-10: validates partition conservation and rejects illegal references or collisions", () => {
    const validProposal = {
      id: "prop-valid",
      strategy: "postpone_flexible" as const,
      title: "Postpone flexible",
      explanation: "Test",
      viability: "viable" as const,
      viabilityCondition: null,
      addressedConflictIds: ["conf-1"],
      resolvedConflictIds: ["conf-1"],
      unresolvedConflictIds: [],
      unresolvedBreakdown: {
        confirmed: [],
        potential: [],
        insufficientInformation: [],
      },
      netHoursFreed: 4,
      resultingPlannedHours: 16,
      affectedPlanItemIds: ["task-C"],
      retainedPlanItemIds: ["task-A", "task-B"],
      previouslyDeferredItemIds: ["task-D"],
      actions: [
        {
          type: "postpone_item" as const,
          itemId: "task-C",
          currentCategory: "flexible_options" as const,
          targetReason: "out_of_capacity" as const,
          hoursFreed: 4,
          rationale: "Free 4h",
        },
      ],
      tradeoffs: ["Postponed"],
    };

    // 1. Valid proposal succeeds
    const check1 = validateProposalInvariants(validProposal, basePlan, [
      {
        id: "conf-1",
        type: "capacity_deficit",
        certainty: "confirmed",
        scope: "weekly",
        title: "Deficit",
        explanation: "Overload",
        involvedElementIds: ["task-C"],
        evidence: {
          metric: "hours_balance",
          description: "balance",
          availableOrRequired: 20,
          conflictingValue: 24,
        },
      },
    ]);
    expect(check1.valid).toBe(true);

    // 2. Partition violation (omitted task-B)
    const check2 = validateProposalInvariants(
      {
        ...validProposal,
        retainedPlanItemIds: ["task-A"], // task-B omitted!
      },
      basePlan
    );
    expect(check2.valid).toBe(false);
    expect(check2.errors.some((e) => e.includes('Item "task-B" is omitted'))).toBe(true);

    // 3. Collision in reassign_time_block
    const collidingProposal = {
      ...validProposal,
      strategy: "reallocate_time_blocks" as const,
      actions: [
        {
          type: "reassign_time_block" as const,
          itemId: "task-C",
          currentBlock: {
            itemId: "task-C",
            day: "2026-10-13",
            startTime: "09:00",
            endTime: "10:00",
          },
          proposedBlock: {
            itemId: "task-C",
            day: "2026-10-13",
            startTime: "10:00",
            endTime: "11:00", // Collides with task-B!
          },
          rationale: "Colliding slot",
        },
      ],
    };

    const check3 = validateProposalInvariants(
      collidingProposal,
      basePlan,
      [],
      [
        {
          itemId: "task-B",
          day: "2026-10-13",
          startTime: "10:00",
          endTime: "11:00",
        },
      ]
    );
    expect(check3.valid).toBe(false);
    expect(check3.errors.some((e) => e.includes("collides with existing block"))).toBe(true);
  });

  // --------------------------------------------------------------------------
  // Audit Regression 1: Dynamic block duration preservation (90 min & 120 min)
  // --------------------------------------------------------------------------
  it("regression: preserves exact 90-minute block duration when reassigning", () => {
    const timeBlocks: TimeBlock[] = [
      {
        itemId: "task-B",
        day: "2026-10-13",
        startTime: "10:00",
        endTime: "11:30", // 90 minutes!
      },
      {
        itemId: "task-C",
        day: "2026-10-13",
        startTime: "10:00",
        endTime: "11:30", // 90 minutes!
      },
    ];

    const input: ProposeAdjustmentInput = {
      activePlan: basePlan,
      timeBlocks,
    };

    const res = proposeAdjustmentsDeterministically(input);
    expect(res.status).toBe("adjustments_proposed");

    const reassignProp = res.proposals.find((p) => p.strategy === "reallocate_time_blocks");
    expect(reassignProp).toBeDefined();

    const action = reassignProp?.actions[0];
    expect(action?.type).toBe("reassign_time_block");
    if (action?.type === "reassign_time_block") {
      const [sh, sm] = action.proposedBlock.startTime.split(":").map(Number);
      const [eh, em] = action.proposedBlock.endTime.split(":").map(Number);
      const duration = eh * 60 + em - (sh * 60 + sm);
      expect(duration).toBe(90); // Exactly 90 minutes!
    }
  });

  it("regression: preserves exact 120-minute block duration when reassigning", () => {
    const timeBlocks: TimeBlock[] = [
      {
        itemId: "task-B",
        day: "2026-10-13",
        startTime: "09:00",
        endTime: "11:00", // 120 minutes!
      },
      {
        itemId: "task-C",
        day: "2026-10-13",
        startTime: "09:00",
        endTime: "11:00", // 120 minutes!
      },
    ];

    const input: ProposeAdjustmentInput = {
      activePlan: basePlan,
      timeBlocks,
    };

    const res = proposeAdjustmentsDeterministically(input);
    expect(res.status).toBe("adjustments_proposed");

    const reassignProp = res.proposals.find((p) => p.strategy === "reallocate_time_blocks");
    expect(reassignProp).toBeDefined();

    const action = reassignProp?.actions[0];
    expect(action?.type).toBe("reassign_time_block");
    if (action?.type === "reassign_time_block") {
      const [sh, sm] = action.proposedBlock.startTime.split(":").map(Number);
      const [eh, em] = action.proposedBlock.endTime.split(":").map(Number);
      const duration = eh * 60 + em - (sh * 60 + sm);
      expect(duration).toBe(120); // Exactly 120 minutes!
    }
  });

  // --------------------------------------------------------------------------
  // Audit Regression 4: Unresolvable blocking conflict with secondary accept_tradeoff
  // --------------------------------------------------------------------------
  it("audit-4: returns no_viable_alternatives when confirmed blocking overlap is insubsanable even if secondary potential conflict exists", () => {
    const strictPlan: ProposedWeek = {
      ...basePlan,
      foci: [],
      flexibleOptions: [],
      obligations: [
        {
          itemId: "task-ob-1",
          title: "Court hearing",
          commitmentType: "strict_deadline",
          dueDate: "2026-10-13",
          rationale: "Legal mandate",
          estimatedHours: 4,
        },
        {
          itemId: "task-ob-2",
          title: "Audit inspection",
          commitmentType: "external",
          dueDate: "2026-10-13",
          rationale: "Inspector visit",
          estimatedHours: 4,
        },
      ],
    };

    // Pack all slots on 2026-10-13
    const timeBlocks: TimeBlock[] = [
      {
        itemId: "task-ob-1",
        day: "2026-10-13",
        startTime: "10:00",
        endTime: "11:00",
      },
      {
        itemId: "task-ob-2",
        day: "2026-10-13",
        startTime: "10:00",
        endTime: "11:00",
      },
      {
        itemId: "dummy-1",
        day: "2026-10-13",
        startTime: "14:00",
        endTime: "15:00",
      },
      {
        itemId: "dummy-2",
        day: "2026-10-13",
        startTime: "15:00",
        endTime: "16:00",
      },
      {
        itemId: "dummy-3",
        day: "2026-10-13",
        startTime: "11:00",
        endTime: "12:00",
      },
    ];

    // Explicit conflict report containing BOTH an insubsanable confirmed overlap AND a secondary potential risk
    const input: ProposeAdjustmentInput = {
      activePlan: strictPlan,
      timeBlocks,
      conflictReport: {
        status: "conflicts_detected",
        summary: "Conflicts detected",
        hasBlockingConflicts: true,
        conflicts: [
          {
            id: "conf-blocking-overlap",
            type: "schedule_overlap",
            certainty: "confirmed",
            scope: "daily",
            title: "Solapamiento entre obligaciones externas",
            explanation: "Dos obligaciones externas coinciden y no hay franjas libres.",
            involvedElementIds: ["task-ob-1", "task-ob-2"],
            evidence: {
              metric: "fixed_time_interval",
              description: "Intervalo 10:00-11:00",
              availableOrRequired: "10:00-11:00",
              conflictingValue: "10:00-11:00",
            },
          },
          {
            id: "conf-secondary-risk",
            type: "capacity_deficit",
            certainty: "potential",
            scope: "weekly",
            title: "Riesgo potencial secundario",
            explanation: "Ligera tensión de estimaciones no confirmada.",
            involvedElementIds: ["task-ob-1"],
            evidence: {
              metric: "hours_balance",
              description: "Estimación ajustada",
              availableOrRequired: 20,
              conflictingValue: 22,
            },
          },
        ],
        unconflictedAreas: [],
      },
    };

    const res = proposeAdjustmentsDeterministically(input);

    // Because the blocking conflict has no viable alternative, accept_tradeoff on the secondary risk cannot disguise it
    expect(res.status).toBe("no_viable_alternatives");
    expect(res.proposals).toEqual([]);
    expect(res.summary).toContain("ninguna alternativa es viable sin renegociar");
  });

  // --------------------------------------------------------------------------
  // Audit Regression 5: Deficit (8h) greater than freed hours of focus (4h)
  // --------------------------------------------------------------------------
  it("audit-5: handles weekly capacity deficit (8h) with focus smaller than deficit (4h) as partial conditional proposal", () => {
    const deficitPlan: ProposedWeek = {
      ...basePlan,
      weekSummary: {
        ...basePlan.weekSummary,
        capacity: {
          ...basePlan.weekSummary.capacity,
          plannableHours: 20,
          plannedHours: 28, // Deficit = 28 - 20 = 8h
          capacityStatus: "over_capacity",
        },
      },
      foci: [
        {
          ...basePlan.foci[0],
          estimatedHours: 4, // 4h < 8h deficit!
        },
      ],
      flexibleOptions: [], // No other items to postpone
    };

    const input: ProposeAdjustmentInput = {
      activePlan: deficitPlan,
    };

    const res = proposeAdjustmentsDeterministically(input);

    expect(res.status).toBe("adjustments_proposed");
    const partialProp = res.proposals.find((p) => p.strategy === "postpone_foci");
    expect(partialProp).toBeDefined();

    // Must be conditional, NOT viable
    expect(partialProp?.viability).toBe("conditional");
    expect(partialProp?.viabilityCondition).toContain("4 h"); // references remaining deficit (8h - 4h = 4h)
    // Must NOT declare the deficit conflict resolved
    expect(partialProp?.resolvedConflictIds).toEqual([]);
    expect(partialProp?.unresolvedConflictIds).toContain("conflict-weekly-capacity-deficit");
    expect(partialProp?.netHoursFreed).toBe(4);
    expect(partialProp?.resultingPlannedHours).toBe(24); // 28 - 4 = 24h
  });
});
