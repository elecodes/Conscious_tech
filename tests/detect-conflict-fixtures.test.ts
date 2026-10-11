import { describe, it, expect } from "vitest";
import { ProposedWeek } from "../src/domain/week";
import { DetectConflictInput } from "../src/domain/conflict";
import { detectConflictsDeterministically } from "../src/skills/detect-conflict/deterministic";

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
      contributingItemIds: ["item-01"],
      estimatedHours: 12,
    },
  ],
  obligations: [
    {
      itemId: "item-02",
      title: "Deliver audit report",
      commitmentType: "external",
      dueDate: "2026-10-14",
      rationale: "Contractual",
      estimatedHours: 8,
    },
  ],
  flexibleOptions: [],
  deferredItems: [],
  unplannedSpace: {
    rationale: "Protected 10h buffer",
    recommendedHours: 10,
  },
  confirmationPrompt: {
    question: "OK?",
    keyTradeoffs: [],
    pendingQuestions: [],
  },
};

describe("Skill 08: detect_conflict - 10 Canonical Fixture Suite", () => {
  // conflict-01: Déficit de capacidad semanal comprobado
  it("conflict-01: confirmed weekly capacity deficit triggers blocking conflict", () => {
    const overloadedPlan: ProposedWeek = {
      ...basePlan,
      weekSummary: {
        ...basePlan.weekSummary,
        capacity: {
          ...basePlan.weekSummary.capacity,
          plannableHours: 20,
        },
      },
      foci: [
        {
          ...basePlan.foci[0],
          estimatedHours: 16,
        },
      ],
      obligations: [
        {
          ...basePlan.obligations[0],
          estimatedHours: 10,
        },
      ],
    };

    const input: DetectConflictInput = {
      currentDate: "2026-10-11",
      activePlan: overloadedPlan,
    };

    const result = detectConflictsDeterministically(input);
    expect(result.status).toBe("conflicts_detected");
    expect(result.hasBlockingConflicts).toBe(true);

    const capConflict = result.conflicts.find((c) => c.type === "capacity_deficit" && c.scope === "weekly");
    expect(capConflict).toBeDefined();
    expect(capConflict?.certainty).toBe("confirmed");
    expect(capConflict?.evidence.metric).toBe("hours_balance");
    expect(capConflict?.evidence.availableOrRequired).toBe(20);
    expect(capConflict?.evidence.conflictingValue).toBe(26);
  });

  // conflict-02: Dependencia causal bloqueante en plan
  it("conflict-02: active item depending on deferred prerequisite triggers confirmed blocked_by_dependency", () => {
    const planWithDeferred: ProposedWeek = {
      ...basePlan,
      deferredItems: [
        {
          itemId: "item-prereq",
          title: "Setup DB cluster",
          reason: "out_of_capacity",
          rationale: "Postponed",
        },
      ],
    };

    const input: DetectConflictInput = {
      currentDate: "2026-10-11",
      activePlan: planWithDeferred,
      relationships: [
        {
          sourceItemId: "item-01", // in focus-1
          targetItemId: "item-prereq",
          type: "depends_on",
          confidence: "high",
          reason: "Needs DB cluster online",
        },
      ],
    };

    const result = detectConflictsDeterministically(input);
    expect(result.status).toBe("conflicts_detected");
    expect(result.hasBlockingConflicts).toBe(true);

    const depConflict = result.conflicts.find((c) => c.type === "blocked_by_dependency");
    expect(depConflict).toBeDefined();
    expect(depConflict?.certainty).toBe("confirmed");
    expect(depConflict?.involvedElementIds).toEqual(["item-01", "item-prereq"]);
  });

  // conflict-03: Solapamiento horario demostrado
  it("conflict-03: overlapping fixed-time intervals on same day trigger confirmed schedule_overlap", () => {
    const input: DetectConflictInput = {
      currentDate: "2026-10-11",
      activePlan: basePlan,
      timeBlocks: [
        {
          itemId: "meeting-client",
          day: "2026-10-13",
          startTime: "10:00",
          endTime: "11:30",
        },
        {
          itemId: "doctor-appointment",
          day: "2026-10-13",
          startTime: "11:00",
          endTime: "12:00",
        },
      ],
    };

    const result = detectConflictsDeterministically(input);
    expect(result.status).toBe("conflicts_detected");
    expect(result.hasBlockingConflicts).toBe(true);

    const overlap = result.conflicts.find((c) => c.type === "schedule_overlap");
    expect(overlap).toBeDefined();
    expect(overlap?.certainty).toBe("confirmed");
    expect(overlap?.scope).toBe("daily");
    expect(overlap?.evidence.metric).toBe("fixed_time_interval");
  });

  // conflict-04: Déficit de capacidad en una ventana diaria explícita
  it("conflict-04: explicit daily work allocation exceeding day capacity constraint triggers confirmed daily capacity_deficit", () => {
    const input: DetectConflictInput = {
      currentDate: "2026-10-11",
      activePlan: basePlan,
      dayConstraints: [
        {
          day: "2026-10-15",
          availableHours: 3,
          note: "Family afternoon; only 3h available",
        },
      ],
      dailyAllocations: [
        {
          itemId: "task-deploy",
          day: "2026-10-15",
          allocatedHours: 4,
        },
        {
          itemId: "task-training",
          day: "2026-10-15",
          allocatedHours: 2,
        },
      ],
    };

    const result = detectConflictsDeterministically(input);
    expect(result.status).toBe("conflicts_detected");
    expect(result.hasBlockingConflicts).toBe(true);

    const dailyCap = result.conflicts.find((c) => c.type === "capacity_deficit" && c.scope === "daily");
    expect(dailyCap).toBeDefined();
    expect(dailyCap?.certainty).toBe("confirmed");
    expect(dailyCap?.evidence.metric).toBe("hours_balance");
    expect(dailyCap?.evidence.availableOrRequired).toBe(3);
    expect(dailyCap?.evidence.conflictingValue).toBe(6);
  });

  // conflict-05: Fecha límite de prerrequisito posterior sin bloqueo rígido
  it("conflict-05: movable prerequisite with later due date triggers potential risk without blocking", () => {
    const planWithTwoObligations: ProposedWeek = {
      ...basePlan,
      obligations: [
        {
          itemId: "item-successor",
          title: "Deliver feature beta",
          commitmentType: "strict_deadline",
          dueDate: "2026-10-14",
          rationale: "Target date",
          estimatedHours: 4,
        },
        {
          itemId: "item-prereq",
          title: "Review dependencies",
          commitmentType: "strict_deadline", // Not external contractual
          dueDate: "2026-10-16",
          rationale: "Planned for Friday",
          estimatedHours: 2,
        },
      ],
    };

    const input: DetectConflictInput = {
      currentDate: "2026-10-11",
      activePlan: planWithTwoObligations,
      relationships: [
        {
          sourceItemId: "item-successor",
          targetItemId: "item-prereq",
          type: "depends_on",
          confidence: "high",
          reason: "Beta requires review first",
        },
      ],
    };

    const result = detectConflictsDeterministically(input);
    expect(result.status).toBe("potential_risks_only");
    expect(result.hasBlockingConflicts).toBe(false);

    const dateRisk = result.conflicts.find((c) => c.type === "deadline_incompatibility");
    expect(dateRisk).toBeDefined();
    expect(dateRisk?.certainty).toBe("potential");
    expect(dateRisk?.evidence.metric).toBe("calendar_dates");
  });

  // conflict-06: Tensión de capacidad con estimaciones incompletas
  it("conflict-06: high load near ceiling with unestimated elements reports insufficient_information without blocking", () => {
    const nearLimitPlan: ProposedWeek = {
      ...basePlan,
      weekSummary: {
        ...basePlan.weekSummary,
        capacity: {
          ...basePlan.weekSummary.capacity,
          plannableHours: 20,
          plannedHours: 19,
          estimationCompleteness: "partial",
        },
      },
      foci: [
        {
          id: "focus-1",
          title: "Important focus",
          desiredOutcome: "Ship",
          rationale: "Priority",
          contributingItemIds: ["item-01"],
          estimatedHours: null, // missing estimate!
        },
      ],
    };

    const input: DetectConflictInput = {
      currentDate: "2026-10-11",
      activePlan: nearLimitPlan,
    };

    const result = detectConflictsDeterministically(input);
    expect(result.status).toBe("potential_risks_only");
    expect(result.hasBlockingConflicts).toBe(false);

    const uncertainCap = result.conflicts.find((c) => c.type === "capacity_deficit");
    expect(uncertainCap).toBeDefined();
    expect(uncertainCap?.certainty).toBe("insufficient_information");
  });

  // conflict-07: Capacidad total semanal desconocida (null)
  it("conflict-07: null capacity does not invent overload, nor certify unconflicted areas falsely", () => {
    const unknownCapPlan: ProposedWeek = {
      ...basePlan,
      weekSummary: {
        ...basePlan.weekSummary,
        capacity: {
          totalAvailableHours: null,
          plannableHours: null,
          plannedHours: null,
          knownEstimatedHours: null,
          estimationCompleteness: "none",
          protectedSpaceHours: null,
          capacityStatus: "unknown",
          protectedSpaceStatus: "unknown",
        },
      },
      foci: [
        {
          ...basePlan.foci[0],
          estimatedHours: null,
        },
      ],
    };

    const input: DetectConflictInput = {
      currentDate: "2026-10-11",
      activePlan: unknownCapPlan,
    };

    const result = detectConflictsDeterministically(input);
    // Does NOT invent a conflict
    expect(result.status).toBe("no_conflicts");
    expect(result.hasBlockingConflicts).toBe(false);
    expect(result.conflicts.length).toBe(0);
    // Crucial: does NOT falsely certify unconflicted areas when data is unknown!
    expect(result.unconflictedAreas.length).toBe(0);
  });

  // conflict-08: Dependencia temática no causal (related_to / same_project)
  it("conflict-08: related_to or same_project relationships do not generate false dependency blocks", () => {
    const input: DetectConflictInput = {
      currentDate: "2026-10-11",
      activePlan: basePlan,
      relationships: [
        {
          sourceItemId: "item-01",
          targetItemId: "item-02",
          type: "related_to",
          confidence: "high",
          reason: "Both are related to documentation",
        },
        {
          sourceItemId: "item-01",
          targetItemId: "item-02",
          type: "same_project",
          confidence: "high",
          reason: "Part of project alpha",
        },
      ],
    };

    const result = detectConflictsDeterministically(input);
    expect(result.status).toBe("no_conflicts");
    expect(result.conflicts.length).toBe(0);
    expect(result.hasBlockingConflicts).toBe(false);
  });

  // conflict-09: Opciones flexibles y deseos sin fecha
  it("conflict-09: flexible options and exploratory ideas without deadlines do not trigger conflicts", () => {
    const flexiblePlan: ProposedWeek = {
      ...basePlan,
      flexibleOptions: [
        {
          itemId: "idea-blog",
          title: "Write blog article if time allows",
          condition: "If time permits",
          estimatedHours: 2,
        },
      ],
    };

    const input: DetectConflictInput = {
      currentDate: "2026-10-11",
      activePlan: flexiblePlan,
    };

    const result = detectConflictsDeterministically(input);
    expect(result.status).toBe("no_conflicts");
    expect(result.conflicts.length).toBe(0);
    expect(result.hasBlockingConflicts).toBe(false);
  });

  // conflict-10: Plan equilibrado con aislamiento verificado positivamente
  it("conflict-10: balanced plan with complete data certifies unconflicted areas positively", () => {
    const input: DetectConflictInput = {
      currentDate: "2026-10-11",
      activePlan: basePlan,
    };

    const result = detectConflictsDeterministically(input);
    expect(result.status).toBe("no_conflicts");
    expect(result.conflicts.length).toBe(0);
    expect(result.hasBlockingConflicts).toBe(false);
    expect(result.unconflictedAreas.length).toBeGreaterThan(0);

    const fociArea = result.unconflictedAreas.find((a) => a.areaName === "foci");
    expect(fociArea).toBeDefined();
    expect(fociArea?.elementIds).toContain("focus-1");

    const obArea = result.unconflictedAreas.find((a) => a.areaName === "obligations");
    expect(obArea).toBeDefined();
    expect(obArea?.elementIds).toContain("item-02");
  });
});
