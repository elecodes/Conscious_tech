import { describe, it, expect, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { indexedDB as fakeIDB, IDBKeyRange as fakeKeyRange } from "fake-indexeddb";
import { MockProvider } from "../src/providers/mock-provider";
import { extractItems } from "../src/skills/extract-items";
import { TargetWeek } from "../src/domain/week";
import { calculateWeeklyCapacity } from "../src/skills/build-week/deterministic";
import { generateWeeklyProposalFromItemsDetailed } from "../src/application/planning-pipeline";
import { WeeklyPlanningFromNotes } from "../src/web/components/weekly-planning-from-notes";
import {
  WeeklySessionReactContext,
  WeeklySessionContextValue,
  WeeklySessionController,
} from "../src/web/context/weekly-session-context";
import { createIndexedDbStorage, deleteDatabase } from "../src/infrastructure/storage/indexeddb";
import { WeeklySessionService } from "../src/application/weekly-session-service";
import { StoredWeeklyPlan } from "../src/domain/repositories/types";

describe("Prioridad: Continuidad de la propuesta semanal (Borradores, recarga y calibración de capacidad)", () => {
  const currentDate = "2026-10-12";
  const targetWeek: TargetWeek = {
    startDate: "2026-10-19",
    endDate: "2026-10-25",
  };
  const userNote =
    "Preparar el informe trimestral antes del jueves (6 horas). Reunión de alineación con el equipo el martes a las 10 (2 horas). Comprar café.";

  const TEST_DB_NAME = "conscious_tech_draft_continuity_test_db";

  if (typeof globalThis.IDBKeyRange === "undefined") {
    (globalThis as unknown as { IDBKeyRange: typeof fakeKeyRange }).IDBKeyRange = fakeKeyRange;
  }

  beforeEach(async () => {
    await deleteDatabase(TEST_DB_NAME, fakeIDB);
  });

  async function createTestService() {
    const storage = await createIndexedDbStorage({
      dbName: TEST_DB_NAME,
      customFactory: fakeIDB,
    });
    return new WeeklySessionService({
      plans: storage.plans,
      schedules: storage.schedules,
      closeReports: storage.closeReports,
      memories: storage.memories,
      getDb: () => storage.db,
    });
  }

  function createMockSessionContext(
    service: WeeklySessionService,
    controller: WeeklySessionController,
    overrides?: Partial<WeeklySessionContextValue>
  ): WeeklySessionContextValue {
    return {
      state: controller.getSnapshot(),
      service,
      controller,
      reloadSession: () => controller.reloadSession(),
      createOrSavePlan: (plan, schedule) => controller.createOrSavePlan(plan, schedule),
      applyAdjustment: (params) => controller.applyAdjustment(params),
      closeWeek: (params) => controller.closeWeek(params),
      confirmMemoryCandidate: (candidate, decision) =>
        controller.confirmMemoryCandidate(candidate, decision),
      confirmMemoryOperation: (operation, confirmation) =>
        controller.confirmMemoryOperation(operation, confirmation),
      purgeSession: (planId) => controller.purgeSession(planId),
      resolveAmbiguity: (keepPlanId) => controller.resolveAmbiguity(keepPlanId),
      saveDraftPlan: (plan) => controller.saveDraftPlan(plan),
      clearDraftPlan: (planId) => controller.clearDraftPlan(planId),
      ...overrides,
    };
  }

  it("1. Persistencia de borrador: almacena la propuesta como 'draft' en IndexedDB sin activar el plan", async () => {
    const service = await createTestService();
    const provider = new MockProvider();
    const extractionResult = await extractItems(provider, { text: userNote, currentDate });

    const detailedPlan = await generateWeeklyProposalFromItemsDetailed(provider, {
      items: extractionResult.items,
      currentDate,
      targetWeek,
      totalAvailableHours: 20,
      minProtectedSpaceRatio: 0.25,
    });

    const draftPlan: StoredWeeklyPlan = {
      planId: `draft-${targetWeek.startDate}`,
      status: "draft",
      targetWeek,
      proposal: detailedPlan.proposal,
      draftContext: {
        extractedItems: extractionResult.items,
        acceptedItemIds: extractionResult.items.map((i) => i.id),
        availableHoursInput: "20",
        protectedSpacePercentInput: "25",
        overdueDecisions: {},
      },
      createdAt: "2026-10-14T10:00:00.000Z",
      updatedAt: "2026-10-14T10:00:00.000Z",
    };

    const saveResult = await service.saveDraftPlan(draftPlan);
    expect(saveResult.status).toBe("success");

    // Verificar que resumeSession() NO lo confunde con un plan activo
    const resumeResult = await service.resumeSession();
    expect(resumeResult.status).toBe("no_active_session");
    if (resumeResult.status === "no_active_session") {
      expect(resumeResult.draftPlan).not.toBeNull();
      expect(resumeResult.draftPlan?.planId).toBe(`draft-${targetWeek.startDate}`);
      expect(resumeResult.draftPlan?.status).toBe("draft");
      expect(resumeResult.draftPlan?.proposal.weekSummary.capacity.totalAvailableHours).toBe(20);
    }
  });

  it("2. Capacidad configurada: 20h disponibles y 25% margen protegido producen 5h protegidas y 15h planificables", () => {
    const capacity = calculateWeeklyCapacity({
      capacityConfig: {
        totalAvailableHours: 20,
        minProtectedSpaceRatio: 0.25,
      },
      foci: [{ estimatedHours: 6 }],
      obligations: [{ estimatedHours: 2 }],
    });

    expect(capacity.totalAvailableHours).toBe(20);
    expect(capacity.protectedSpaceHours).toBe(5);
    expect(capacity.plannableHours).toBe(15);
    expect(capacity.plannedHours).toBe(8); // 6h informe + 2h reunión
    expect(capacity.capacityStatus).toBe("within_capacity");
    expect(capacity.protectedSpaceStatus).toBe("respected");
    // Capacidad planificable restante = 15 - 8 = 7h
    expect(capacity.plannableHours! - capacity.plannedHours!).toBe(7);
  });

  it("3. Renderizado de propuesta hidratada: muestra 20h disponibles, 15h planificables, 5h protegidas y 7h restantes", async () => {
    const service = await createTestService();
    const controller = new WeeklySessionController(service);

    const provider = new MockProvider();
    const extractionResult = await extractItems(provider, { text: userNote, currentDate });

    const detailedPlan = await generateWeeklyProposalFromItemsDetailed(provider, {
      items: extractionResult.items,
      currentDate,
      targetWeek,
      totalAvailableHours: 20,
      minProtectedSpaceRatio: 0.25,
    });

    const proposalWithRecovery = {
      ...detailedPlan.proposal,
      foci: [
        ...detailedPlan.proposal.foci,
        {
          id: "focus-recovery-item-mock-1",
          title: "Recuperación: Preparar el informe trimestral",
          desiredOutcome: "Completar tarea vencida",
          rationale: "Prioridad de recuperación con fecha original 2026-10-15",
          contributingItemIds: ["item-mock-1"],
          estimatedHours: 6,
        },
      ],
      deferredItems: detailedPlan.proposal.deferredItems.filter((d) => d.itemId !== "item-mock-1"),
      weekSummary: {
        ...detailedPlan.proposal.weekSummary,
        capacity: calculateWeeklyCapacity({
          capacityConfig: { totalAvailableHours: 20, minProtectedSpaceRatio: 0.25 },
          foci: [{ estimatedHours: 6 }],
          obligations: detailedPlan.proposal.obligations,
        }),
      },
    };

    const draftPlan: StoredWeeklyPlan = {
      planId: `draft-${targetWeek.startDate}`,
      status: "draft",
      targetWeek,
      proposal: proposalWithRecovery,
      draftContext: {
        extractedItems: extractionResult.items,
        acceptedItemIds: extractionResult.items.map((i) => i.id),
        availableHoursInput: "20",
        protectedSpacePercentInput: "25",
        overdueDecisions: {
          "item-mock-1": { decision: "include_recovery" },
        },
      },
      createdAt: "2026-10-14T10:00:00.000Z",
      updatedAt: "2026-10-14T10:00:00.000Z",
    };

    await service.saveDraftPlan(draftPlan);

    const mockContext = createMockSessionContext(service, controller, {
      state: {
        ...controller.getSnapshot(),
        status: "no_active_session",
        draftPlan,
      },
    });

    const html = renderToStaticMarkup(
      <WeeklySessionReactContext.Provider value={mockContext}>
        <WeeklyPlanningFromNotes
          provider={provider}
          currentDate={currentDate}
          initialItems={extractionResult.items}
          initialProposedWeek={proposalWithRecovery}
        />
      </WeeklySessionReactContext.Provider>
    );

    // Métricas en la propuesta
    expect(html).toContain("20h");
    expect(html).toContain("15h");
    expect(html).toContain("5h");
    expect(html).toContain("8h");
    expect(html).toContain("7h");
    expect(html).toContain("data-testid=\"planning-remaining-plannable-hours\"");

    // Tarea vencida en recuperación
    expect(html).toContain("Recuperación: Preparar el informe trimestral");
    expect(html).toContain("2026-10-15");

    // Reunión externa
    expect(html).toContain("Reunión de alineación con el equipo");
    expect(html).toContain("2h");

    // Café sin programar
    expect(html).toContain("Comprar café");

    // Botones de acción y estado
    expect(html).toContain("data-testid=\"modify-capacity-button\"");
    expect(html).toContain("Modificar capacidad");
    expect(html).toContain("Confirmar y activar semana");
  });

  it("4. Confirmar y activar semana: promueve el borrador a 'active', elimina el borrador y crea exactamente un plan activo", async () => {
    const service = await createTestService();

    const provider = new MockProvider();
    const extractionResult = await extractItems(provider, { text: userNote, currentDate });

    const detailedPlan = await generateWeeklyProposalFromItemsDetailed(provider, {
      items: extractionResult.items,
      currentDate,
      targetWeek,
      totalAvailableHours: 20,
      minProtectedSpaceRatio: 0.25,
    });

    // Guardar borrador inicial
    const draftPlan: StoredWeeklyPlan = {
      planId: `draft-${targetWeek.startDate}`,
      status: "draft",
      targetWeek,
      proposal: detailedPlan.proposal,
      createdAt: "2026-10-14T10:00:00.000Z",
      updatedAt: "2026-10-14T10:00:00.000Z",
    };
    await service.saveDraftPlan(draftPlan);

    // Verificar que existe el borrador
    const foundDraft = await service.getDraftPlan();
    expect(foundDraft).not.toBeNull();
    expect(foundDraft?.status).toBe("draft");

    // Simular que la persona confirma y activa la semana
    const nowIso = new Date().toISOString();
    const activePlanId = `plan-${targetWeek.startDate}-123`;
    const confirmedPlan: StoredWeeklyPlan = {
      planId: activePlanId,
      status: "active",
      targetWeek,
      proposal: detailedPlan.proposal,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    const confirmResult = await service.createOrSavePlanAndSchedule(confirmedPlan);
    expect(confirmResult.status).toBe("success");

    // Verificar que el borrador fue eliminado
    const draftAfterConfirm = await service.getDraftPlan();
    expect(draftAfterConfirm).toBeNull();

    // Verificar que resumeSession() ahora devuelve la sesión activa de forma limpia
    const resumeResult = await service.resumeSession();
    expect(resumeResult.status).toBe("session_resumed");
    if (resumeResult.status === "session_resumed") {
      expect(resumeResult.state.activePlan?.planId).toBe(activePlanId);
      expect(resumeResult.state.activePlan?.status).toBe("active");
      expect(resumeResult.draftPlan).toBeNull();
    }
  });

  it("5. Guardián de sesión: no permite activar dos semanas concurrentes", async () => {
    const service = await createTestService();

    const plan1: StoredWeeklyPlan = {
      planId: "plan-sem1",
      status: "active",
      targetWeek: { startDate: "2026-10-12", endDate: "2026-10-18" },
      proposal: {
        weekSummary: {
          targetWeek: { startDate: "2026-10-12", endDate: "2026-10-18" },
          capacity: {
            totalAvailableHours: 20,
            plannableHours: 15,
            plannedHours: 5,
            knownEstimatedHours: 5,
            estimationCompleteness: "complete",
            protectedSpaceHours: 5,
            capacityStatus: "within_capacity",
            protectedSpaceStatus: "respected",
          },
        },
        foci: [],
        obligations: [],
        flexibleOptions: [],
        deferredItems: [],
        unplannedSpace: { recommendedHours: 5, rationale: "margen" },
        confirmationPrompt: { question: "¿Aceptas esta propuesta?", keyTradeoffs: [], pendingQuestions: [] },
      },
      createdAt: "2026-10-12T00:00:00.000Z",
      updatedAt: "2026-10-12T00:00:00.000Z",
    };

    await service.createOrSavePlanAndSchedule(plan1);

    const plan2: StoredWeeklyPlan = {
      planId: "plan-sem2",
      status: "active",
      targetWeek: { startDate: "2026-10-19", endDate: "2026-10-25" },
      proposal: {
        ...plan1.proposal,
        weekSummary: {
          ...plan1.proposal.weekSummary,
          targetWeek: { startDate: "2026-10-19", endDate: "2026-10-25" },
        },
      },
      createdAt: "2026-10-19T00:00:00.000Z",
      updatedAt: "2026-10-19T00:00:00.000Z",
    };

    const result2 = await service.createOrSavePlanAndSchedule(plan2);
    expect(result2.status).toBe("conflict_active_plan_exists");
  });
});
