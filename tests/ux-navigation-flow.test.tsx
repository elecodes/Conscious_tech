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
import { App } from "../src/web/App";
import {
  WeeklySessionView,
  formatUnscheduledCategory,
} from "../src/web/components/weekly-session-view";
import { MockProvider } from "../src/providers/mock-provider";
import { StoredWeeklyPlan } from "../src/domain/repositories/types";
import { WeeklySchedule } from "../src/domain/schedule";

describe("Flujos de Experiencia de Usuario (UX) guiada y divulgación progresiva", () => {
  const TEST_DB = "conscious_tech_ux_flow_test_db";

  if (typeof globalThis.IDBKeyRange === "undefined") {
    (globalThis as unknown as { IDBKeyRange: typeof fakeKeyRange }).IDBKeyRange = fakeKeyRange;
  }

  let storage: IndexedDbStorageContext;
  let service: WeeklySessionService;
  let controller: WeeklySessionController;
  const mockProvider = new MockProvider();

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

  function createMockContextValue(overrides?: Partial<WeeklySessionContextValue>): WeeklySessionContextValue {
    return {
      state: controller.getSnapshot(),
      service,
      controller,
      reloadSession: () => controller.reloadSession(),
      createOrSavePlan: (plan, sched) => controller.createOrSavePlan(plan, sched),
      applyAdjustment: (params) => controller.applyAdjustment(params),
      closeWeek: (params) => controller.closeWeek(params),
      reopenWeek: (planId) => controller.reopenWeek(planId),
      confirmMemoryCandidate: (cand, dec) => controller.confirmMemoryCandidate(cand, dec),
      confirmMemoryOperation: (op, conf) => controller.confirmMemoryOperation(op, conf),
      purgeSession: (id) => controller.purgeSession(id),
      resolveAmbiguity: (id) => controller.resolveAmbiguity(id),
      saveDraftPlan: (p) => controller.saveDraftPlan(p),
      clearDraftPlan: (id) => controller.clearDraftPlan(id),
      ...overrides,
    };
  }

  it("1. App renderiza los 4 espacios de navegación guiada e indicador de proceso", () => {
    const html = renderToStaticMarkup(<App service={service} initialTab="active" />);

    // 4 pestañas de navegación
    expect(html).toContain("1. Capturar ideas");
    expect(html).toContain("2. Preparar semana");
    expect(html).toContain("3. Mi semana");
    expect(html).toContain("4. Revisar y aprender");

    // Indicador de estado del proceso
    expect(html).toContain("process-status-badge");
    expect(html).toContain("Borrador / Sin semana activa");
  });

  it("2. Espacio 'Mi semana' sin semana activa ofrece acción clara para preparar", async () => {
    await controller.reloadSession();
    expect(controller.getSnapshot().status).toBe("no_active_session");

    const contextVal = createMockContextValue();
    const html = renderToStaticMarkup(
      <WeeklySessionReactContext.Provider value={contextVal}>
        <WeeklySessionView provider={mockProvider} activeSpace="active" />
      </WeeklySessionReactContext.Provider>
    );

    expect(html).toContain("Tu cuaderno está despejado. No hay ninguna semana activa en este momento.");
    expect(html).toContain("nav-to-prepare-from-active-button");
    expect(html).toContain("🗓️ Preparar una semana");
  });

  it("3. Espacio 'Preparar semana' permite configurar sin cerrar la semana activa", async () => {
    // Iniciar una semana activa
    const samplePlan: StoredWeeklyPlan = {
      planId: "plan-active-1",
      status: "active",
      targetWeek: { startDate: "2026-10-12", endDate: "2026-10-18" },
      proposal: {
        weekSummary: {
          targetWeek: { startDate: "2026-10-12", endDate: "2026-10-18" },
          capacity: {
            totalAvailableHours: 30,
            plannableHours: 22.5,
            plannedHours: 15,
            knownEstimatedHours: 15,
            estimationCompleteness: "complete",
            protectedSpaceHours: 7.5,
            capacityStatus: "within_capacity",
            protectedSpaceStatus: "respected",
          },
          intent: "Semana en curso",
        },
        foci: [],
        obligations: [
          {
            itemId: "task-1",
            title: "Auditoría de UX",
            dueDate: "2026-10-15",
            commitmentType: "external",
            rationale: "Foco principal",
            estimatedHours: 5,
          },
        ],
        flexibleOptions: [],
        deferredItems: [],
        unplannedSpace: { recommendedHours: 7.5, rationale: "Espacio protegido" },
        confirmationPrompt: { question: "¿Representa tu plan?", keyTradeoffs: [], pendingQuestions: [] },
      },
      createdAt: "2026-10-12T00:00:00.000Z",
      updatedAt: "2026-10-12T00:00:00.000Z",
    };

    const sampleSchedule: WeeklySchedule = {
      scheduleId: "sched-active-1",
      planId: "plan-active-1",
      weekRange: { startDate: "2026-10-12", endDate: "2026-10-18" },
      version: 1,
      timeBlocks: [],
      dailyAllocations: [{ day: "2026-10-12", allocatedHours: 5, itemId: "task-1" }],
      appliedAdjustments: [],
      createdAt: "2026-10-12T00:00:00.000Z",
      updatedAt: "2026-10-12T00:00:00.000Z",
    };

    await controller.createOrSavePlan(samplePlan, sampleSchedule);
    await controller.reloadSession();

    const contextVal = createMockContextValue();
    const htmlPrepare = renderToStaticMarkup(
      <WeeklySessionReactContext.Provider value={contextVal}>
        <WeeklySessionView provider={mockProvider} activeSpace="prepare" />
      </WeeklySessionReactContext.Provider>
    );

    // Debe indicar claramente que la semana activa continúa protegida
    expect(htmlPrepare).toContain("2. Preparar semana");
    expect(htmlPrepare).toContain("Semana activa: 2026-10-12 al 2026-10-18");
    expect(htmlPrepare).toContain("sin alterar la semana activa");
  });

  it("4. Categorías de elementos no programados reflejan estados honestos", () => {
    const intentional = formatUnscheduledCategory("intentional_postponement");
    expect(intentional.label).toBe("Dejado para después por decisión humana");

    const dependency = formatUnscheduledCategory("waiting_dependency");
    expect(dependency.label).toBe("Pendiente de información");

    const capacity = formatUnscheduledCategory("out_of_capacity");
    expect(capacity.label).toBe("Fuera de la propuesta actual");

    const notScheduled = formatUnscheduledCategory("not_scheduled");
    expect(notScheduled.label).toBe("Pendiente de decisión");
  });

  it("5. Divulgación progresiva: resumen de capacidad compacto y espacio protegido visible", async () => {
    const samplePlan: StoredWeeklyPlan = {
      planId: "plan-cap-1",
      status: "active",
      targetWeek: { startDate: "2026-10-12", endDate: "2026-10-18" },
      proposal: {
        weekSummary: {
          targetWeek: { startDate: "2026-10-12", endDate: "2026-10-18" },
          capacity: {
            totalAvailableHours: 40,
            plannableHours: 32,
            plannedHours: 20,
            knownEstimatedHours: 20,
            estimationCompleteness: "complete",
            protectedSpaceHours: 8,
            capacityStatus: "within_capacity",
            protectedSpaceStatus: "respected",
          },
          intent: "Semana balanceada",
        },
        foci: [],
        obligations: [],
        flexibleOptions: [],
        deferredItems: [],
        unplannedSpace: { recommendedHours: 8, rationale: "Margen para respiro" },
        confirmationPrompt: { question: "¿Aprobado?", keyTradeoffs: [], pendingQuestions: [] },
      },
      createdAt: "2026-10-12T00:00:00.000Z",
      updatedAt: "2026-10-12T00:00:00.000Z",
    };

    const sampleSchedule: WeeklySchedule = {
      scheduleId: "sched-cap-1",
      planId: "plan-cap-1",
      weekRange: { startDate: "2026-10-12", endDate: "2026-10-18" },
      version: 1,
      timeBlocks: [],
      dailyAllocations: [],
      appliedAdjustments: [],
      createdAt: "2026-10-12T00:00:00.000Z",
      updatedAt: "2026-10-12T00:00:00.000Z",
    };

    await controller.createOrSavePlan(samplePlan, sampleSchedule);
    await controller.reloadSession();
    const contextVal = createMockContextValue();
    const htmlActive = renderToStaticMarkup(
      <WeeklySessionReactContext.Provider value={contextVal}>
        <WeeklySessionView provider={mockProvider} activeSpace="active" />
      </WeeklySessionReactContext.Provider>
    );

    // Resumen compacto
    expect(htmlActive).toContain("Disponibles:");
    expect(htmlActive).toContain("40h");
    expect(htmlActive).toContain("Protegidas:");
    expect(htmlActive).toContain("8h");
    expect(htmlActive).toContain("Planificables:");
    expect(htmlActive).toContain("32h");
    expect(htmlActive).toContain("Planificadas:");
    expect(htmlActive).toContain("20h");
    expect(htmlActive).toContain("Restantes:");
    expect(htmlActive).toContain("12h");

    // Frase rectora requerida
    expect(htmlActive).toContain("Se ha reservado espacio protegido en el plan");

    // Divulgación progresiva: detalles plegables para fórmulas
    expect(htmlActive).toContain("Ver desglose completo de cálculos y límites");
  });

  it("6. Cierre de semana con aviso de cierre anticipado y formulario escalonado", async () => {
    // Semana futura (ej: finaliza en 2030)
    const futurePlan: StoredWeeklyPlan = {
      planId: "plan-future-1",
      status: "active",
      targetWeek: { startDate: "2030-10-14", endDate: "2030-10-20" },
      proposal: {
        weekSummary: {
          targetWeek: { startDate: "2030-10-14", endDate: "2030-10-20" },
          capacity: {
            totalAvailableHours: 20,
            plannableHours: 15,
            plannedHours: 10,
            knownEstimatedHours: 10,
            estimationCompleteness: "complete",
            protectedSpaceHours: 5,
            capacityStatus: "within_capacity",
            protectedSpaceStatus: "respected",
          },
          intent: "Semana lejana",
        },
        foci: [],
        obligations: [
          {
            itemId: "task-future",
            title: "Planificación a largo plazo",
            commitmentType: "external",
            rationale: "Foco",
            estimatedHours: 10,
          },
        ],
        flexibleOptions: [],
        deferredItems: [],
        unplannedSpace: { recommendedHours: 5, rationale: "Margen" },
        confirmationPrompt: { question: "¿Aprobado?", keyTradeoffs: [], pendingQuestions: [] },
      },
      createdAt: "2026-10-12T00:00:00.000Z",
      updatedAt: "2026-10-12T00:00:00.000Z",
    };

    const futureSchedule: WeeklySchedule = {
      scheduleId: "sched-future-1",
      planId: "plan-future-1",
      weekRange: { startDate: "2030-10-14", endDate: "2030-10-20" },
      version: 1,
      timeBlocks: [],
      dailyAllocations: [],
      appliedAdjustments: [],
      createdAt: "2026-10-12T00:00:00.000Z",
      updatedAt: "2026-10-12T00:00:00.000Z",
    };

    await controller.createOrSavePlan(futurePlan, futureSchedule);
    await controller.reloadSession();
    const contextVal = createMockContextValue();

    const htmlReview = renderToStaticMarkup(
      <WeeklySessionReactContext.Provider value={contextVal}>
        <WeeklySessionView provider={mockProvider} activeSpace="review" />
      </WeeklySessionReactContext.Provider>
    );

    // Debe mostrar la guardia de cierre anticipado
    expect(htmlReview).toContain("early-close-guard-box");
    expect(htmlReview).toContain("⚠️ Cierre anticipado de semana");
    expect(htmlReview).toContain("Esta semana está programada hasta el");
    expect(htmlReview).toContain("2030-10-20");
    expect(htmlReview).toContain("confirm-early-close-button");
    expect(htmlReview).toContain("Alternativa segura:");
  });

  it("8. Muestra borradores guardados y opciones de desarrollo en Mi semana sin semana activa", async () => {
    // Guardamos un borrador
    const draftPlan: StoredWeeklyPlan = {
      planId: "draft-2026-10-19",
      status: "draft",
      targetWeek: { startDate: "2026-10-19", endDate: "2026-10-25" },
      proposal: {
        weekSummary: {
          targetWeek: { startDate: "2026-10-19", endDate: "2026-10-25" },
          capacity: {
            totalAvailableHours: 20,
            plannableHours: 15,
            plannedHours: 10,
            knownEstimatedHours: 10,
            estimationCompleteness: "complete",
            protectedSpaceHours: 5,
            capacityStatus: "within_capacity",
            protectedSpaceStatus: "respected",
          },
          intent: "Semana borrador",
        },
        foci: [],
        obligations: [],
        flexibleOptions: [],
        deferredItems: [],
        unplannedSpace: { recommendedHours: 5, rationale: "Margen" },
        confirmationPrompt: { question: "¿Ok?", keyTradeoffs: [], pendingQuestions: [] },
      },
      createdAt: "2026-10-12T00:00:00.000Z",
      updatedAt: "2026-10-12T00:00:00.000Z",
    };

    await controller.saveDraftPlan(draftPlan);
    await controller.reloadSession();

    const contextVal = createMockContextValue();
    const html = renderToStaticMarkup(
      <WeeklySessionReactContext.Provider value={contextVal}>
        <WeeklySessionView provider={mockProvider} activeSpace="active" />
      </WeeklySessionReactContext.Provider>
    );

    // Debe mostrar aviso con el borrador guardado
    expect(html).toContain("active-space-drafts-notice");
    expect(html).toContain("Borradores de semana guardados");
    expect(html).toContain("2026-10-19");
    expect(html).toContain("Continuar borrador →");

    // Y debe ofrecer las opciones de desarrollo
    expect(html).toContain("dev-options-section");
    expect(html).toContain("Opciones de desarrollo: Iniciar semana de ejemplo prefijada");
  });

  it("9. Permite añadir más ideas a una lista existente y limpiar el cuaderno para una nueva semana", async () => {
    await controller.reloadSession();
    const contextVal = createMockContextValue();

    // Renderizamos con elementos iniciales
    const initialItems = [
      {
        id: "task-1",
        title: "Tarea inicial",
        rawText: "Hacer tarea inicial",
        type: "task" as const,
        status: "pending" as const,
        priority: "medium" as const,
        confidence: 0.9,
      },
    ];

    const html = renderToStaticMarkup(
      <WeeklySessionReactContext.Provider value={contextVal}>
        <WeeklySessionView
          provider={mockProvider}
          activeSpace="prepare"
          initialPlanningItems={initialItems}
        />
      </WeeklySessionReactContext.Provider>
    );

    // Debe mostrar botón para añadir a la lista existente
    expect(html).toContain("extract-append-button");
    expect(html).toContain("➕ Añadir a la lista existente");
    expect(html).toContain("extract-replace-button");
    expect(html).toContain("🔄 Reemplazar lista actual");

    // Y botones para limpiar / empezar nueva semana
    expect(html).toContain("start-fresh-week-top-button");
    expect(html).toContain("✨ Limpiar y empezar nueva semana");
    expect(html).toContain("clear-extracted-items-button");
    expect(html).toContain("✨ Limpiar elementos");
  });
});
