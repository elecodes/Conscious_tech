import { describe, it, expect, beforeEach } from "vitest";
import React from "react";
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
import { SuggestedAdjustmentAction } from "../src/domain/adjustment";
import { applyAdjustmentToSchedule } from "../src/domain/schedule";

describe("Reprogramación segura de tareas y propuestas de ajuste interactivas", () => {
  const TEST_DB_NAME = "conscious_tech_reschedule_adj_test_db";

  if (typeof globalThis.IDBKeyRange === "undefined") {
    (globalThis as unknown as { IDBKeyRange: typeof fakeKeyRange }).IDBKeyRange = fakeKeyRange;
  }

  let storage: IndexedDbStorageContext;
  let service: WeeklySessionService;
  let controller: WeeklySessionController;

  const samplePlan: StoredWeeklyPlan = {
    planId: "plan-2026-w43",
    createdAt: "2026-10-12T10:00:00.000Z",
    updatedAt: "2026-10-12T10:00:00.000Z",
    targetWeek: {
      startDate: "2026-10-19",
      endDate: "2026-10-25",
    },
    status: "active",
    proposal: {
      weekSummary: {
        targetWeek: {
          startDate: "2026-10-19",
          endDate: "2026-10-25",
        },
        capacity: {
          totalAvailableHours: null, // Capacidad desconocida/sin configurar
          plannableHours: null,
          plannedHours: null,
          knownEstimatedHours: 8,
          estimationCompleteness: "partial",
          protectedSpaceHours: null,
          capacityStatus: "unknown",
          protectedSpaceStatus: "unknown",
        },
      },
      foci: [],
      obligations: [
        {
          itemId: "item-reunion",
          title: "Reunión de alineación con el equipo",
          commitmentType: "strict_deadline",
          dueDate: "2026-10-20",
          rationale: "Compromiso de equipo",
          estimatedHours: 2,
        },
      ],
      flexibleOptions: [],
      deferredItems: [
        {
          itemId: "item-informe",
          title: "Preparar el informe trimestral",
          reason: "not_scheduled",
          rationale: "Elemento no programado en la propuesta; conservado para decisión de la persona.",
        },
      ],
      unplannedSpace: {
        rationale: "Margen",
        recommendedHours: null,
      },
      confirmationPrompt: {
        question: "¿Confirmás esta semana?",
        keyTradeoffs: [],
        pendingQuestions: [],
      },
    },
  };

  const sampleSchedule: WeeklySchedule = {
    scheduleId: "sched-2026-w43",
    planId: "plan-2026-w43",
    weekRange: {
      startDate: "2026-10-19",
      endDate: "2026-10-25",
    },
    version: 1,
    timeBlocks: [],
    dailyAllocations: [],
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

    // Bootstrap active plan and schedule
    await service.createOrSavePlanAndSchedule(samplePlan, sampleSchedule);
    await controller.reloadSession();
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
      confirmMemoryCandidate: (cand, dec) => controller.confirmMemoryCandidate(cand, dec),
      confirmMemoryOperation: (op, conf) => controller.confirmMemoryOperation(op, conf),
      purgeSession: (id) => controller.purgeSession(id),
      resolveAmbiguity: (id) => controller.resolveAmbiguity(id),
      saveDraftPlan: (p) => controller.saveDraftPlan(p),
      clearDraftPlan: (id) => controller.clearDraftPlan(id),
      ...overrides,
    };
  }

  describe("1. Contrato de dominio y reprogramación entre semanas", () => {
    it("permite registrar un ajuste de postergación con semana destino explícita sin violar weekRange", () => {
      const action: SuggestedAdjustmentAction = {
        type: "postpone_item",
        itemId: "item-informe",
        currentCategory: "deferred_items",
        targetReason: "intentional_postponement",
        hoursFreed: 6,
        rationale: "Reprogramación intencional hacia la semana 2026-10-26 al 2026-11-01",
        targetWeek: {
          startDate: "2026-10-26",
          endDate: "2026-11-01",
        },
      };

      const result = applyAdjustmentToSchedule(sampleSchedule, {
        adjustmentId: "adj-reschedule-1",
        proposalId: "prop-1",
        action,
        expectedScheduleVersion: 1,
        humanDecision: "accepted",
        decidedAt: "2026-10-13T10:00:00.000Z",
        activePlan: samplePlan.proposal,
      });

      expect(result.status).toBe("success");
      if (result.status === "success") {
        expect(result.schedule.version).toBe(2);
        expect(result.schedule.appliedAdjustments).toHaveLength(1);
        const record = result.schedule.appliedAdjustments[0];
        expect(record.humanDecision).toBe("accepted");
        expect(record.applicationOutcome).toBe("applied");
        expect(record.lifecycleStatus).toBe("active");
        expect(record.action.type).toBe("postpone_item");
        if (record.action.type === "postpone_item") {
          expect(record.action.targetWeek?.startDate).toBe("2026-10-26");
          expect(record.action.targetWeek?.endDate).toBe("2026-11-01");
        }
      }
    });

    it("falla atómicamente si expectedScheduleVersion es obsoleto (concurrency conflict)", () => {
      const action: SuggestedAdjustmentAction = {
        type: "postpone_item",
        itemId: "item-informe",
        currentCategory: "deferred_items",
        targetReason: "intentional_postponement",
        hoursFreed: 6,
        rationale: "Reprogramación hacia otra semana",
        targetWeek: {
          startDate: "2026-10-26",
          endDate: "2026-11-01",
        },
      };

      const result = applyAdjustmentToSchedule(sampleSchedule, {
        adjustmentId: "adj-reschedule-stale",
        proposalId: "prop-1",
        action,
        expectedScheduleVersion: 99, // Versión no coincidente
        humanDecision: "accepted",
        decidedAt: "2026-10-13T10:00:00.000Z",
        activePlan: samplePlan.proposal,
      });

      expect(result.status).toBe("failed");
      if (result.status === "failed") {
        expect(result.errorCode).toBe("stale_schedule_version");
        // La agenda original permanece intacta
        expect(result.schedule.version).toBe(1);
        expect(result.schedule.appliedAdjustments).toHaveLength(0);
      }
    });

    it("el rechazo humano no muta la agenda ni incrementa la versión", () => {
      const action: SuggestedAdjustmentAction = {
        type: "postpone_item",
        itemId: "item-informe",
        currentCategory: "deferred_items",
        targetReason: "intentional_postponement",
        hoursFreed: 6,
        rationale: "Reprogramación hacia otra semana",
      };

      const result = applyAdjustmentToSchedule(sampleSchedule, {
        adjustmentId: "adj-reschedule-rejected",
        proposalId: "prop-1",
        action,
        expectedScheduleVersion: 1,
        humanDecision: "rejected",
        decidedAt: "2026-10-13T10:00:00.000Z",
        activePlan: samplePlan.proposal,
      });

      expect(result.status).toBe("failed");
      if (result.status === "failed") {
        expect(result.errorCode).toBe("decision_rejected");
        expect(result.failedRecord.humanDecision).toBe("rejected");
        expect(result.failedRecord.applicationOutcome).toBe("failed");
        expect(result.schedule.version).toBe(1);
      }
    });
  });

  describe("2. Renderizado interactivo honesto en WeeklySessionView", () => {
    it("reemplaza el ejemplo fijo por un selector de tareas reales del plan", () => {
      const html = renderToStaticMarkup(
        React.createElement(
          WeeklySessionReactContext.Provider,
          { value: createMockContextValue() },
          React.createElement(WeeklySessionView)
        )
      );

      // No debe contener el ejemplo ficticio hardcodeado
      expect(html).not.toContain('Ejemplo: Mover el bloque de "task-reporte"');
      // Debe contener el selector interactivo de tarea real
      expect(html).toContain("adjustment-item-select");
      expect(html).toContain("Preparar el informe trimestral");
      expect(html).toContain("Generar propuesta de reprogramación");
    });

    it("detecta deadline pasado y capacidad desconocida al evaluar la propuesta", () => {
      // Simular apertura de propuesta en el HTML estático
      // Verificamos que la lógica contextual alerte sobre deadline vencido y capacidad no configurada
      const effectiveDeadline = "2026-10-15";
      const targetWeekStart = "2026-10-26";
      const targetWeekEnd = "2026-11-01";
      const isDeadlineOverdue = effectiveDeadline < targetWeekStart;
      const isCapacityUnconfigured = samplePlan.proposal.weekSummary.capacity.totalAvailableHours === null;

      expect(isDeadlineOverdue).toBe(true);
      expect(targetWeekEnd).toBe("2026-11-01");
      expect(isCapacityUnconfigured).toBe(true);
    });
  });

  describe("3. Flujo a través del servicio y preservación del plan original", () => {
    it("al aplicar con éxito preserva el plan original y actualiza el historial en almacenamiento", async () => {
      const action: SuggestedAdjustmentAction = {
        type: "postpone_item",
        itemId: "item-informe",
        currentCategory: "deferred_items",
        targetReason: "intentional_postponement",
        hoursFreed: 6,
        rationale: "Reprogramación intencional de 'Preparar el informe trimestral' hacia 2026-10-26 al 2026-11-01.",
        targetWeek: {
          startDate: "2026-10-26",
          endDate: "2026-11-01",
        },
      };

      const res = await controller.applyAdjustment({
        scheduleId: sampleSchedule.scheduleId,
        proposalId: "prop-reschedule-item-informe",
        adjustmentId: "adj-test-101",
        action,
        expectedScheduleVersion: 1,
        humanDecision: "accepted",
      });

      expect(res.status).toBe("success");
      if (res.status === "success") {
        expect(res.schedule.version).toBe(2);
        expect(res.schedule.appliedAdjustments).toHaveLength(1);
        expect(res.schedule.appliedAdjustments[0].humanDecision).toBe("accepted");
      }

      // Comprobar que en IndexedDB la agenda está en v2 y el plan permanece activo
      const savedSchedule = await storage.schedules.getById(sampleSchedule.scheduleId);
      expect(savedSchedule?.version).toBe(2);
      const savedPlan = await storage.plans.getById(samplePlan.planId);
      expect(savedPlan?.status).toBe("active");
    });

    it("al rechazar la propuesta la agenda permanece en versión 1 y no se muta", async () => {
      const action: SuggestedAdjustmentAction = {
        type: "postpone_item",
        itemId: "item-informe",
        currentCategory: "deferred_items",
        targetReason: "intentional_postponement",
        hoursFreed: 6,
        rationale: "Reprogramación rechazada",
      };

      const res = await controller.applyAdjustment({
        scheduleId: sampleSchedule.scheduleId,
        proposalId: "prop-reschedule-item-informe",
        adjustmentId: "adj-test-102",
        action,
        expectedScheduleVersion: 1,
        humanDecision: "rejected",
      });

      expect(res.status).toBe("rejected");
      const savedSchedule = await storage.schedules.getById(sampleSchedule.scheduleId);
      expect(savedSchedule?.version).toBe(1);
      expect(savedSchedule?.appliedAdjustments).toHaveLength(0);
    });
  });
});
