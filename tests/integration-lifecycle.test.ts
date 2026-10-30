import { describe, it, expect } from "vitest";
import type { BuildWeekInput, ProposedWeek, TargetWeek } from "../src/domain/week";
import { normalizeAndConserveProposedWeek } from "../src/skills/build-week/deterministic";
import { analyzeChangeDeterministically } from "../src/skills/analyze-change/deterministic";
import { detectConflictsDeterministically } from "../src/skills/detect-conflict/deterministic";
import { proposeAdjustmentsDeterministically } from "../src/skills/propose-adjustment/deterministic";
import { executeCloseWeekDeterministic } from "../src/skills/close-week/deterministic";
import { manageMemoryDeterministically } from "../src/skills/manage-memory/deterministic";
import type { TimeBlock, DailyWorkAllocation } from "../src/domain/conflict";
import { applyAdjustmentToSchedule, type WeeklySchedule } from "../src/domain/schedule";

describe("Cross-Skill Lifecycle Integration: build_week -> analyze_change -> detect_conflict -> propose_adjustment -> close_week -> manage_memory", () => {
  const targetWeek: TargetWeek = {
    startDate: "2026-10-12",
    endDate: "2026-10-18",
  };

  const sampleBuildInput: BuildWeekInput = {
    currentDate: "2026-10-09",
    targetWeek,
    userIntent: "Completar certificación y sostener compromisos",
    items: [
      {
        id: "item-aws",
        rawText: "Preparar certificación AWS el viernes",
        title: "Certificación AWS",
        type: "task",
        status: "started",
        estimatedEffort: { value: 12, unit: "hours", source: "user" },
      },
      {
        id: "item-clase",
        rawText: "Dar clase de cibervoluntarios el martes",
        title: "Clase martes",
        type: "commitment",
        commitment: "external",
        status: "started",
        estimatedEffort: { value: 4, unit: "hours", source: "user" },
      },
      {
        id: "item-zapsac",
        rawText: "Avanzar Zapsac si tengo tiempo",
        title: "Avanzar Zapsac",
        type: "idea",
        status: "exploring",
        estimatedEffort: { value: 4, unit: "hours", source: "user" },
      },
      {
        id: "item-podcast",
        rawText: "Pensar en podcast archivado",
        title: "Idea podcast",
        type: "idea",
        status: "archived",
      },
    ],
    relationships: [],
    groupedWork: {
      groups: [
        {
          id: "group-aws",
          title: "AWS Prep",
          itemIds: ["item-aws"],
          rationale: "Foco clave",
        },
      ],
      ungroupedItemIds: ["item-clase", "item-zapsac", "item-podcast"],
    },
    deadlines: {
      deadlines: [
        {
          itemId: "item-clase",
          raw: "el martes",
          kind: "relative_date",
          resolvedStart: "2026-10-13",
          resolvedEnd: null,
          confidence: "high",
        },
      ],
    },
    context: {
      itemAssessments: [
        { itemId: "item-aws", attention: "high", signals: ["already_started"], rationale: "Foco" },
        {
          itemId: "item-clase",
          attention: "high",
          signals: ["external_commitment"],
          rationale: "Obligación",
        },
        { itemId: "item-zapsac", attention: "low", signals: [], rationale: "Flexible" },
        { itemId: "item-podcast", attention: "low", signals: [], rationale: "Diferido" },
      ],
      groupAssessments: [{ groupId: "group-aws", relevance: "high", rationale: "Foco" }],
      openQuestions: [],
    },
    capacity: {
      totalAvailableHours: 30,
      minProtectedSpaceRatio: 0.25, // 7.5h protected -> 22.5h plannable
    },
  };

  // Base proposal synthesized from build_week
  const compliantBaseProposal: ProposedWeek = {
    weekSummary: {
      targetWeek,
      intent: "Completar certificación y sostener compromisos",
      capacity: {
        totalAvailableHours: 30,
        plannableHours: 22.5,
        plannedHours: 16, // 12 (focus) + 4 (obligation) = 16 <= 22.5
        knownEstimatedHours: 16,
        estimationCompleteness: "complete",
        protectedSpaceHours: 7.5,
        capacityStatus: "within_capacity",
        protectedSpaceStatus: "respected",
      },
    },
    foci: [
      {
        id: "focus-aws",
        title: "Certificación AWS",
        groupId: "group-aws",
        desiredOutcome: "Simulacro aprobado",
        rationale: "Foco principal",
        contributingItemIds: ["item-aws"],
        estimatedHours: 12,
      },
    ],
    obligations: [
      {
        itemId: "item-clase",
        title: "Clase martes",
        dueDate: "2026-10-13",
        commitmentType: "external",
        rationale: "Compromiso externo confirmado",
        estimatedHours: 4,
      },
    ],
    flexibleOptions: [
      {
        itemId: "item-zapsac",
        title: "Avanzar Zapsac",
        condition: "Si queda tiempo",
        estimatedHours: 4,
      },
    ],
    deferredItems: [
      {
        itemId: "item-podcast",
        title: "Idea podcast",
        reason: "archived",
        rationale: "Idea en archivo",
      },
    ],
    unplannedSpace: {
      recommendedHours: 7.5,
      rationale: "Espacio protegido para margen y calma",
    },
    confirmationPrompt: {
      question: "¿Te representa este plan?",
      keyTradeoffs: ["Zapsac queda como opción flexible"],
      pendingQuestions: [],
    },
  };

  // ==========================================================================
  // ESCENARIO A: Semana sin conflictos (Happy Path E2E)
  // ==========================================================================
  describe("Escenario A: Semana sin conflictos", () => {
    it("encadena build_week -> analyze_change -> detect_conflict -> propose_adjustment -> close_week -> manage_memory", () => {
      // 1. build_week: normalización y conservación
      const buildResult = normalizeAndConserveProposedWeek(compliantBaseProposal, sampleBuildInput);
      if (buildResult.repaired) {
        console.log("REPAIRS:", buildResult.repairs);
      }
      expect(buildResult.repaired).toBe(false);
      const activePlan = buildResult.proposal;

      // Invariante de no-mutación: la entrada original no se altera
      expect(activePlan).toEqual(compliantBaseProposal);

      // 2. analyze_change: cambio ausente o neutral
      const changeResult = analyzeChangeDeterministically({
        currentDate: activePlan.weekSummary.targetWeek.startDate,
        activePlan,
        changeDescription: "Sin novedades esta semana",
      });
      expect(changeResult.status).toBe("no_impact");
      expect(changeResult.changeType).toBe("none_detected");
      expect(changeResult.requiresUserIntervention).toBe(false);

      // 3. detect_conflict: plan en equilibrio sin conflictos
      const conflictResult = detectConflictsDeterministically({
        currentDate: activePlan.weekSummary.targetWeek.startDate,
        activePlan,
        changeAnalysis: changeResult,
      });
      expect(conflictResult.status).toBe("no_conflicts");
      expect(conflictResult.conflicts).toHaveLength(0);
      expect(conflictResult.hasBlockingConflicts).toBe(false);

      // 4. propose_adjustment: verifica precondición y devuelve no_adjustment_needed
      const adjustmentResult = proposeAdjustmentsDeterministically({
        activePlan,
        conflictReport: conflictResult,
        changeAnalysis: changeResult,
      });
      expect(adjustmentResult.status).toBe("no_adjustment_needed");
      expect(adjustmentResult.proposals).toHaveLength(0);

      // 5. close_week: resultados reportados al 100%
      const closeResult = executeCloseWeekDeterministic({
        closedAt: "2026-10-18T19:00:00Z",
        activePlan,
        itemOutcomes: [
          { itemId: "item-aws", status: "completed", actualHours: 12 },
          { itemId: "item-clase", status: "completed", actualHours: 4 },
          { itemId: "item-zapsac", status: "completed", actualHours: 3 },
          { itemId: "item-podcast", status: "not_started", actualHours: 0 },
        ],
        userReflection: {
          energyLevel: "energized",
          generalNotes: "Semana fluida sin interrupciones",
        },
      });

      expect(closeResult.status).toBe("success");
      expect(closeResult.classifiedItems).toHaveLength(4);
      expect(closeResult.fociOutcomes[0].outcome).toBe("achieved");
      expect(closeResult.capacityAnalysis.spaceRespected).toBe(true);
      expect(closeResult.capacityAnalysis.totalActualHours).toBe(19);

      // 6. manage_memory: los candidatos emitidos pasan sin persistencia automática
      expect(closeResult.memoryCandidates.length).toBeGreaterThan(0);
      const memoryResult = manageMemoryDeterministically({
        referenceDate: "2026-10-19",
        existingMemories: [],
        candidates: closeResult.memoryCandidates,
      });

      expect(memoryResult.status).toBe("proposals_generated");
      expect(memoryResult.proposedOperations.length).toBe(closeResult.memoryCandidates.length);

      // INVARIANTE: Ninguna memoria se persiste automáticamente
      for (const op of memoryResult.proposedOperations) {
        expect(op.type).toBe("add");
        if (op.type === "add") {
          expect(op.requiresHumanConfirmation).toBe(true);
        }
      }
    });
  });

  // ==========================================================================
  // ESCENARIO B: Sobrecarga y ajuste propuesto (Decisión humana explícita)
  // ==========================================================================
  describe("Escenario B: Sobrecarga y ajuste propuesto", () => {
    it("detecta sobrecarga, formula alternativas viables, simula decisión humana y cierra con postergación consciente", () => {
      const activePlan = compliantBaseProposal;

      // 1. analyze_change: se introduce una nueva obligación pesada de 8 horas
      const changeResult = analyzeChangeDeterministically({
        currentDate: activePlan.weekSummary.targetWeek.startDate,
        activePlan,
        changeDescription: "Nueva auditoría urgente confirmada",
        incomingDelta: {
          itemOperations: [
            {
              op: "add",
              item: {
                id: "item-auditoria",
                title: "Auditoría de seguridad",
                type: "commitment",
                commitment: "external",
                status: "pending",
                rawText: "Auditoría de seguridad el jueves",
                estimatedEffort: { value: 8, unit: "hours", source: "user" },
              },
            },
          ],
        },
      });

      expect(changeResult.status).toBe("analyzed");
      expect(changeResult.requiresUserIntervention).toBe(true);
      expect(changeResult.changeType).toBe("new_item");

      // 2. detect_conflict: déficit de capacidad verificado (16 + 8 = 24 > 22.5 plannable)
      // Construimos un plan hipotético que incluye la nueva tarea para simular el impacto
      const overloadedPlan: ProposedWeek = {
        ...activePlan,
        weekSummary: {
          ...activePlan.weekSummary,
          capacity: {
            ...activePlan.weekSummary.capacity,
            plannedHours: 24,
            capacityStatus: "over_capacity",
            protectedSpaceStatus: "compromised",
          },
        },
        obligations: [
          ...activePlan.obligations,
          {
            itemId: "item-auditoria",
            title: "Auditoría de seguridad",
            dueDate: "2026-10-15",
            commitmentType: "external",
            rationale: "Auditoría obligatoria",
            estimatedHours: 8,
          },
        ],
      };

      const conflictResult = detectConflictsDeterministically({
        currentDate: activePlan.weekSummary.targetWeek.startDate,
        activePlan: overloadedPlan,
        changeAnalysis: changeResult,
      });

      expect(conflictResult.status).toBe("conflicts_detected");
      expect(conflictResult.hasBlockingConflicts).toBe(true);
      const capConflict = conflictResult.conflicts.find((c) => c.type === "capacity_deficit");
      expect(capConflict).toBeDefined();

      // 3. propose_adjustment: genera alternativas discretas
      const adjustmentResult = proposeAdjustmentsDeterministically({
        activePlan: overloadedPlan,
        conflictReport: conflictResult,
      });

      expect(adjustmentResult.status).toBe("adjustments_proposed");
      expect(adjustmentResult.proposals.length).toBeGreaterThan(0);

      // Invariante: las propuestas no mutan el plan de entrada
      expect(overloadedPlan.weekSummary.capacity.plannedHours).toBe(24);

      // 4. Decisión humana explícita: el usuario elige posponer la opción flexible (Zapsac)
      const selectedProposal = adjustmentResult.proposals.find(
        (p) => p.strategy === "postpone_flexible" && p.affectedPlanItemIds.includes("item-zapsac")
      );
      expect(selectedProposal).toBeDefined();
      expect(selectedProposal?.viability).toBe("viable");

      // Transición controlada: el plan adaptado tras la decisión humana
      // (Liberó 4h de Zapsac, quedando en 20h <= 22.5h plannable)
      const adjustedPlan: ProposedWeek = {
        ...overloadedPlan,
        weekSummary: {
          ...overloadedPlan.weekSummary,
          capacity: {
            ...overloadedPlan.weekSummary.capacity,
            plannedHours: 20,
            capacityStatus: "within_capacity",
            protectedSpaceStatus: "respected",
          },
        },
        flexibleOptions: [], // Zapsac fue postergado
        deferredItems: [
          ...activePlan.deferredItems,
          {
            itemId: "item-zapsac",
            title: "Avanzar Zapsac",
            reason: "intentional_postponement",
            rationale: "Postergado para dar cabida a la auditoría",
          },
        ],
      };

      // 5. close_week: se cierra con la postergación consciente registrada
      const closeResult = executeCloseWeekDeterministic({
        closedAt: "2026-10-18T19:00:00Z",
        activePlan: adjustedPlan,
        itemOutcomes: [
          { itemId: "item-aws", status: "completed", actualHours: 12 },
          { itemId: "item-clase", status: "completed", actualHours: 4 },
          { itemId: "item-auditoria", status: "completed", actualHours: 8 },
          {
            itemId: "item-zapsac",
            status: "consciously_postponed",
            postponementReason: "Postergado conscientemente por auditoría",
          },
          { itemId: "item-podcast", status: "not_started" },
        ],
      });

      expect(closeResult.status).toBe("success");
      const zapsacCandidate = closeResult.itemDispositions.carryOverCandidates.find(
        (c) => c.itemId === "item-zapsac"
      );
      expect(zapsacCandidate).toBeDefined();
      expect(zapsacCandidate?.reason).toBe("consciously_postponed");

      // Invariante: el elemento diferido NO se convierte en obligación
      expect(closeResult.itemDispositions.completed).not.toContain("item-zapsac");
      expect(closeResult.itemDispositions.dropped).not.toContain("item-zapsac");

      // 6. manage_memory: la postergación genera candidato a memoria sin elevar certeza
      const decisionCandidate = closeResult.memoryCandidates.find(
        (m) => m.suggestedCategory === "decision"
      );
      expect(decisionCandidate).toBeDefined();
      // INVARIANTE: La síntesis de close_week NO se disfraza de declaración explícita
      expect(decisionCandidate?.isExplicitUserStatement).toBe(false);
      expect(decisionCandidate?.provenanceSource).toBe("plan_decision");

      const memoryResult = manageMemoryDeterministically({
        referenceDate: "2026-10-19",
        existingMemories: [],
        candidates: [decisionCandidate!],
      });

      expect(memoryResult.status).toBe("proposals_generated");
      const proposedOp = memoryResult.proposedOperations[0];
      expect(proposedOp.type).toBe("add");
      if (proposedOp.type === "add") {
        expect(proposedOp.requiresHumanConfirmation).toBe(true);
        // INVARIANTE EPISTÉMICA: La decisión de plan no adquiere 'confirmed' sin evidencia de aceptación verificable
        expect(proposedOp.proposedMemory.category).toBe("decision");
        expect(proposedOp.proposedMemory.provenance.source).toBe("plan_decision");
        expect(proposedOp.proposedMemory.confirmationStatus).toBe("unconfirmed");
      }
    });
  });

  // ==========================================================================
  // ESCENARIO C: Datos parciales e incertidumbre transversal
  // ==========================================================================
  describe("Escenario C: Datos parciales e incertidumbre", () => {
    it("preserva la incertidumbre a través de toda la cadena sin fabricar ceros ni certezas", () => {
      // 1. Plan con estimaciones incompletas
      const uncertainPlan: ProposedWeek = {
        ...compliantBaseProposal,
        weekSummary: {
          ...compliantBaseProposal.weekSummary,
          capacity: {
            totalAvailableHours: 30,
            plannableHours: 22.5,
            plannedHours: null,
            knownEstimatedHours: 4,
            estimationCompleteness: "partial",
            protectedSpaceHours: 7.5,
            capacityStatus: "unknown",
            protectedSpaceStatus: "unknown",
          },
        },
        foci: [
          {
            ...compliantBaseProposal.foci[0],
            estimatedHours: null, // AWS sin estimar!
          },
        ],
      };

      // 2. detect_conflict: no afirma confirmed_deficit, reporta incertidumbre
      const conflictResult = detectConflictsDeterministically({
        currentDate: targetWeek.startDate,
        activePlan: uncertainPlan,
      });

      // No debe haber conflicto confirmado si faltan estimaciones
      const confirmedCapDeficit = conflictResult.conflicts.find(
        (c) => c.type === "capacity_deficit" && c.certainty === "confirmed"
      );
      expect(confirmedCapDeficit).toBeUndefined();

      // 3. propose_adjustment: con 0 conflictos y estimaciones parciales, no inventa propuestas
      const adjustmentResult = proposeAdjustmentsDeterministically({
        activePlan: uncertainPlan,
        conflictReport: conflictResult,
      });
      // Sin conflictos reportados y capacidad incompleta, proposals es []
      expect(adjustmentResult.proposals).toHaveLength(0);
      expect(adjustmentResult.status).toBe("adjustments_proposed");

      // 4. close_week: cierre con horas reales parciales (solo 1 de 4 items reporta)
      const closeResult = executeCloseWeekDeterministic({
        closedAt: "2026-10-18T19:00:00Z",
        activePlan: uncertainPlan,
        itemOutcomes: [
          { itemId: "item-clase", status: "completed", actualHours: 4 },
          // los demás no reportan horas reales
        ],
        userReflection: {
          generalNotes: "Quizás la próxima semana rinda más y tenga mayor energía",
        },
      });

      expect(closeResult.status).toBe("partial_data");
      expect(closeResult.capacityAnalysis.status).toBe("partial");
      // INVARIANTE: spaceRespected es estrictamente null ante datos parciales
      expect(closeResult.capacityAnalysis.spaceRespected).toBeNull();
      expect(closeResult.capacityAnalysis.explanation).toContain("Registro parcial");

      // 5. manage_memory: los candidatos no se elevan automáticamente a confirmados
      const memoryResult = manageMemoryDeterministically({
        referenceDate: "2026-10-19",
        existingMemories: [],
        candidates: closeResult.memoryCandidates,
      });

      for (const op of memoryResult.proposedOperations) {
        if (op.type === "add") {
          expect(op.proposedMemory.confirmationStatus).toBe("unconfirmed");
        }
      }
    });
  });

  // ==========================================================================
  // ESCENARIO D: Contexto temporal y franjas horarias (TimeBlock & DailyAllocation)
  // ==========================================================================
  describe("Escenario D: Contexto temporal y franjas horarias", () => {
    it("detecta colisión en TimeBlock y genera reasignación, documentando el límite de ProposedWeek", () => {
      const activePlan = compliantBaseProposal;

      // Dos reuniones colisionando en el mismo horario el martes
      const timeBlocks: TimeBlock[] = [
        {
          itemId: "item-clase",
          day: "2026-10-13",
          startTime: "10:00",
          endTime: "12:00",
          note: "Clase presencial",
        },
        {
          itemId: "item-zapsac",
          day: "2026-10-13",
          startTime: "11:00",
          endTime: "13:00",
          note: "Reunión de coordinación Zapsac",
        },
      ];

      const dailyAllocations: DailyWorkAllocation[] = [
        { itemId: "item-clase", day: "2026-10-13", allocatedHours: 2 },
        { itemId: "item-zapsac", day: "2026-10-13", allocatedHours: 2 },
      ];

      // 1. detect_conflict: detecta colisión horaria estricta
      const conflictResult = detectConflictsDeterministically({
        currentDate: targetWeek.startDate,
        activePlan,
        timeBlocks,
        dailyAllocations,
      });

      expect(conflictResult.status).toBe("conflicts_detected");
      const overlap = conflictResult.conflicts.find((c) => c.type === "schedule_overlap");
      expect(overlap).toBeDefined();
      expect(overlap?.certainty).toBe("confirmed");

      // 2. propose_adjustment: genera reasignación horaria
      const adjustmentResult = proposeAdjustmentsDeterministically({
        activePlan,
        conflictReport: conflictResult,
        timeBlocks,
        dailyAllocations,
      });

      expect(adjustmentResult.status).toBe("adjustments_proposed");
      const reassignProposal = adjustmentResult.proposals.find((p) =>
        p.actions.some((a) => a.type === "reassign_time_block")
      );
      expect(reassignProposal).toBeDefined();

      // HALLAZGO ARQUITECTÓNICO DOCUMENTADO:
      // ProposedWeek no contiene un campo 'timeBlocks' nativo.
      // Por ende, la reasignación de TimeBlock vive en el reporte de ajuste,
      // pero no puede serializarse dentro del objeto ProposedWeek al pasarlo a close_week.
      expect((activePlan as Record<string, unknown>).timeBlocks).toBeUndefined();
    });
  });

  // ==========================================================================
  // ESCENARIO E: Ciclo completo con WeeklySchedule y continuidad temporal
  // propose_adjustment -> aceptación humana -> applyAdjustmentToSchedule -> close_week -> manage_memory
  // ==========================================================================
  describe("Escenario E: Ciclo completo con WeeklySchedule y continuidad temporal", () => {
    it("conecta detección de conflicto, propuesta de ajuste, decisión humana sobre WeeklySchedule, reconocimiento en close_week y formulación en manage_memory", () => {
      const activePlan = compliantBaseProposal;

      // 1. Agenda inicial v1 con compromisos de la semana
      const initialSchedule: WeeklySchedule = {
        scheduleId: "sched-2026-w42",
        planId: "plan-2026-w42",
        weekRange: targetWeek,
        timeBlocks: [
          {
            itemId: "item-clase",
            day: "2026-10-13",
            startTime: "10:00",
            endTime: "12:00",
          },
        ],
        dailyAllocations: [
          { itemId: "item-aws", day: "2026-10-12", allocatedHours: 6 },
          { itemId: "item-aws", day: "2026-10-14", allocatedHours: 6 },
          { itemId: "item-clase", day: "2026-10-13", allocatedHours: 4 },
          { itemId: "item-zapsac", day: "2026-10-15", allocatedHours: 4 },
        ],
        appliedAdjustments: [],
        version: 1,
        createdAt: "2026-10-12T08:00:00Z",
        updatedAt: "2026-10-12T08:00:00Z",
      };

      // 2. detect_conflict: Detección determinista con asignaciones diarias
      const conflictResult = detectConflictsDeterministically({
        currentDate: targetWeek.startDate,
        activePlan,
        dailyAllocations: initialSchedule.dailyAllocations,
        timeBlocks: initialSchedule.timeBlocks,
      });
      expect(conflictResult).toBeDefined();

      // 3. propose_adjustment: Propuesta formal de postergación para opción flexible
      const postponeAction = {
        type: "postpone_item" as const,
        itemId: "item-zapsac",
        currentCategory: "flexible_options" as const,
        targetReason: "out_of_capacity" as const,
        hoursFreed: 4,
        rationale: "Sobrecarga de foco detectada a mitad de semana; postergar Zapsac",
      };

      // 4. Aceptación humana explícita & aplicación pura sobre WeeklySchedule
      // "AI propone. La persona decide."
      const applyResult = applyAdjustmentToSchedule(initialSchedule, {
        adjustmentId: "adj-zapsac-postpone",
        proposalId: "prop-zapsac-01",
        action: postponeAction,
        expectedScheduleVersion: 1,
        decidedAt: "2026-10-14T11:00:00Z",
        humanDecision: "accepted",
      });

      expect(applyResult.status).toBe("success");
      if (applyResult.status !== "success") return;

      const updatedSchedule = applyResult.schedule;
      expect(updatedSchedule.version).toBe(2);
      expect(updatedSchedule.appliedAdjustments).toHaveLength(1);
      expect(updatedSchedule.appliedAdjustments[0]?.lifecycleStatus).toBe("active");
      // Asignaciones de item-zapsac eliminadas de la agenda
      expect(
        updatedSchedule.dailyAllocations.filter((a) => a.itemId === "item-zapsac")
      ).toHaveLength(0);

      // 5. close_week: Cierre de semana recibiendo la agenda actualizada
      // La persona reporta item-aws y item-clase como completados; no necesita volver a justificar item-zapsac
      const closeResult = executeCloseWeekDeterministic({
        closedAt: "2026-10-18T19:00:00Z",
        activePlan,
        schedule: updatedSchedule,
        itemOutcomes: [
          { itemId: "item-aws", status: "completed", actualHours: 12 },
          { itemId: "item-clase", status: "completed", actualHours: 4 },
          // item-zapsac se omite deliberadamente
          { itemId: "item-podcast", status: "not_started" },
        ],
      });

      expect(closeResult.status).toBe("success");

      // item-zapsac reconocido automáticamente como postergación consciente
      const zapsacClassified = closeResult.classifiedItems.find((i) => i.itemId === "item-zapsac");
      expect(zapsacClassified).toBeDefined();
      expect(zapsacClassified?.finalDisposition).toBe("consciously_postponed");
      expect(zapsacClassified?.isReported).toBe(true);
      expect(zapsacClassified?.postponementReason).toContain("Sobrecarga de foco detectada");

      // Verificamos que item-zapsac está en carryOverCandidates
      const zapsacCarryOver = closeResult.itemDispositions.carryOverCandidates.find(
        (c) => c.itemId === "item-zapsac"
      );
      expect(zapsacCarryOver?.reason).toBe("consciously_postponed");

      // 6. manage_memory: Candidato de memoria con procedencia plan_decision y referencia al adjustmentId
      const decisionCandidate = closeResult.memoryCandidates.find(
        (c) => c.suggestedCategory === "decision"
      );
      expect(decisionCandidate).toBeDefined();
      expect(decisionCandidate?.provenanceSource).toBe("plan_decision");
      expect(decisionCandidate?.evidenceReference).toBe("adj-zapsac-postpone");

      // Procesamos el candidato en manage_memory de forma no confirmada
      const memoryResult = manageMemoryDeterministically({
        referenceDate: "2026-10-19",
        existingMemories: [],
        candidates: closeResult.memoryCandidates,
      });

      expect(memoryResult.status).toBe("proposals_generated");
      const memoryOp = memoryResult.proposedOperations.find(
        (op) => op.type === "add" && op.proposedMemory.category === "decision"
      );
      expect(memoryOp).toBeDefined();
      if (memoryOp && memoryOp.type === "add") {
        expect(memoryOp.proposedMemory.confirmationStatus).toBe("unconfirmed");
        expect(memoryOp.requiresHumanConfirmation).toBe(true);
      }
    });
  });
});
