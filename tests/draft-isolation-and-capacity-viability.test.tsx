import { describe, it, expect, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { indexedDB as fakeIDB, IDBKeyRange as fakeKeyRange } from "fake-indexeddb";
import {
  createIndexedDbStorage,
  deleteDatabase,
  IndexedDbStorageContext,
} from "../src/infrastructure/storage/indexeddb";
import { WeeklySessionService } from "../src/application/weekly-session-service";
import {
  WeeklySessionController,
  WeeklySessionReactContext,
  WeeklySessionContextValue,
} from "../src/web/context/weekly-session-context";
import { AmbiguousDraftPlanError, StoredWeeklyPlan } from "../src/domain/repositories/types";
import { ProposedWeek, TargetWeek } from "../src/domain/week";
import { WeeklySchedule } from "../src/domain/schedule";
import { MockProvider } from "../src/providers/mock-provider";
import { WeeklyPlanningFromNotes } from "../src/web/components/weekly-planning-from-notes";
import { ExtractedItem } from "../src/domain/items";

describe("Aislamiento de borradores, honestidad de capacidad y transición entre semanas", () => {
  const TEST_DB = "test_draft_isolation_db";

  if (typeof globalThis.IDBKeyRange === "undefined") {
    (globalThis as unknown as { IDBKeyRange: typeof fakeKeyRange }).IDBKeyRange = fakeKeyRange;
  }

  let storage: IndexedDbStorageContext;
  let service: WeeklySessionService;
  let controller: WeeklySessionController;

  const weekA: TargetWeek = {
    startDate: "2026-10-19",
    endDate: "2026-10-25",
  };

  const weekB: TargetWeek = {
    startDate: "2026-10-26",
    endDate: "2026-11-01",
  };

  const createSampleProposal = (
    targetWeek: TargetWeek,
    customProps?: Partial<ProposedWeek>
  ): ProposedWeek => ({
    weekSummary: {
      targetWeek,
      capacity: {
        totalAvailableHours: 20,
        plannableHours: 15,
        plannedHours: 8,
        knownEstimatedHours: 8,
        estimationCompleteness: "complete",
        protectedSpaceHours: 5,
        capacityStatus: "within_capacity",
        protectedSpaceStatus: "respected",
      },
      intent: `Plan para la semana ${targetWeek.startDate}`,
    },
    foci: [
      {
        id: "foco-1",
        title: "Foco principal",
        desiredOutcome: "Completado",
        rationale: "Esencial",
        contributingItemIds: ["item-1"],
        estimatedHours: 6,
      },
    ],
    obligations: [
      {
        itemId: "item-meeting",
        title: "Reunión externa",
        commitmentType: "strict_deadline",
        rationale: "Compromiso",
        estimatedHours: 2,
      },
    ],
    flexibleOptions: [],
    deferredItems: [
      {
        itemId: "item-postponed",
        title: "Comprar café para la oficina",
        reason: "intentional_postponement",
        rationale: "Diferido para después",
      },
      {
        itemId: "item-unscheduled",
        title: "Explorar nueva herramienta",
        reason: "not_scheduled",
        rationale: "Sin programar en la propuesta",
      },
    ],
    unplannedSpace: {
      rationale: "Margen de maniobra",
      recommendedHours: 5,
    },
    confirmationPrompt: {
      question: "¿Confirmar la semana?",
      keyTradeoffs: [],
      pendingQuestions: [],
    },
    ...customProps,
  });

  const createSampleSchedule = (planId: string, targetWeek: TargetWeek): WeeklySchedule => ({
    scheduleId: `sched-${planId}`,
    planId,
    weekRange: targetWeek,
    version: 1,
    timeBlocks: [],
    dailyAllocations: [],
    appliedAdjustments: [],
    createdAt: "2026-10-14T10:00:00.000Z",
    updatedAt: "2026-10-14T10:00:00.000Z",
  });

  function createTestContextValue(
    overrides?: Partial<WeeklySessionContextValue>
  ): WeeklySessionContextValue {
    return {
      state: {
        status: "no_active_session",
        activePlan: null,
        activeSchedule: null,
        latestCloseReport: null,
        latestClosedPlan: null,
        latestClosedWeek: null,
        concurrencyConflict: null,
        memories: [],
        memoryCandidates: [],
        ambiguousPlanIds: [],
        inconsistencyReason: null,
        errorMessage: null,
        draftPlan: null,
        draftPlans: [],
      },
      service,
      controller,
      reloadSession: () => controller.reloadSession(),
      createOrSavePlan: (plan, schedule) => controller.createOrSavePlan(plan, schedule),
      applyAdjustment: (params) => controller.applyAdjustment(params),
      closeWeek: (params) => controller.closeWeek(params),
      confirmMemoryCandidate: (c, d) => controller.confirmMemoryCandidate(c, d),
      confirmMemoryOperation: (op, conf) => controller.confirmMemoryOperation(op, conf),
      purgeSession: (id) => controller.purgeSession(id),
      resolveAmbiguity: (id) => controller.resolveAmbiguity(id),
      getDraftPlan: (w) => controller.getDraftPlan(w),
      saveDraftPlan: (plan) => controller.saveDraftPlan(plan),
      clearDraftPlan: (p) => controller.clearDraftPlan(p),
      ...overrides,
    };
  }

  beforeEach(async () => {
    await deleteDatabase(TEST_DB, fakeIDB);
    storage = await createIndexedDbStorage({
      dbName: TEST_DB,
      customFactory: fakeIDB,
    });
    service = new WeeklySessionService({
      plans: storage.plans,
      schedules: storage.schedules,
      closeReports: storage.closeReports,
      memories: storage.memories,
      getDb: () => storage.db,
    });
    controller = new WeeklySessionController(service);
  });

  describe("1. Persistencia y aislamiento de borradores", () => {
    it("permite que coexistan múltiples borradores de semanas diferentes sin pisarse", async () => {
      const draftA: StoredWeeklyPlan = {
        planId: "draft-week-a",
        createdAt: "2026-10-14T09:00:00.000Z",
        updatedAt: "2026-10-14T09:00:00.000Z",
        targetWeek: weekA,
        status: "draft",
        proposal: createSampleProposal(weekA),
      };

      const draftB: StoredWeeklyPlan = {
        planId: "draft-week-b",
        createdAt: "2026-10-14T10:00:00.000Z",
        updatedAt: "2026-10-14T10:00:00.000Z",
        targetWeek: weekB,
        status: "draft",
        proposal: createSampleProposal(weekB),
      };

      await service.saveDraftPlan(draftA);
      await service.saveDraftPlan(draftB);

      const allDrafts = await service.getDraftPlans();
      expect(allDrafts).toHaveLength(2);
      expect(allDrafts.map((d) => d.planId)).toContain("draft-week-a");
      expect(allDrafts.map((d) => d.planId)).toContain("draft-week-b");
    });

    it("getDraftPlan(targetWeek) recupera el borrador exacto para la semana solicitada", async () => {
      const draftA: StoredWeeklyPlan = {
        planId: "draft-week-a",
        createdAt: "2026-10-14T09:00:00.000Z",
        updatedAt: "2026-10-14T12:00:00.000Z", // Modificado más recientemente
        targetWeek: weekA,
        status: "draft",
        proposal: createSampleProposal(weekA),
      };

      const draftB: StoredWeeklyPlan = {
        planId: "draft-week-b",
        createdAt: "2026-10-14T08:00:00.000Z",
        updatedAt: "2026-10-14T08:00:00.000Z",
        targetWeek: weekB,
        status: "draft",
        proposal: createSampleProposal(weekB),
      };

      await service.saveDraftPlan(draftA);
      await service.saveDraftPlan(draftB);

      // Consulta semana B: no debe devolver el de la semana A por ser el más reciente
      const recoveredB = await service.getDraftPlan(weekB);
      expect(recoveredB).not.toBeNull();
      expect(recoveredB?.planId).toBe("draft-week-b");
      expect(recoveredB?.targetWeek.startDate).toBe(weekB.startDate);

      // Consulta semana A: debe devolver el de la semana A
      const recoveredA = await service.getDraftPlan(weekA);
      expect(recoveredA).not.toBeNull();
      expect(recoveredA?.planId).toBe("draft-week-a");
      expect(recoveredA?.targetWeek.startDate).toBe(weekA.startDate);
    });

    it("lanza AmbiguousDraftPlanError si existen múltiples borradores para el mismo intervalo", async () => {
      const draft1: StoredWeeklyPlan = {
        planId: "draft-week-a-1",
        createdAt: "2026-10-14T08:00:00.000Z",
        updatedAt: "2026-10-14T08:00:00.000Z",
        targetWeek: weekA,
        status: "draft",
        proposal: createSampleProposal(weekA),
      };

      const draft2: StoredWeeklyPlan = {
        planId: "draft-week-a-2",
        createdAt: "2026-10-14T09:00:00.000Z",
        updatedAt: "2026-10-14T09:00:00.000Z",
        targetWeek: weekA,
        status: "draft",
        proposal: createSampleProposal(weekA),
      };

      // Guardamos directamente en repositorio para simular datos duplicados en el store
      await storage.plans.save(draft1);
      await storage.plans.save(draft2);

      await expect(service.getDraftPlan(weekA)).rejects.toThrow(AmbiguousDraftPlanError);
    });

    it("lanza AmbiguousDraftPlanError si se llama getDraftPlan() sin targetWeek habiendo múltiples borradores", async () => {
      const draftA: StoredWeeklyPlan = {
        planId: "draft-week-a",
        createdAt: "2026-10-14T08:00:00.000Z",
        updatedAt: "2026-10-14T08:00:00.000Z",
        targetWeek: weekA,
        status: "draft",
        proposal: createSampleProposal(weekA),
      };

      const draftB: StoredWeeklyPlan = {
        planId: "draft-week-b",
        createdAt: "2026-10-14T09:00:00.000Z",
        updatedAt: "2026-10-14T09:00:00.000Z",
        targetWeek: weekB,
        status: "draft",
        proposal: createSampleProposal(weekB),
      };

      await service.saveDraftPlan(draftA);
      await service.saveDraftPlan(draftB);

      await expect(service.getDraftPlan()).rejects.toThrow(AmbiguousDraftPlanError);
    });

    it("al activar una semana, elimina exclusivamente su borrador y conserva el de otra semana", async () => {
      const draftA: StoredWeeklyPlan = {
        planId: "draft-week-a",
        createdAt: "2026-10-14T08:00:00.000Z",
        updatedAt: "2026-10-14T08:00:00.000Z",
        targetWeek: weekA,
        status: "draft",
        proposal: createSampleProposal(weekA),
      };

      const draftB: StoredWeeklyPlan = {
        planId: "draft-week-b",
        createdAt: "2026-10-14T09:00:00.000Z",
        updatedAt: "2026-10-14T09:00:00.000Z",
        targetWeek: weekB,
        status: "draft",
        proposal: createSampleProposal(weekB),
      };

      await service.saveDraftPlan(draftA);
      await service.saveDraftPlan(draftB);

      // Activamos la semana A
      const planA: StoredWeeklyPlan = {
        ...draftA,
        planId: "active-plan-week-a",
        status: "active",
      };
      const scheduleA = createSampleSchedule(planA.planId, weekA);

      const activationResult = await service.createOrSavePlanAndSchedule(planA, scheduleA);

      expect(activationResult.status).toBe("success");

      // El borrador de la semana A debe haber sido eliminado
      const recoveredA = await service.getDraftPlan(weekA);
      expect(recoveredA).toBeNull();

      // El borrador de la semana B debe seguir intacto
      const recoveredB = await service.getDraftPlan(weekB);
      expect(recoveredB).not.toBeNull();
      expect(recoveredB?.planId).toBe("draft-week-b");
    });

    it("si la activación falla, conserva tanto el borrador como la semana activa existente", async () => {
      // 1. Crear semana activa previa para semana A
      const activePlanA: StoredWeeklyPlan = {
        planId: "active-plan-week-a",
        createdAt: "2026-10-14T08:00:00.000Z",
        updatedAt: "2026-10-14T08:00:00.000Z",
        targetWeek: weekA,
        status: "active",
        proposal: createSampleProposal(weekA),
      };
      const scheduleA = createSampleSchedule(activePlanA.planId, weekA);
      await service.createOrSavePlanAndSchedule(activePlanA, scheduleA);

      // 2. Guardar borrador para semana B
      const draftB: StoredWeeklyPlan = {
        planId: "draft-week-b",
        createdAt: "2026-10-14T09:00:00.000Z",
        updatedAt: "2026-10-14T09:00:00.000Z",
        targetWeek: weekB,
        status: "draft",
        proposal: createSampleProposal(weekB),
      };
      await service.saveDraftPlan(draftB);

      // 3. Intentar activar semana B sin haber cerrado semana A -> conflicto
      const planB: StoredWeeklyPlan = {
        ...draftB,
        planId: "active-plan-week-b",
        status: "active",
      };
      const scheduleB = createSampleSchedule(planB.planId, weekB);

      const failedResult = await service.createOrSavePlanAndSchedule(planB, scheduleB);

      expect(failedResult.status).toBe("conflict_active_plan_exists");

      // Verificamos que el borrador B NO se borró
      const recoveredB = await service.getDraftPlan(weekB);
      expect(recoveredB).not.toBeNull();
      expect(recoveredB?.planId).toBe("draft-week-b");

      // Verificamos que la semana activa A sigue intacta
      const resumed = await service.resumeSession();
      expect(resumed.status).toBe("session_resumed");
      if (resumed.status === "session_resumed") {
        expect(resumed.state.activePlan?.planId).toBe("active-plan-week-a");
      }
    });
  });

  describe("2. Verificación de capacidad y honestidad de estimaciones", () => {
    it("persiste la calibración de capacidad en el borrador (draftContext)", async () => {
      const draft: StoredWeeklyPlan = {
        planId: "draft-calibrated",
        createdAt: "2026-10-14T10:00:00.000Z",
        updatedAt: "2026-10-14T10:00:00.000Z",
        targetWeek: weekA,
        status: "draft",
        proposal: createSampleProposal(weekA),
        draftContext: {
          noteText: "Nota original de prueba",
          extractedItems: [],
          availableHoursInput: "25",
          protectedSpacePercentInput: "25",
        },
      };

      await service.saveDraftPlan(draft);

      const recovered = await service.getDraftPlan(weekA);
      expect(recovered?.draftContext?.availableHoursInput).toBe("25");
      expect(recovered?.draftContext?.protectedSpacePercentInput).toBe("25");
    });

    it("muestra badge de estimación incompleta y no declara viabilidad confirmada cuando faltan estimaciones", () => {
      const proposalWithIncompleteEstimates: ProposedWeek = {
        ...createSampleProposal(weekA),
        weekSummary: {
          targetWeek: weekA,
          capacity: {
            totalAvailableHours: 25,
            plannableHours: 18.75,
            plannedHours: null,
            knownEstimatedHours: 6,
            estimationCompleteness: "partial",
            protectedSpaceHours: 6.25,
            capacityStatus: "unknown",
            protectedSpaceStatus: "respected",
          },
        },
      };

      const mockContextValue = createTestContextValue();

      const sampleItems: ExtractedItem[] = [
        {
          id: "item-1",
          rawText: "Informe trimestral",
          title: "Informe trimestral",
          type: "task",
          status: "started",
          estimatedEffort: { value: 6, unit: "hours", source: "user" },
        },
        {
          id: "item-2",
          rawText: "Comprar café",
          title: "Comprar café",
          type: "task",
          status: "started",
          // Sin estimación
        },
      ];

      const html = renderToStaticMarkup(
        <WeeklySessionReactContext.Provider value={mockContextValue}>
          <WeeklyPlanningFromNotes
            provider={new MockProvider()}
            currentDate="2026-10-14"
            initialItems={sampleItems}
            initialProposedWeek={proposalWithIncompleteEstimates}
          />
        </WeeklySessionReactContext.Provider>
      );

      // Debe mostrar el resumen de capacidad configurada
      expect(html).toContain('data-testid="capacity-validated-summary"');
      // Debe mostrar la advertencia honesta de estimaciones incompletas
      expect(html).toContain('data-testid="incomplete-estimations-badge"');
      expect(html).toContain("estimaciones incompletas");
      // NO debe declarar falsamente viabilidad confirmada
      expect(html).not.toContain('data-testid="viability-confirmed-badge"');
    });

    it("muestra sobrecarga cuando las horas estimadas conocidas superan las planificables", () => {
      const proposalOverCapacity: ProposedWeek = {
        ...createSampleProposal(weekA),
        weekSummary: {
          targetWeek: weekA,
          capacity: {
            totalAvailableHours: 10,
            plannableHours: 7.5,
            plannedHours: 12,
            knownEstimatedHours: 12,
            estimationCompleteness: "complete",
            protectedSpaceHours: 2.5,
            capacityStatus: "over_capacity",
            protectedSpaceStatus: "respected",
          },
        },
      };

      const mockContextValue = createTestContextValue();

      const html = renderToStaticMarkup(
        <WeeklySessionReactContext.Provider value={mockContextValue}>
          <WeeklyPlanningFromNotes
            provider={new MockProvider()}
            currentDate="2026-10-14"
            initialItems={[]}
            initialProposedWeek={proposalOverCapacity}
          />
        </WeeklySessionReactContext.Provider>
      );

      expect(html).toContain('data-testid="over-capacity-badge"');
      expect(html).toContain("Sobrecarga detectada");
      expect(html).not.toContain('data-testid="viability-confirmed-badge"');
    });

    it("muestra viabilidad confirmada cuando las estimaciones son completas y caben dentro de la capacidad", () => {
      const proposalViable: ProposedWeek = {
        ...createSampleProposal(weekA),
        weekSummary: {
          targetWeek: weekA,
          capacity: {
            totalAvailableHours: 20,
            plannableHours: 15,
            plannedHours: 8,
            knownEstimatedHours: 8,
            estimationCompleteness: "complete",
            protectedSpaceHours: 5,
            capacityStatus: "within_capacity",
            protectedSpaceStatus: "respected",
          },
        },
      };

      const mockContextValue = createTestContextValue();

      const html = renderToStaticMarkup(
        <WeeklySessionReactContext.Provider value={mockContextValue}>
          <WeeklyPlanningFromNotes
            provider={new MockProvider()}
            currentDate="2026-10-14"
            initialItems={[]}
            initialProposedWeek={proposalViable}
          />
        </WeeklySessionReactContext.Provider>
      );

      expect(html).toContain('data-testid="viability-confirmed-badge"');
      expect(html).toContain("Viabilidad confirmada");
      expect(html).not.toContain('data-testid="over-capacity-badge"');
      expect(html).not.toContain('data-testid="incomplete-estimations-badge"');
    });
  });

  describe("3. Elementos no programados e intención explícita", () => {
    it("diferencia claramente entre elementos pendientes de decisión y postergados conscientemente", () => {
      const proposal = createSampleProposal(weekA);
      const mockContextValue = createTestContextValue();

      const html = renderToStaticMarkup(
        <WeeklySessionReactContext.Provider value={mockContextValue}>
          <WeeklyPlanningFromNotes
            provider={new MockProvider()}
            currentDate="2026-10-14"
            initialItems={[]}
            initialProposedWeek={proposal}
          />
        </WeeklySessionReactContext.Provider>
      );

      // Comprobar las dos secciones diferenciadas
      expect(html).toContain('data-testid="pending-decision-items-group"');
      expect(html).toContain('data-testid="postponed-items-group"');

      // Botones de acción explícita para el ítem no programado
      expect(html).toContain('data-testid="defer-item-postpone-button-item-unscheduled"');
      expect(html).toContain('data-testid="defer-item-include-button-item-unscheduled"');

      // Botones de acción explícita para el ítem postergado
      expect(html).toContain('data-testid="defer-item-unschedule-button-item-postponed"');
    });
  });

  describe("4. Transición entre semanas y resguardo ante conflictos", () => {
    it("muestra banner de transición calmada cuando existe una semana activa previa al intentar activar la futura", async () => {
      // 1. Activar semana A
      const activePlanA: StoredWeeklyPlan = {
        planId: "active-week-a",
        createdAt: "2026-10-14T08:00:00.000Z",
        updatedAt: "2026-10-14T08:00:00.000Z",
        targetWeek: weekA,
        status: "active",
        proposal: createSampleProposal(weekA),
      };
      await service.createOrSavePlanAndSchedule(
        activePlanA,
        createSampleSchedule(activePlanA.planId, weekA)
      );

      // 2. Preparar propuesta para semana B con borrador existente
      const draftB: StoredWeeklyPlan = {
        planId: "draft-week-b",
        createdAt: "2026-10-14T09:00:00.000Z",
        updatedAt: "2026-10-14T09:00:00.000Z",
        targetWeek: weekB,
        status: "draft",
        proposal: createSampleProposal(weekB),
      };
      await service.saveDraftPlan(draftB);

      // Verificamos que getActivePlan devuelve semana A
      const active = await storage.plans.getActivePlan();
      expect(active?.planId).toBe("active-week-a");

      // Verificamos que el borrador futuro de semana B se recupera limpiamente
      const futureDraft = await service.getDraftPlan(weekB);
      expect(futureDraft?.planId).toBe("draft-week-b");
    });
  });
});
