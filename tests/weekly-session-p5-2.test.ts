import { describe, it, expect, beforeEach } from "vitest";
import { indexedDB as fakeIDB, IDBKeyRange as fakeKeyRange } from "fake-indexeddb";
import {
  createIndexedDbStorage,
  deleteDatabase,
  IndexedDbStorageContext,
} from "../src/infrastructure/storage/indexeddb";
import { WeeklySessionService } from "../src/application/weekly-session-service";
import { WeeklySessionController } from "../src/web/context/weekly-session-context";
import {
  formatAdjustmentActionType,
  getAdjustmentTargetItem,
  renderAdjustmentDetails,
} from "../src/web/components/weekly-session-view";
import { StoredWeeklyPlan } from "../src/domain/repositories/types";
import {
  WeeklySchedule,
  ScheduleAdjustmentRecord,
  applyAdjustmentToSchedule,
} from "../src/domain/schedule";
import { ProposedWeek } from "../src/domain/week";
import { SuggestedAdjustmentAction } from "../src/domain/adjustment";

describe("Fase P5.2 — Historial de ajustes visible, trazable y honesto", () => {
  const TEST_DB_NAME = "conscious_tech_p5_2_test_db";

  if (typeof globalThis.IDBKeyRange === "undefined") {
    (globalThis as unknown as { IDBKeyRange: typeof fakeKeyRange }).IDBKeyRange = fakeKeyRange;
  }

  let storage: IndexedDbStorageContext;
  let service: WeeklySessionService;
  let controller: WeeklySessionController;

  const validTargetWeek = {
    startDate: "2026-10-12",
    endDate: "2026-10-18",
  };

  const sampleProposal: ProposedWeek = {
    weekSummary: {
      targetWeek: validTargetWeek,
      capacity: {
        totalAvailableHours: 35,
        plannableHours: 25,
        plannedHours: 15,
        knownEstimatedHours: 15,
        estimationCompleteness: "complete",
        protectedSpaceHours: 10,
        capacityStatus: "within_capacity",
        protectedSpaceStatus: "respected",
      },
      intent: "Semana balanceada para pruebas de ajustes",
    },
    foci: [
      {
        id: "focus-1",
        title: "Foco Principal",
        desiredOutcome: "Resultado deseado",
        rationale: "Foco clave",
        contributingItemIds: ["task-1"],
        estimatedHours: 6,
      },
    ],
    obligations: [
      {
        itemId: "task-sync",
        title: "Reunión de alineación",
        dueDate: "2026-10-13",
        commitmentType: "external",
        rationale: "Sincronización semanal",
        estimatedHours: 2,
      },
    ],
    flexibleOptions: [],
    deferredItems: [],
    unplannedSpace: {
      recommendedHours: 10,
      rationale: "Margen de maniobra",
    },
    confirmationPrompt: {
      question: "¿Aceptas este plan?",
      keyTradeoffs: [],
      pendingQuestions: [],
    },
  };

  const samplePlan: StoredWeeklyPlan = {
    planId: "plan-p5-2",
    status: "active",
    targetWeek: validTargetWeek,
    proposal: sampleProposal,
    createdAt: "2026-10-12T08:00:00Z",
    updatedAt: "2026-10-12T08:00:00Z",
  };

  const baseSchedule: WeeklySchedule = {
    scheduleId: "sched-p5-2",
    planId: "plan-p5-2",
    weekRange: validTargetWeek,
    version: 1,
    timeBlocks: [
      {
        itemId: "task-1",
        day: "2026-10-12",
        startTime: "09:00",
        endTime: "11:00",
      },
      {
        itemId: "task-sync",
        day: "2026-10-13",
        startTime: "10:00",
        endTime: "12:00",
      },
    ],
    dailyAllocations: [
      {
        itemId: "task-1",
        day: "2026-10-12",
        allocatedHours: 2,
      },
      {
        itemId: "task-sync",
        day: "2026-10-13",
        allocatedHours: 2,
      },
    ],
    appliedAdjustments: [],
    createdAt: "2026-10-12T08:00:00Z",
    updatedAt: "2026-10-12T08:00:00Z",
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

  describe("1. Contrato e integridad del ciclo de vida en WeeklySchedule", () => {
    it("debe preservar registros con todas las combinaciones dimensionales en IndexedDB", async () => {
      // Configuramos 5 registros con combinaciones explícitas de las 3 dimensiones:
      // 1. accepted + applied + superseded
      // 2. accepted + applied + active
      // 3. accepted + applied + reverted
      // 4. rejected + failed + active (con failureReason, sin appliedAt)
      // 5. accepted + failed + active (por error de validación)
      const records: ScheduleAdjustmentRecord[] = [
        {
          adjustmentId: "adj-1",
          proposalId: "prop-p5-2-1",
          action: {
            type: "reassign_time_block",
            itemId: "task-1",
            currentBlock: {
              itemId: "task-1",
              day: "2026-10-12",
              startTime: "09:00",
              endTime: "11:00",
            },
            proposedBlock: {
              itemId: "task-1",
              day: "2026-10-12",
              startTime: "14:00",
              endTime: "16:00",
            },
            rationale: "Mover a la tarde por cansancio matutino",
          },
          humanDecision: "accepted",
          applicationOutcome: "applied",
          lifecycleStatus: "superseded",
          decidedAt: "2026-10-12T09:30:00Z",
          appliedAt: "2026-10-12T09:31:00Z",
          expectedScheduleVersion: 1,
          userNotes: "Primer ajuste aprobado",
        },
        {
          adjustmentId: "adj-2",
          proposalId: "prop-p5-2-2",
          action: {
            type: "reassign_time_block",
            itemId: "task-1",
            currentBlock: {
              itemId: "task-1",
              day: "2026-10-12",
              startTime: "14:00",
              endTime: "16:00",
            },
            proposedBlock: {
              itemId: "task-1",
              day: "2026-10-14",
              startTime: "10:00",
              endTime: "12:00",
            },
            rationale: "Pasar al miércoles",
          },
          humanDecision: "accepted",
          applicationOutcome: "applied",
          lifecycleStatus: "active",
          decidedAt: "2026-10-12T11:00:00Z",
          appliedAt: "2026-10-12T11:01:00Z",
          expectedScheduleVersion: 2,
          userNotes: "Segundo ajuste que sustituye al anterior",
        },
        {
          adjustmentId: "adj-3",
          proposalId: "prop-p5-2-3",
          action: {
            type: "postpone_item",
            itemId: "task-sync",
            currentCategory: "obligations",
            targetReason: "intentional_postponement",
            hoursFreed: 2,
            rationale: "Posponer reunión externa",
          },
          humanDecision: "accepted",
          applicationOutcome: "applied",
          lifecycleStatus: "reverted",
          decidedAt: "2026-10-12T11:30:00Z",
          appliedAt: "2026-10-12T11:31:00Z",
          expectedScheduleVersion: 3,
          userNotes: "Ajuste revertido manualmente",
        },
        {
          adjustmentId: "adj-4",
          proposalId: "prop-p5-2-4",
          action: {
            type: "postpone_item",
            itemId: "task-sync",
            currentCategory: "obligations",
            targetReason: "waiting_dependency",
            hoursFreed: 2,
            rationale: "Esperar confirmación",
          },
          humanDecision: "rejected",
          applicationOutcome: "failed",
          lifecycleStatus: "active",
          decidedAt: "2026-10-12T12:00:00Z",
          expectedScheduleVersion: 3,
          failureReason: "La persona rechazó posponer la obligación externa",
          userNotes: "No puedo mover la reunión con el equipo",
        },
        {
          adjustmentId: "adj-5",
          proposalId: "prop-p5-2-5",
          action: {
            type: "reallocate_day_work",
            itemId: "task-1",
            sourceDay: "2026-10-12",
            targetDay: "2026-10-13",
            hoursToMove: 5,
            rationale: "Mover carga",
          },
          humanDecision: "accepted",
          applicationOutcome: "failed",
          lifecycleStatus: "active",
          decidedAt: "2026-10-12T13:00:00Z",
          expectedScheduleVersion: 3,
          failureReason: "Capacidad insuficiente en día destino",
        },
      ];

      const scheduleWithHistory: WeeklySchedule = {
        ...baseSchedule,
        version: 3,
        appliedAdjustments: records,
      };

      await storage.plans.save(samplePlan);
      await storage.schedules.save(scheduleWithHistory);

      // Recuperamos directamente del repositorio IndexedDB
      const loaded = await storage.schedules.getById("sched-p5-2");
      expect(loaded).toBeDefined();
      expect(loaded!.appliedAdjustments).toHaveLength(5);

      // Verificamos dimensiones del primer registro (sustituido)
      const r1 = loaded!.appliedAdjustments[0];
      expect(r1.adjustmentId).toBe("adj-1");
      expect(r1.humanDecision).toBe("accepted");
      expect(r1.applicationOutcome).toBe("applied");
      expect(r1.lifecycleStatus).toBe("superseded");
      expect(r1.appliedAt).toBe("2026-10-12T09:31:00Z");
      expect(r1.userNotes).toBe("Primer ajuste aprobado");

      // Verificamos dimensiones del segundo registro (vigente)
      const r2 = loaded!.appliedAdjustments[1];
      expect(r2.adjustmentId).toBe("adj-2");
      expect(r2.lifecycleStatus).toBe("active");
      expect(r2.applicationOutcome).toBe("applied");

      // Verificamos dimensiones del tercer registro (revertido)
      const r3 = loaded!.appliedAdjustments[2];
      expect(r3.adjustmentId).toBe("adj-3");
      expect(r3.humanDecision).toBe("accepted");
      expect(r3.applicationOutcome).toBe("applied");
      expect(r3.lifecycleStatus).toBe("reverted");

      // Verificamos dimensiones del cuarto registro (rechazado, sin appliedAt, con failureReason)
      const r4 = loaded!.appliedAdjustments[3];
      expect(r4.adjustmentId).toBe("adj-4");
      expect(r4.humanDecision).toBe("rejected");
      expect(r4.applicationOutcome).toBe("failed");
      expect(r4.lifecycleStatus).toBe("active");
      expect(r4.appliedAt).toBeUndefined();
      expect(r4.failureReason).toBe("La persona rechazó posponer la obligación externa");
      expect(r4.userNotes).toBe("No puedo mover la reunión con el equipo");

      // Verificamos dimensiones del quinto registro (aceptado pero falló)
      const r5 = loaded!.appliedAdjustments[4];
      expect(r5.adjustmentId).toBe("adj-5");
      expect(r5.humanDecision).toBe("accepted");
      expect(r5.applicationOutcome).toBe("failed");
      expect(r5.failureReason).toBe("Capacidad insuficiente en día destino");
    });

    it("la skill applyAdjustmentToSchedule debe marcar ajustes previos como 'superseded' al solaparse", () => {
      // 1. Aplicamos primer ajuste
      const action1: SuggestedAdjustmentAction = {
        type: "reassign_time_block",
        itemId: "task-1",
        currentBlock: { itemId: "task-1", day: "2026-10-12", startTime: "09:00", endTime: "11:00" },
        proposedBlock: {
          itemId: "task-1",
          day: "2026-10-12",
          startTime: "14:00",
          endTime: "16:00",
        },
        rationale: "Reasignación inicial",
      };

      const res1 = applyAdjustmentToSchedule(baseSchedule, {
        proposalId: "prop-step-1",
        adjustmentId: "adj-step-1",
        action: action1,
        humanDecision: "accepted",
        expectedScheduleVersion: 1,
        decidedAt: "2026-10-12T09:30:00Z",
      });

      expect(res1.status).toBe("success");
      if (res1.status !== "success") return;
      expect(res1.schedule.version).toBe(2);
      expect(res1.schedule.appliedAdjustments).toHaveLength(1);
      expect(res1.schedule.appliedAdjustments[0].lifecycleStatus).toBe("active");

      // 2. Aplicamos un segundo ajuste sobre el mismo ítem y bloque que solapa/reemplaza
      const action2: SuggestedAdjustmentAction = {
        type: "reassign_time_block",
        itemId: "task-1",
        currentBlock: { itemId: "task-1", day: "2026-10-12", startTime: "14:00", endTime: "16:00" },
        proposedBlock: {
          itemId: "task-1",
          day: "2026-10-14",
          startTime: "09:00",
          endTime: "11:00",
        },
        rationale: "Segunda reasignación",
      };

      const res2 = applyAdjustmentToSchedule(res1.schedule, {
        proposalId: "prop-step-2",
        adjustmentId: "adj-step-2",
        action: action2,
        humanDecision: "accepted",
        expectedScheduleVersion: 2,
        decidedAt: "2026-10-12T11:00:00Z",
      });

      expect(res2.status).toBe("success");
      if (res2.status !== "success") return;
      expect(res2.schedule.version).toBe(3);
      expect(res2.schedule.appliedAdjustments).toHaveLength(2);

      // El primero pasa a superseded
      expect(res2.schedule.appliedAdjustments[0].lifecycleStatus).toBe("superseded");
      // El segundo está activo
      expect(res2.schedule.appliedAdjustments[1].lifecycleStatus).toBe("active");
    });
  });

  describe("2. Ayudantes de UI: formateo y extracción honesta", () => {
    it("formatAdjustmentActionType debe devolver etiquetas descriptivas en español", () => {
      expect(formatAdjustmentActionType("reassign_time_block")).toBe(
        "Reasignación de bloque horario"
      );
      expect(formatAdjustmentActionType("reallocate_day_work")).toBe(
        "Redistribución de esfuerzo diario"
      );
      expect(formatAdjustmentActionType("postpone_item")).toBe("Postergación de tarea");
      expect(formatAdjustmentActionType("unblock_dependency")).toBe("Desbloqueo de dependencia");
      expect(formatAdjustmentActionType("accept_risk")).toBe("Aceptación de riesgo");
      expect(formatAdjustmentActionType("request_information")).toBe("Solicitud de información");
    });

    it("getAdjustmentTargetItem debe extraer el elemento afectado según la variante de la unión", () => {
      // reassign_time_block
      expect(
        getAdjustmentTargetItem({
          type: "reassign_time_block",
          itemId: "task-reassign",
          currentBlock: {
            itemId: "task-reassign",
            day: "2026-10-12",
            startTime: "09:00",
            endTime: "11:00",
          },
          proposedBlock: {
            itemId: "task-reassign",
            day: "2026-10-12",
            startTime: "11:00",
            endTime: "13:00",
          },
          rationale: "Ajuste horario",
        })
      ).toBe("task-reassign");

      // postpone_item
      expect(
        getAdjustmentTargetItem({
          type: "postpone_item",
          itemId: "task-postpone",
          currentCategory: "foci",
          targetReason: "out_of_capacity",
          hoursFreed: 3,
          rationale: "Posponer",
        })
      ).toBe("task-postpone");

      // unblock_dependency
      expect(
        getAdjustmentTargetItem({
          type: "unblock_dependency",
          dependentItemId: "task-dep",
          prerequisiteItemId: "task-pre",
          requiredAction: "Contactar a stakeholder",
          rationale: "Desbloquear tarea",
        })
      ).toBe("task-dep");

      // accept_risk
      expect(
        getAdjustmentTargetItem({
          type: "accept_risk",
          conflictId: "conflict-42",
          toleratedRisk: "Sobrecarga menor",
          rationale: "Tolerar riesgo",
        })
      ).toBe("conflict-42");

      // request_information con targetItemId
      expect(
        getAdjustmentTargetItem({
          type: "request_information",
          targetItemId: "task-info",
          missingField: "estimated_hours",
          question: "¿Cuántas horas estimas?",
        })
      ).toBe("task-info");

      // request_information sin targetItemId
      expect(
        getAdjustmentTargetItem({
          type: "request_information",
          missingField: "capacity_availability",
          question: "¿Cuál es tu disponibilidad real?",
        })
      ).toBe("agenda");
    });

    it("renderAdjustmentDetails debe generar detalles para los diferentes tipos de acción", () => {
      // reassign_time_block
      const elBlock = renderAdjustmentDetails({
        type: "reassign_time_block",
        itemId: "task-1",
        currentBlock: { itemId: "task-1", day: "2026-10-12", startTime: "09:00", endTime: "11:00" },
        proposedBlock: {
          itemId: "task-1",
          day: "2026-10-12",
          startTime: "14:00",
          endTime: "16:00",
        },
        rationale: "Cambio de turno",
      });
      expect(elBlock).toBeDefined();

      // reallocate_day_work
      const elRealloc = renderAdjustmentDetails({
        type: "reallocate_day_work",
        itemId: "task-1",
        sourceDay: "2026-10-12",
        targetDay: "2026-10-13",
        hoursToMove: 2,
        rationale: "Nivelar carga",
      });
      expect(elRealloc).toBeDefined();

      // postpone_item
      const elPostpone = renderAdjustmentDetails({
        type: "postpone_item",
        itemId: "task-1",
        currentCategory: "foci",
        targetReason: "out_of_capacity",
        hoursFreed: 2,
        rationale: "Posponer",
      });
      expect(elPostpone).toBeDefined();

      // unblock_dependency
      const elUnblock = renderAdjustmentDetails({
        type: "unblock_dependency",
        dependentItemId: "task-b",
        prerequisiteItemId: "task-a",
        requiredAction: "Esperar confirmación de API",
        rationale: "Esperar API",
      });
      expect(elUnblock).toBeDefined();

      // accept_risk
      const elRisk = renderAdjustmentDetails({
        type: "accept_risk",
        conflictId: "c-1",
        toleratedRisk: "Posible fatiga el jueves",
        rationale: "Riesgo asumido",
      });
      expect(elRisk).toBeDefined();

      // request_information
      const elReq = renderAdjustmentDetails({
        type: "request_information",
        missingField: "estimated_hours",
        question: "¿Se conoce la duración del evento?",
      });
      expect(elReq).toBeDefined();
    });
  });

  describe("3. Integración con WeeklySessionController y ciclo E2E", () => {
    it("debe reflejar y persistir los ajustes aplicados al actualizar la sesión", async () => {
      await storage.plans.save(samplePlan);
      await storage.schedules.save(baseSchedule);

      await controller.reloadSession();
      expect(controller.getSnapshot().status).toBe("session_resumed");
      expect(controller.getSnapshot().activeSchedule?.appliedAdjustments).toEqual([]);

      // Aplicamos un ajuste mediante el servicio
      const applyResult = await service.applyAdjustment({
        scheduleId: "sched-p5-2",
        proposalId: "prop-controller-1",
        adjustmentId: "adj-controller-1",
        action: {
          type: "reassign_time_block",
          itemId: "task-1",
          currentBlock: {
            itemId: "task-1",
            day: "2026-10-12",
            startTime: "09:00",
            endTime: "11:00",
          },
          proposedBlock: {
            itemId: "task-1",
            day: "2026-10-12",
            startTime: "14:00",
            endTime: "16:00",
          },
          rationale: "Reorganización voluntaria",
        },
        humanDecision: "accepted",
        expectedScheduleVersion: 1,
        decidedAt: "2026-10-12T10:00:00Z",
      });

      expect(applyResult.status).toBe("success");
      if (applyResult.status !== "success") return;

      expect(applyResult.schedule.appliedAdjustments).toHaveLength(1);
      const applied = applyResult.schedule.appliedAdjustments[0];
      expect(applied.lifecycleStatus).toBe("active");
      expect(applied.humanDecision).toBe("accepted");
      expect(applied.applicationOutcome).toBe("applied");

      // Recargamos la sesión desde cero para verificar persistencia duradera
      const freshController = new WeeklySessionController(service);
      await freshController.reloadSession();

      const freshState = freshController.getSnapshot();
      expect(freshState.status).toBe("session_resumed");
      expect(freshState.activeSchedule?.version).toBe(2);
      expect(freshState.activeSchedule?.appliedAdjustments).toHaveLength(1);

      const persisted = freshState.activeSchedule!.appliedAdjustments[0];
      expect(persisted.adjustmentId).toBe("adj-controller-1");
      expect(persisted.humanDecision).toBe("accepted");
      expect(persisted.applicationOutcome).toBe("applied");
      expect(persisted.lifecycleStatus).toBe("active");
      expect(persisted.userNotes).toBeUndefined();
    });
  });
});
