import { describe, it, expect, beforeEach, afterEach } from "vitest";
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
  initialWeeklySessionState,
} from "../src/web/context/weekly-session-context";
import { App, resolveNextStep } from "../src/web/App";
import {
  WeeklySessionView,
  formatUnscheduledCategory,
} from "../src/web/components/weekly-session-view";
import { WeeklyPlanningFromNotes } from "../src/web/components/weekly-planning-from-notes";
import { PlanningCapacityHud } from "../src/web/components/planning-capacity-hud";
import { ProposedWeek } from "../src/domain/week";
import { MockProvider } from "../src/providers/mock-provider";
import { StoredWeeklyPlan } from "../src/domain/repositories/types";
import { WeeklySchedule } from "../src/domain/schedule";
import { setDevModeForTesting } from "../src/web/dev-mode";

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

  afterEach(() => {
    setDevModeForTesting(null);
  });

  function createMockContextValue(
    overrides?: Partial<WeeklySessionContextValue>
  ): WeeklySessionContextValue {
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

  it("1. App renderiza los 2 espacios de navegación guiada, bienvenida e indicador de proceso", () => {
    const html = renderToStaticMarkup(<App service={service} initialTab="active" />);

    // 2 pestañas de navegación principales: Mi semana y Nueva semana
    expect(html).toContain("Mi semana");
    expect(html).toContain("Nueva semana");
    expect(html).not.toContain('data-testid="nav-tab-capture"');
    expect(html).not.toContain('data-testid="nav-tab-prepare"');
    expect(html).not.toContain('data-testid="nav-tab-review"');

    // Indicador de estado del proceso
    expect(html).toContain("process-status-badge");
    expect(html).toContain("Borrador / Sin semana activa");

    // Tarjeta de bienvenida de primer uso
    expect(html).toContain("welcome-card");
    expect(html).toContain("Escribe → Revisa → Vive tu semana");

    // Barra de siguiente paso guiado (inicial: nada capturado)
    expect(html).toContain("next-step-bar");
    expect(html).toContain("Escribe lo que tienes en la cabeza");
  });

  it("2. Espacio 'Mi semana' sin semana activa muestra las 3 líneas claras y el botón principal", async () => {
    await controller.reloadSession();
    expect(controller.getSnapshot().status).toBe("no_active_session");

    const contextVal = createMockContextValue();
    const html = renderToStaticMarkup(
      <WeeklySessionReactContext.Provider value={contextVal}>
        <WeeklySessionView provider={mockProvider} activeSpace="active" />
      </WeeklySessionReactContext.Provider>
    );

    // 3 líneas del estado vacío: Escribe -> Revisa -> Vive tu semana
    expect(html).toContain("empty-active-week-card");
    expect(html).toContain("Escribe");
    expect(html).toContain("Revisa");
    expect(html).toContain("Vive tu semana");
    expect(html).toContain("nav-to-prepare-from-active-button");
    expect(html).toContain("Comenzar mi semana →");
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
        confirmationPrompt: {
          question: "¿Representa tu plan?",
          keyTradeoffs: [],
          pendingQuestions: [],
        },
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
    expect(htmlPrepare).toContain("Nueva semana");
    expect(htmlPrepare).toContain("Actualmente ya tienes una semana activa en curso");
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

    // Por defecto (modo normal) no muestra opciones de desarrollo
    expect(html).not.toContain("dev-options-section");

    // En modo desarrollador (?dev=1), debe ofrecer las opciones de desarrollo
    setDevModeForTesting(true);
    const htmlDev = renderToStaticMarkup(
      <WeeklySessionReactContext.Provider value={contextVal}>
        <WeeklySessionView provider={mockProvider} activeSpace="active" />
      </WeeklySessionReactContext.Provider>
    );
    expect(htmlDev).toContain("dev-options-section");
    expect(htmlDev).toContain("Opciones de desarrollo: Iniciar semana de ejemplo prefijada");
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

  it("10. resolveNextStep deriva el siguiente paso único a partir del estado existente", () => {
    // 1. Nada capturado
    const step1 = resolveNextStep({
      state: { activePlan: null },
      extractedCount: 0,
    });
    expect(step1.message).toBe("Escribe lo que tienes en la cabeza");
    expect(step1.targetSpace).toBe("capture");

    // 2. Elementos extraídos, sin plan
    const step2 = resolveNextStep({
      state: { activePlan: null },
      extractedCount: 4,
    });
    expect(step2.message).toBe("Planifica tu semana con estas 4 ideas");
    expect(step2.targetSpace).toBe("prepare");

    // 3. Propuesta pendiente (borrador o propuesta activa en memoria)
    const step3 = resolveNextStep({
      state: {
        activePlan: null,
        draftPlan: { planId: "draft-1" } as any,
      },
      extractedCount: 4,
    });
    expect(step3.message).toBe("Revisa y confirma la propuesta");
    expect(step3.targetSpace).toBe("prepare");

    const step3b = resolveNextStep({
      state: { activePlan: null },
      extractedCount: 4,
      hasPendingProposal: true,
    });
    expect(step3b.message).toBe("Revisa y confirma la propuesta");
    expect(step3b.targetSpace).toBe("prepare");

    // 4. Semana activa en curso
    const step4 = resolveNextStep({
      state: {
        activePlan: {
          status: "active",
          targetWeek: { endDate: "2099-12-31" },
        },
      },
      extractedCount: 0,
    });
    expect(step4.message).toBe("Esta es tu semana");
    expect(step4.targetSpace).toBe("active");

    // 5. Semana terminando o terminada
    const step5 = resolveNextStep({
      state: {
        activePlan: {
          status: "active",
          targetWeek: { endDate: "2020-01-01" },
        },
      },
      extractedCount: 0,
    });
    expect(step5.message).toBe("Cierra la semana y apunta lo aprendido");
    expect(step5.targetSpace).toBe("review");
  });

  it("11. Planificar colapsa las opciones avanzadas y la adición opcional de ideas", async () => {
    await controller.reloadSession();
    const contextVal = createMockContextValue();
    const html = renderToStaticMarkup(
      <WeeklySessionReactContext.Provider value={contextVal}>
        <WeeklySessionView
          provider={mockProvider}
          activeSpace="prepare"
          initialPlanningItems={[
            {
              id: "item-1",
              title: "Tarea 1",
              rawText: "Tarea 1",
              type: "task",
              status: "pending",
            },
          ]}
        />
      </WeeklySessionReactContext.Provider>
    );

    // Opciones colapsadas presentes en el DOM/HTML
    expect(html).toContain("planning-options-details");
    expect(html).toContain("target-week-start-input");
    expect(html).toContain("start-fresh-week-top-button");
    expect(html).toContain("calendar-sync-card");

    // Adición de ideas colapsada presente en el DOM/HTML
    expect(html).toContain("add-more-ideas-details");
    expect(html).toContain("extract-append-button");
  });

  it("12. Selector de proveedor IA reside dentro de Ajustes y no en la superficie principal", () => {
    const html = renderToStaticMarkup(<App service={service} initialTab="capture" />);

    // Selector de proveedor está dentro de Ajustes
    expect(html).toContain('data-testid="settings-dropdown"');
    expect(html).toContain('data-testid="settings-ai-assistant-section"');
    expect(html).toContain('data-testid="provider-select"');
    expect(html).toContain("Asistente de IA");
    expect(html).toContain('data-testid="mock-provider-explanation"');
    expect(html).toContain(
      "Ahora usas el modo de prueba (Mock): no se envía nada a ningún servicio. Elige Groq o Gemini para propuestas con IA real."
    );

    // Config bar en Ideas solo contiene el selector de casos de ejemplo
    expect(html).toContain('data-testid="sample-case-select"');
  });

  it("13. Landing tab se elige según el estado (vacío -> Nueva semana at Escribir, activa -> Mi semana, borrador -> Nueva semana at Revisar)", () => {
    // A) Estado vacío -> aterriza en Nueva semana (nav-tab-new-week) en el paso Escribir
    const emptyState = {
      ...initialWeeklySessionState,
      status: "no_active_session" as const,
      activePlan: null,
      draftPlan: null,
    };
    const htmlEmpty = renderToStaticMarkup(<App service={service} initialState={emptyState} />);
    expect(htmlEmpty).toContain('data-testid="nav-tab-new-week"');
    expect(htmlEmpty).toMatch(
      /<button[^>]*class="[^"]*primary[^"]*"[^>]*data-testid="nav-tab-new-week"/
    );
    expect(htmlEmpty).toContain('data-testid="flow-step-write"');
    expect(htmlEmpty).toContain("Escribe lo que tienes en la cabeza");
    expect(htmlEmpty).not.toContain('data-testid="next-step-button"');

    // B) Semana activa -> aterriza en Mi semana (active)
    const activeState = {
      ...initialWeeklySessionState,
      status: "session_resumed" as const,
      activePlan: {
        planId: "plan-act-1",
        status: "active" as const,
        targetWeek: { startDate: "2026-12-01", endDate: "2026-12-31" },
        proposal: {
          weekSummary: {
            targetWeek: { startDate: "2026-12-01", endDate: "2026-12-31" },
            capacity: {
              totalAvailableHours: 30,
              plannableHours: 22,
              plannedHours: 10,
              knownEstimatedHours: 10,
              estimationCompleteness: "complete" as const,
              protectedSpaceHours: 8,
              capacityStatus: "within_capacity" as const,
              protectedSpaceStatus: "respected" as const,
            },
            intent: "Foco activo",
          },
          foci: [],
          obligations: [],
          flexibleOptions: [],
          deferredItems: [],
          unplannedSpace: { rationale: "margen", recommendedHours: 8 },
          confirmationPrompt: { question: "¿Activar?", keyTradeoffs: [], pendingQuestions: [] },
        },
        createdAt: "2026-10-19T08:00:00Z",
        updatedAt: "2026-10-19T08:00:00Z",
      },
    };
    const htmlActive = renderToStaticMarkup(<App service={service} initialState={activeState} />);
    expect(htmlActive).toMatch(
      /<button[^>]*class="[^"]*primary[^"]*"[^>]*data-testid="nav-tab-active"/
    );
    // En Mi semana con semana activa y nada pendiente, la barra de siguiente paso está oculta
    expect(htmlActive).not.toContain('data-testid="next-step-bar"');

    // C) Borrador pendiente -> aterriza en Nueva semana (nav-tab-new-week) en el paso Revisar
    const draftState = {
      ...initialWeeklySessionState,
      status: "no_active_session" as const,
      activePlan: null,
      draftPlan: {
        planId: "plan-draft-1",
        status: "draft" as const,
        targetWeek: { startDate: "2026-10-26", endDate: "2026-11-01" },
        proposal: {
          weekSummary: {
            targetWeek: { startDate: "2026-10-26", endDate: "2026-11-01" },
            capacity: {
              totalAvailableHours: 30,
              plannableHours: 22,
              plannedHours: 10,
              knownEstimatedHours: 10,
              estimationCompleteness: "complete" as const,
              protectedSpaceHours: 8,
              capacityStatus: "within_capacity" as const,
              protectedSpaceStatus: "respected" as const,
            },
            intent: "Borrador",
          },
          foci: [],
          obligations: [],
          flexibleOptions: [],
          deferredItems: [],
          unplannedSpace: { rationale: "margen", recommendedHours: 8 },
          confirmationPrompt: { question: "¿Activar?", keyTradeoffs: [], pendingQuestions: [] },
        },
        createdAt: "2026-10-26T08:00:00Z",
        updatedAt: "2026-10-26T08:00:00Z",
      },
    };
    const htmlDraft = renderToStaticMarkup(<App service={service} initialState={draftState} />);
    expect(htmlDraft).toMatch(
      /<button[^>]*class="[^"]*primary[^"]*"[^>]*data-testid="nav-tab-new-week"/
    );
    expect(htmlDraft).toContain("Revisa y confirma la propuesta");
    expect(htmlDraft).not.toContain('data-testid="next-step-button"');

    // D) initialTab explícito no es sobreescrito por el estado
    const htmlExplicit = renderToStaticMarkup(
      <App service={service} initialState={emptyState} initialTab="active" />
    );
    expect(htmlExplicit).toMatch(
      /<button[^>]*class="[^"]*primary[^"]*"[^>]*data-testid="nav-tab-active"/
    );
  });

  it("14. Botón de siguiente paso se oculta cuando apunta a la pestaña actual y se muestra cuando navega a otra", () => {
    const emptyState = {
      ...initialWeeklySessionState,
      status: "no_active_session" as const,
      activePlan: null,
      draftPlan: null,
    };

    // En Nueva semana (capture) con target capture -> botón oculto
    const htmlCapture = renderToStaticMarkup(
      <App service={service} initialState={emptyState} initialTab="capture" />
    );
    expect(htmlCapture).toContain("Escribe lo que tienes en la cabeza");
    expect(htmlCapture).not.toContain('data-testid="next-step-button"');

    // En Mi semana con target capture -> botón visible para comenzar semana
    const htmlActiveEmpty = renderToStaticMarkup(
      <App service={service} initialState={emptyState} initialTab="active" />
    );
    expect(htmlActiveEmpty).toContain("Escribe lo que tienes en la cabeza");
    expect(htmlActiveEmpty).toContain('data-testid="next-step-button"');
    expect(htmlActiveEmpty).toContain("Nueva semana →");
  });

  it("15. Balance de capacidad oculta la chapa redundante cuando la capacidad no está configurada", () => {
    const unconfiguredWeek: ProposedWeek = {
      weekSummary: {
        targetWeek: { startDate: "2026-10-19", endDate: "2026-10-25" },
        capacity: {
          totalAvailableHours: null,
          plannableHours: null,
          plannedHours: null,
          knownEstimatedHours: 0,
          estimationCompleteness: "none",
          protectedSpaceHours: null,
          capacityStatus: "unknown",
          protectedSpaceStatus: "unknown",
        },
        intent: "Semana sin capacidad",
      },
      foci: [],
      obligations: [],
      flexibleOptions: [],
      deferredItems: [],
      unplannedSpace: { rationale: "margen", recommendedHours: null },
      confirmationPrompt: { question: "¿Activar?", keyTradeoffs: [], pendingQuestions: [] },
    };

    const html = renderToStaticMarkup(
      <PlanningCapacityHud
        proposedWeek={unconfiguredWeek}
        isEditingCapacity={false}
        setIsEditingCapacity={() => {}}
        availableHoursInput=""
        setAvailableHoursInput={() => {}}
        protectedSpacePercentInput=""
        setProtectedSpacePercentInput={() => {}}
        capacityFeedbackMessage={null}
        onStartEditCapacity={() => {}}
        onCancelEditCapacity={() => {}}
        onVerifyCapacity={() => {}}
      />
    );

    // Muestra la frase limpia
    expect(html).toContain("Aún no has configurado tu capacidad");
    // NO muestra la chapa redundante de Capacidad no configurada
    expect(html).not.toContain('data-testid="planning-capacity-status-summary-badge"');
    expect(html).not.toContain("Capacidad no configurada");
  });

  it("16. Textos actualizados y navegación visible de vuelta en el flujo guiado", async () => {
    await controller.reloadSession();
    const contextVal = createMockContextValue();
    const html = renderToStaticMarkup(
      <WeeklySessionReactContext.Provider value={contextVal}>
        <WeeklySessionView
          provider={mockProvider}
          activeSpace="prepare"
          onNavigateSpace={() => {}}
        />
      </WeeklySessionReactContext.Provider>
    );

    // En Revisar tiene botón para volver a escribir
    expect(html).toContain("← Volver a escribir");
    expect(html).toContain("Elige qué entra en tu semana con calma");
  });

  it("17. Flujo guiado Nueva semana: línea de progreso visible y botones 'Volver' en cada paso", async () => {
    await controller.reloadSession();
    const contextVal = createMockContextValue();

    // Paso 1: Escribir
    const htmlStep1 = renderToStaticMarkup(
      <WeeklySessionReactContext.Provider value={contextVal}>
        <WeeklyPlanningFromNotes provider={mockProvider} initialStep="write" />
      </WeeklySessionReactContext.Provider>
    );
    expect(htmlStep1).toContain("guided-flow-progress");
    expect(htmlStep1).toContain("step-indicator-write");
    expect(htmlStep1).toContain("step-indicator-review");
    expect(htmlStep1).toContain("step-indicator-confirm");
    expect(htmlStep1).toContain("flow-step-write");
    expect(htmlStep1).toContain("flow-continue-to-review");

    // Paso 2: Revisar
    const htmlStep2 = renderToStaticMarkup(
      <WeeklySessionReactContext.Provider value={contextVal}>
        <WeeklyPlanningFromNotes
          provider={mockProvider}
          initialStep="review"
          initialItems={[
            {
              id: "item-1",
              title: "Tarea de prueba",
              rawText: "Hacer tarea",
              type: "task",
              status: "pending",
            },
          ]}
        />
      </WeeklySessionReactContext.Provider>
    );
    expect(htmlStep2).toContain("flow-step-review");
    expect(htmlStep2).toContain("flow-back-to-write");
    expect(htmlStep2).toContain("flow-continue-to-confirm");
    expect(htmlStep2).toContain("idea-card-item-1");
    expect(htmlStep2).toContain("details-toggle-item-1");

    // Paso 3: Confirmar
    const sampleWeek: ProposedWeek = {
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
        intent: "Semana guiada",
      },
      foci: [],
      obligations: [],
      flexibleOptions: [],
      deferredItems: [],
      unplannedSpace: { rationale: "margen", recommendedHours: 5 },
      confirmationPrompt: { question: "¿Activar?", keyTradeoffs: [], pendingQuestions: [] },
    };
    const htmlStep3 = renderToStaticMarkup(
      <WeeklySessionReactContext.Provider value={contextVal}>
        <WeeklyPlanningFromNotes
          provider={mockProvider}
          initialStep="confirm"
          initialProposedWeek={sampleWeek}
        />
      </WeeklySessionReactContext.Provider>
    );
    expect(htmlStep3).toContain("flow-step-confirm");
    expect(htmlStep3).toContain("flow-back-to-review");
    expect(htmlStep3).toContain("confirm-plan-button");
    expect(htmlStep3).toContain("proposal-more-actions-details");
  });

  it("18. Tarjeta de bienvenida de primer uso y reapertura desde Ajustes", () => {
    const html = renderToStaticMarkup(<App service={service} initialTab="active" />);

    // Tarjeta presente por defecto (primer uso)
    expect(html).toContain('data-testid="welcome-card"');
    expect(html).toContain('data-testid="dismiss-welcome-button"');
    expect(html).toContain("Escribe → Revisa → Vive tu semana");

    // Opción para reabrir en Ajustes
    expect(html).toContain('data-testid="settings-welcome-section"');
    expect(html).toContain('data-testid="reopen-welcome-button"');
    expect(html).toContain("Mostrar bienvenida");
  });

  it("19. Ayuda contextual '¿Qué es esto?' en Imprevistos y Recuerdos confirmados", async () => {
    await controller.reloadSession();
    const contextVal = createMockContextValue();
    const htmlActive = renderToStaticMarkup(
      <WeeklySessionReactContext.Provider value={contextVal}>
        <WeeklySessionView provider={mockProvider} activeSpace="active" />
      </WeeklySessionReactContext.Provider>
    );

    // Ayuda en Recuerdos confirmados
    expect(htmlActive).toContain('data-testid="help-memories"');
    expect(htmlActive).toContain("¿Qué es esto?");
    expect(htmlActive).toContain("Patrones, preferencias y aprendizajes confirmados");
  });
});
