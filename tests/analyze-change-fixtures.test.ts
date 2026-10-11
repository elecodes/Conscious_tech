import { describe, it, expect } from "vitest";
import { ProposedWeek } from "../src/domain/week";
import { AnalyzeChangeInput } from "../src/domain/change";
import { analyzeChangeDeterministically } from "../src/skills/analyze-change/deterministic";

// Standard base plan for fixture suite
const basePlan: ProposedWeek = {
  weekSummary: {
    targetWeek: {
      startDate: "2026-10-12",
      endDate: "2026-10-18",
    },
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
      title: "Core Feature Release",
      desiredOutcome: "Deploy backend endpoints",
      rationale: "Strategic company milestone",
      contributingItemIds: ["item-01", "item-02"],
      estimatedHours: 14,
    },
  ],
  obligations: [
    {
      itemId: "item-03",
      title: "Client contract deadline",
      commitmentType: "external",
      dueDate: "2026-10-15",
      rationale: "Contractually committed delivery",
      estimatedHours: 6,
    },
  ],
  flexibleOptions: [
    {
      itemId: "item-04",
      title: "Clean documentation",
      condition: "If core work finishes ahead of time",
      estimatedHours: 4,
    },
  ],
  deferredItems: [
    {
      itemId: "item-05",
      title: "Explore new database provider",
      reason: "out_of_capacity",
      rationale: "Postponed to preserve focus",
    },
  ],
  unplannedSpace: {
    rationale: "10 hours reserved for focus and unexpected urgent matters",
    recommendedHours: 10,
  },
  confirmationPrompt: {
    question: "¿Te representa esta propuesta para estructurar la semana?",
    keyTradeoffs: ["item-05 postponed to next cycle"],
    pendingQuestions: [],
  },
};

