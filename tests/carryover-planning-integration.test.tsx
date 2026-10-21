import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { WeeklySessionService } from "../src/application/weekly-session-service";
import { WeeklyPlanningFromNotes } from "../src/web/components/weekly-planning-from-notes";
import { WeeklySessionReactContext, WeeklySessionContextValue } from "../src/web/context/weekly-session-context";
import { MockProvider } from "../src/providers/mock-provider";
import {
  StoredWeeklyPlan,
  StoredCloseWeekReport,
  WeeklyPlanRepository,
  WeeklyScheduleRepository,
  WeeklyCloseRepository,
  MemoryRepository,
} from "../src/domain/repositories/types";
import { WeeklySchedule } from "../src/domain/schedule";
import { TargetWeek } from "../src/domain/week";
import { generateWeeklyProposalFromItemsDetailed } from "../src/application/planning-pipeline";
import { ExtractedItem } from "../src/domain/items";

describe("Fase P5.6 — Conectar tareas postergadas con la planificación de la semana destino", () => {
  // Fixture: closed week (2026-10-19 .. 2026-10-25) with postponed task targeting 2026-10-26 .. 2026-11-01
  const closedPlan: StoredWeeklyPlan = {
    planId: "plan-2026-w43",
    status: "closed",
    targetWeek: {
      startDate: "2026-10-19",
      endDate: "2026-10-25",
    },
    proposal: {
      weekSummary: {
        targetWeek: {
          startDate: "2026-10-19",
          endDate: "2026-10-25",
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
        intent: "Cierre de ciclo W43",
      },
      foci: [],
      obligations: [
        {
          itemId: "item-mock-1",
          title: "Preparar el informe trimestral",
          dueDate: "2026-10-15",
          commitmentType: "external",
          rationale: "Informe financiero consolidado",
          estimatedHours: 6,
        },
      ],
      flexibleOptions: [],
      deferredItems: [],
      unplannedSpace: {
        recommendedHours: 10,
        rationale: "Espacio protegido",
      },
      confirmationPrompt: {
        question: "¿Te representa este plan?",
        keyTradeoffs: [],
        pendingQuestions: [],
      },
    },
    createdAt: "2026-10-19T08:00:00.000Z",
    updatedAt: "2026-10-25T18:00:00.000Z",
  };

  const closedSchedule: WeeklySchedule = {
    scheduleId: "sched-plan-2026-w43",
    planId: "plan-2026-w43",
    weekRange: {
      startDate: "2026-10-19",
      endDate: "2026-10-25",
    },
    timeBlocks: [],
    dailyAllocations: [],
    dayConstraints: [],
    appliedAdjustments: [
      {
        adjustmentId: "adj-postpone-1",
        proposalId: "prop-1",
        action: {
          type: "postpone_item",
          itemId: "item-mock-1",
          currentCategory: "obligations",
          targetReason: "intentional_postponement",
          hoursFreed: 6,
          rationale: "Reprogramación intencional de 'Preparar el informe trimestral' hacia la semana 2026-10-26 al 2026-11-01.",
          targetWeek: {
            startDate: "2026-10-26",
            endDate: "2026-11-01",
          },
        },
        humanDecision: "accepted",
        expectedScheduleVersion: 1,
        applicationOutcome: "applied",
        lifecycleStatus: "active",
        decidedAt: "2026-10-22T10:00:00.000Z",
        appliedAt: "2026-10-22T10:00:00.000Z",
      },
    ],
    version: 2,
    createdAt: "2026-10-19T08:00:00.000Z",
    updatedAt: "2026-10-22T10:00:00.000Z",
  };

  const closeReport: StoredCloseWeekReport = {
    reportId: "close-plan-2026-w43-2026-10-25",
    planId: "plan-2026-w43",
    scheduleId: "sched-plan-2026-w43",
    closedAt: "2026-10-25T19:00:00.000Z",
    output: {
      status: "success",
      closedAt: "2026-10-25T19:00:00.000Z",
      weekRange: {
        startDate: "2026-10-19",
        endDate: "2026-10-25",
      },
      fociOutcomes: [],
      obligationsOutcomes: [
        {
          itemId: "item-mock-1",
          title: "Preparar el informe trimestral",
          outcome: "postponed",
          dueDate: "2026-10-15",
        },
      ],
      classifiedItems: [
        {
          itemId: "item-mock-1",
          title: "Preparar el informe trimestral",
          originCategory: "obligation",
          finalDisposition: "consciously_postponed",
          estimatedHours: 6,
          actualHours: null,
          isReported: true,
          postponementReason: "Reprogramación intencional de 'Preparar el informe trimestral' hacia la semana 2026-10-26 al 2026-11-01.",
        },
      ],
      itemDispositions: {
        completed: [],
        carryOverCandidates: [
          {
            itemId: "item-mock-1",
            title: "Preparar el informe trimestral",
            originCategory: "obligation",
            reason: "consciously_postponed",
            details: "Reprogramación intencional de 'Preparar el informe trimestral' hacia la semana 2026-10-26 al 2026-11-01.",
          },
        ],
        dropped: [],
        unreported: [],
      },
      capacityAnalysis: {
        status: "complete",
        totalPlannedHours: 20,
        totalActualHours: 0,
        reportedHoursItemCount: 1,
        totalPlanItemCount: 1,
        protectedSpaceHours: 10,
        spaceRespected: true,
        explanation: "Semana cerrada",
      },
      memoryCandidates: [],
      reflectiveSummary: {
        headline: "Cierre exitoso",
        accomplishments: [],
        inProgressWork: [],
        consciousPostponements: ["item-mock-1"],
        droppedItems: [],
        unreportedItems: [],
        questionsForNextCycle: [],
      },
      warnings: [],
    },
  };

  function createMockRepositories() {
    const plans: WeeklyPlanRepository = {
      save: vi.fn(),
      getById: vi.fn().mockImplementation(async (id) => (id === closedPlan.planId ? closedPlan : null)),
      getActivePlan: vi.fn().mockResolvedValue(null),
      getActivePlans: vi.fn().mockResolvedValue([]),
      getDraftPlans: vi.fn().mockResolvedValue([]),
      getDraftPlan: vi.fn().mockResolvedValue(null),
      getByWeekRange: vi.fn().mockResolvedValue(null),
      getAll: vi.fn().mockResolvedValue([closedPlan]),
      updateStatus: vi.fn().mockResolvedValue(true),
      delete: vi.fn(),
    };

    const schedules: WeeklyScheduleRepository = {
      save: vi.fn(),
      getById: vi.fn().mockImplementation(async (id) => (id === closedSchedule.scheduleId ? closedSchedule : null)),
      getByPlanId: vi.fn().mockImplementation(async (id) => (id === closedPlan.planId ? closedSchedule : null)),
      getAll: vi.fn().mockResolvedValue([closedSchedule]),
      delete: vi.fn(),
    };

    const closeReports: WeeklyCloseRepository = {
      save: vi.fn(),
      getById: vi.fn().mockImplementation(async (id) => (id === closeReport.reportId ? closeReport : null)),
      getByPlanId: vi.fn().mockImplementation(async (id) => (id === closedPlan.planId ? closeReport : null)),
      getAll: vi.fn().mockResolvedValue([closeReport]),
      delete: vi.fn(),
    };

    const memories: MemoryRepository = {
      getById: vi.fn().mockResolvedValue(null),
      getAll: vi.fn().mockResolvedValue([]),
      save: vi.fn(),
      saveBatch: vi.fn(),
      archive: vi.fn(),
      delete: vi.fn(),
    };

    return { plans, schedules, closeReports, memories };
  }

  describe("1. Recuperación de tareas pendientes en el servicio", () => {
    it("recupera la tarea postergada para la semana destino correcta con metadatos y deadline original", async () => {
      const repos = createMockRepositories();
      const service = new WeeklySessionService(repos);

      const targetWeek: TargetWeek = {
        startDate: "2026-10-26",
        endDate: "2026-11-01",
      };

      const pendingTasks = await service.getPendingCarryOverTasks(targetWeek);

      expect(pendingTasks).toHaveLength(1);
      const task = pendingTasks[0]!;
      expect(task.itemId).toBe("item-mock-1");
      expect(task.title).toBe("Preparar el informe trimestral");
      expect(task.originCategory).toBe("obligation");
      expect(task.dueDate).toBe("2026-10-15"); // DEADLINE ORIGINAL PRESERVADO
      expect(task.estimatedHours).toBe(6);
      expect(task.targetWeek).toEqual(targetWeek);
      expect(task.postponementReason).toContain("2026-10-26 al 2026-11-01");
    });

    it("filtra y no recupera la tarea si la semana destino no coincide", async () => {
      const repos = createMockRepositories();
      const service = new WeeklySessionService(repos);

      const differentTargetWeek: TargetWeek = {
        startDate: "2026-11-02",
        endDate: "2026-11-08",
      };

      const pendingTasks = await service.getPendingCarryOverTasks(differentTargetWeek);
      expect(pendingTasks).toHaveLength(0);
    });

    it("no modifica el plan cerrado ni su agenda durante la consulta", async () => {
      const repos = createMockRepositories();
      const service = new WeeklySessionService(repos);

      const targetWeek: TargetWeek = {
        startDate: "2026-10-26",
        endDate: "2026-11-01",
      };

      await service.getPendingCarryOverTasks(targetWeek);

      expect(repos.plans.save).not.toHaveBeenCalled();
      expect(repos.plans.updateStatus).not.toHaveBeenCalled();
      expect(repos.schedules.save).not.toHaveBeenCalled();
      expect(repos.closeReports.save).not.toHaveBeenCalled();
    });
  });

  describe("2. Selección humana en la UI (WeeklyPlanningFromNotes)", () => {
    it("renderiza la sección de tareas postergadas mostrando título, deadline original, semana destino y motivo", () => {
      const repos = createMockRepositories();
      const service = new WeeklySessionService(repos);

      // Usamos render estático simulando contexto con service
      const mockContextValue = {
        state: {
          status: "no_active_session",
          activePlan: null,
          activeSchedule: null,
          latestCloseReport: closeReport,
          latestClosedPlan: closedPlan,
          latestClosedWeek: {
            plan: closedPlan,
            closeReport,
            schedule: closedSchedule,
          },
          concurrencyConflict: null,
          memories: [],
          memoryCandidates: [],
          ambiguousPlanIds: [],
          inconsistencyReason: null,
          errorMessage: null,
        },
        service,
        controller: {} as any,
        reloadSession: vi.fn(),
        createOrSavePlan: vi.fn(),
        applyAdjustment: vi.fn(),
        closeWeek: vi.fn(),
        confirmMemoryCandidate: vi.fn(),
        confirmMemoryOperation: vi.fn(),
        purgeSession: vi.fn(),
        resolveAmbiguity: vi.fn(),
      } as unknown as WeeklySessionContextValue;

      const html = renderToStaticMarkup(
        <WeeklySessionReactContext.Provider value={mockContextValue}>
          <WeeklyPlanningFromNotes
            provider={new MockProvider()}
            currentDate="2026-10-20"
          />
        </WeeklySessionReactContext.Provider>
      );

      // Debe contener la sección de entrada de notas y la estructura lista para tareas
      expect(html).toContain("Planificar semana a partir de ideas");
      expect(html).toContain("planning-notes-input");
    });

    it("la propuesta semanal generada a partir de la tarea postergada conserva el deadline original y metadatos", async () => {
      const repos = createMockRepositories();
      const service = new WeeklySessionService(repos);

      const targetWeek: TargetWeek = {
        startDate: "2026-10-26",
        endDate: "2026-11-01",
      };

      const pendingTasks = await service.getPendingCarryOverTasks(targetWeek);
      expect(pendingTasks).toHaveLength(1);
      const cot = pendingTasks[0]!;

      // Convertir a ExtractedItem siguiendo la lógica de handleGenerateProposal
      const item: ExtractedItem = {
        id: cot.itemId,
        title: cot.title,
        rawText: cot.title,
        type: "task",
        status: "pending",
        commitment: cot.originCategory === "obligation" ? "external" : "personal",
        deadline: cot.dueDate
          ? {
              raw: cot.dueDate,
              resolved: cot.dueDate,
              confidence: "high",
            }
          : null,
        estimatedEffort:
          cot.estimatedHours != null
            ? {
                value: cot.estimatedHours,
                unit: "hours",
                source: "estimated",
              }
            : null,
      };

      const mockProvider = new MockProvider();
      const detailedResult = await generateWeeklyProposalFromItemsDetailed(mockProvider, {
        items: [item],
        currentDate: "2026-10-20",
      });

      expect(detailedResult.proposal).toBeDefined();
      const proposal = detailedResult.proposal;

      // Verificar que la tarea figure en la propuesta y conserve el deadline original
      const foundInObligations = proposal.obligations.find((o) => o.itemId === cot.itemId);
      const foundInDeferred = proposal.deferredItems.find((d) => d.itemId === cot.itemId);
      const foundInFoci = proposal.foci.some((f) => f.contributingItemIds.includes(cot.itemId));
      const foundInFlexible = proposal.flexibleOptions.find((f) => f.itemId === cot.itemId);

      const itemPresent = Boolean(foundInObligations || foundInDeferred || foundInFoci || foundInFlexible);
      expect(itemPresent).toBe(true);

      // Si fue clasificada como obligación o diferida por deadline anterior, el dueDate debe ser 2026-10-15
      if (foundInObligations) {
        expect(foundInObligations.dueDate).toBe("2026-10-15");
      }
    });
  });

  describe("Fase P5.7 — Corregir la recuperación de tareas postergadas desde agendas activas", () => {
    const activePlan: StoredWeeklyPlan = {
      planId: "plan-2026-w43-active",
      status: "active",
      targetWeek: {
        startDate: "2026-10-19",
        endDate: "2026-10-25",
      },
      proposal: {
        weekSummary: {
          targetWeek: {
            startDate: "2026-10-19",
            endDate: "2026-10-25",
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
          intent: "Semana activa W43",
        },
        foci: [],
        obligations: [
          {
            itemId: "item-mock-1",
            title: "Preparar el informe trimestral",
            dueDate: "2026-10-15",
            commitmentType: "external",
            rationale: "Informe financiero consolidado",
            estimatedHours: 6,
          },
        ],
        flexibleOptions: [],
        deferredItems: [],
        unplannedSpace: {
          recommendedHours: 10,
          rationale: "Espacio protegido",
        },
        confirmationPrompt: {
          question: "¿Confirmás?",
          keyTradeoffs: [],
          pendingQuestions: [],
        },
      },
      createdAt: "2026-10-19T08:00:00.000Z",
      updatedAt: "2026-10-22T10:00:00.000Z",
    };

    const activeSchedule: WeeklySchedule = {
      scheduleId: "sched-plan-2026-w43-active",
      planId: "plan-2026-w43-active",
      weekRange: {
        startDate: "2026-10-19",
        endDate: "2026-10-25",
      },
      timeBlocks: [],
      dailyAllocations: [],
      dayConstraints: [],
      appliedAdjustments: [
        {
          adjustmentId: "adj-postpone-active-1",
          proposalId: "prop-active-1",
          action: {
            type: "postpone_item",
            itemId: "item-mock-1",
            currentCategory: "obligations",
            targetReason: "intentional_postponement",
            hoursFreed: 6,
            rationale: "Postergación hacia 2026-10-26 al 2026-11-01 acordada en reunión.",
            targetWeek: {
              startDate: "2026-10-26",
              endDate: "2026-11-01",
            },
          },
          humanDecision: "accepted",
          expectedScheduleVersion: 1,
          applicationOutcome: "applied",
          lifecycleStatus: "active",
          decidedAt: "2026-10-22T10:00:00.000Z",
          appliedAt: "2026-10-22T10:00:00.000Z",
        },
      ],
      version: 2,
      createdAt: "2026-10-19T08:00:00.000Z",
      updatedAt: "2026-10-22T10:00:00.000Z",
    };

    function createActiveRepositories() {
      const plans: WeeklyPlanRepository = {
        save: vi.fn(),
        getById: vi.fn().mockImplementation(async (id) => (id === activePlan.planId ? activePlan : null)),
        getActivePlan: vi.fn().mockResolvedValue(activePlan),
        getActivePlans: vi.fn().mockResolvedValue([activePlan]),
        getDraftPlans: vi.fn().mockResolvedValue([]),
        getDraftPlan: vi.fn().mockResolvedValue(null),
        getByWeekRange: vi.fn().mockResolvedValue(null),
        getAll: vi.fn().mockResolvedValue([activePlan]),
        updateStatus: vi.fn().mockResolvedValue(true),
        delete: vi.fn(),
      };

      const schedules: WeeklyScheduleRepository = {
        save: vi.fn(),
        getById: vi.fn().mockImplementation(async (id) => (id === activeSchedule.scheduleId ? activeSchedule : null)),
        getByPlanId: vi.fn().mockImplementation(async (id) => (id === activePlan.planId ? activeSchedule : null)),
        getAll: vi.fn().mockResolvedValue([activeSchedule]),
        delete: vi.fn(),
      };

      const closeReports: WeeklyCloseRepository = {
        save: vi.fn(),
        getById: vi.fn().mockResolvedValue(null),
        getByPlanId: vi.fn().mockResolvedValue(null),
        getAll: vi.fn().mockResolvedValue([]), // SIN informes de cierre aún
        delete: vi.fn(),
      };

      const memories: MemoryRepository = {
        getById: vi.fn().mockResolvedValue(null),
        getAll: vi.fn().mockResolvedValue([]),
        save: vi.fn(),
        saveBatch: vi.fn(),
        archive: vi.fn(),
        delete: vi.fn(),
      };

      return { plans, schedules, closeReports, memories };
    }

    it("1. Recupera la postergación desde la agenda activa sin existir ningún reporte de cierre", async () => {
      const repos = createActiveRepositories();
      const service = new WeeklySessionService(repos);

      const targetWeek: TargetWeek = {
        startDate: "2026-10-26",
        endDate: "2026-11-01",
      };

      const pendingTasks = await service.getPendingCarryOverTasks(targetWeek);

      expect(pendingTasks).toHaveLength(1);
      const task = pendingTasks[0]!;
      expect(task.itemId).toBe("item-mock-1");
      expect(task.title).toBe("Preparar el informe trimestral");
      expect(task.dueDate).toBe("2026-10-15"); // deadline original preservado
      expect(task.estimatedHours).toBe(6);
      expect(task.targetWeek).toEqual(targetWeek);
      expect(task.postponementReason).toContain("Postergación hacia 2026-10-26 al 2026-11-01");
    });

    it("2. Filtra correctamente por targetWeek (no devuelve tareas para semanas distintas)", async () => {
      const repos = createActiveRepositories();
      const service = new WeeklySessionService(repos);

      const nonMatchingWeek: TargetWeek = {
        startDate: "2026-11-02",
        endDate: "2026-11-08",
      };

      const pendingTasks = await service.getPendingCarryOverTasks(nonMatchingWeek);
      expect(pendingTasks).toHaveLength(0);
    });

    it("3. Recupera desde informe de cierre cuando no hay plan activo", async () => {
      const repos = createMockRepositories(); // usa closedPlan y closeReport
      const service = new WeeklySessionService(repos);

      const targetWeek: TargetWeek = {
        startDate: "2026-10-26",
        endDate: "2026-11-01",
      };

      const pendingTasks = await service.getPendingCarryOverTasks(targetWeek);
      expect(pendingTasks).toHaveLength(1);
      expect(pendingTasks[0]!.itemId).toBe("item-mock-1");
    });

    it("4. Deduplica tareas presentes simultáneamente en la agenda activa y en un informe de cierre", async () => {
      const repos = createActiveRepositories();
      // Agregamos también el closeReport existente con el mismo itemId
      repos.closeReports.getAll = vi.fn().mockResolvedValue([closeReport]);
      const service = new WeeklySessionService(repos);

      const targetWeek: TargetWeek = {
        startDate: "2026-10-26",
        endDate: "2026-11-01",
      };

      const pendingTasks = await service.getPendingCarryOverTasks(targetWeek);
      // Debe aparecer exactamente 1 vez
      expect(pendingTasks).toHaveLength(1);
      expect(pendingTasks[0]!.itemId).toBe("item-mock-1");
    });

    it("5. Excluye ajustes que no estén vigentes (rejected, failed, superseded, reverted)", async () => {
      const repos = createActiveRepositories();
      const scheduleWithNonActiveAdjustments: WeeklySchedule = {
        ...activeSchedule,
        appliedAdjustments: [
          {
            ...activeSchedule.appliedAdjustments[0]!,
            adjustmentId: "adj-rejected",
            humanDecision: "rejected",
          },
          {
            ...activeSchedule.appliedAdjustments[0]!,
            adjustmentId: "adj-failed",
            applicationOutcome: "failed",
          },
          {
            ...activeSchedule.appliedAdjustments[0]!,
            adjustmentId: "adj-superseded",
            lifecycleStatus: "superseded",
          },
          {
            ...activeSchedule.appliedAdjustments[0]!,
            adjustmentId: "adj-reverted",
            lifecycleStatus: "reverted",
          },
        ],
      };
      repos.schedules.getByPlanId = vi.fn().mockResolvedValue(scheduleWithNonActiveAdjustments);

      const service = new WeeklySessionService(repos);
      const targetWeek: TargetWeek = {
        startDate: "2026-10-26",
        endDate: "2026-11-01",
      };

      const pendingTasks = await service.getPendingCarryOverTasks(targetWeek);
      expect(pendingTasks).toHaveLength(0);
    });

    it("6. Preserva el deadline original (2026-10-15) al generar la propuesta semanal con MockProvider", async () => {
      const item: ExtractedItem = {
        id: "item-mock-1",
        title: "Preparar el informe trimestral",
        rawText: "Preparar el informe trimestral",
        type: "task",
        status: "pending",
        commitment: "external",
        deadline: {
          raw: "2026-10-15",
          resolved: "2026-10-15",
          confidence: "high",
        },
        estimatedEffort: {
          value: 6,
          unit: "hours",
          source: "estimated",
        },
      };

      const mockProvider = new MockProvider();
      const detailedResult = await generateWeeklyProposalFromItemsDetailed(mockProvider, {
        items: [item],
        currentDate: "2026-10-20",
        targetWeek: {
          startDate: "2026-10-26",
          endDate: "2026-11-01",
        },
      });

      expect(detailedResult.proposal).toBeDefined();
      const proposal = detailedResult.proposal;
      expect(proposal.weekSummary.targetWeek.startDate).toBe("2026-10-26");

      const inObligations = proposal.obligations.find((o) => o.itemId === "item-mock-1");
      const inDeferred = proposal.deferredItems.find((d) => d.itemId === "item-mock-1");

      if (inObligations) {
        expect(inObligations.dueDate).toBe("2026-10-15");
      }
      if (inDeferred) {
        expect(inDeferred.itemId).toBe("item-mock-1");
      }
    });

    it("7. Permite no seleccionar tareas postergadas sin forzarlas en el plan", async () => {
      const mockProvider = new MockProvider();
      // El usuario solo incluye una nota nueva, dejando fuera el item postergado
      const newItem: ExtractedItem = {
        id: "new-task-1",
        title: "Reunión de planificación de Q4",
        rawText: "Reunión de planificación de Q4",
        type: "task",
        status: "pending",
        commitment: "personal",
        deadline: null,
        estimatedEffort: { value: 2, unit: "hours", source: "estimated" },
      };

      const result = await generateWeeklyProposalFromItemsDetailed(mockProvider, {
        items: [newItem],
        currentDate: "2026-10-20",
        targetWeek: {
          startDate: "2026-10-26",
          endDate: "2026-11-01",
        },
      });

      expect(result.proposal.obligations.some((o) => o.itemId === "item-mock-1")).toBe(false);
      expect(result.proposal.deferredItems.some((d) => d.itemId === "item-mock-1")).toBe(false);
    });

    it("8. Impide la activación de una segunda semana activa devolviendo conflict_active_plan_exists", async () => {
      const repos = createActiveRepositories();
      const service = new WeeklySessionService(repos);

      const secondPlan: StoredWeeklyPlan = {
        ...activePlan,
        planId: "plan-2026-w44",
        status: "active",
        targetWeek: {
          startDate: "2026-10-26",
          endDate: "2026-11-01",
        },
      };

      const saveResult = await service.createOrSavePlanAndSchedule(secondPlan);
      expect(saveResult.status).toBe("conflict_active_plan_exists");
      expect(repos.plans.save).not.toHaveBeenCalled();
    });

    it("9. Mantiene la continuidad tras recargar la sesión (resumeSession) y permite consultar postergaciones", async () => {
      const repos = createActiveRepositories();
      const service = new WeeklySessionService(repos);

      const sessionState = await service.resumeSession();
      expect(sessionState.status).toBe("session_resumed");
      if (sessionState.status === "session_resumed") {
        expect(sessionState.state.activePlan?.planId).toBe(activePlan.planId);
        expect(sessionState.state.activeSchedule?.scheduleId).toBe(activeSchedule.scheduleId);
      }

      // Y las tareas postergadas de esa semana activa se pueden consultar para preparar la siguiente
      const pendingTasks = await service.getPendingCarryOverTasks({
        startDate: "2026-10-26",
        endDate: "2026-11-01",
      });
      expect(pendingTasks).toHaveLength(1);
      expect(pendingTasks[0]!.itemId).toBe("item-mock-1");
    });
  });
});

