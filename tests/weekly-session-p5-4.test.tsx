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
import { WeeklySessionView } from "../src/web/components/weekly-session-view";
import { WeeklyPlanningFromNotes } from "../src/web/components/weekly-planning-from-notes";
import {
  prepareBuildWeekInput,
  generateWeeklyProposalFromItems,
} from "../src/application/planning-pipeline";
import { MockProvider } from "../src/providers/mock-provider";
import { AIProvider } from "../src/providers/ai-provider";
import { ExtractedItem } from "../src/domain/items";
import { ProposedWeekSchema } from "../src/domain/week";
import { StoredWeeklyPlan } from "../src/domain/repositories/types";
import { WeeklySchedule } from "../src/domain/schedule";

describe("Fase P5.4 — Conectar la entrada de ideas con la planificación semanal", () => {
  const TEST_DB_NAME = "conscious_tech_p5_4_test_db";

  if (typeof globalThis.IDBKeyRange === "undefined") {
    (globalThis as unknown as { IDBKeyRange: typeof fakeKeyRange }).IDBKeyRange = fakeKeyRange;
  }

  let storage: IndexedDbStorageContext;
  let service: WeeklySessionService;
  let controller: WeeklySessionController;
  let mockProvider: MockProvider;

  const sampleItems: ExtractedItem[] = [
    {
      id: "item-informe",
      title: "Redactar informe trimestral",
      rawText: "Preparar informe trimestral para el directorio antes del jueves",
      type: "task",
      status: "started",
      estimatedEffort: { value: 6, unit: "hours", source: "user" },
      deadline: { raw: "jueves", resolved: "2026-10-15", confidence: "high" },
      commitment: "external",
      project: "Finanzas",
    },
    {
      id: "item-reunion",
      title: "Sincronización semanal",
      rawText: "Reunión de alineación el martes a las 10",
      type: "commitment",
      status: "started",
      estimatedEffort: { value: 2, unit: "hours", source: "user" },
      commitment: "external",
    },
    {
      id: "item-investigar",
      title: "Explorar arquitectura hexagonal",
      rawText: "Leer sobre puertos y adaptadores si tengo tiempo libre",
      type: "idea",
      status: "exploring",
      estimatedEffort: { value: 3, unit: "hours", source: "user" },
    },
  ];

  function createMockContextValue(overrides?: Partial<WeeklySessionContextValue>): WeeklySessionContextValue {
    return {
      state: controller.getSnapshot(),
      service,
      controller,
      reloadSession: () => controller.reloadSession(),
      createOrSavePlan: (plan, sched) => controller.createOrSavePlan(plan, sched),
      applyAdjustment: (params) => controller.applyAdjustment(params),
      closeWeek: (params) => controller.closeWeek(params),
      confirmMemoryCandidate: (cand, dec) => controller.confirmMemoryCandidate(cand, dec),
      confirmMemoryOperation: (op, conf) => controller.confirmMemoryOperation(op, conf),
      purgeSession: (id) => controller.purgeSession(id),
      resolveAmbiguity: (id) => controller.resolveAmbiguity(id),
      saveDraftPlan: (p) => controller.saveDraftPlan(p),
      clearDraftPlan: (id) => controller.clearDraftPlan(id),
      ...overrides,
    };
  }

  beforeEach(async () => {
    await deleteDatabase(TEST_DB_NAME, fakeIDB);
    storage = await createIndexedDbStorage({
      dbName: TEST_DB_NAME,
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
    mockProvider = new MockProvider();
  });

  // ==========================================================================
  // 1. Pipeline de preparación de planificación (deterministic & resilient)
  // ==========================================================================
  describe("Pipeline de preparación de planificación (prepareBuildWeekInput y generateWeeklyProposalFromItems)", () => {
    it("debe resolver semana vacía de forma determinista sin tokens de IA cuando no hay ítems", async () => {
      const proposal = await generateWeeklyProposalFromItems(mockProvider, {
        items: [],
        currentDate: "2026-10-12",
      });

      expect(proposal).toBeDefined();
      expect(proposal.foci).toHaveLength(0);
      expect(proposal.obligations).toHaveLength(0);
      expect(proposal.weekSummary.targetWeek.startDate).toBe("2026-10-19");
      expect(proposal.weekSummary.capacity.capacityStatus).toBe("unknown");
      expect(ProposedWeekSchema.safeParse(proposal).success).toBe(true);
    });

    it("debe ejecutar el pipeline completo de skills y generar una propuesta semanal válida", async () => {
      const proposal = await generateWeeklyProposalFromItems(mockProvider, {
        items: sampleItems,
        currentDate: "2026-10-09",
        userIntent: "Cerrar informe y mantener foco",
      });

      expect(proposal).toBeDefined();
      expect(ProposedWeekSchema.safeParse(proposal).success).toBe(true);
      expect(proposal.weekSummary.targetWeek.startDate).toBe("2026-10-12");
      expect(proposal.weekSummary.targetWeek.endDate).toBe("2026-10-18");

      expect(proposal.foci.length + proposal.obligations.length).toBeGreaterThan(0);
      expect(proposal.confirmationPrompt).toBeDefined();
      expect(proposal.confirmationPrompt.question).toBeTruthy();
    });

    it("debe ser resiliente ante fallos de skills intermedias usando salvaguardas deterministas", async () => {
      const faultyProvider: AIProvider = {
        id: "mock",
        model: "mock-fail",
        extractItems: async () => ({ items: sampleItems }),
        detectRelationships: async () => {
          throw new Error("Simulated relationships error");
        },
        groupWork: async () => {
          throw new Error("Simulated group work error");
        },
        detectDeadlines: async () => {
          throw new Error("Simulated deadlines error");
        },
        evaluateContext: async () => {
          throw new Error("Simulated context error");
        },
        buildWeek: async (input) => {
          return mockProvider.buildWeek(input);
        },
      };

      const input = await prepareBuildWeekInput(faultyProvider, {
        items: sampleItems,
        currentDate: "2026-10-09",
      });

      expect(input).toBeDefined();
      expect(input.items).toHaveLength(3);
      expect(input.relationships).toEqual([]);
      expect(input.groupedWork.ungroupedItemIds).toHaveLength(3);
      expect(input.context.itemAssessments).toHaveLength(3);

      const proposal = await generateWeeklyProposalFromItems(faultyProvider, {
        items: sampleItems,
        currentDate: "2026-10-09",
      });
      expect(ProposedWeekSchema.safeParse(proposal).success).toBe(true);
    });

    it("debe propagar restricciones de capacidad e intención del usuario si se proporcionan", async () => {
      const input = await prepareBuildWeekInput(mockProvider, {
        items: sampleItems,
        currentDate: "2026-10-09",
        userIntent: "Semana con calma",
        totalAvailableHours: 32,
        minProtectedSpaceRatio: 0.3,
      });

      expect(input.userIntent).toBe("Semana con calma");
      expect(input.capacity?.totalAvailableHours).toBe(32);
      expect(input.capacity?.minProtectedSpaceRatio).toBe(0.3);
    });
  });

  // ==========================================================================
  // 2. Renderizado estático y componentes de UI
  // ==========================================================================
  describe("Componente WeeklyPlanningFromNotes y WeeklySessionView (Renderizado)", () => {
    it("debe renderizar el área de notas y botones iniciales cuando no hay sesión activa", () => {
      const contextVal = createMockContextValue();
      const html = renderToStaticMarkup(
        <WeeklySessionReactContext.Provider value={contextVal}>
          <WeeklyPlanningFromNotes provider={mockProvider} currentDate="2026-10-12" />
        </WeeklySessionReactContext.Provider>
      );

      expect(html).toContain("¿Qué tienes en mente para planificar?");
      expect(html).toContain("Analizar y extraer elementos");
      expect(html).toContain("IA propone · Tú decides");
    });

    it("WeeklySessionView en estado no_active_session debe mostrar WeeklyPlanningFromNotes", async () => {
      await controller.reloadSession();
      expect(controller.getSnapshot().status).toBe("no_active_session");

      const contextVal = createMockContextValue();
      const html = renderToStaticMarkup(
        <WeeklySessionReactContext.Provider value={contextVal}>
          <WeeklySessionView provider={mockProvider} />
        </WeeklySessionReactContext.Provider>
      );
      expect(html).toContain("¿Qué tienes en mente para planificar?");
      expect(html).toContain("Analizar y extraer elementos");
    });

    it("debe advertir si se planifica mientras existe una semana activa", () => {
      const contextVal = createMockContextValue();
      const html = renderToStaticMarkup(
        <WeeklySessionReactContext.Provider value={contextVal}>
          <WeeklyPlanningFromNotes
            provider={mockProvider}
            hasActivePlan={true}
          />
        </WeeklySessionReactContext.Provider>
      );

      expect(html).toContain("Actualmente ya tienes una semana activa");
    });
  });

  // ==========================================================================
  // 3. Flujo completo E2E: Entrada -> Extracción -> Revisión -> Confirmación -> Persistencia
  // ==========================================================================
  describe("Flujo E2E de ciclo semanal completo desde notas", () => {
    it("debe permitir extraer, filtrar ítems aceptados, proponer semana y persistirla bajo confirmación humana explícita", async () => {
      // 1. Estado inicial: sin sesión activa
      const initialResume = await service.resumeSession();
      expect(initialResume.status).toBe("no_active_session");

      // 2. Extracción de ideas a través del proveedor
      mockProvider.setHandler(async () => ({ items: sampleItems }));
      const rawNotes = "Preparar informe trimestral y coordinar reunión el martes. Además pensar en arquitectura si da el tiempo.";
      const extracted = await mockProvider.extractItems({
        text: rawNotes,
        currentDate: "2026-10-09",
        locale: "es-ES",
      });
      expect(extracted.items.length).toBe(3);

      // 3. Revisión humana: la persona decide qué ítems entran
      const accepted = extracted.items.slice(0, 2);
      expect(accepted.length).toBe(2);

      // 4. Generación de propuesta semanal (IA propone)
      const proposedWeek = await generateWeeklyProposalFromItems(mockProvider, {
        items: accepted,
        currentDate: "2026-10-09",
        userIntent: "Entregables prioritarios",
      });

      expect(proposedWeek).toBeDefined();
      expect(proposedWeek.weekSummary.targetWeek.startDate).toBe("2026-10-12");

      // Invariante fundamental: La propuesta NO se guarda automáticamente en IndexedDB
      const activePlanBefore = await storage.plans.getActivePlan();
      expect(activePlanBefore).toBeNull();

      // 5. Confirmación humana explícita (La persona decide y activa)
      const planId = `plan-p54-${Date.now()}`;
      const now = new Date().toISOString();
      const planToStore: StoredWeeklyPlan = {
        planId,
        status: "active",
        targetWeek: proposedWeek.weekSummary.targetWeek,
        proposal: proposedWeek,
        createdAt: now,
        updatedAt: now,
      };

      const scheduleToStore: WeeklySchedule = {
        scheduleId: `sched-${planId}`,
        planId,
        weekRange: proposedWeek.weekSummary.targetWeek,
        timeBlocks: [],
        dailyAllocations: [],
        dayConstraints: [],
        appliedAdjustments: [],
        version: 1,
        createdAt: now,
        updatedAt: now,
      };

      const createResult = await controller.createOrSavePlan(planToStore, scheduleToStore);
      expect(createResult.status).toBe("success");

      // 6. Verificación de persistencia en IndexedDB
      const persistedPlan = await storage.plans.getById(planId);
      expect(persistedPlan).not.toBeNull();
      expect(persistedPlan?.status).toBe("active");
      expect(persistedPlan?.proposal.weekSummary.targetWeek.startDate).toBe("2026-10-12");

      const persistedSchedule = await storage.schedules.getById(`sched-${planId}`);
      expect(persistedSchedule).not.toBeNull();
      expect(persistedSchedule?.version).toBe(1);

      // 7. Simular recarga de página: resumeSession debe recuperar la semana activa guardada
      const newService = new WeeklySessionService({
        plans: storage.plans,
        schedules: storage.schedules,
        closeReports: storage.closeReports,
        memories: storage.memories,
        getDb: () => storage.db,
      });
      const resumed = await newService.resumeSession();

      expect(resumed.status).toBe("session_resumed");
      if (resumed.status === "session_resumed") {
        expect(resumed.state.activePlan?.planId).toBe(planId);
        expect(resumed.state.activePlan?.status).toBe("active");
        expect(resumed.state.activeSchedule?.scheduleId).toBe(`sched-${planId}`);
      }
    });

    it("debe rechazar la activación de un segundo plan si ya existe uno activo (conflict_active_plan_exists)", async () => {
      // 1. Crear un primer plan activo
      const plan1: StoredWeeklyPlan = {
        planId: "plan-active-1",
        status: "active",
        targetWeek: { startDate: "2026-10-12", endDate: "2026-10-18" },
        proposal: await generateWeeklyProposalFromItems(mockProvider, {
          items: [],
          currentDate: "2026-10-09",
        }),
        createdAt: "2026-10-09T10:00:00.000Z",
        updatedAt: "2026-10-09T10:00:00.000Z",
      };
      await controller.createOrSavePlan(plan1);

      // 2. Intentar crear otro plan con status active
      const plan2: StoredWeeklyPlan = {
        planId: "plan-active-2",
        status: "active",
        targetWeek: { startDate: "2026-10-19", endDate: "2026-10-25" },
        proposal: await generateWeeklyProposalFromItems(mockProvider, {
          items: [],
          currentDate: "2026-10-16",
        }),
        createdAt: "2026-10-16T10:00:00.000Z",
        updatedAt: "2026-10-16T10:00:00.000Z",
      };

      const result = await controller.createOrSavePlan(plan2);
      expect(result.status).toBe("conflict_active_plan_exists");
      if (result.status === "conflict_active_plan_exists") {
        expect(result.existingActivePlanId).toBe("plan-active-1");
      }

      // El plan 1 sigue siendo el único plan activo
      const activePlans = await storage.plans.getActivePlans();
      expect(activePlans).toHaveLength(1);
      expect(activePlans[0]!.planId).toBe("plan-active-1");
    });

    it("no debe llamar a APIs externas reales durante toda la suite de pruebas", () => {
      expect(mockProvider.id).toBe("mock");
      expect(mockProvider.model).toBe("deterministic-mock-v1");
    });
  });
});
