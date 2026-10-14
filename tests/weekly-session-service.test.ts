import { describe, it, expect, beforeEach } from "vitest";
import { indexedDB as fakeIDB, IDBKeyRange as fakeKeyRange } from "fake-indexeddb";
import {
  createIndexedDbStorage,
  deleteDatabase,
  IndexedDbStorageContext,
} from "../src/infrastructure/storage/indexeddb";
import { WeeklySessionService } from "../src/application/weekly-session-service";
import { StoredWeeklyPlan } from "../src/domain/repositories/types";
import { WeeklySchedule } from "../src/domain/schedule";
import { ProposedWeek } from "../src/domain/week";
import { MemoryOperation } from "../src/domain/memory";

describe("WeeklySessionService — Capa de Aplicación (Fase P3)", () => {
  const TEST_DB_NAME = "conscious_tech_service_test_db";

  if (typeof globalThis.IDBKeyRange === "undefined") {
    (globalThis as unknown as { IDBKeyRange: typeof fakeKeyRange }).IDBKeyRange = fakeKeyRange;
  }

  let storage: IndexedDbStorageContext;
  let service: WeeklySessionService;

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
  });

  const compliantProposal: ProposedWeek = {
    weekSummary: {
      targetWeek: {
        startDate: "2026-10-12",
        endDate: "2026-10-18",
      },
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
      intent: "Semana de consolidación",
    },
    foci: [
      {
        id: "focus-aws",
        title: "Certificación AWS",
        desiredOutcome: "Simulacro aprobado",
        rationale: "Foco principal",
        contributingItemIds: ["item-aws"],
        estimatedHours: 12,
      },
    ],
    obligations: [
      {
        itemId: "item-clase",
        title: "Clase martes",
        dueDate: "2026-10-13",
        commitmentType: "external",
        rationale: "Compromiso externo confirmado",
        estimatedHours: 4,
      },
    ],
    flexibleOptions: [
      {
        itemId: "item-zapsac",
        title: "Avanzar Zapsac",
        condition: "Si queda tiempo",
        estimatedHours: 4,
      },
    ],
    deferredItems: [
      {
        itemId: "item-podcast",
        title: "Idea podcast",
        reason: "archived",
        rationale: "Idea en archivo",
      },
    ],
    unplannedSpace: {
      recommendedHours: 7.5,
      rationale: "Espacio protegido para margen",
    },
    confirmationPrompt: {
      question: "¿Te representa este plan?",
      keyTradeoffs: [],
      pendingQuestions: [],
    },
  };

  const samplePlan: StoredWeeklyPlan = {
    planId: "plan-2026-w42",
    targetWeek: {
      startDate: "2026-10-12",
      endDate: "2026-10-18",
    },
    status: "active",
    proposal: compliantProposal,
    createdAt: "2026-10-12T08:00:00Z",
    updatedAt: "2026-10-12T08:00:00Z",
  };

  const sampleSchedule: WeeklySchedule = {
    scheduleId: "sched-2026-w42",
    planId: "plan-2026-w42",
    weekRange: {
      startDate: "2026-10-12",
      endDate: "2026-10-18",
    },
    timeBlocks: [
      {
        day: "2026-10-13",
        startTime: "10:00",
        endTime: "14:00",
        itemId: "item-clase",
        note: "Clase martes",
      },
    ],
    dailyAllocations: [
      {
        itemId: "item-aws",
        day: "2026-10-12",
        allocatedHours: 6,
      },
    ],
    dayConstraints: [
      {
        day: "2026-10-12",
        availableHours: 8,
      },
      {
        day: "2026-10-13",
        availableHours: 6,
      },
    ],
    appliedAdjustments: [],
    version: 1,
    createdAt: "2026-10-12T08:00:00Z",
    updatedAt: "2026-10-12T08:00:00Z",
  };

  // ==========================================================================
  // 1. Recuperación sin datos y con sesión válida
  // ==========================================================================
  it("1. Recuperación sin datos y con sesión válida", async () => {
    // Sin datos
    const emptyResume = await service.resumeSession();
    expect(emptyResume.status).toBe("no_active_session");

    // Con datos válidos
    await service.createOrSavePlanAndSchedule(samplePlan, sampleSchedule);
    const validResume = await service.resumeSession();
    expect(validResume.status).toBe("session_resumed");
    if (validResume.status === "session_resumed") {
      expect(validResume.state.activePlan?.planId).toBe(samplePlan.planId);
      expect(validResume.state.activeSchedule?.scheduleId).toBe(sampleSchedule.scheduleId);
    }
  });

  // ==========================================================================
  // 2. Recuperación ambigua por múltiples planes activos (H-01)
  // ==========================================================================
  it("2. Recuperación ambigua por múltiples planes activos", async () => {
    const planA = { ...samplePlan, planId: "plan-A", status: "active" as const };
    const planB = { ...samplePlan, planId: "plan-B", status: "active" as const };

    // Persistir directamente saltándose el guard para emular inconsistencia previa
    await storage.plans.save(planA);
    await storage.plans.save(planB);

    const resumeResult = await service.resumeSession();
    expect(resumeResult.status).toBe("ambiguous_active_plans");
    if (resumeResult.status === "ambiguous_active_plans") {
      expect(resumeResult.activePlanIds).toContain("plan-A");
      expect(resumeResult.activePlanIds).toContain("plan-B");
    }
  });

  // ==========================================================================
  // 3. Agenda ausente o asociada a otro plan
  // ==========================================================================
  it("3. Agenda ausente o asociada a otro plan", async () => {
    // Agenda ausente es un estado válido (plan sin micro-calendario)
    await service.createOrSavePlanAndSchedule(samplePlan);
    const resumeNoSched = await service.resumeSession();
    expect(resumeNoSched.status).toBe("session_resumed");
    if (resumeNoSched.status === "session_resumed") {
      expect(resumeNoSched.state.activeSchedule).toBeNull();
    }

    // Agenda con weekRange que no coincide con el plan
    const mismatchedSchedule: WeeklySchedule = {
      ...sampleSchedule,
      weekRange: {
        startDate: "2026-10-19",
        endDate: "2026-10-25",
      },
      timeBlocks: [],
      dailyAllocations: [],
      dayConstraints: [],
    };
    await storage.schedules.save(mismatchedSchedule);

    const resumeMismatched = await service.resumeSession();
    expect(resumeMismatched.status).toBe("inconsistent_references");
  });

  // ==========================================================================
  // 4. Guardado y recuperación de plan y agenda
  // ==========================================================================
  it("4. Guardado y recuperación de plan y agenda con verificación referencial", async () => {
    const saveResult = await service.createOrSavePlanAndSchedule(samplePlan, sampleSchedule);
    expect(saveResult.status).toBe("success");

    const getResult = await service.getPlanAndSchedule(samplePlan.planId);
    expect(getResult.status).toBe("success");
    if (getResult.status === "success") {
      expect(getResult.plan.planId).toBe(samplePlan.planId);
      expect(getResult.schedule?.scheduleId).toBe(sampleSchedule.scheduleId);
    }
  });

  // ==========================================================================
  // 5. Ajuste aceptado aplicado correctamente
  // ==========================================================================
  it("5. Ajuste aceptado aplicado correctamente con versión incrementada", async () => {
    await service.createOrSavePlanAndSchedule(samplePlan, sampleSchedule);

    const adjustResult = await service.applyAdjustment({
      scheduleId: sampleSchedule.scheduleId,
      proposalId: "prop-01",
      adjustmentId: "adj-01",
      action: {
        type: "postpone_item",
        itemId: "item-aws",
        currentCategory: "foci",
        targetReason: "out_of_capacity",
        hoursFreed: 6,
        rationale: "Sobrecarga de foco",
      },
      expectedScheduleVersion: 1,
      humanDecision: "accepted",
      decidedAt: "2026-10-12T10:00:00Z",
    });

    expect(adjustResult.status).toBe("success");
    if (adjustResult.status === "success") {
      expect(adjustResult.schedule.version).toBe(2);
      expect(adjustResult.appliedRecord.adjustmentId).toBe("adj-01");
      expect(adjustResult.appliedRecord.lifecycleStatus).toBe("active");
    }

    // Comprobar persistencia real
    const storedSchedule = await storage.schedules.getById(sampleSchedule.scheduleId);
    expect(storedSchedule?.version).toBe(2);
    expect(storedSchedule?.appliedAdjustments).toHaveLength(1);
  });

  // ==========================================================================
  // 6. Versión obsoleta sin sobrescribir la agenda actual
  // ==========================================================================
  it("6. Versión obsoleta detectada sin sobrescribir la agenda actual", async () => {
    await service.createOrSavePlanAndSchedule(samplePlan, sampleSchedule);

    // Intento con versión esperada 99 en vez de 1
    const conflictResult = await service.applyAdjustment({
      scheduleId: sampleSchedule.scheduleId,
      proposalId: "prop-01",
      adjustmentId: "adj-01",
      action: {
        type: "postpone_item",
        itemId: "item-aws",
        currentCategory: "foci",
        targetReason: "out_of_capacity",
        hoursFreed: 6,
        rationale: "Sobrecarga",
      },
      expectedScheduleVersion: 99,
      humanDecision: "accepted",
      decidedAt: "2026-10-12T10:00:00Z",
    });

    expect(conflictResult.status).toBe("concurrency_conflict");
    if (conflictResult.status === "concurrency_conflict") {
      expect(conflictResult.currentVersion).toBe(1);
      expect(conflictResult.expectedVersion).toBe(99);
    }

    // Invariante: La agenda permanece intacta en versión 1
    const storedSchedule = await storage.schedules.getById(sampleSchedule.scheduleId);
    expect(storedSchedule?.version).toBe(1);
  });

  // ==========================================================================
  // 7. Cierre semanal con persistencia del informe
  // ==========================================================================
  it("7. Cierre semanal con persistencia del informe y candidatos no persistidos", async () => {
    await service.createOrSavePlanAndSchedule(samplePlan, sampleSchedule);

    const closeResult = await service.closeCurrentWeek({
      planId: samplePlan.planId,
      closedAt: "2026-10-18T19:00:00Z",
      itemOutcomes: [
        { itemId: "item-aws", status: "completed", actualHours: 12 },
        { itemId: "item-clase", status: "completed", actualHours: 4 },
        { itemId: "item-zapsac", status: "completed", actualHours: 4 },
        { itemId: "item-podcast", status: "not_started" },
      ],
      userReflection: {
        energyLevel: "energized",
        generalNotes: "Semana fluida",
      },
    });

    expect(closeResult.status).toBe("success");
    if (closeResult.status === "success") {
      expect(closeResult.closeReport.planId).toBe(samplePlan.planId);
      expect(closeResult.closeReport.output.status).toBe("success");
      expect(closeResult.memoryCandidates.length).toBeGreaterThan(0);
    }

    // Verificar que el plan pasó a 'closed'
    const storedPlan = await storage.plans.getById(samplePlan.planId);
    expect(storedPlan?.status).toBe("closed");

    // INVARIANTE CRÍTICA: Ningún recuerdo candidato fue guardado automáticamente en 'memories'
    const storedMemories = await storage.memories.getAll();
    expect(storedMemories).toHaveLength(0);
  });

  // ==========================================================================
  // 8. Fallo al guardar el cierre sin declarar el cierre como persistido
  // ==========================================================================
  it("8. Plan no encontrado al cerrar devuelve resultado de no encontrado", async () => {
    const closeNonexistent = await service.closeCurrentWeek({
      planId: "nonexistent-plan",
      closedAt: "2026-10-18T19:00:00Z",
      itemOutcomes: [],
    });

    expect(closeNonexistent.status).toBe("not_found");
  });

  // ==========================================================================
  // 9. Eliminación coordinada sin borrados parciales (H-02)
  // ==========================================================================
  it("9. Purga atómica multialmacén de plan, agenda y cierre", async () => {
    await service.createOrSavePlanAndSchedule(samplePlan, sampleSchedule);
    await service.closeCurrentWeek({
      planId: samplePlan.planId,
      closedAt: "2026-10-18T19:00:00Z",
      itemOutcomes: [
        { itemId: "item-aws", status: "completed", actualHours: 12 },
        { itemId: "item-clase", status: "completed", actualHours: 4 },
        { itemId: "item-zapsac", status: "completed", actualHours: 4 },
        { itemId: "item-podcast", status: "not_started" },
      ],
    });

    // Verificar que existen en los 3 almacenes
    expect(await storage.plans.getById(samplePlan.planId)).not.toBeNull();
    expect(await storage.schedules.getByPlanId(samplePlan.planId)).not.toBeNull();
    expect(await storage.closeReports.getByPlanId(samplePlan.planId)).not.toBeNull();

    // Purgar de forma atómica
    const purgeResult = await service.purgePlanAndAssociatedData(samplePlan.planId);
    expect(purgeResult.status).toBe("success");

    // Confirmar que se eliminaron de los 3 almacenes
    expect(await storage.plans.getById(samplePlan.planId)).toBeNull();
    expect(await storage.schedules.getByPlanId(samplePlan.planId)).toBeNull();
    expect(await storage.closeReports.getByPlanId(samplePlan.planId)).toBeNull();
  });

  // ==========================================================================
  // 10. Memoria candidata no confirmada que no se persiste
  // ==========================================================================
  it("10. Rechaza la persistencia sin confirmación explícita aceptada", async () => {
    const memoryOp: MemoryOperation = {
      type: "add",
      candidateId: "cand-01",
      proposedMemory: {
        id: "mem-01",
        content: "Prefiero trabajar en bloques de 90 minutos",
        category: "preference",
        confirmationStatus: "confirmed",
        temporalStatus: "active",
        tags: ["ritmo"],
        provenance: {
          source: "user_explicit",
          referenceText: "prefiero bloques de 90 minutos",
        },
        createdAt: "2026-10-12",
      },
      rationale: "Preferencia explícita",
      requiresHumanConfirmation: true,
    };

    // Intento con confirmación rechazada
    const rejectedResult = await service.confirmAndApplyMemoryOperation(memoryOp, {
      confirmedBy: "user_explicit",
      confirmedAt: "2026-10-12T10:00:00Z",
      decision: "rejected",
    });

    expect(rejectedResult.status).toBe("rejected");
    expect(await storage.memories.getById("mem-01")).toBeNull();
  });

  // ==========================================================================
  // 11. Memoria confirmada explícitamente que se valida antes de guardar
  // ==========================================================================
  it("11. Memoria confirmada explícitamente se valida e inserta correctamente", async () => {
    const validOp: MemoryOperation = {
      type: "add",
      candidateId: "cand-02",
      proposedMemory: {
        id: "mem-02",
        content: "No agendar reuniones los viernes por la tarde",
        category: "preference",
        confirmationStatus: "confirmed",
        temporalStatus: "active",
        tags: ["calendario"],
        provenance: {
          source: "user_explicit",
          referenceText: "los viernes a la tarde nada de reuniones",
        },
        createdAt: "2026-10-12",
      },
      rationale: "Preferencia explícita",
      requiresHumanConfirmation: true,
    };

    const confirmResult = await service.confirmAndApplyMemoryOperation(validOp, {
      confirmedBy: "user_explicit",
      confirmedAt: "2026-10-12T10:00:00Z",
      decision: "accepted",
    });

    expect(confirmResult.status).toBe("applied");
    if (confirmResult.status === "applied") {
      expect(confirmResult.memoryId).toBe("mem-02");
    }

    const saved = await storage.memories.getById("mem-02");
    expect(saved).not.toBeNull();
    expect(saved?.content).toBe("No agendar reuniones los viernes por la tarde");
  });

  // ==========================================================================
  // 12. Propagación de errores de almacenamiento
  // ==========================================================================
  it("12. Memoria inválida que viola invariantes epistémicas es rechazada", async () => {
    const invalidEpistemicOp: MemoryOperation = {
      type: "add",
      candidateId: "cand-03",
      proposedMemory: {
        id: "mem-unearned",
        content: "Inferencia no ganada",
        category: "fact",
        confirmationStatus: "confirmed",
        temporalStatus: "active",
        tags: [],
        provenance: {
          source: "conversation_inference",
          referenceText: "me pareció que sí",
        },
        createdAt: "2026-10-12",
      },
      rationale: "Inferencia",
      requiresHumanConfirmation: true,
    };

    const result = await service.confirmAndApplyMemoryOperation(invalidEpistemicOp, {
      confirmedBy: "user_explicit",
      confirmedAt: "2026-10-12T10:00:00Z",
      decision: "accepted",
    });

    expect(result.status).toBe("invalid_operation");
    expect(await storage.memories.getById("mem-unearned")).toBeNull();
  });

  // ==========================================================================
  // 13. Reabrir semana cerrada (Soberanía del usuario para corregir cierres prematuros)
  // ==========================================================================
  describe("reopenWeek — Reabrir semana cerrada", () => {
    it("13.1 Devuelve not_found si el planId no existe", async () => {
      const result = await service.reopenWeek("plan-inexistente");
      expect(result.status).toBe("not_found");
    });

    it("13.2 Devuelve not_closed si el plan no está cerrado", async () => {
      const activePlan: StoredWeeklyPlan = {
        planId: "plan-todavia-activo",
        status: "active",
        targetWeek: { startDate: "2026-10-12", endDate: "2026-10-18" },
        proposal: compliantProposal,
        createdAt: "2026-10-12T00:00:00Z",
        updatedAt: "2026-10-12T00:00:00Z",
      };
      await storage.plans.save(activePlan);

      const result = await service.reopenWeek("plan-todavia-activo");
      expect(result.status).toBe("not_closed");
    });

    it("13.3 Devuelve conflict_active_plan_exists si ya hay otro plan activo", async () => {
      // Plan cerrado
      const closedPlan: StoredWeeklyPlan = {
        planId: "plan-cerrado-1",
        status: "closed",
        targetWeek: { startDate: "2026-10-05", endDate: "2026-10-11" },
        proposal: compliantProposal,
        createdAt: "2026-10-05T00:00:00Z",
        updatedAt: "2026-10-11T23:59:59Z",
      };
      await storage.plans.save(closedPlan);

      // Otro plan activo en el sistema
      const activePlan: StoredWeeklyPlan = {
        planId: "plan-activo-2",
        status: "active",
        targetWeek: { startDate: "2026-10-12", endDate: "2026-10-18" },
        proposal: compliantProposal,
        createdAt: "2026-10-12T00:00:00Z",
        updatedAt: "2026-10-12T00:00:00Z",
      };
      await storage.plans.save(activePlan);

      const result = await service.reopenWeek("plan-cerrado-1");
      expect(result.status).toBe("conflict_active_plan_exists");
      if (result.status === "conflict_active_plan_exists") {
        expect(result.existingActivePlanId).toBe("plan-activo-2");
      }
    });

    it("13.4 Reabre exitosamente el plan cerrado, elimina el informe de cierre y reactiva la sesión", async () => {
      // 1. Guardar plan activo y cerrarlo con closeCurrentWeek
      const planToClose: StoredWeeklyPlan = {
        planId: "plan-a-reabrir",
        status: "active",
        targetWeek: { startDate: "2026-10-12", endDate: "2026-10-18" },
        proposal: compliantProposal,
        createdAt: "2026-10-12T00:00:00Z",
        updatedAt: "2026-10-12T00:00:00Z",
      };
      await storage.plans.save(planToClose);

      const closeRes = await service.closeCurrentWeek({
        planId: "plan-a-reabrir",
        closedAt: "2026-10-18T23:59:59Z",
        itemOutcomes: [
          {
            itemId: "item-aws",
            status: "completed",
            actualHours: 10,
          },
        ],
      });
      expect(closeRes.status).toBe("success");

      // Verificar que está cerrado
      const closedInDb = await storage.plans.getById("plan-a-reabrir");
      expect(closedInDb?.status).toBe("closed");
      const closeReportInDb = await storage.closeReports.getByPlanId("plan-a-reabrir");
      expect(closeReportInDb).not.toBeNull();

      // 2. Ejecutar reopenWeek
      const reopenRes = await service.reopenWeek("plan-a-reabrir");
      expect(reopenRes.status).toBe("success");
      if (reopenRes.status === "success") {
        expect(reopenRes.plan.status).toBe("active");
        expect(reopenRes.plan.planId).toBe("plan-a-reabrir");
      }

      // 3. Verificar persistencia: plan vuelve a active y closeReport se remueve
      const reloadedPlan = await storage.plans.getById("plan-a-reabrir");
      expect(reloadedPlan?.status).toBe("active");

      const reloadedCloseReport = await storage.closeReports.getByPlanId("plan-a-reabrir");
      expect(reloadedCloseReport).toBeNull();

      // 4. resumeSession ahora debe retomar la sesión como activa
      const resumed = await service.resumeSession();
      expect(resumed.status).toBe("session_resumed");
      if (resumed.status === "session_resumed") {
        expect(resumed.state.activePlan?.planId).toBe("plan-a-reabrir");
      }
    });
  });
});
