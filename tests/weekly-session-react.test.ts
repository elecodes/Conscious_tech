import { describe, it, expect, beforeEach } from "vitest";
import { indexedDB as fakeIDB, IDBKeyRange as fakeKeyRange } from "fake-indexeddb";
import {
  createIndexedDbStorage,
  deleteDatabase,
  IndexedDbStorageContext,
} from "../src/infrastructure/storage/indexeddb";
import { WeeklySessionService } from "../src/application/weekly-session-service";
import {
  WeeklySessionController,
  WeeklySessionUIState,
} from "../src/web/context/weekly-session-context";
import { StoredWeeklyPlan } from "../src/domain/repositories/types";
import { WeeklySchedule } from "../src/domain/schedule";
import { ProposedWeek } from "../src/domain/week";
import { SuggestedAdjustmentAction } from "../src/domain/adjustment";
import { StoreCandidate } from "../src/domain/memory";

describe("Fase P4 — Integración de WeeklySessionService con React (Controller & Hook State Machine)", () => {
  const TEST_DB_NAME = "conscious_tech_react_test_db";

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
        id: "focus-deep-work",
        title: "Arquitectura de Persistencia",
        desiredOutcome: "Contrato implementado",
        rationale: "Foco crítico",
        contributingItemIds: ["task-audit", "task-code"],
        estimatedHours: 10,
      },
    ],
    obligations: [
      {
        itemId: "task-sync",
        title: "Sincronización semanal",
        dueDate: "2026-10-13",
        commitmentType: "external",
        rationale: "Compromiso de equipo",
        estimatedHours: 2,
      },
    ],
    flexibleOptions: [],
    deferredItems: [],
    unplannedSpace: {
      recommendedHours: 10,
      rationale: "Espacio no planificado intencional",
    },
    confirmationPrompt: {
      question: "¿Refleja este plan tus intenciones reales?",
      keyTradeoffs: ["Foco en arquitectura vs nuevas features"],
      pendingQuestions: [],
    },
  };

  const samplePlan: StoredWeeklyPlan = {
    planId: "plan-2026-w42",
    status: "active",
    targetWeek: validTargetWeek,
    proposal: sampleProposal,
    createdAt: "2026-10-12T08:00:00Z",
    updatedAt: "2026-10-12T08:00:00Z",
  };

  const sampleSchedule: WeeklySchedule = {
    scheduleId: "sched-2026-w42",
    planId: "plan-2026-w42",
    weekRange: validTargetWeek,
    version: 1,
    timeBlocks: [
      {
        itemId: "task-audit",
        day: "2026-10-12",
        startTime: "09:00",
        endTime: "11:00",
      },
    ],
    dailyAllocations: [
      { day: "2026-10-12", allocatedHours: 2, itemId: "task-audit" },
      { day: "2026-10-13", allocatedHours: 2, itemId: "task-sync" },
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

  // --------------------------------------------------------------------------
  // Scenario 1: Strict Mode Resilience & Concurrent Reload
  // --------------------------------------------------------------------------
  it("1. Resiliencia bajo React Strict Mode: doble montaje y recargas concurrentes no generan carreras", async () => {
    const states: WeeklySessionUIState[] = [];
    const unsubscribe = controller.subscribe(() => {
      states.push(controller.getSnapshot());
    });

    // Simular doble mount inmediato como en React 19 Strict Mode
    const p1 = controller.reloadSession();
    const p2 = controller.reloadSession();

    await Promise.all([p1, p2]);

    expect(controller.getSnapshot().status).toBe("no_active_session");
    unsubscribe();
  });

  // --------------------------------------------------------------------------
  // Scenario 2: Resumes Empty Session cleanly
  // --------------------------------------------------------------------------
  it("2. Carga limpia de sesión vacía (no_active_session) sin lanzar errores", async () => {
    await controller.reloadSession();

    const snapshot = controller.getSnapshot();
    expect(snapshot.status).toBe("no_active_session");
    expect(snapshot.activePlan).toBeNull();
    expect(snapshot.activeSchedule).toBeNull();
    expect(snapshot.memories).toEqual([]);
    expect(snapshot.memoryCandidates).toEqual([]);
    expect(snapshot.errorMessage).toBeNull();
  });

  // --------------------------------------------------------------------------
  // Scenario 3: Resumes Active Session with Plan, Schedule and Memories
  // --------------------------------------------------------------------------
  it("3. Carga exitosa de sesión activa con plan, agenda y memorias confirmadas", async () => {
    await service.createOrSavePlanAndSchedule(samplePlan, sampleSchedule);
    await storage.memories.save({
      id: "mem-prior-1",
      content: "Prefiero mañanas para foco profundo",
      category: "preference",
      confirmationStatus: "confirmed",
      temporalStatus: "active",
      tags: [],
      provenance: {
        source: "user_explicit",
        referenceText: "Declaración previa explícita",
      },
      createdAt: "2026-10-10",
    });

    await controller.reloadSession();

    const snapshot = controller.getSnapshot();
    expect(snapshot.status).toBe("session_resumed");
    expect(snapshot.activePlan?.planId).toBe("plan-2026-w42");
    expect(snapshot.activeSchedule?.scheduleId).toBe("sched-2026-w42");
    expect(snapshot.activeSchedule?.version).toBe(1);
    expect(snapshot.memories).toHaveLength(1);
    expect(snapshot.memories[0]?.id).toBe("mem-prior-1");
  });

  // --------------------------------------------------------------------------
  // Scenario 4: Ambiguous Active Plans Detection & Explicit Human Choice
  // --------------------------------------------------------------------------
  it("4. Detecta ambigüedad (ambiguous_active_plans) y permite resolución humana explícita", async () => {
    // Guardar dos planes activos
    await storage.plans.save(samplePlan);
    const secondPlan: StoredWeeklyPlan = {
      ...samplePlan,
      planId: "plan-2026-w42-duplicate",
      status: "active",
    };
    await storage.plans.save(secondPlan);

    await controller.reloadSession();

    let snapshot = controller.getSnapshot();
    expect(snapshot.status).toBe("ambiguous_active_plans");
    expect(snapshot.ambiguousPlanIds).toContain("plan-2026-w42");
    expect(snapshot.ambiguousPlanIds).toContain("plan-2026-w42-duplicate");

    // Resolución humana: elegir conservar plan-2026-w42
    await controller.resolveAmbiguity("plan-2026-w42");

    snapshot = controller.getSnapshot();
    expect(snapshot.status).toBe("session_resumed");
    expect(snapshot.activePlan?.planId).toBe("plan-2026-w42");

    // Verificar que el otro plan fue purgado
    const purged = await storage.plans.getById("plan-2026-w42-duplicate");
    expect(purged).toBeNull();
  });

  // --------------------------------------------------------------------------
  // Scenario 5: Inconsistent References Detection
  // --------------------------------------------------------------------------
  it("5. Detecta incoherencia referencial (inconsistent_references) sin mutaciones silenciosas", async () => {
    const mismatchedSchedule: WeeklySchedule = {
      scheduleId: "sched-2026-w42",
      planId: "plan-2026-w42",
      weekRange: {
        startDate: "2026-11-02",
        endDate: "2026-11-08",
      },
      version: 1,
      timeBlocks: [
        {
          itemId: "task-audit",
          day: "2026-11-02",
          startTime: "09:00",
          endTime: "11:00",
        },
      ],
      dailyAllocations: [
        { day: "2026-11-02", allocatedHours: 2, itemId: "task-audit" },
      ],
      appliedAdjustments: [],
      createdAt: "2026-10-12T08:00:00Z",
      updatedAt: "2026-10-12T08:00:00Z",
    };
    await storage.plans.save(samplePlan);
    await storage.schedules.save(mismatchedSchedule);

    await controller.reloadSession();

    const snapshot = controller.getSnapshot();
    expect(snapshot.status).toBe("inconsistent_references");
    expect(snapshot.inconsistencyReason).toContain("does not match plan targetWeek");
    expect(snapshot.activePlan).toBeNull();
    expect(snapshot.activeSchedule).toBeNull();
  });

  // --------------------------------------------------------------------------
  // Scenario 6: Apply Adjustment with Human Acceptance
  // --------------------------------------------------------------------------
  it("6. Aplicación de ajuste aceptado por el usuario: actualiza agenda e incrementa versión", async () => {
    await controller.createOrSavePlan(samplePlan, sampleSchedule);

    const action: SuggestedAdjustmentAction = {
      type: "reassign_time_block",
      itemId: "task-audit",
      rationale: "Mover bloque de mañana a tarde",
      currentBlock: {
        itemId: "task-audit",
        day: "2026-10-12",
        startTime: "09:00",
        endTime: "11:00",
      },
      proposedBlock: {
        itemId: "task-audit",
        day: "2026-10-12",
        startTime: "14:00",
        endTime: "16:00",
      },
    };

    const res = await controller.applyAdjustment({
      scheduleId: sampleSchedule.scheduleId,
      proposalId: "prop-1",
      adjustmentId: "adj-1",
      action,
      expectedScheduleVersion: 1,
      humanDecision: "accepted",
    });

    expect(res.status).toBe("success");
    if (res.status === "success") {
      expect(res.schedule.version).toBe(2);
      expect(res.schedule.timeBlocks[0]?.startTime).toBe("14:00");
    }

    const snapshot = controller.getSnapshot();
    expect(snapshot.activeSchedule?.version).toBe(2);
    expect(snapshot.activeSchedule?.timeBlocks[0]?.startTime).toBe("14:00");
  });

  // --------------------------------------------------------------------------
  // Scenario 7: Reject Adjustment Proposal
  // --------------------------------------------------------------------------
  it("7. Rechazo de ajuste por el usuario: conserva la agenda intacta sin incrementar versión", async () => {
    await controller.createOrSavePlan(samplePlan, sampleSchedule);

    const action: SuggestedAdjustmentAction = {
      type: "reassign_time_block",
      itemId: "task-audit",
      rationale: "Propuesta que no convence",
      currentBlock: {
        itemId: "task-audit",
        day: "2026-10-12",
        startTime: "09:00",
        endTime: "11:00",
      },
      proposedBlock: {
        itemId: "task-audit",
        day: "2026-10-12",
        startTime: "15:00",
        endTime: "17:00",
      },
    };

    const res = await controller.applyAdjustment({
      scheduleId: sampleSchedule.scheduleId,
      proposalId: "prop-2",
      adjustmentId: "adj-2",
      action,
      expectedScheduleVersion: 1,
      humanDecision: "rejected",
    });

    expect(res.status).toBe("rejected");
    const snapshot = controller.getSnapshot();
    expect(snapshot.activeSchedule?.version).toBe(1);
    expect(snapshot.activeSchedule?.timeBlocks[0]?.startTime).toBe("09:00");
  });

  // --------------------------------------------------------------------------
  // Scenario 8: Concurrency Conflict Handling
  // --------------------------------------------------------------------------
  it("8. Conflicto de concurrencia: versión obsoleta es rechazada y reportada sin corromper estado", async () => {
    await controller.createOrSavePlan(samplePlan, sampleSchedule);

    const action: SuggestedAdjustmentAction = {
      type: "reassign_time_block",
      itemId: "task-audit",
      rationale: "Intento con versión desactualizada",
      currentBlock: {
        itemId: "task-audit",
        day: "2026-10-12",
        startTime: "09:00",
        endTime: "11:00",
      },
      proposedBlock: {
        itemId: "task-audit",
        day: "2026-10-12",
        startTime: "14:00",
        endTime: "16:00",
      },
    };

    // Intentar aplicar con expectedScheduleVersion = 99 (la agenda está en v1)
    const res = await controller.applyAdjustment({
      scheduleId: sampleSchedule.scheduleId,
      proposalId: "prop-stale",
      adjustmentId: "adj-stale",
      action,
      expectedScheduleVersion: 99,
      humanDecision: "accepted",
    });

    expect(res.status).toBe("concurrency_conflict");
    if (res.status === "concurrency_conflict") {
      expect(res.currentVersion).toBe(1);
      expect(res.expectedVersion).toBe(99);
    }

    const snapshot = controller.getSnapshot();
    expect(snapshot.activeSchedule?.version).toBe(1);
  });

  // --------------------------------------------------------------------------
  // Scenario 9: Close Week with Memory Candidates Sovereignty
  // --------------------------------------------------------------------------
  it("9. Cierre de semana determinista: persiste informe, cierra plan y presenta candidatos SIN autoguardado", async () => {
    await controller.createOrSavePlan(samplePlan, sampleSchedule);

    const res = await controller.closeWeek({
      planId: samplePlan.planId,
      closedAt: "2026-10-18",
      itemOutcomes: [
        { itemId: "task-audit", status: "completed" },
        { itemId: "task-sync", status: "completed" },
      ],
      userReflection: {
        generalNotes: "Semana productiva y calma.",
        energyLevel: "energized",
      },
    });

    expect(res.status).toBe("success");
    const snapshot = controller.getSnapshot();
    expect(snapshot.activePlan?.status).toBe("closed");
    expect(snapshot.latestCloseReport).not.toBeNull();
    expect(snapshot.latestCloseReport?.planId).toBe(samplePlan.planId);

    // Los candidatos de memoria están en memoria de UI, NO en la base de datos persistida
    const storedMemories = await storage.memories.getAll();
    expect(storedMemories).toHaveLength(0);
  });

  // --------------------------------------------------------------------------
  // Scenario 10: Explicit Human Decision on Memory Candidates
  // --------------------------------------------------------------------------
  it("10. Confirmación humana de candidatos: descartar no guarda nada; aceptar guarda con validación", async () => {
    await controller.createOrSavePlan(samplePlan, sampleSchedule);

    const mockCandidate: StoreCandidate = {
      candidateId: "cand-focus-rule",
      actionIntent: "store",
      rawText: "Rindo mejor asignando foco en bloques matutinos",
      suggestedCategory: "preference",
      isExplicitUserStatement: true,
      provenanceSource: "user_explicit",
      evidenceReference: "Comentario del usuario en reflexión",
    };

    // Agregar candidato temporal en UI
    controller["setState"]((s) => ({
      ...s,
      memoryCandidates: [mockCandidate],
    }));

    expect(controller.getSnapshot().memoryCandidates).toHaveLength(1);

    // 10a. Descartar candidato
    const rejectRes = await controller.confirmMemoryCandidate(mockCandidate, "rejected");
    expect(rejectRes.status).toBe("rejected");
    expect(controller.getSnapshot().memoryCandidates).toHaveLength(0);

    let inDb = await storage.memories.getAll();
    expect(inDb).toHaveLength(0);

    // 10b. Volver a simular y aceptar candidato
    controller["setState"]((s) => ({
      ...s,
      memoryCandidates: [mockCandidate],
    }));

    const acceptRes = await controller.confirmMemoryCandidate(mockCandidate, "accepted");
    expect(acceptRes.status).toBe("applied");

    expect(controller.getSnapshot().memoryCandidates).toHaveLength(0);
    expect(controller.getSnapshot().memories).toHaveLength(1);
    expect(controller.getSnapshot().memories[0]?.content).toBe(mockCandidate.rawText);

    // Comprobar persistencia real en IndexedDB
    inDb = await storage.memories.getAll();
    expect(inDb).toHaveLength(1);
    expect(inDb[0]?.content).toBe(mockCandidate.rawText);
    expect(inDb[0]?.confirmationStatus).toBe("confirmed");
  });

  // --------------------------------------------------------------------------
  // Scenario 11: Multi-Store Atomic Purge
  // --------------------------------------------------------------------------
  it("11. Purga atómica de sesión: elimina plan, agenda y reportes asociados sin dejar datos huérfanos", async () => {
    await controller.createOrSavePlan(samplePlan, sampleSchedule);

    const purgeRes = await controller.purgeSession(samplePlan.planId);
    expect(purgeRes.status).toBe("success");

    const snapshot = controller.getSnapshot();
    expect(snapshot.status).toBe("no_active_session");
    expect(snapshot.activePlan).toBeNull();
    expect(snapshot.activeSchedule).toBeNull();

    const planInDb = await storage.plans.getById(samplePlan.planId);
    const schedInDb = await storage.schedules.getByPlanId(samplePlan.planId);
    expect(planInDb).toBeNull();
    expect(schedInDb).toBeNull();
  });

  // --------------------------------------------------------------------------
  // Scenario 12: Cierre duplicado / simultáneo idempotente
  // --------------------------------------------------------------------------
  it("12. Cierre duplicado o simultáneo: dos acciones consecutivas o concurrentes no generan informes contradictorios", async () => {
    await controller.createOrSavePlan(samplePlan, sampleSchedule);

    const closeParams = {
      planId: samplePlan.planId,
      closedAt: "2026-10-18T18:00:00Z",
      itemOutcomes: [
        { itemId: "task-audit", status: "completed" as const },
        { itemId: "task-sync", status: "completed" as const },
      ],
      userReflection: { generalNotes: "Primer cierre" },
    };

    // Primera ejecución de cierre
    const res1 = await controller.closeWeek(closeParams);
    expect(res1.status).toBe("success");

    // Segunda ejecución de cierre sobre la semana ya cerrada
    const res2 = await controller.closeWeek(closeParams);
    expect(res2.status).toBe("success");

    if (res1.status === "success" && res2.status === "success") {
      expect(res2.closeReport.reportId).toBe(res1.closeReport.reportId);
      expect(res2.closeReport.closedAt).toBe(res1.closeReport.closedAt);
    }

    // Verificar en almacenamiento que existe un único informe para este plan
    const reportInDb = await storage.closeReports.getByPlanId(samplePlan.planId);
    expect(reportInDb).not.toBeNull();
    expect(reportInDb?.reportId).toBe(`close-${samplePlan.planId}-2026-10-18T18:00:00Z`);
  });

  // --------------------------------------------------------------------------
  // Scenario 13: Confirmación obsoleta de memoria
  // --------------------------------------------------------------------------
  it("13. Confirmación obsoleta de memoria: un candidato ajeno o ya procesado es rechazado sin mutar MemoryRepository", async () => {
    await controller.createOrSavePlan(samplePlan, sampleSchedule);

    const staleCandidate: StoreCandidate = {
      candidateId: "cand-stale-999",
      actionIntent: "store",
      rawText: "Preferencia descontextualizada de otra semana",
      suggestedCategory: "preference",
      isExplicitUserStatement: true,
      provenanceSource: "user_explicit",
    };

    // El candidato no está en controller.getSnapshot().memoryCandidates
    expect(controller.getSnapshot().memoryCandidates).toHaveLength(0);

    const result = await controller.confirmMemoryCandidate(staleCandidate, "accepted");
    expect(result.status).toBe("rejected");
    if (result.status === "rejected") {
      expect(result.reason).toContain("obsoleto");
    }

    // Ningún registro fue persistido
    const memoriesInDb = await storage.memories.getAll();
    expect(memoriesInDb).toHaveLength(0);
  });

  // --------------------------------------------------------------------------
  // Scenario 14: Conflicto de versión en UI expuesto sin asumir aplicación
  // --------------------------------------------------------------------------
  it("14. Conflicto de versión en UI: tras concurrency_conflict el estado refleja el conflicto y no asume cambios", async () => {
    await controller.createOrSavePlan(samplePlan, sampleSchedule);

    const action: SuggestedAdjustmentAction = {
      type: "reassign_time_block",
      itemId: "task-audit",
      rationale: "Cambio con versión vieja",
      currentBlock: {
        itemId: "task-audit",
        day: "2026-10-12",
        startTime: "09:00",
        endTime: "11:00",
      },
      proposedBlock: {
        itemId: "task-audit",
        day: "2026-10-12",
        startTime: "14:00",
        endTime: "16:00",
      },
    };

    const conflictRes = await controller.applyAdjustment({
      scheduleId: sampleSchedule.scheduleId,
      proposalId: "prop-stale",
      adjustmentId: "adj-stale",
      action,
      expectedScheduleVersion: 42, // La agenda está en v1
      humanDecision: "accepted",
    });

    expect(conflictRes.status).toBe("concurrency_conflict");

    const snapshot = controller.getSnapshot();
    expect(snapshot.concurrencyConflict).toEqual({
      currentVersion: 1,
      expectedVersion: 42,
    });
    // La agenda no fue mutada
    expect(snapshot.activeSchedule?.version).toBe(1);
    expect(snapshot.activeSchedule?.timeBlocks[0]?.startTime).toBe("09:00");

    // Al recargar para resincronizar, el conflicto se limpia
    await controller.reloadSession();
    expect(controller.getSnapshot().concurrencyConflict).toBeNull();
  });

  // --------------------------------------------------------------------------
  // Scenario 15: Ciclo completo y recuperación en reinicio/recarga fresca
  // --------------------------------------------------------------------------
  it("15. Persistencia y recuperación total tras recarga: plan cerrado, agenda con historial e informe sobreviven", async () => {
    // 15a. Crear semana
    await controller.createOrSavePlan(samplePlan, sampleSchedule);

    // 15b. Aplicar un ajuste
    const action: SuggestedAdjustmentAction = {
      type: "reassign_time_block",
      itemId: "task-audit",
      rationale: "Mover a la tarde",
      currentBlock: {
        itemId: "task-audit",
        day: "2026-10-12",
        startTime: "09:00",
        endTime: "11:00",
      },
      proposedBlock: {
        itemId: "task-audit",
        day: "2026-10-12",
        startTime: "14:00",
        endTime: "16:00",
      },
    };
    const adjRes = await controller.applyAdjustment({
      scheduleId: sampleSchedule.scheduleId,
      proposalId: "prop-e2e",
      adjustmentId: "adj-e2e",
      action,
      expectedScheduleVersion: 1,
      humanDecision: "accepted",
    });
    expect(adjRes.status).toBe("success");

    // 15c. Cerrar la semana
    const closeRes = await controller.closeWeek({
      planId: samplePlan.planId,
      closedAt: "2026-10-18T18:00:00Z",
      itemOutcomes: [
        { itemId: "task-audit", status: "completed" },
        { itemId: "task-code", status: "completed" },
        { itemId: "task-sync", status: "completed" },
      ],
      userReflection: { generalNotes: "Cierre exitoso E2E" },
    });
    expect(closeRes.status).toBe("success");

    // 15d. Simular nueva instancia fresca (recarga de página / segunda pestaña)
    const freshStorage = await createIndexedDbStorage({
      dbName: TEST_DB_NAME,
      customFactory: fakeIDB,
    });
    const freshService = new WeeklySessionService({
      plans: freshStorage.plans,
      schedules: freshStorage.schedules,
      closeReports: freshStorage.closeReports,
      memories: freshStorage.memories,
      getDb: () => freshStorage.db,
    });

    // Comprobar que a través del servicio y el almacenamiento sobreviven todas las entidades
    const serviceRecovery = await freshService.getPlanAndSchedule(samplePlan.planId);
    expect(serviceRecovery.status).toBe("success");
    if (serviceRecovery.status === "success") {
      expect(serviceRecovery.plan.status).toBe("closed");
      expect(serviceRecovery.schedule?.version).toBe(2);
    }

    const recoveredPlan = await freshStorage.plans.getById(samplePlan.planId);
    expect(recoveredPlan).not.toBeNull();
    expect(recoveredPlan?.status).toBe("closed");

    const recoveredSchedule = await freshStorage.schedules.getByPlanId(samplePlan.planId);
    expect(recoveredSchedule).not.toBeNull();
    expect(recoveredSchedule?.version).toBe(2);
    expect(recoveredSchedule?.appliedAdjustments).toHaveLength(1);
    expect(recoveredSchedule?.appliedAdjustments[0]?.adjustmentId).toBe("adj-e2e");
    expect(recoveredSchedule?.timeBlocks[0]?.startTime).toBe("14:00");

    const recoveredClose = await freshStorage.closeReports.getByPlanId(samplePlan.planId);
    expect(recoveredClose).not.toBeNull();
    expect(recoveredClose?.planId).toBe(samplePlan.planId);
    expect(recoveredClose?.output.itemDispositions.completed).toHaveLength(3);
    expect(recoveredClose?.output.status).toBe("success");
  });
});