describe("Skill 07: analyze_change - 10 Agreed Fixture Test Suite", () => {
  // change-01: Reducción drástica de disponibilidad semanal
  it("change-01: capacity reduction causes deficit_known and requires intervention", () => {
    const input: AnalyzeChangeInput = {
      currentDate: "2026-10-11",
      activePlan: basePlan,
      changeDescription: "Only 15 hours available this week due to sudden family emergency.",
      incomingDelta: {
        capacityOperations: [
          { previousAvailableHours: 40, newAvailableHours: 15 },
        ],
      },
    };

    const result = analyzeChangeDeterministically(input);
    expect(result.status).toBe("analyzed");
    expect(result.changeType).toBe("capacity_change");
    expect(result.capacityImpact.projectedTotalHours).toBe(15);
    expect(result.capacityImpact.deltaHours).toBe(-25);
    expect(result.capacityImpact.arithmeticBalance).toBe("deficit_known");
    expect(result.requiresUserIntervention).toBe(true);
    expect(result.interventionReason).toContain("deficit");
  });

  // change-02: Adelanto crítico de fecha límite externa
  it("change-02: external deadline moved to target week keeps commitment and scope", () => {
    const input: AnalyzeChangeInput = {
      currentDate: "2026-10-11",
      activePlan: basePlan,
      changeDescription: "Client moved audit delivery to Wednesday 2026-10-14.",
      incomingDelta: {
        deadlineOperations: [
          {
            itemId: "item-03",
            previousDueDate: "2026-10-15",
            newDueDate: "2026-10-14",
          },
        ],
      },
    };

    const result = analyzeChangeDeterministically(input);
    expect(result.status).toBe("analyzed");
    expect(result.changeType).toBe("deadline_change");
    const affected = result.affectedElements.find((e) => e.elementId === "item-03");
    expect(affected).toBeDefined();
    expect(affected?.temporalScope).toBe("current_week");
    expect(affected?.commitmentNature).toBe("external_commitment");
  });

  // change-03: Prórroga de entrega hacia semana futura
  it("change-03: deadline moved to future week sets temporalScope to future_week", () => {
    const input: AnalyzeChangeInput = {
      currentDate: "2026-10-11",
      activePlan: basePlan,
      changeDescription: "Client contract deadline postponed to 2026-10-28.",
      incomingDelta: {
        deadlineOperations: [
          {
            itemId: "item-03",
            previousDueDate: "2026-10-15",
            newDueDate: "2026-10-28",
          },
        ],
      },
    };

    const result = analyzeChangeDeterministically(input);
    expect(result.status).toBe("analyzed");
    expect(result.changeType).toBe("deadline_change");
    const affected = result.affectedElements.find((e) => e.elementId === "item-03");
    expect(affected).toBeDefined();
    expect(affected?.temporalScope).toBe("future_week");
  });

  // change-04: Eliminación de tarea que contribuye a un foco semanal
  it("change-04: removing contributing item breaks focus_integrity and triggers intervention", () => {
    const input: AnalyzeChangeInput = {
      currentDate: "2026-10-11",
      activePlan: basePlan,
      changeDescription: "Drop item-01 from scope entirely.",
      incomingDelta: {
        itemOperations: [{ op: "remove", itemId: "item-01" }],
      },
    };

    const result = analyzeChangeDeterministically(input);
    expect(result.status).toBe("analyzed");
    expect(result.changeType).toBe("drop_item");
    expect(result.requiresUserIntervention).toBe(true);
    const focusAffected = result.affectedElements.find((e) => e.category === "focus_integrity");
    expect(focusAffected).toBeDefined();
    expect(focusAffected?.elementId).toBe("focus-1");
  });

  // change-05: Incorporación de nueva tarea con estimación incompleta
  it("change-05: new item without estimation results in indeterminate arithmetic balance", () => {
    const input: AnalyzeChangeInput = {
      currentDate: "2026-10-11",
      activePlan: basePlan,
      changeDescription: "New urgent bug reported by CEO.",
      incomingDelta: {
        itemOperations: [
          {
            op: "add",
            item: {
              id: "item-06",
              rawText: "Fix intermittent auth crash reported by CEO",
              title: "Fix intermittent auth crash",
              type: "task",
              // No estimatedEffort provided
            },
          },
        ],
      },
    };

    const result = analyzeChangeDeterministically(input);
    expect(result.status).toBe("analyzed");
    expect(result.changeType).toBe("new_item");
    expect(result.capacityImpact.arithmeticBalance).toBe("indeterminate");
  });

  // change-06: Desbloqueo anticipado de dependencia causal
  it("change-06: dependency removal marks condition satisfied and does NOT require intervention", () => {
    const input: AnalyzeChangeInput = {
      currentDate: "2026-10-11",
      activePlan: basePlan,
      changeDescription: "External team delivered API early, item-02 is no longer waiting on prerequisite.",
      incomingDelta: {
        relationshipOperations: [
          {
            op: "remove",
            sourceItemId: "item-02",
            targetItemId: "item-01",
            type: "depends_on",
          },
        ],
      },
    };

    const result = analyzeChangeDeterministically(input);
    expect(result.status).toBe("analyzed");
    expect(result.changeType).toBe("dependency_change");
    expect(result.requiresUserIntervention).toBe(false);
    const affected = result.affectedElements.find((e) => e.elementId === "item-02");
    expect(affected?.dependencyState).toBe("satisfied");
  });

  // change-07: Bloqueo causal sobrevenido
  it("change-07: new pending causal dependency triggers intervention", () => {
    const input: AnalyzeChangeInput = {
      currentDate: "2026-10-11",
      activePlan: basePlan,
      changeDescription: "item-02 cannot start until item-05 is resolved.",
      incomingDelta: {
        relationshipOperations: [
          {
            op: "add",
            sourceItemId: "item-02",
            targetItemId: "item-05",
            type: "depends_on",
          },
        ],
      },
    };

    const result = analyzeChangeDeterministically(input);
    expect(result.status).toBe("analyzed");
    expect(result.changeType).toBe("dependency_change");
    expect(result.requiresUserIntervention).toBe(true);
    const affected = result.affectedElements.find((e) => e.elementId === "item-02");
    expect(affected?.dependencyState).toBe("pending");
  });

  // change-08: Conversación neutral / sin impacto identificable
  it("change-08: conversational text without delta reports no_impact cleanly", () => {
    const input: AnalyzeChangeInput = {
      currentDate: "2026-10-11",
      activePlan: basePlan,
      changeDescription: "¿Qué tal ves la semana para organizarme tranquilo?",
    };

    const result = analyzeChangeDeterministically(input);
    expect(result.status).toBe("no_impact");
    expect(result.changeType).toBe("none_detected");
    expect(result.requiresUserIntervention).toBe(false);
    expect(result.affectedElements.length).toBe(0);
    expect(result.unaffectedAreas.length).toBeGreaterThan(0);
  });

  // change-09: Modificación de atributos sin alteración de fechas ni dependencias
  it("change-09: attribute modification without date change classifies as modified_item", () => {
    const input: AnalyzeChangeInput = {
      currentDate: "2026-10-11",
      activePlan: basePlan,
      changeDescription: "Clarify title for documentation task.",
      incomingDelta: {
        itemOperations: [
          {
            op: "modify",
            itemId: "item-04",
            patch: {
              title: "Update API Swagger and OpenAPI documentation v2",
            },
          },
        ],
      },
    };

    const result = analyzeChangeDeterministically(input);
    expect(result.status).toBe("analyzed");
    expect(result.changeType).toBe("modified_item");
    expect(result.requiresUserIntervention).toBe(false);
    // Focus 1 must remain verified in unaffectedAreas
    const fociArea = result.unaffectedAreas.find((a) => a.areaName === "foci");
    expect(fociArea).toBeDefined();
    expect(fociArea?.elementIds).toContain("focus-1");
  });

  // change-10: Referencia a item inexistente en el plan
  it("change-10: non-existent item reference fails safely with invalid_references", () => {
    const input: AnalyzeChangeInput = {
      currentDate: "2026-10-11",
      activePlan: basePlan,
      changeDescription: "Cancel phantom task.",
      incomingDelta: {
        itemOperations: [
          {
            op: "remove",
            itemId: "item-999-phantom",
          },
        ],
      },
    };

    const result = analyzeChangeDeterministically(input);
    expect(result.status).toBe("invalid_references");
    expect(result.validationErrors.length).toBeGreaterThan(0);
    expect(result.validationErrors[0].type).toBe("unresolved_reference");
    expect(result.requiresUserIntervention).toBe(true);
    expect(result.affectedElements.length).toBe(0);
  });
});
