import { describe, it, expect } from "vitest";
import { CloseWeekService } from "../src/skills/close-week";
import type { CloseWeekInput } from "../src/domain/close-week";
import type { ProposedWeek } from "../src/domain/week";
import type { WeeklySchedule, ScheduleAdjustmentRecord } from "../src/domain/schedule";

describe("Skill 11: close_week deterministic engine & behavioral fixtures", () => {
  const service = new CloseWeekService();

  const basePlan: ProposedWeek = {
    weekSummary: {
      targetWeek: {
        startDate: "2026-10-12",
        endDate: "2026-10-18",
      },
      capacity: {
        totalAvailableHours: 30,
        plannableHours: 22,
        plannedHours: 20,
        knownEstimatedHours: 20,
        estimationCompleteness: "complete",
        protectedSpaceHours: 8,
        capacityStatus: "within_capacity",
        protectedSpaceStatus: "respected",
      },
    },
    foci: [
      {
        id: "focus-aws",
        title: "Preparar certificación AWS",
        desiredOutcome: "Completar simulacro",
        rationale: "Foco principal",
        contributingItemIds: ["item-aws-1", "item-aws-2"],
        estimatedHours: 12,
      },
    ],
    obligations: [
      {
        itemId: "ob-clase",
        title: "Dar clase martes",
        dueDate: "2026-10-13",
        commitmentType: "external",
        rationale: "Compromiso externo confirmado",
        estimatedHours: 4,
      },
    ],
    flexibleOptions: [
      {
        itemId: "flex-zapsac",
        title: "Avanzar Zapsac",
        condition: "Si hay tiempo",
        estimatedHours: 4,
      },
    ],
    deferredItems: [
      {
        itemId: "def-podcast",
        title: "Idea podcast",
        reason: "not_scheduled",
        rationale: "Diferido para semanas futuras",
      },
    ],
    unplannedSpace: {
      recommendedHours: 8,
      rationale: "Espacio protegido",
    },
    confirmationPrompt: {
      question: "¿Plan aceptado?",
      keyTradeoffs: [],
      pendingQuestions: [],
    },
  };

  // 1. Empty week
  it("handles empty week without plan items cleanly", () => {
    const emptyPlan: ProposedWeek = {
      ...basePlan,
      foci: [],
      obligations: [],
      flexibleOptions: [],
      deferredItems: [],
      weekSummary: {
        targetWeek: { startDate: "2026-10-12", endDate: "2026-10-18" },
        capacity: {
          totalAvailableHours: 20,
          plannableHours: 14,
          plannedHours: 0,
          knownEstimatedHours: 0,
          estimationCompleteness: "complete",
          protectedSpaceHours: 6,
          capacityStatus: "within_capacity",
          protectedSpaceStatus: "respected",
        },
      },
    };

    const result = service.execute({
      closedAt: "2026-10-18T20:00:00Z",
      activePlan: emptyPlan,
      itemOutcomes: [],
    });

    expect(result.status).toBe("success");
    expect(result.classifiedItems).toHaveLength(0);
    expect(result.capacityAnalysis.totalActualHours).toBeNull();
    expect(result.capacityAnalysis.spaceRespected).toBe(true);
  });

  // 2. Fully reported week with achievements
  it("processes a completely reported week with achieved foci and respected space", () => {
    const input: CloseWeekInput = {
      closedAt: "2026-10-18T19:00:00Z",
      activePlan: basePlan,
      itemOutcomes: [
        { itemId: "item-aws-1", status: "completed", actualHours: 6 },
        { itemId: "item-aws-2", status: "completed", actualHours: 5 },
        { itemId: "ob-clase", status: "completed", actualHours: 4 },
        { itemId: "flex-zapsac", status: "completed", actualHours: 3 },
        { itemId: "def-podcast", status: "not_started", actualHours: 0 },
      ],
      userReflection: {
        energyLevel: "energized",
        generalNotes: "Excelente foco en AWS.",
      },
    };

    const result = service.execute(input);
    if (result.status === "invalid_request") {
      console.log("WARNINGS:", result.warnings);
    }

    expect(result.status).toBe("success");
    expect(result.classifiedItems).toHaveLength(5);
    expect(result.fociOutcomes[0].outcome).toBe("achieved");
    expect(result.obligationsOutcomes[0].outcome).toBe("completed");
    expect(result.itemDispositions.completed).toEqual(
      expect.arrayContaining(["item-aws-1", "item-aws-2", "ob-clase", "flex-zapsac"])
    );
    // 6 + 5 + 4 + 3 = 18 hours. Available = 30, protected = 8. Max work allowed = 22. 18 <= 22 -> true!
    expect(result.capacityAnalysis.spaceRespected).toBe(true);
    expect(result.capacityAnalysis.totalActualHours).toBe(18);

    // Memory candidates generated
    expect(result.memoryCandidates.length).toBeGreaterThan(0);
    const factCandidate = result.memoryCandidates.find((m) => m.suggestedCategory === "fact");
    expect(factCandidate).toBeDefined();
    expect(factCandidate?.rawText).toContain("Preparar certificación AWS");
  });

  // 3. Unreported items
  it("treats missing outcomes as unreported without fabricating not_started or dropped", () => {
    const input: CloseWeekInput = {
      closedAt: "2026-10-18T19:00:00Z",
      activePlan: basePlan,
      itemOutcomes: [
        { itemId: "item-aws-1", status: "completed", actualHours: 6 },
        // item-aws-2 is missing!
        { itemId: "ob-clase", status: "completed", actualHours: 4 },
      ],
    };

    const result = service.execute(input);

    expect(result.status).toBe("partial_data");
    const itemAws2 = result.classifiedItems.find((c) => c.itemId === "item-aws-2");
    expect(itemAws2?.finalDisposition).toBe("unreported");
    expect(itemAws2?.isReported).toBe(false);

    expect(result.fociOutcomes[0].outcome).toBe("partially_achieved");
    expect(result.fociOutcomes[0].unreportedItemIds).toContain("item-aws-2");
  });

  // 4. Deferred items do not reactivate automatically
  it("preserves deferredItems as carryOverCandidates without converting them into obligations", () => {
    const input: CloseWeekInput = {
      closedAt: "2026-10-18T19:00:00Z",
      activePlan: basePlan,
      itemOutcomes: [
        { itemId: "item-aws-1", status: "completed", actualHours: 6 },
        { itemId: "item-aws-2", status: "completed", actualHours: 6 },
        { itemId: "ob-clase", status: "completed", actualHours: 4 },
        { itemId: "flex-zapsac", status: "not_started" },
        // def-podcast has no report!
      ],
    };

    const result = service.execute(input);

    const defCandidate = result.itemDispositions.carryOverCandidates.find(
      (c) => c.itemId === "def-podcast"
    );
    expect(defCandidate).toBeDefined();
    expect(defCandidate?.reason).toBe("not_scheduled");
    expect(defCandidate?.originCategory).toBe("deferred");
    // Doesn't appear in completed or dropped
    expect(result.itemDispositions.completed).not.toContain("def-podcast");
    expect(result.itemDispositions.dropped).not.toContain("def-podcast");
  });

  // 5. Conscious postponement vs dropped
  it("distinguishes conscious postponement from dropped items clearly", () => {
    const input: CloseWeekInput = {
      closedAt: "2026-10-18T19:00:00Z",
      activePlan: basePlan,
      itemOutcomes: [
        {
          itemId: "item-aws-1",
          status: "consciously_postponed",
          postponementReason: "Esperando confirmación de fecha de examen",
        },
        {
          itemId: "item-aws-2",
          status: "dropped",
          userNotes: "Decidí no hacer este simulacro adicional",
        },
        { itemId: "ob-clase", status: "completed", actualHours: 4 },
        { itemId: "flex-zapsac", status: "not_started" },
        { itemId: "def-podcast", status: "not_started" },
      ],
    };

    const result = service.execute(input);

    // Dropped appears in dropped array and is NOT in carryOverCandidates
    expect(result.itemDispositions.dropped).toContain("item-aws-2");
    expect(result.itemDispositions.carryOverCandidates.some((c) => c.itemId === "item-aws-2")).toBe(
      false
    );

    // Consciously postponed appears in carryOverCandidates and generates a memory candidate
    const postponedCandidate = result.itemDispositions.carryOverCandidates.find(
      (c) => c.itemId === "item-aws-1"
    );
    expect(postponedCandidate).toBeDefined();
    expect(postponedCandidate?.reason).toBe("consciously_postponed");

    const decisionMem = result.memoryCandidates.find((m) => m.suggestedCategory === "decision");
    expect(decisionMem).toBeDefined();
    expect(decisionMem?.rawText).toContain("Decisión de postergación consciente");
  });

  // 6. Complete, partial, and absent actual hours
  it("correctly identifies complete, partial, and absent actual hours", () => {
    // A. Absent actual hours
    const absentHoursResult = service.execute({
      closedAt: "2026-10-18T19:00:00Z",
      activePlan: basePlan,
      itemOutcomes: [
        { itemId: "item-aws-1", status: "completed", actualHours: null },
        { itemId: "item-aws-2", status: "completed", actualHours: null },
        { itemId: "ob-clase", status: "completed", actualHours: null },
        { itemId: "flex-zapsac", status: "completed", actualHours: null },
        { itemId: "def-podcast", status: "completed", actualHours: null },
      ],
    });
    expect(absentHoursResult.capacityAnalysis.status).toBe("no_actual_data");
    expect(absentHoursResult.capacityAnalysis.spaceRespected).toBeNull();

    // B. Partial actual hours
    const partialHoursResult = service.execute({
      closedAt: "2026-10-18T19:00:00Z",
      activePlan: basePlan,
      itemOutcomes: [
        { itemId: "item-aws-1", status: "completed", actualHours: 5 },
        { itemId: "item-aws-2", status: "completed", actualHours: null },
        { itemId: "ob-clase", status: "completed", actualHours: 4 },
        { itemId: "flex-zapsac", status: "completed", actualHours: null },
        { itemId: "def-podcast", status: "completed", actualHours: null },
      ],
    });
    expect(partialHoursResult.capacityAnalysis.status).toBe("partial");
    expect(partialHoursResult.capacityAnalysis.spaceRespected).toBeNull();
    expect(partialHoursResult.capacityAnalysis.reportedHoursItemCount).toBe(2);
  });

  // 7. Unknown estimates in plan
  it("handles plans with unknown capacity or estimates without fabricating numbers", () => {
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
    };

    const result = service.execute({
      closedAt: "2026-10-18T19:00:00Z",
      activePlan: unknownCapPlan,
      itemOutcomes: [
        { itemId: "item-aws-1", status: "completed", actualHours: 4 },
        { itemId: "item-aws-2", status: "completed", actualHours: 4 },
        { itemId: "ob-clase", status: "completed", actualHours: 4 },
        { itemId: "flex-zapsac", status: "completed", actualHours: 4 },
        { itemId: "def-podcast", status: "completed", actualHours: 4 },
      ],
    });

    expect(result.capacityAnalysis.status).toBe("complete");
    // Since available hours and protected space are null, spaceRespected cannot be computed
    expect(result.capacityAnalysis.spaceRespected).toBeNull();
    expect(result.capacityAnalysis.explanation).toContain("eran desconocidos");
  });

  // 8. Protected space breached
  it("detects when actual work hours breach protected space", () => {
    // basePlan has totalAvailableHours: 30, protectedSpaceHours: 8 -> maxWork = 22.
    // If actual hours = 26, space was NOT respected.
    const result = service.execute({
      closedAt: "2026-10-18T19:00:00Z",
      activePlan: basePlan,
      itemOutcomes: [
        { itemId: "item-aws-1", status: "completed", actualHours: 10 },
        { itemId: "item-aws-2", status: "completed", actualHours: 8 },
        { itemId: "ob-clase", status: "completed", actualHours: 4 },
        { itemId: "flex-zapsac", status: "completed", actualHours: 4 },
        { itemId: "def-podcast", status: "not_started", actualHours: 0 },
      ],
    });

    expect(result.capacityAnalysis.totalActualHours).toBe(26);
    expect(result.capacityAnalysis.spaceRespected).toBe(false);
    expect(result.capacityAnalysis.explanation).toContain(
      "superaron el límite de trabajo planificable"
    );
  });

  // 9. Foreign or duplicate item IDs in outcomes
  it("unifies identical duplicate reports with warning and isolates foreign IDs", () => {
    const result = service.execute({
      closedAt: "2026-10-18T19:00:00Z",
      activePlan: basePlan,
      itemOutcomes: [
        { itemId: "item-aws-1", status: "completed", actualHours: 5 },
        { itemId: "item-aws-1", status: "completed", actualHours: 5 }, // identical duplicate!
        { itemId: "alien-item-999", status: "completed", actualHours: 10 }, // foreign!
        { itemId: "item-aws-2", status: "completed", actualHours: 5 },
        { itemId: "ob-clase", status: "completed", actualHours: 4 },
        { itemId: "flex-zapsac", status: "completed", actualHours: 4 },
        { itemId: "def-podcast", status: "completed", actualHours: 0 },
      ],
    });

    expect(
      result.warnings.some((w) =>
        w.includes('Se encontraron múltiples reportes idénticos para el elemento "item-aws-1"')
      )
    ).toBe(true);
    expect(result.warnings.some((w) => w.includes("alien-item-999"))).toBe(true);
    expect(result.classifiedItems.some((c) => c.itemId === "alien-item-999")).toBe(false);

    const aws1 = result.classifiedItems.find((c) => c.itemId === "item-aws-1");
    expect(aws1?.finalDisposition).toBe("completed");
    expect(aws1?.actualHours).toBe(5);
  });

  it("does not choose silently when reports are contradictory, classifying item as unreported with warning", () => {
    const result = service.execute({
      closedAt: "2026-10-18T19:00:00Z",
      activePlan: basePlan,
      itemOutcomes: [
        { itemId: "item-aws-1", status: "completed", actualHours: 5 },
        { itemId: "item-aws-1", status: "in_progress", actualHours: 8 }, // contradictory!
        { itemId: "item-aws-2", status: "completed", actualHours: 5 },
        { itemId: "ob-clase", status: "completed", actualHours: 4 },
        { itemId: "flex-zapsac", status: "completed", actualHours: 4 },
        { itemId: "def-podcast", status: "completed", actualHours: 0 },
      ],
    });

    expect(
      result.warnings.some((w) => w.includes('Conflicto en reportes para el elemento "item-aws-1"'))
    ).toBe(true);

    const aws1 = result.classifiedItems.find((c) => c.itemId === "item-aws-1");
    expect(aws1?.finalDisposition).toBe("unreported");
    expect(aws1?.isReported).toBe(false);
    expect(aws1?.userNotes).toContain("Reportes contradictorios recibidos; requiere aclaración.");
    expect(result.status).toBe("partial_data");
  });

  // 10. Memory candidates are unconfirmed and formatted as store candidates
  it("generates memory candidates with actionIntent store and unconfirmed status", () => {
    const result = service.execute({
      closedAt: "2026-10-18T19:00:00Z",
      activePlan: basePlan,
      itemOutcomes: [
        { itemId: "item-aws-1", status: "completed" },
        { itemId: "item-aws-2", status: "completed" },
        { itemId: "ob-clase", status: "completed" },
        { itemId: "flex-zapsac", status: "consciously_postponed" },
        { itemId: "def-podcast", status: "not_started" },
      ],
      userReflection: {
        generalNotes: "Prefiero trabajar en bloques de mañana.",
      },
    });

    for (const cand of result.memoryCandidates) {
      expect(cand.actionIntent).toBe("store");
      expect(cand.candidateId).toMatch(/^mem-close-/);
      expect(cand.rawText.length).toBeGreaterThan(5);
    }
    expect(result.memoryCandidates.some((c) => c.suggestedCategory === "fact")).toBe(true);
    expect(result.memoryCandidates.some((c) => c.suggestedCategory === "decision")).toBe(true);
    expect(result.memoryCandidates.some((c) => c.suggestedCategory === "project_context")).toBe(
      true
    );
  });

  // 11. Idempotency and canonical order
  it("produces identical canonical results regardless of itemOutcomes ordering", () => {
    const outcomesA = [
      { itemId: "item-aws-1", status: "completed" as const, actualHours: 5 },
      { itemId: "item-aws-2", status: "completed" as const, actualHours: 4 },
      { itemId: "ob-clase", status: "completed" as const, actualHours: 3 },
      { itemId: "flex-zapsac", status: "not_started" as const },
      { itemId: "def-podcast", status: "not_started" as const },
    ];

    const outcomesB = [
      { itemId: "def-podcast", status: "not_started" as const },
      { itemId: "ob-clase", status: "completed" as const, actualHours: 3 },
      { itemId: "flex-zapsac", status: "not_started" as const },
      { itemId: "item-aws-2", status: "completed" as const, actualHours: 4 },
      { itemId: "item-aws-1", status: "completed" as const, actualHours: 5 },
    ];

    const resA = service.execute({
      closedAt: "2026-10-18T19:00:00Z",
      activePlan: basePlan,
      itemOutcomes: outcomesA,
    });

    const resB = service.execute({
      closedAt: "2026-10-18T19:00:00Z",
      activePlan: basePlan,
      itemOutcomes: outcomesB,
    });

    expect(resA).toEqual(resB);
  });

  // 12. Total Item Conservation invariant
  it("guarantees 100% item conservation between plan and classified items", () => {
    const result = service.execute({
      closedAt: "2026-10-18T19:00:00Z",
      activePlan: basePlan,
      itemOutcomes: [{ itemId: "item-aws-1", status: "completed" }],
    });

    // 2 in focus + 1 obligation + 1 flexible + 1 deferred = 5 distinct items
    expect(result.classifiedItems).toHaveLength(5);
    const classifiedIds = new Set(result.classifiedItems.map((c) => c.itemId));
    expect(classifiedIds).toEqual(
      new Set(["item-aws-1", "item-aws-2", "ob-clase", "flex-zapsac", "def-podcast"])
    );
  });

  // 13. Epistemic Provenance: synthesized postponement is NOT an explicit user statement
  it("does not tag synthesized conscious postponement as explicit user statement and assigns plan_decision provenance", () => {
    const result = service.execute({
      closedAt: "2026-10-18T19:00:00Z",
      activePlan: basePlan,
      itemOutcomes: [
        { itemId: "item-aws-1", status: "completed" },
        { itemId: "item-aws-2", status: "completed" },
        { itemId: "ob-clase", status: "completed" },
        {
          itemId: "flex-zapsac",
          status: "consciously_postponed",
          postponementReason: "Postergado conscientemente para preservar foco",
        },
        { itemId: "def-podcast", status: "not_started" },
      ],
    });

    const postponementCandidate = result.memoryCandidates.find(
      (c) => c.suggestedCategory === "decision"
    );
    expect(postponementCandidate).toBeDefined();
    // Invariante 1 & 2: NO se disfraza de cita textual del usuario; su procedencia es plan_decision
    expect(postponementCandidate?.isExplicitUserStatement).toBe(false);
    expect(postponementCandidate?.provenanceSource).toBe("plan_decision");
    expect(postponementCandidate?.suggestedCategory).toBe("decision");
  });

  // 14. Epistemic Provenance: genuine reflection notes remain explicit user statements
  it("preserves explicit user statement provenance only for genuine user reflection notes", () => {
    const result = service.execute({
      closedAt: "2026-10-18T19:00:00Z",
      activePlan: basePlan,
      itemOutcomes: [
        { itemId: "item-aws-1", status: "completed" },
        { itemId: "item-aws-2", status: "completed" },
        { itemId: "ob-clase", status: "completed" },
        { itemId: "flex-zapsac", status: "completed" },
        { itemId: "def-podcast", status: "not_started" },
      ],
      userReflection: {
        generalNotes: "Descubrí que los miércoles me rinde mejor trabajar sin reuniones.",
      },
    });

    const reflectionCandidate = result.memoryCandidates.find(
      (c) => c.suggestedCategory === "project_context"
    );
    expect(reflectionCandidate).toBeDefined();
    expect(reflectionCandidate?.isExplicitUserStatement).toBe(true);
    expect(reflectionCandidate?.provenanceSource).toBe("user_explicit");
    expect(reflectionCandidate?.rawText).toBe(
      "Descubrí que los miércoles me rinde mejor trabajar sin reuniones."
    );
  });

  // ============================================================================
  // Integración con WeeklySchedule & appliedAdjustments (Fase 3 - ADR 0012)
  // ============================================================================
  describe("Integración con WeeklySchedule & appliedAdjustments (Fase 3)", () => {
    function createTestSchedule(overrides: Partial<WeeklySchedule> = {}): WeeklySchedule {
      return {
        scheduleId: "sched-2026-w42",
        planId: "plan-2026-w42",
        weekRange: {
          startDate: "2026-10-12",
          endDate: "2026-10-18",
        },
        timeBlocks: [],
        dailyAllocations: [],
        appliedAdjustments: [],
        version: 1,
        createdAt: "2026-10-12T08:00:00Z",
        updatedAt: "2026-10-12T08:00:00Z",
        ...overrides,
      };
    }

    // 1. Postergación aceptada y aplicada: el cierre la reconoce correctamente
    it("1. Postergación aceptada y aplicada: el cierre la reconoce correctamente sin exigir doble reporte", () => {
      const schedule = createTestSchedule({
        appliedAdjustments: [
          {
            adjustmentId: "adj-postpone-aws2",
            proposalId: "prop-p1",
            action: {
              type: "postpone_item",
              itemId: "item-aws-2",
              currentCategory: "foci",
              targetReason: "out_of_capacity",
              hoursFreed: 5,
              rationale: "Sobrecarga de foco; postergación consciente a la próxima semana",
            },
            expectedScheduleVersion: 1,
            decidedAt: "2026-10-14T10:00:00Z",
            humanDecision: "accepted",
            applicationOutcome: "applied",
            appliedAt: "2026-10-14T10:00:05Z",
            lifecycleStatus: "active",
          },
        ],
      });

      // User reports all other items, omitting item-aws-2
      const result = service.execute({
        closedAt: "2026-10-18T19:00:00Z",
        activePlan: basePlan,
        schedule,
        itemOutcomes: [
          { itemId: "item-aws-1", status: "completed", actualHours: 7 },
          { itemId: "ob-clase", status: "completed", actualHours: 4 },
          { itemId: "flex-zapsac", status: "completed", actualHours: 3 },
          { itemId: "def-podcast", status: "not_started" },
        ],
      });

      // Recognized as consciously_postponed
      const aws2 = result.classifiedItems.find((i) => i.itemId === "item-aws-2");
      expect(aws2).toBeDefined();
      expect(aws2?.finalDisposition).toBe("consciously_postponed");
      expect(aws2?.isReported).toBe(true);
      expect(aws2?.postponementReason).toContain("Sobrecarga de foco");

      // Placed into carryOverCandidates
      const carryOver = result.itemDispositions.carryOverCandidates.find(
        (c) => c.itemId === "item-aws-2"
      );
      expect(carryOver).toBeDefined();
      expect(carryOver?.reason).toBe("consciously_postponed");

      // Memory candidate with decision category, plan_decision provenance, and adjustmentId reference
      const decisionCandidate = result.memoryCandidates.find(
        (m) => m.suggestedCategory === "decision"
      );
      expect(decisionCandidate).toBeDefined();
      expect(decisionCandidate?.provenanceSource).toBe("plan_decision");
      expect(decisionCandidate?.isExplicitUserStatement).toBe(false);
      expect(decisionCandidate?.evidenceReference).toBe("adj-postpone-aws2");
      expect(decisionCandidate?.rawText).toContain("Preparar certificación AWS");

      // Global status is success because all items were reported or consciously postponed
      expect(result.status).toBe("success");
    });

    // 2. Postergación rechazada: no se reconoce como aplicada
    it("2. Postergación rechazada: no se reconoce como aplicada", () => {
      const schedule = createTestSchedule({
        appliedAdjustments: [
          {
            adjustmentId: "adj-rejected",
            proposalId: "prop-p2",
            action: {
              type: "postpone_item",
              itemId: "item-aws-2",
              currentCategory: "foci",
              targetReason: "intentional_postponement",
              hoursFreed: 5,
              rationale: "Usuario rechazó postergar",
            },
            expectedScheduleVersion: 1,
            decidedAt: "2026-10-14T10:00:00Z",
            humanDecision: "rejected",
            applicationOutcome: "failed",
            failureReason: "User rejected proposal",
            lifecycleStatus: "active",
          },
        ],
      });

      const result = service.execute({
        closedAt: "2026-10-18T19:00:00Z",
        activePlan: basePlan,
        schedule,
        itemOutcomes: [{ itemId: "item-aws-1", status: "completed" }],
      });

      const aws2 = result.classifiedItems.find((i) => i.itemId === "item-aws-2");
      expect(aws2?.finalDisposition).toBe("unreported");
      expect(aws2?.isReported).toBe(false);
      expect(result.status).toBe("partial_data");
    });

    // 3. Aplicación fallida: no se reconoce como postergación
    it("3. Aplicación fallida: no se reconoce como postergación", () => {
      const schedule = createTestSchedule({
        appliedAdjustments: [
          {
            adjustmentId: "adj-failed",
            proposalId: "prop-p3",
            action: {
              type: "postpone_item",
              itemId: "item-aws-2",
              currentCategory: "foci",
              targetReason: "out_of_capacity",
              hoursFreed: 5,
              rationale: "Falló por concurrencia",
            },
            expectedScheduleVersion: 1,
            decidedAt: "2026-10-14T10:00:00Z",
            humanDecision: "accepted",
            applicationOutcome: "failed",
            failureReason: "stale_schedule_version",
            lifecycleStatus: "active",
          },
        ],
      });

      const result = service.execute({
        closedAt: "2026-10-18T19:00:00Z",
        activePlan: basePlan,
        schedule,
        itemOutcomes: [],
      });

      const aws2 = result.classifiedItems.find((i) => i.itemId === "item-aws-2");
      expect(aws2?.finalDisposition).toBe("unreported");
      expect(aws2?.isReported).toBe(false);
    });

    // 4. Registro aplicado pero superseded o reverted: no se reconoce como postergación vigente
    it("4. Registro aplicado pero superseded o reverted: no se reconoce como postergación vigente", () => {
      // Case A: superseded
      const scheduleSuperseded = createTestSchedule({
        appliedAdjustments: [
          {
            adjustmentId: "adj-superseded",
            proposalId: "prop-p4a",
            action: {
              type: "postpone_item",
              itemId: "item-aws-2",
              currentCategory: "foci",
              targetReason: "out_of_capacity",
              hoursFreed: 5,
              rationale: "Sustituido posteriormente",
            },
            expectedScheduleVersion: 1,
            decidedAt: "2026-10-14T10:00:00Z",
            humanDecision: "accepted",
            applicationOutcome: "applied",
            appliedAt: "2026-10-14T10:00:05Z",
            lifecycleStatus: "superseded",
          },
        ],
      });

      const resSuperseded = service.execute({
        closedAt: "2026-10-18T19:00:00Z",
        activePlan: basePlan,
        schedule: scheduleSuperseded,
        itemOutcomes: [],
      });
      const aws2Superseded = resSuperseded.classifiedItems.find((i) => i.itemId === "item-aws-2");
      expect(aws2Superseded?.finalDisposition).toBe("unreported");

      // Case B: reverted
      const scheduleReverted = createTestSchedule({
        appliedAdjustments: [
          {
            adjustmentId: "adj-reverted",
            proposalId: "prop-p4b",
            action: {
              type: "postpone_item",
              itemId: "item-aws-2",
              currentCategory: "foci",
              targetReason: "out_of_capacity",
              hoursFreed: 5,
              rationale: "Revertido explícitamente",
            },
            expectedScheduleVersion: 1,
            decidedAt: "2026-10-14T10:00:00Z",
            humanDecision: "accepted",
            applicationOutcome: "applied",
            appliedAt: "2026-10-14T10:00:05Z",
            lifecycleStatus: "reverted",
          },
        ],
      });

      const resReverted = service.execute({
        closedAt: "2026-10-18T19:00:00Z",
        activePlan: basePlan,
        schedule: scheduleReverted,
        itemOutcomes: [],
      });
      const aws2Reverted = resReverted.classifiedItems.find((i) => i.itemId === "item-aws-2");
      expect(aws2Reverted?.finalDisposition).toBe("unreported");
    });

    // 5. Postergación de un ítem ajeno al plan: se ignora sin contaminar el cierre
    it("5. Postergación de un ítem ajeno al plan: se ignora sin contaminar el cierre", () => {
      const schedule = createTestSchedule({
        appliedAdjustments: [
          {
            adjustmentId: "adj-foreign",
            proposalId: "prop-foreign",
            action: {
              type: "postpone_item",
              itemId: "phantom-item-999", // Not in basePlan!
              currentCategory: "flexible_options",
              targetReason: "out_of_capacity",
              hoursFreed: 3,
              rationale: "Ítem fantasma",
            },
            expectedScheduleVersion: 1,
            decidedAt: "2026-10-14T10:00:00Z",
            humanDecision: "accepted",
            applicationOutcome: "applied",
            appliedAt: "2026-10-14T10:00:05Z",
            lifecycleStatus: "active",
          },
        ],
      });

      const result = service.execute({
        closedAt: "2026-10-18T19:00:00Z",
        activePlan: basePlan,
        schedule,
        itemOutcomes: [
          { itemId: "item-aws-1", status: "completed" },
          { itemId: "item-aws-2", status: "completed" },
          { itemId: "ob-clase", status: "completed" },
          { itemId: "flex-zapsac", status: "completed" },
          { itemId: "def-podcast", status: "not_started" },
        ],
      });

      // Phantom item does NOT appear in classifiedItems
      const phantom = result.classifiedItems.find((i) => i.itemId === "phantom-item-999");
      expect(phantom).toBeUndefined();

      // Warning records the ignored foreign adjustment
      const foreignWarning = result.warnings.find((w) => w.includes("phantom-item-999"));
      expect(foreignWarning).toBeDefined();

      // Clean plan item count intact (5 items in basePlan)
      expect(result.classifiedItems).toHaveLength(5);
    });

    // 6. Agenda perteneciente a otra semana o a otro plan: error explícito
    it("6. Agenda perteneciente a otra semana o a otro plan: error explícito", () => {
      // Mismatched week range
      const mismatchedWeekSchedule = createTestSchedule({
        weekRange: {
          startDate: "2026-10-19", // Next week
          endDate: "2026-10-25",
        },
      });

      const resWeekMismatch = service.execute({
        closedAt: "2026-10-18T19:00:00Z",
        activePlan: basePlan,
        schedule: mismatchedWeekSchedule,
        itemOutcomes: [],
      });

      expect(resWeekMismatch.status).toBe("invalid_request");
      expect(resWeekMismatch.warnings.some((w) => w.includes("Schedule weekRange"))).toBe(true);

      // Mismatched planId
      const validWeekSchedule = createTestSchedule({
        planId: "plan-other-team",
      });

      const resPlanMismatch = service.execute({
        closedAt: "2026-10-18T19:00:00Z",
        activePlan: basePlan,
        planId: "plan-2026-w42", // Expects w42
        schedule: validWeekSchedule,
        itemOutcomes: [],
      });

      expect(resPlanMismatch.status).toBe("invalid_request");
      expect(resPlanMismatch.warnings.some((w) => w.includes("Schedule planId"))).toBe(true);
    });

    // 7. Postergación aplicada y itemOutcome contradictorio: conserva la contradicción y requiere aclaración
    it("7. Postergación aplicada y itemOutcome contradictorio: conserva la contradicción y requiere aclaración", () => {
      const schedule = createTestSchedule({
        appliedAdjustments: [
          {
            adjustmentId: "adj-postpone-clase",
            proposalId: "prop-p7",
            action: {
              type: "postpone_item",
              itemId: "ob-clase",
              currentCategory: "obligations",
              targetReason: "out_of_capacity",
              hoursFreed: 4,
              rationale: "Se acordó postergar clase",
            },
            expectedScheduleVersion: 1,
            decidedAt: "2026-10-14T10:00:00Z",
            humanDecision: "accepted",
            applicationOutcome: "applied",
            appliedAt: "2026-10-14T10:00:05Z",
            lifecycleStatus: "active",
          },
        ],
      });

      // User reports 'completed' in itemOutcomes contradicting schedule postponement
      const result = service.execute({
        closedAt: "2026-10-18T19:00:00Z",
        activePlan: basePlan,
        schedule,
        itemOutcomes: [{ itemId: "ob-clase", status: "completed", actualHours: 4 }],
      });

      const clase = result.classifiedItems.find((i) => i.itemId === "ob-clase");
      expect(clase?.finalDisposition).toBe("unreported");
      expect(clase?.isReported).toBe(false);
      expect(clase?.userNotes).toContain(
        "Contradicción entre la postergación registrada en la agenda y el resultado reportado; requiere aclaración."
      );

      // Warning contains contradiction explanation
      const contradictionWarning = result.warnings.find((w) =>
        w.includes('Contradicción para el elemento "ob-clase"')
      );
      expect(contradictionWarning).toBeDefined();

      // Does not arbitrarily pick either side; marks partial_data
      expect(result.status).toBe("partial_data");
    });

    // 8. Ítem sin itemOutcome: no se inventa un resultado
    it("8. Ítem sin itemOutcome ni postergación en agenda: permanece unreported sin transformarse en not_started", () => {
      const schedule = createTestSchedule(); // No adjustments

      const result = service.execute({
        closedAt: "2026-10-18T19:00:00Z",
        activePlan: basePlan,
        schedule,
        itemOutcomes: [
          { itemId: "item-aws-1", status: "completed" },
          // item-aws-2, ob-clase, flex-zapsac omitted
        ],
      });

      const aws2 = result.classifiedItems.find((i) => i.itemId === "item-aws-2");
      expect(aws2?.finalDisposition).toBe("unreported");
      expect(aws2?.isReported).toBe(false);

      const carryOver = result.itemDispositions.carryOverCandidates.find(
        (c) => c.itemId === "item-aws-2"
      );
      expect(carryOver?.reason).toBe("unreported");
      expect(carryOver?.reason).not.toBe("not_started");
    });

    // 9. Semana cerrada sin WeeklySchedule: se mantiene el comportamiento anterior
    it("9. Semana cerrada sin WeeklySchedule: se mantiene el comportamiento anterior", () => {
      const resultWithoutSchedule = service.execute({
        closedAt: "2026-10-18T19:00:00Z",
        activePlan: basePlan,
        // schedule undefined
        itemOutcomes: [
          { itemId: "item-aws-1", status: "completed" },
          {
            itemId: "item-aws-2",
            status: "consciously_postponed",
            postponementReason: "Manual report",
          },
          { itemId: "ob-clase", status: "completed" },
          { itemId: "flex-zapsac", status: "completed" },
          { itemId: "def-podcast", status: "not_started" },
        ],
      });

      expect(resultWithoutSchedule.status).toBe("success");
      const postponed = resultWithoutSchedule.classifiedItems.find(
        (i) => i.itemId === "item-aws-2"
      );
      expect(postponed?.finalDisposition).toBe("consciously_postponed");
      expect(postponed?.postponementReason).toBe("Manual report");
    });

    // 10. Cierre: la agenda y el historial originales permanecen sin cambios
    it("10. Cierre: la agenda y el historial originales permanecen sin cambios (inmutabilidad estricta)", () => {
      const originalRecord: ScheduleAdjustmentRecord = {
        adjustmentId: "adj-immutable-1",
        proposalId: "prop-imm",
        action: {
          type: "postpone_item",
          itemId: "flex-zapsac",
          currentCategory: "flexible_options",
          targetReason: "intentional_postponement",
          hoursFreed: 4,
          rationale: "Inmutability verification",
        },
        expectedScheduleVersion: 1,
        decidedAt: "2026-10-14T10:00:00Z",
        humanDecision: "accepted",
        applicationOutcome: "applied",
        appliedAt: "2026-10-14T10:00:05Z",
        lifecycleStatus: "active",
      };

      const originalSchedule = createTestSchedule({
        version: 3,
        appliedAdjustments: [originalRecord],
      });

      const scheduleCloneBefore = JSON.parse(JSON.stringify(originalSchedule));

      service.execute({
        closedAt: "2026-10-18T19:00:00Z",
        activePlan: basePlan,
        schedule: originalSchedule,
        itemOutcomes: [],
      });

      // Assert complete untouched equality
      expect(originalSchedule.version).toBe(3);
      expect(originalSchedule.appliedAdjustments).toHaveLength(1);
      expect(originalSchedule).toEqual(scheduleCloneBefore);
    });
  });
});
