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
import { StoredWeeklyPlan, StoredCloseWeekReport } from "../src/domain/repositories/types";

describe("WeeklySessionView — Inspección y Reapertura de Semana Cerrada", () => {
  const TEST_DB_NAME = "conscious_tech_closed_week_view_test_db";

  if (typeof globalThis.IDBKeyRange === "undefined") {
    (globalThis as unknown as { IDBKeyRange: typeof fakeKeyRange }).IDBKeyRange = fakeKeyRange;
  }

  let storage: IndexedDbStorageContext;
  let service: WeeklySessionService;
  let controller: WeeklySessionController;

  const closedPlan: StoredWeeklyPlan = {
    planId: "plan-2026-10-12",
    status: "closed",
    targetWeek: { startDate: "2026-10-12", endDate: "2026-10-18" },
    proposal: {
      weekSummary: {
        targetWeek: { startDate: "2026-10-12", endDate: "2026-10-18" },
        capacity: {
          totalAvailableHours: 30,
          plannableHours: 22.5,
          plannedHours: 16,
          knownEstimatedHours: 16,
          estimationCompleteness: "complete",
          protectedSpaceHours: 7.5,
          capacityStatus: "within_capacity",
          protectedSpaceStatus: "respected",
        },
        intent: "Semana de arquitectura sólida",
      },
      foci: [
        {
          id: "focus-1",
          title: "Refactorizar almacenamiento",
          desiredOutcome: "Persistencia atómica",
          rationale: "Foco clave",
          contributingItemIds: ["item-1"],
          estimatedHours: 8,
        },
      ],
      obligations: [
        {
          itemId: "item-2",
          title: "Reunión de equipo",
          dueDate: "2026-10-14",
          commitmentType: "external",
          rationale: "Compromiso fijo",
          estimatedHours: 2,
        },
      ],
      flexibleOptions: [
        {
          itemId: "item-3",
          title: "Lectura técnica",
          condition: "Si sobra tiempo",
          estimatedHours: 2,
        },
      ],
      deferredItems: [],
      unplannedSpace: { recommendedHours: 7.5, rationale: "Espacio protegido" },
      confirmationPrompt: { question: "¿Representa tu plan?", keyTradeoffs: [], pendingQuestions: [] },
    },
    createdAt: "2026-10-12T00:00:00.000Z",
    updatedAt: "2026-10-18T23:59:59.000Z",
  };

  const storedCloseReport: StoredCloseWeekReport = {
    reportId: "close-plan-2026-10-12-2026-10-18",
    planId: "plan-2026-10-12",
    closedAt: "2026-10-18T23:59:59.000Z",
    output: {
      status: "success",
      closedAt: "2026-10-18T23:59:59.000Z",
      weekRange: { startDate: "2026-10-12", endDate: "2026-10-18" },
      fociOutcomes: [
        {
          focusId: "focus-1",
          title: "Refactorizar almacenamiento",
          outcome: "achieved",
          contributingItemIds: ["item-1"],
          completedItemIds: ["item-1"],
          pendingItemIds: [],
          unreportedItemIds: [],
        },
      ],
      obligationsOutcomes: [
        {
          itemId: "item-2",
          title: "Reunión de equipo",
          outcome: "completed",
          dueDate: "2026-10-14",
        },
      ],
      classifiedItems: [
        {
          itemId: "item-1",
          title: "Implementar transacciones IndexedDB",
          originCategory: "focus",
          finalDisposition: "completed",
          estimatedHours: 8,
          actualHours: 7.5,
          isReported: true,
          userNotes: "Completado sin contratiempos",
        },
      ],
      itemDispositions: {
        completed: ["item-1"],
        carryOverCandidates: [],
        dropped: [],
        unreported: [],
      },
      capacityAnalysis: {
        status: "complete",
        totalPlannedHours: 16,
        totalActualHours: 7.5,
        reportedHoursItemCount: 1,
        totalPlanItemCount: 1,
        protectedSpaceHours: 7.5,
        spaceRespected: true,
        explanation: "La capacidad y el espacio protegido fueron respetados.",
      },
      memoryCandidates: [],
      reflectiveSummary: {
        headline: "Excelente cierre de semana",
        accomplishments: ["Almacenamiento transaccional completado"],
        inProgressWork: [],
        consciousPostponements: [],
        droppedItems: [],
        unreportedItems: [],
        questionsForNextCycle: ["¿Cómo monitorear el tamaño de la base de datos?"],
      },
      warnings: [],
    },
  };

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
  });

  it("renderiza la tarjeta de última semana cerrada con botones para ver detalle y reabrir semana", async () => {
    const mockContextValue: WeeklySessionContextValue = {
      state: {
        status: "no_active_session",
        activePlan: null,
        activeSchedule: null,
        latestCloseReport: storedCloseReport,
        latestClosedPlan: closedPlan,
        latestClosedWeek: {
          plan: closedPlan,
          closeReport: storedCloseReport,
          schedule: null,
        },
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
      reloadSession: () => Promise.resolve(),
      createOrSavePlan: () => Promise.resolve({ status: "success", plan: closedPlan, schedule: null }),
      applyAdjustment: () => Promise.resolve({ status: "rejected", schedule: null as any, reason: "none" }),
      closeWeek: () => Promise.resolve({ status: "success", closeReport: storedCloseReport, memoryCandidates: [] }),
      reopenWeek: (id) => controller.reopenWeek(id),
      confirmMemoryCandidate: () => Promise.resolve({ status: "rejected", reason: "none" }),
      confirmMemoryOperation: () => Promise.resolve({ status: "rejected", reason: "none" }),
      purgeSession: () => Promise.resolve({ status: "success", purgedPlanId: "none" }),
      resolveAmbiguity: () => Promise.resolve(),
      saveDraftPlan: () => Promise.resolve({ status: "success", plan: closedPlan }),
      clearDraftPlan: () => Promise.resolve(),
    };

    const html = renderToStaticMarkup(
      <WeeklySessionReactContext.Provider value={mockContextValue}>
        <WeeklySessionView />
      </WeeklySessionReactContext.Provider>
    );

    expect(html).toContain("Última semana cerrada");
    expect(html).toContain("2026-10-12 al 2026-10-18");
    expect(html).toContain("Semana de arquitectura sólida");
    expect(html).toContain("Excelente cierre de semana");
    expect(html).toContain("data-testid=\"toggle-closed-week-details\"");
    expect(html).toContain("Ver detalle de la semana");
    expect(html).toContain("data-testid=\"reopen-closed-week-button\"");
    expect(html).toContain("Reabrir semana para modificar");
  });

  it("reabrir la semana cerrada a través del controller la reactiva y elimina el informe de cierre", async () => {
    await storage.plans.save(closedPlan);
    await storage.closeReports.save(storedCloseReport);

    const initialResume = await service.resumeSession();
    expect(initialResume.status).toBe("no_active_session");

    // Ejecutar reapertura a través del controller
    const reopenRes = await controller.reopenWeek(closedPlan.planId);
    expect(reopenRes.status).toBe("success");

    // Verificar nuevo estado en el controller
    const currentSnapshot = controller.getSnapshot();
    expect(currentSnapshot.status).toBe("session_resumed");
    expect(currentSnapshot.activePlan?.planId).toBe(closedPlan.planId);
    expect(currentSnapshot.activePlan?.status).toBe("active");

    // Verificar en base de datos
    const planInDb = await storage.plans.getById(closedPlan.planId);
    expect(planInDb?.status).toBe("active");
    const closeReportInDb = await storage.closeReports.getByPlanId(closedPlan.planId);
    expect(closeReportInDb).toBeNull();
  });

  it("recupera memorias activas incluso cuando no hay semana activa (status: no_active_session)", async () => {
    await storage.plans.save(closedPlan);
    await storage.closeReports.save(storedCloseReport);
    await storage.memories.save({
      id: "mem-closed-test-1",
      content: "Arquitectura hexagonal primero",
      category: "decision",
      confirmationStatus: "confirmed",
      temporalStatus: "active",
      tags: [],
      provenance: { source: "user_explicit", referenceText: "Nota de cierre" },
      validUntil: null,
      createdAt: "2026-10-18",
    });

    const resumeResult = await service.resumeSession();
    expect(resumeResult.status).toBe("no_active_session");
    if (resumeResult.status === "no_active_session") {
      expect(resumeResult.memories).toHaveLength(1);
      expect(resumeResult.memories?.[0]?.content).toBe("Arquitectura hexagonal primero");
    }

    await controller.reloadSession();
    const snapshot = controller.getSnapshot();
    expect(snapshot.status).toBe("no_active_session");
    expect(snapshot.memories).toHaveLength(1);
    expect(snapshot.memories[0]?.content).toBe("Arquitectura hexagonal primero");
  });

  it("renderiza candidatos de memoria pendientes en el espacio de revisión cuando no hay semana activa", () => {
    const candidateContextValue: WeeklySessionContextValue = {
      state: {
        status: "no_active_session",
        activePlan: null,
        activeSchedule: null,
        latestClosedPlan: closedPlan,
        latestCloseReport: storedCloseReport,
        latestClosedWeek: {
          plan: closedPlan,
          closeReport: storedCloseReport,
          schedule: null,
        },
        concurrencyConflict: null,
        memories: [],
        memoryCandidates: [
          {
            candidateId: "cand-review-1",
            actionIntent: "store",
            rawText: "Postergación deliberada de tareas no urgentes",
            suggestedCategory: "decision",
            isExplicitUserStatement: false,
            provenanceSource: "plan_decision",
          },
        ],
        ambiguousPlanIds: [],
        inconsistencyReason: null,
        errorMessage: null,
        draftPlan: null,
        draftPlans: [],
      },
      service,
      controller,
      reloadSession: () => Promise.resolve(),
      createOrSavePlan: () => Promise.resolve({ status: "success", plan: closedPlan, schedule: null }),
      applyAdjustment: () => Promise.resolve({ status: "rejected", schedule: null as any, reason: "none" }),
      closeWeek: () => Promise.resolve({ status: "success", closeReport: storedCloseReport, memoryCandidates: [] }),
      reopenWeek: (id) => controller.reopenWeek(id),
      confirmMemoryCandidate: () => Promise.resolve({ status: "rejected", reason: "none" }),
      confirmMemoryOperation: () => Promise.resolve({ status: "rejected", reason: "none" }),
      purgeSession: () => Promise.resolve({ status: "success", purgedPlanId: "none" }),
      resolveAmbiguity: () => Promise.resolve(),
      saveDraftPlan: () => Promise.resolve({ status: "success", plan: closedPlan }),
      clearDraftPlan: () => Promise.resolve(),
      archiveMemory: () => Promise.resolve(),
      deleteMemory: () => Promise.resolve(),
      exportBackup: () => Promise.resolve({} as any),
      importBackup: () => Promise.resolve({ status: "success", importedCounts: { plans: 0, schedules: 0, closeReports: 0, memories: 0 }, exportedAt: "2026-10-18T00:00:00.000Z" }),
    };

    const html = renderToStaticMarkup(
      <WeeklySessionReactContext.Provider value={candidateContextValue}>
        <WeeklySessionView activeSpace="review" />
      </WeeklySessionReactContext.Provider>
    );

    expect(html).toContain("Candidatos de memoria pendientes de decisión");
    expect(html).toContain("Postergación deliberada de tareas no urgentes");
    expect(html).toContain("Decisión consciente");
    expect(html).toContain("Decisión de la semana");
    expect(html).not.toContain("plan_decision");
    expect(html).not.toContain("user_explicit");
    expect(html).toContain("Guardar en memoria");
    expect(html).toContain("Descartar");
  });
});

