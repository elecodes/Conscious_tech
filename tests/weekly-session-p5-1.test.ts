import { describe, it, expect, beforeEach } from "vitest";
import { indexedDB as fakeIDB, IDBKeyRange as fakeKeyRange } from "fake-indexeddb";
import {
  createIndexedDbStorage,
  deleteDatabase,
  IndexedDbStorageContext,
} from "../src/infrastructure/storage/indexeddb";
import { WeeklySessionService } from "../src/application/weekly-session-service";
import { WeeklySessionController } from "../src/web/context/weekly-session-context";
import { extractPlanItems } from "../src/web/components/weekly-session-view";
import { StoredWeeklyPlan, StoredCloseWeekReport } from "../src/domain/repositories/types";
import { WeeklySchedule } from "../src/domain/schedule";
import { ProposedWeek } from "../src/domain/week";
import { ItemOutcomeInput } from "../src/domain/close-week";

describe("Fase P5.1 — Continuidad del cierre y disposiciones honestas", () => {
  const TEST_DB_NAME = "conscious_tech_p5_1_test_db";

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
      intent: "Semana balanceada con margen de respiro",
    },
    foci: [
      {
        id: "focus-p5",
        title: "Entrega de Cierre",
        desiredOutcome: "Ciclo cerrado con honestidad",
        rationale: "Foco principal",
        contributingItemIds: ["task-reporte", "task-code"],
        estimatedHours: 8,
      },
    ],
    obligations: [
      {
        itemId: "task-sync",
        title: "Sincronización semanal",
        dueDate: "2026-10-13",
        commitmentType: "external",
        rationale: "Reunión de alineación",
        estimatedHours: 2,
      },
    ],
    flexibleOptions: [
      {
        itemId: "task-reading",
        title: "Lectura técnica",
        condition: "Si sobra energía",
        estimatedHours: 3,
      },
    ],
    deferredItems: [
      {
        itemId: "task-backlog",
        title: "Refactor antiguo",
        reason: "archived",
        rationale: "No prioritario",
      },
    ],
    unplannedSpace: {
      recommendedHours: 10,
      rationale: "Espacio no planificado",
    },
    confirmationPrompt: {
      question: "¿Aceptas este plan?",
      keyTradeoffs: [],
      pendingQuestions: [],
    },
  };

  const samplePlan: StoredWeeklyPlan = {
    planId: "plan-p5-1",
    status: "active",
    targetWeek: validTargetWeek,
    proposal: sampleProposal,
    createdAt: "2026-10-12T08:00:00Z",
    updatedAt: "2026-10-12T08:00:00Z",
  };

  const sampleSchedule: WeeklySchedule = {
    scheduleId: "sched-p5-1",
    planId: samplePlan.planId,
    weekRange: validTargetWeek,
    version: 1,
    timeBlocks: [
      {
        itemId: "task-reporte",
        day: "2026-10-12",
        startTime: "09:00",
        endTime: "11:00",
      },
    ],
    dailyAllocations: [
      { day: "2026-10-12", allocatedHours: 2, itemId: "task-reporte" },
      { day: "2026-10-13", allocatedHours: 2, itemId: "task-sync" },
    ],
    appliedAdjustments: [],
    createdAt: "2026-10-12T08:00:00Z",
    updatedAt: "2026-10-12T08:00:00Z",
  };

  beforeEach(async () => {
    await deleteDatabase(TEST_DB_NAME, fakeIDB);
    storage = await createIndexedDbStorage({ dbName: TEST_DB_NAME, customFactory: fakeIDB });
    service = new WeeklySessionService({
      plans: storage.plans,
      schedules: storage.schedules,
      closeReports: storage.closeReports,
      memories: storage.memories,
      getDb: () => storage.db,
    });
    controller = new WeeklySessionController(service);
  });

  // ==========================================================================
  // PARTE 1: Recuperación del último cierre (6 pruebas)
  // ==========================================================================
  describe("1. Recuperación del último cierre", () => {
    it("1.1. Sin historial previo ni plan activo: resumeSession() retorna no_active_session con latestClosedWeek en null", async () => {
      const result = await service.resumeSession();
      expect(result.status).toBe("no_active_session");
      if (result.status === "no_active_session") {
        expect(result.state).toBeNull();
        expect(result.latestClosedWeek).toBeNull();
      }

      await controller.reloadSession();
      const snap = controller.getSnapshot();
      expect(snap.status).toBe("no_active_session");
      expect(snap.activePlan).toBeNull();
      expect(snap.latestClosedWeek).toBeNull();
    });

    it("1.2. Con una semana cerrada y sin plan activo: recupera latestClosedWeek con plan, reporte y agenda", async () => {
      // Crear y cerrar la semana
      await service.createOrSavePlanAndSchedule(samplePlan, sampleSchedule);
      const closeRes = await service.closeCurrentWeek({
        planId: samplePlan.planId,
        closedAt: "2026-10-18T18:00:00Z",
        itemOutcomes: [{ itemId: "task-reporte", status: "completed" }],
      });
      expect(closeRes.status).toBe("success");

      // Reanudar sesión (no hay planes activos pues el estado pasó a 'closed')
      const result = await service.resumeSession();
      expect(result.status).toBe("no_active_session");
      if (result.status === "no_active_session") {
        expect(result.latestClosedWeek).not.toBeNull();
        expect(result.latestClosedWeek?.plan.planId).toBe(samplePlan.planId);
        expect(result.latestClosedWeek?.plan.status).toBe("closed");
        expect(result.latestClosedWeek?.closeReport.closedAt).toBe("2026-10-18T18:00:00Z");
        expect(result.latestClosedWeek?.schedule?.scheduleId).toBe(sampleSchedule.scheduleId);
      }

      // El controlador expone latestClosedWeek bajo no_active_session
      await controller.reloadSession();
      const snap = controller.getSnapshot();
      expect(snap.status).toBe("no_active_session");
      expect(snap.latestClosedWeek?.plan.planId).toBe(samplePlan.planId);
      expect(snap.latestCloseReport?.closedAt).toBe("2026-10-18T18:00:00Z");
    });

    it("1.3. Orden determinista ante múltiples cierres: selecciona el reporte con closedAt más reciente y tie-break por reportId desc", async () => {
      // Guardar dos planes cerrados
      const planWeek1: StoredWeeklyPlan = {
        ...samplePlan,
        planId: "plan-w1",
        status: "closed",
        targetWeek: { startDate: "2026-10-05", endDate: "2026-10-11" },
      };
      const planWeek2: StoredWeeklyPlan = {
        ...samplePlan,
        planId: "plan-w2",
        status: "closed",
        targetWeek: { startDate: "2026-10-12", endDate: "2026-10-18" },
      };
      await storage.plans.save(planWeek1);
      await storage.plans.save(planWeek2);

      // Reporte 1 (más antiguo)
      const reportW1: StoredCloseWeekReport = {
        reportId: "close-w1-2026-10-11T18:00:00Z",
        planId: "plan-w1",
        closedAt: "2026-10-11T18:00:00Z",
        output: {
          status: "success",
          closedAt: "2026-10-11T18:00:00Z",
          weekRange: planWeek1.targetWeek,
          fociOutcomes: [],
          obligationsOutcomes: [],
          classifiedItems: [],
          itemDispositions: { completed: ["task-1"], carryOverCandidates: [], dropped: [], unreported: [] },
          capacityAnalysis: {
            status: "complete",
            totalPlannedHours: 10,
            totalActualHours: 10,
            reportedHoursItemCount: 1,
            totalPlanItemCount: 1,
            protectedSpaceHours: 5,
            spaceRespected: true,
            explanation: "OK",
          },
          memoryCandidates: [],
          reflectiveSummary: {
            headline: "Semana 1 cerrada",
            accomplishments: [],
            inProgressWork: [],
            consciousPostponements: [],
            droppedItems: [],
            unreportedItems: [],
            questionsForNextCycle: [],
          },
          warnings: [],
        },
      };

      // Reporte 2 (más reciente)
      const reportW2: StoredCloseWeekReport = {
        reportId: "close-w2-2026-10-18T18:00:00Z",
        planId: "plan-w2",
        closedAt: "2026-10-18T18:00:00Z",
        output: {
          ...reportW1.output,
          closedAt: "2026-10-18T18:00:00Z",
          weekRange: planWeek2.targetWeek,
          reflectiveSummary: { ...reportW1.output.reflectiveSummary, headline: "Semana 2 cerrada" },
        },
      };

      await storage.closeReports.save(reportW1);
      await storage.closeReports.save(reportW2);

      const res = await service.resumeSession();
      expect(res.status).toBe("no_active_session");
      if (res.status === "no_active_session") {
        expect(res.latestClosedWeek?.plan.planId).toBe("plan-w2");
        expect(res.latestClosedWeek?.closeReport.reportId).toBe(reportW2.reportId);
      }

      // Probar desempate cuando closedAt es idéntico: desempata por reportId desc
      const planWeek3: StoredWeeklyPlan = {
        ...samplePlan,
        planId: "plan-w3",
        status: "closed",
        targetWeek: { startDate: "2026-10-12", endDate: "2026-10-18" },
      };
      await storage.plans.save(planWeek3);

      const reportW2TieBreak: StoredCloseWeekReport = {
        ...reportW2,
        reportId: "close-w2-z-tiebreak", // alfabéticamente superior a close-w2-2026
        planId: "plan-w3",
      };
      await storage.closeReports.save(reportW2TieBreak);

      const resTie = await service.resumeSession();
      if (resTie.status === "no_active_session") {
        expect(resTie.latestClosedWeek?.closeReport.reportId).toBe("close-w2-z-tiebreak");
        expect(resTie.latestClosedWeek?.plan.planId).toBe("plan-w3");
      }
    });

    it("1.4. Coherencia referencial estricta: si el reporte de cierre referencia un planId inexistente, retorna inconsistent_references", async () => {
      const orphanReport: StoredCloseWeekReport = {
        reportId: "close-orphan",
        planId: "plan-fantasma-inexistente",
        closedAt: "2026-10-18T18:00:00Z",
        output: {
          status: "success",
          closedAt: "2026-10-18T18:00:00Z",
          weekRange: validTargetWeek,
          fociOutcomes: [],
          obligationsOutcomes: [],
          classifiedItems: [],
          itemDispositions: { completed: [], carryOverCandidates: [], dropped: [], unreported: [] },
          capacityAnalysis: {
            status: "complete",
            totalPlannedHours: 10,
            totalActualHours: 10,
            reportedHoursItemCount: 1,
            totalPlanItemCount: 1,
            protectedSpaceHours: 5,
            spaceRespected: true,
            explanation: "OK",
          },
          memoryCandidates: [],
          reflectiveSummary: {
            headline: "Huéérfano",
            accomplishments: [],
            inProgressWork: [],
            consciousPostponements: [],
            droppedItems: [],
            unreportedItems: [],
            questionsForNextCycle: [],
          },
          warnings: [],
        },
      };
      await storage.closeReports.save(orphanReport);

      const res = await service.resumeSession();
      expect(res.status).toBe("inconsistent_references");
      if (res.status === "inconsistent_references") {
        expect(res.reason).toContain("plan-fantasma-inexistente");
      }
    });

    it("1.5. Incoherencia en agenda: si el reporte referencia un scheduleId inexistente o ajeno, retorna inconsistent_references", async () => {
      const closedPlan: StoredWeeklyPlan = {
        ...samplePlan,
        status: "closed",
      };
      await storage.plans.save(closedPlan);

      const reportWithBadSchedule: StoredCloseWeekReport = {
        reportId: "close-bad-sched",
        planId: closedPlan.planId,
        scheduleId: "sched-inexistente",
        closedAt: "2026-10-18T18:00:00Z",
        output: {
          status: "success",
          closedAt: "2026-10-18T18:00:00Z",
          weekRange: validTargetWeek,
          fociOutcomes: [],
          obligationsOutcomes: [],
          classifiedItems: [],
          itemDispositions: { completed: [], carryOverCandidates: [], dropped: [], unreported: [] },
          capacityAnalysis: {
            status: "complete",
            totalPlannedHours: 10,
            totalActualHours: 10,
            reportedHoursItemCount: 1,
            totalPlanItemCount: 1,
            protectedSpaceHours: 5,
            spaceRespected: true,
            explanation: "OK",
          },
          memoryCandidates: [],
          reflectiveSummary: {
            headline: "Reporte con agenda rota",
            accomplishments: [],
            inProgressWork: [],
            consciousPostponements: [],
            droppedItems: [],
            unreportedItems: [],
            questionsForNextCycle: [],
          },
          warnings: [],
        },
      };
      await storage.closeReports.save(reportWithBadSchedule);

      const res = await service.resumeSession();
      expect(res.status).toBe("inconsistent_references");
      if (res.status === "inconsistent_references") {
        expect(res.reason).toContain("sched-inexistente");
      }
    });

    it("1.6. Prioridad al plan activo: prioriza la semana activa en session_resumed pero conserva latestClosedWeek como contexto histórico", async () => {
      // 1. Guardar semana 1 cerrada
      const planW1: StoredWeeklyPlan = {
        ...samplePlan,
        planId: "plan-w1-closed",
        status: "closed",
        targetWeek: { startDate: "2026-10-05", endDate: "2026-10-11" },
      };
      await storage.plans.save(planW1);
      const reportW1: StoredCloseWeekReport = {
        reportId: "close-w1",
        planId: "plan-w1-closed",
        closedAt: "2026-10-11T18:00:00Z",
        output: {
          status: "success",
          closedAt: "2026-10-11T18:00:00Z",
          weekRange: planW1.targetWeek,
          fociOutcomes: [],
          obligationsOutcomes: [],
          classifiedItems: [],
          itemDispositions: { completed: ["task-w1"], carryOverCandidates: [], dropped: [], unreported: [] },
          capacityAnalysis: {
            status: "complete",
            totalPlannedHours: 10,
            totalActualHours: 10,
            reportedHoursItemCount: 1,
            totalPlanItemCount: 1,
            protectedSpaceHours: 5,
            spaceRespected: true,
            explanation: "OK",
          },
          memoryCandidates: [],
          reflectiveSummary: {
            headline: "Semana 1 concluida",
            accomplishments: [],
            inProgressWork: [],
            consciousPostponements: [],
            droppedItems: [],
            unreportedItems: [],
            questionsForNextCycle: [],
          },
          warnings: [],
        },
      };
      await storage.closeReports.save(reportW1);

      // 2. Guardar semana 2 activa
      const planW2Active: StoredWeeklyPlan = {
        ...samplePlan,
        planId: "plan-w2-active",
        status: "active",
        targetWeek: { startDate: "2026-10-12", endDate: "2026-10-18" },
      };
      const schedW2: WeeklySchedule = {
        ...sampleSchedule,
        scheduleId: "sched-w2",
        planId: "plan-w2-active",
        weekRange: planW2Active.targetWeek,
      };
      await service.createOrSavePlanAndSchedule(planW2Active, schedW2);

      // 3. Reanudar sesión
      const res = await service.resumeSession();
      expect(res.status).toBe("session_resumed");
      if (res.status === "session_resumed") {
        // Sesión activa es W2
        expect(res.state.activePlan?.planId).toBe("plan-w2-active");
        expect(res.state.activeSchedule?.scheduleId).toBe("sched-w2");
        // Contexto histórico separado recupera W1
        expect(res.latestClosedWeek).not.toBeNull();
        expect(res.latestClosedWeek?.plan.planId).toBe("plan-w1-closed");
        expect(res.latestClosedWeek?.closeReport.reportId).toBe("close-w1");
      }

      await controller.reloadSession();
      const snap = controller.getSnapshot();
      expect(snap.status).toBe("session_resumed");
      expect(snap.activePlan?.planId).toBe("plan-w2-active");
      expect(snap.latestClosedWeek?.plan.planId).toBe("plan-w1-closed");
    });
  });

  // ==========================================================================
  // PARTE 2: Disposiciones interactivas de cierre (7 pruebas)
  // ==========================================================================
  describe("2. Disposiciones interactivas de cierre", () => {
    it("2.1. extractPlanItems: consolida ítems únicos de obligaciones, flexibleOptions, foci y agenda sin duplicados", () => {
      const items = extractPlanItems(samplePlan, sampleSchedule);
      // Foci: task-reporte, task-code
      // Obligations: task-sync
      // Flexible: task-reading
      // Deferred: task-backlog
      const itemIds = items.map((i) => i.itemId);
      expect(itemIds).toContain("task-sync");
      expect(itemIds).toContain("task-reading");
      expect(itemIds).toContain("task-reporte");
      expect(itemIds).toContain("task-code");
      expect(itemIds).toContain("task-backlog");

      // Verificar que task-reporte (presente en foco, allocations y timeblocks) aparece solo UNA vez
      const reporteOccurrences = items.filter((i) => i.itemId === "task-reporte");
      expect(reporteOccurrences).toHaveLength(1);
    });

    it("2.2. Ítems no revisados (unreviewed): no se envían en itemOutcomes y closeWeek trata como no informados", async () => {
      await controller.createOrSavePlan(samplePlan, sampleSchedule);

      // Cerrar semana sin enviar outcomes para task-code ni task-reading (quedan sin revisar)
      const explicitlyReviewed: ItemOutcomeInput[] = [
        { itemId: "task-reporte", status: "completed" },
      ];

      const res = await controller.closeWeek({
        planId: samplePlan.planId,
        closedAt: "2026-10-18T18:00:00Z",
        itemOutcomes: explicitlyReviewed,
      });

      expect(res.status).toBe("success");
      if (res.status === "success") {
        const report = res.closeReport.output;
        expect(report.itemDispositions.completed).toContain("task-reporte");
        // Las tareas no enviadas aparecen como no informadas en las disposiciones
        expect(report.itemDispositions.unreported).toContain("task-code");
        expect(report.itemDispositions.unreported).toContain("task-sync");
      }
    });

    it("2.3. Selección explícita de disposiciones: completed, in_progress, not_started, consciously_postponed y dropped", async () => {
      await controller.createOrSavePlan(samplePlan, sampleSchedule);

      const explicitOutcomes: ItemOutcomeInput[] = [
        { itemId: "task-reporte", status: "completed" },
        { itemId: "task-code", status: "in_progress" },
        { itemId: "task-sync", status: "not_started" },
        {
          itemId: "task-reading",
          status: "consciously_postponed",
          postponementReason: "Foco prioritario en entregables",
        },
        { itemId: "task-backlog", status: "dropped" },
      ];

      const res = await controller.closeWeek({
        planId: samplePlan.planId,
        closedAt: "2026-10-18T18:00:00Z",
        itemOutcomes: explicitOutcomes,
      });

      expect(res.status).toBe("success");
      if (res.status === "success") {
        const { itemDispositions, reflectiveSummary } = res.closeReport.output;
        expect(itemDispositions.completed).toContain("task-reporte");
        expect(itemDispositions.dropped).toContain("task-backlog");

        // CarryOverCandidates deben clasificar las tareas en progreso, no iniciadas y postergadas
        const carryOverIds = itemDispositions.carryOverCandidates.map((c) => c.itemId);
        expect(carryOverIds).toContain("task-code");
        expect(carryOverIds).toContain("task-sync");
        expect(carryOverIds).toContain("task-reading");

        // ReflectiveSummary debe incluir la postergación consciente
        expect(reflectiveSummary.consciousPostponements.length).toBeGreaterThanOrEqual(1);
      }
    });

    it("2.4. Motivo condicional de postergación: se preserva en el reporte y candidaturas de carry-over", async () => {
      await controller.createOrSavePlan(samplePlan, sampleSchedule);

      const res = await controller.closeWeek({
        planId: samplePlan.planId,
        closedAt: "2026-10-18T18:00:00Z",
        itemOutcomes: [
          {
            itemId: "task-code",
            status: "consciously_postponed",
            postponementReason: "Priorización consciente por sobrecarga de reuniones",
          },
        ],
      });

      expect(res.status).toBe("success");
      if (res.status === "success") {
        const classified = res.closeReport.output.classifiedItems.find((i) => i.itemId === "task-code");
        expect(classified?.postponementReason).toBe("Priorización consciente por sobrecarga de reuniones");

        const carryOver = res.closeReport.output.itemDispositions.carryOverCandidates.find(
          (c) => c.itemId === "task-code"
        );
        expect(carryOver?.details).toContain("sobrecarga de reuniones");
      }
    });

    it("2.5. Postergación sin reactivación automática: los ítems postergados no se reactivan en sesiones limpias", async () => {
      await controller.createOrSavePlan(samplePlan, sampleSchedule);
      await controller.closeWeek({
        planId: samplePlan.planId,
        closedAt: "2026-10-18T18:00:00Z",
        itemOutcomes: [
          {
            itemId: "task-code",
            status: "consciously_postponed",
            postponementReason: "Postergado conscientemente",
          },
        ],
      });

      // Al reanudar sesión sin un nuevo plan activo, la sesión permanece limpia sin tareas mágicas
      await controller.reloadSession();
      const snap = controller.getSnapshot();
      expect(snap.status).toBe("no_active_session");
      expect(snap.activePlan).toBeNull();
      expect(snap.activeSchedule).toBeNull();
      // El estado del plan en BD sigue siendo cerrado
      const storedPlan = await storage.plans.getById(samplePlan.planId);
      expect(storedPlan?.status).toBe("closed");
    });

    it("2.6. Informe confirmado visible solo tras éxito de persistencia", async () => {
      await controller.createOrSavePlan(samplePlan, sampleSchedule);

      // Antes de cerrar, el reporte confirmado es null
      expect(controller.getSnapshot().latestCloseReport).toBeNull();

      // Cerrar semana
      const closeRes = await controller.closeWeek({
        planId: samplePlan.planId,
        closedAt: "2026-10-18T18:00:00Z",
        itemOutcomes: [{ itemId: "task-reporte", status: "completed" }],
        userReflection: { generalNotes: "Reflexión confirmada" },
      });
      expect(closeRes.status).toBe("success");

      // Solo después de persistencia exitosa, el snapshot tiene el reporte confirmado
      const snap = controller.getSnapshot();
      expect(snap.latestCloseReport).not.toBeNull();
      expect(snap.latestCloseReport?.output.reflectiveSummary.headline).toBeDefined();
      expect(snap.latestCloseReport?.planId).toBe(samplePlan.planId);
      // Y se refleja también en latestClosedWeek
      expect(snap.latestClosedWeek?.closeReport.reportId).toBe(snap.latestCloseReport?.reportId);
    });

    it("2.7. Purga accesible y segura: controller.purgeSession elimina plan, agenda y reporte atómicamente", async () => {
      await controller.createOrSavePlan(samplePlan, sampleSchedule);
      await controller.closeWeek({
        planId: samplePlan.planId,
        closedAt: "2026-10-18T18:00:00Z",
        itemOutcomes: [{ itemId: "task-reporte", status: "completed" }],
      });

      expect(await storage.plans.getById(samplePlan.planId)).not.toBeNull();
      expect(await storage.closeReports.getByPlanId(samplePlan.planId)).not.toBeNull();

      // Ejecutar purga de sesión
      const purgeRes = await controller.purgeSession(samplePlan.planId);
      expect(purgeRes.status).toBe("success");

      // Verificar que los datos fueron eliminados de la base de datos
      expect(await storage.plans.getById(samplePlan.planId)).toBeNull();
      expect(await storage.schedules.getByPlanId(samplePlan.planId)).toBeNull();
      expect(await storage.closeReports.getByPlanId(samplePlan.planId)).toBeNull();

      // Estado de UI vuelve a no_active_session limpio
      const snap = controller.getSnapshot();
      expect(snap.status).toBe("no_active_session");
      expect(snap.activePlan).toBeNull();
      expect(snap.latestClosedPlan).toBeNull();
      expect(snap.latestCloseReport).toBeNull();
      expect(snap.latestClosedWeek).toBeNull();
    });
  });
});
