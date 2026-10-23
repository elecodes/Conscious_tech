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
import { StoredWeeklyPlan } from "../src/domain/repositories/types";
import { WeeklySchedule } from "../src/domain/schedule";
import { MockProvider } from "../src/providers/mock-provider";

describe("Radar de Imprevistos — Integración en WeeklySessionView (Sección 21-25)", () => {
  const TEST_DB_NAME = "conscious_tech_radar_ui_test_db";

  if (typeof globalThis.IDBKeyRange === "undefined") {
    (globalThis as unknown as { IDBKeyRange: typeof fakeKeyRange }).IDBKeyRange = fakeKeyRange;
  }

  let storage: IndexedDbStorageContext;
  let service: WeeklySessionService;
  let controller: WeeklySessionController;

  const samplePlan: StoredWeeklyPlan = {
    planId: "plan-2026-radar",
    createdAt: "2026-10-12T10:00:00.000Z",
    updatedAt: "2026-10-12T10:00:00.000Z",
    targetWeek: {
      startDate: "2026-10-12",
      endDate: "2026-10-18",
    },
    status: "active",
    proposal: {
      weekSummary: {
        targetWeek: {
          startDate: "2026-10-12",
          endDate: "2026-10-18",
        },
        capacity: {
          totalAvailableHours: 25,
          plannableHours: 18,
          plannedHours: 10,
          knownEstimatedHours: 10,
          estimationCompleteness: "complete",
          protectedSpaceHours: 7,
          capacityStatus: "within_capacity",
          protectedSpaceStatus: "respected",
        },
        intent: "Foco en estabilidad",
      },
      foci: [
        {
          id: "focus-refactor",
          title: "Refactor arquitectura",
          desiredOutcome: "Código limpio",
          rationale: "Foco principal",
          contributingItemIds: ["task-refactor"],
          estimatedHours: 6,
        },
      ],
      obligations: [
        {
          itemId: "task-meet",
          title: "Reunión de seguimiento",
          dueDate: "2026-10-13",
          commitmentType: "external",
          rationale: "Obligación externa",
          estimatedHours: 4,
        },
      ],
      flexibleOptions: [],
      deferredItems: [],
      unplannedSpace: {
        recommendedHours: 7,
        rationale: "Margen de calma",
      },
      confirmationPrompt: {
        question: "¿Refleja este plan tus intenciones reales?",
        keyTradeoffs: [],
        pendingQuestions: [],
      },
    },
  };

  const sampleSchedule: WeeklySchedule = {
    scheduleId: "sched-2026-radar",
    planId: "plan-2026-radar",
    weekRange: {
      startDate: "2026-10-12",
      endDate: "2026-10-18",
    },
    version: 1,
    timeBlocks: [],
    dailyAllocations: [
      { day: "2026-10-12", allocatedHours: 6, itemId: "task-refactor" },
      { day: "2026-10-13", allocatedHours: 4, itemId: "task-meet" },
    ],
    appliedAdjustments: [],
    createdAt: "2026-10-12T10:00:00.000Z",
    updatedAt: "2026-10-12T10:00:00.000Z",
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

    await service.createOrSavePlanAndSchedule(samplePlan, sampleSchedule);
    await controller.reloadSession();
  });

  function createMockContextValue(): WeeklySessionContextValue {
    return {
      state: controller.getSnapshot(),
      service,
      controller,
      reloadSession: () => controller.reloadSession(),
      createOrSavePlan: (p, s) => controller.createOrSavePlan(p, s),
      applyAdjustment: (params) => controller.applyAdjustment(params),
      closeWeek: (params) => controller.closeWeek(params),
      confirmMemoryCandidate: (cand, dec) => controller.confirmMemoryCandidate(cand, dec),
      confirmMemoryOperation: (op, conf) => controller.confirmMemoryOperation(op, conf),
      purgeSession: (id) => controller.purgeSession(id),
      resolveAmbiguity: (id) => controller.resolveAmbiguity(id),
      saveDraftPlan: (p) => controller.saveDraftPlan(p),
      clearDraftPlan: (id) => controller.clearDraftPlan(id),
    };
  }

  it("1. Renderiza la sección Radar en el espacio de semana activa con su título y formulario", () => {
    const contextValue = createMockContextValue();
    const html = renderToStaticMarkup(
      <WeeklySessionReactContext.Provider value={contextValue}>
        <WeeklySessionView activeSpace="active" provider={new MockProvider()} />
      </WeeklySessionReactContext.Provider>
    );

    expect(html).toContain('data-testid="radar-section"');
    expect(html).toContain('data-testid="radar-input"');
    expect(html).toContain('data-testid="radar-evaluate-button"');
    expect(html).toMatch(/Radar: ¿Ha aparecido algo nuevo\?/i);
    expect(html).toMatch(/Expresá lo que surgió o cambió/i);
  });

  it("2. El Radar solo se renderiza en el espacio 'active' (Mi semana) y no invade 'prepare'", () => {
    const contextValue = createMockContextValue();
    const htmlPrepare = renderToStaticMarkup(
      <WeeklySessionReactContext.Provider value={contextValue}>
        <WeeklySessionView activeSpace="prepare" provider={new MockProvider()} />
      </WeeklySessionReactContext.Provider>
    );

    expect(htmlPrepare).not.toContain('data-testid="radar-section"');
  });

  it("3. Aplicar una propuesta del Radar actualiza la agenda e incrementa su versión atómicamente", async () => {
    const { evaluateRadarInput } = await import("../src/application/radar-pipeline");
    const provider = new MockProvider();

    // 15h urgent task that changes balance
    const radarResult = await evaluateRadarInput(provider, {
      changeDescription: "Urgencia de base de datos de 15 horas para el viernes",
      currentDate: "2026-10-14",
      activePlan: samplePlan.proposal,
      dailyAllocations: sampleSchedule.dailyAllocations,
    });

    expect(radarResult.outcome).toBe("changes_balance");
    expect(radarResult.adjustmentProposals).toBeDefined();
    expect(radarResult.adjustmentProposals!.length).toBeGreaterThan(0);

    const firstProposal = radarResult.adjustmentProposals![0]!;
    const primaryAction = firstProposal.actions[0]!;

    // Apply via controller
    const applyRes = await controller.applyAdjustment({
      scheduleId: sampleSchedule.scheduleId,
      proposalId: firstProposal.id,
      adjustmentId: `adj-${Date.now()}`,
      action: primaryAction,
      expectedScheduleVersion: sampleSchedule.version,
      humanDecision: "accepted",
      decidedAt: new Date().toISOString(),
    });

    expect(applyRes.status).toBe("success");
    if (applyRes.status === "success") {
      expect(applyRes.schedule.version).toBe(2);
      expect(applyRes.schedule.appliedAdjustments).toHaveLength(1);
      expect(applyRes.schedule.appliedAdjustments[0]?.action.type).toBe(primaryAction.type);
    }
  });

  it("4. Incorporar elementos del Radar cuando caben en el espacio actualiza el plan y agenda atómicamente", async () => {
    const { evaluateRadarInput } = await import("../src/application/radar-pipeline");
    const provider = new MockProvider();

    // 2h task that fits in available margin (8h margin)
    const radarResult = await evaluateRadarInput(provider, {
      changeDescription: "Aws certification, apps update, job search open possibilities, think Manne substack",
      currentDate: "2026-10-14",
      activePlan: samplePlan.proposal,
      dailyAllocations: sampleSchedule.dailyAllocations,
    });

    expect(radarResult.outcome).toBe("fits_available_space");
    expect(radarResult.extractedItems).toHaveLength(4);

    // Simulate incorporating into plan
    const currentProposal = samplePlan.proposal;
    const newObligations = [...currentProposal.obligations];
    const newFlexible = [...currentProposal.flexibleOptions];

    for (const item of radarResult.extractedItems) {
      const isExternal = item.commitment === "external";
      const hasDeadline = Boolean(item.deadline?.resolved);

      if (isExternal || hasDeadline) {
        newObligations.push({
          itemId: item.id,
          title: item.title,
          ...(item.deadline?.resolved ? { dueDate: item.deadline.resolved } : {}),
          commitmentType: isExternal ? "external" : "strict_deadline",
          rationale: "Incorporado vía Radar de imprevistos",
          estimatedHours: item.estimatedEffort?.value ?? null,
        });
      } else {
        newFlexible.push({
          itemId: item.id,
          title: item.title,
          condition: item.type === "idea" ? "Exploración de idea" : "Si hay espacio",
          estimatedHours: item.estimatedEffort?.value ?? null,
        });
      }
    }

    const updatedPlan: StoredWeeklyPlan = {
      ...samplePlan,
      updatedAt: new Date().toISOString(),
      proposal: {
        ...currentProposal,
        obligations: newObligations,
        flexibleOptions: newFlexible,
      },
    };

    const saveRes = await controller.createOrSavePlan(updatedPlan, sampleSchedule);
    expect(saveRes.status).toBe("success");

    const snapshot = controller.getSnapshot();
    expect(snapshot.activePlan?.proposal.flexibleOptions.length).toBeGreaterThan(0);
  });

  it("5. Incorporar elementos cuando ya existen IDs colisionantes (item-mock-1) no descarta los nuevos elementos", async () => {
    const { extractPlanItems } = await import("../src/web/components/weekly-session-view");

    // Plan that already uses item-mock-1 and item-mock-2
    const collidingPlan: StoredWeeklyPlan = {
      ...samplePlan,
      planId: "plan-colliding",
      proposal: {
        ...samplePlan.proposal,
        foci: [
          {
            id: "f-1",
            title: "Foco principal",
            desiredOutcome: "Completado",
            rationale: "Foco",
            contributingItemIds: ["item-mock-1"],
            estimatedHours: 4,
          },
        ],
        obligations: [
          {
            itemId: "item-mock-2",
            title: "Obligación existente",
            commitmentType: "external",
            rationale: "Externa",
            estimatedHours: 2,
          },
        ],
        flexibleOptions: [],
      },
    };

    const collidingSchedule: WeeklySchedule = {
      ...sampleSchedule,
      scheduleId: "sched-colliding",
      planId: "plan-colliding",
      dailyAllocations: [],
    };

    await service.createOrSavePlanAndSchedule(collidingPlan, collidingSchedule);

    // Initial planItems
    const initialItems = extractPlanItems(collidingPlan, collidingSchedule);
    expect(initialItems).toHaveLength(2);

    // Now simulate incorporating radar items where extracted IDs are item-mock-1 and item-mock-2
    const existingIds = new Set<string>([
      ...collidingPlan.proposal.foci.flatMap((f) => f.contributingItemIds),
      ...collidingPlan.proposal.obligations.map((o) => o.itemId),
    ]);

    const newFlexible = [...collidingPlan.proposal.flexibleOptions];
    let counter = 1;
    for (const rawId of ["item-mock-1", "item-mock-2", "item-mock-3"]) {
      let resolvedId = rawId;
      while (existingIds.has(resolvedId)) {
        resolvedId = `item-radar-${Date.now()}-${counter++}`;
      }
      existingIds.add(resolvedId);
      newFlexible.push({
        itemId: resolvedId,
        title: `Nueva tarea ${rawId}`,
        condition: "Si hay espacio",
        estimatedHours: 1,
      });
    }

    const updatedPlan: StoredWeeklyPlan = {
      ...collidingPlan,
      proposal: {
        ...collidingPlan.proposal,
        flexibleOptions: newFlexible,
      },
    };

    const finalItems = extractPlanItems(updatedPlan, collidingSchedule);
    // Should have 2 initial + 3 new = 5 total items (NONE dropped!)
    expect(finalItems).toHaveLength(5);
  });
});
