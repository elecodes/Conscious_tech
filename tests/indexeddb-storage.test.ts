import { describe, it, expect, beforeEach } from "vitest";
import { indexedDB as fakeIDB, IDBKeyRange as fakeKeyRange } from "fake-indexeddb";
import {
  createIndexedDbStorage,
  openDatabase,
  closeDatabase,
  deleteDatabase,
  DB_VERSION,
  STORES,
} from "../src/infrastructure/storage/indexeddb";
import {
  StoredWeeklyPlan,
  StoredCloseWeekReport,
  StaleVersionConflictError,
  InvalidRecordDataError,
} from "../src/domain/repositories/types";
import { WeeklySchedule } from "../src/domain/schedule";
import { MemoryItem } from "../src/domain/memory";
import { ProposedWeek } from "../src/domain/week";
import { executeCloseWeekDeterministic } from "../src/skills/close-week/deterministic";

describe("Persistencia Local: IndexedDB Storage & Repositories (Fase P2)", () => {
  const TEST_DB_NAME = "conscious_tech_test_db";

  // Provide fakeKeyRange on globalThis if not defined
  if (typeof globalThis.IDBKeyRange === "undefined") {
    (globalThis as unknown as { IDBKeyRange: typeof fakeKeyRange }).IDBKeyRange = fakeKeyRange;
  }

  beforeEach(async () => {
    await deleteDatabase(TEST_DB_NAME, fakeIDB);
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
      intent: "Semana de foco en persistencia",
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
      rationale: "Espacio protegido para margen y calma",
    },
    confirmationPrompt: {
      question: "¿Te representa este plan?",
      keyTradeoffs: ["Zapsac queda como opción flexible"],
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
        note: "Clase de arquitectura",
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

  const closeOutput = executeCloseWeekDeterministic({
    closedAt: "2026-10-18T19:00:00Z",
    activePlan: compliantProposal,
    itemOutcomes: [
      { itemId: "item-aws", status: "completed", actualHours: 12 },
      { itemId: "item-clase", status: "completed", actualHours: 4 },
      { itemId: "item-zapsac", status: "completed", actualHours: 4 },
      { itemId: "item-podcast", status: "not_started" },
    ],
  });

  const sampleCloseReport: StoredCloseWeekReport = {
    reportId: "rep-2026-w42",
    planId: "plan-2026-w42",
    scheduleId: "sched-2026-w42",
    closedAt: "2026-10-18T19:00:00Z",
    output: closeOutput,
  };

  const sampleMemory: MemoryItem = {
    id: "mem-01",
    content: "No agendar compromisos intensivos los lunes temprano",
    category: "preference",
    confirmationStatus: "confirmed",
    temporalStatus: "active",
    tags: ["horarios", "foco"],
    provenance: {
      source: "user_explicit",
      referenceText: "No me agendes nada los lunes por la mañana",
    },
    createdAt: "2026-10-12",
  };

  // ==========================================================================
  // 1. Apertura inicial y creación de almacenes
  // ==========================================================================
  describe("1. Inicialización y almacenes de esquema", () => {
    it("crea la base de datos v1 con los 4 almacenes e índices definidos", async () => {
      const db = await openDatabase(TEST_DB_NAME, DB_VERSION, fakeIDB);
      expect(db.name).toBe(TEST_DB_NAME);
      expect(db.version).toBe(1);

      expect(db.objectStoreNames.contains(STORES.PLANS)).toBe(true);
      expect(db.objectStoreNames.contains(STORES.SCHEDULES)).toBe(true);
      expect(db.objectStoreNames.contains(STORES.CLOSE_REPORTS)).toBe(true);
      expect(db.objectStoreNames.contains(STORES.MEMORIES)).toBe(true);

      const tx = db.transaction([STORES.PLANS, STORES.SCHEDULES, STORES.CLOSE_REPORTS, STORES.MEMORIES], "readonly");
      const plansStore = tx.objectStore(STORES.PLANS);
      expect(plansStore.indexNames.contains("by_target_week_start")).toBe(true);
      expect(plansStore.indexNames.contains("by_status")).toBe(true);

      const schedStore = tx.objectStore(STORES.SCHEDULES);
      expect(schedStore.indexNames.contains("by_plan_id")).toBe(true);
      expect(schedStore.indexNames.contains("by_week_range_start")).toBe(true);

      const closeStore = tx.objectStore(STORES.CLOSE_REPORTS);
      expect(closeStore.indexNames.contains("by_plan_id")).toBe(true);
      expect(closeStore.indexNames.contains("by_closed_at")).toBe(true);

      const memStore = tx.objectStore(STORES.MEMORIES);
      expect(memStore.indexNames.contains("by_category")).toBe(true);
      expect(memStore.indexNames.contains("by_confirmation_status")).toBe(true);
      expect(memStore.indexNames.contains("by_temporal_status")).toBe(true);

      closeDatabase(db);
    });

    it("abre idempotentemente una base ya inicializada sin recrear almacenes", async () => {
      const db1 = await openDatabase(TEST_DB_NAME, 1, fakeIDB);
      closeDatabase(db1);

      const db2 = await openDatabase(TEST_DB_NAME, 1, fakeIDB);
      expect(db2.objectStoreNames.length).toBe(4);
      closeDatabase(db2);
    });
  });

  // ==========================================================================
  // 2. Operaciones CRUD y persistencia tras reconexión
  // ==========================================================================
  describe("2. Operaciones CRUD y reconexión", () => {
    it("guarda, recupera y conserva planes tras cerrar y reabrir conexión", async () => {
      const storage1 = await createIndexedDbStorage({ dbName: TEST_DB_NAME, customFactory: fakeIDB });
      await storage1.plans.save(samplePlan);
      storage1.close();

      const storage2 = await createIndexedDbStorage({ dbName: TEST_DB_NAME, customFactory: fakeIDB });
      const retrieved = await storage2.plans.getById(samplePlan.planId);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.planId).toBe(samplePlan.planId);
      expect(retrieved?.status).toBe("active");

      const active = await storage2.plans.getActivePlan();
      expect(active?.planId).toBe(samplePlan.planId);

      const byRange = await storage2.plans.getByWeekRange(samplePlan.targetWeek);
      expect(byRange?.planId).toBe(samplePlan.planId);

      const updateExisting = await storage2.plans.updateStatus(samplePlan.planId, "closed");
      expect(updateExisting).toBe(true);
      const updated = await storage2.plans.getById(samplePlan.planId);
      expect(updated?.status).toBe("closed");

      const updateNonexistent = await storage2.plans.updateStatus("nonexistent-plan", "closed");
      expect(updateNonexistent).toBe(false);

      await storage2.plans.delete(samplePlan.planId);
      const afterDelete = await storage2.plans.getById(samplePlan.planId);
      expect(afterDelete).toBeNull();

      storage2.close();
    });

    it("detecta múltiples planes activos y lanza AmbiguousActivePlanError en getActivePlan()", async () => {
      const storage = await createIndexedDbStorage({ dbName: TEST_DB_NAME, customFactory: fakeIDB });
      const planA = { ...samplePlan, planId: "plan-A", status: "active" as const };
      const planB = { ...samplePlan, planId: "plan-B", status: "active" as const };

      await storage.plans.save(planA);
      await storage.plans.save(planB);

      const allActive = await storage.plans.getActivePlans();
      expect(allActive).toHaveLength(2);

      await expect(storage.plans.getActivePlan()).rejects.toThrow();
      storage.close();
    });

    it("devuelve null ante registros inexistentes sin arrojar excepciones", async () => {
      const storage = await createIndexedDbStorage({ dbName: TEST_DB_NAME, customFactory: fakeIDB });
      expect(await storage.plans.getById("nonexistent")).toBeNull();
      expect(await storage.schedules.getById("nonexistent")).toBeNull();
      expect(await storage.closeReports.getById("nonexistent")).toBeNull();
      expect(await storage.memories.getById("nonexistent")).toBeNull();
      storage.close();
    });
  });

  // ==========================================================================
  // 3. Concurrencia optimista y atomicidad en WeeklySchedule
  // ==========================================================================
  describe("3. Concurrencia optimista y atomicidad en WeeklySchedule", () => {
    it("incrementa la versión en uno al actualizar con expectedScheduleVersion coincidente", async () => {
      const storage = await createIndexedDbStorage({ dbName: TEST_DB_NAME, customFactory: fakeIDB });
      await storage.schedules.save(sampleSchedule);

      const current = await storage.schedules.getById(sampleSchedule.scheduleId);
      expect(current?.version).toBe(1);

      // Guardar con expectedVersion = 1 -> nueva versión 2
      const updatedSchedule = {
        ...sampleSchedule,
        updatedAt: "2026-10-12T09:00:00Z",
      };
      await storage.schedules.save(updatedSchedule, 1);

      const retrieved = await storage.schedules.getById(sampleSchedule.scheduleId);
      expect(retrieved?.version).toBe(2);
      expect(retrieved?.updatedAt).toBe("2026-10-12T09:00:00Z");

      storage.close();
    });

    it("aborta la transacción y lanza StaleVersionConflictError si la versión esperada difiere", async () => {
      const storage = await createIndexedDbStorage({ dbName: TEST_DB_NAME, customFactory: fakeIDB });
      await storage.schedules.save(sampleSchedule);

      // Intento de actualización esperando versión 99 cuando en DB está en versión 1
      await expect(storage.schedules.save(sampleSchedule, 99)).rejects.toThrow(
        StaleVersionConflictError
      );

      // Invariante de atomicidad: la agenda queda intacta en versión 1
      const intact = await storage.schedules.getById(sampleSchedule.scheduleId);
      expect(intact?.version).toBe(1);

      storage.close();
    });

    it("resuelve colisión de dos actualizaciones concurrentes con la misma versión: solo una triunfa", async () => {
      const storage = await createIndexedDbStorage({ dbName: TEST_DB_NAME, customFactory: fakeIDB });
      await storage.schedules.save(sampleSchedule);

      // Rama A y Rama B intentan actualizar concurrentemente desde la versión 1
      const updateA = storage.schedules.save(
        { ...sampleSchedule, updatedAt: "2026-10-12T10:00:00Z" },
        1
      );
      // Tras el primer commit, la versión pasa a 2; la segunda operación con expectedVersion 1 debe fallar
      await updateA;

      await expect(
        storage.schedules.save(
          { ...sampleSchedule, updatedAt: "2026-10-12T11:00:00Z" },
          1
        )
      ).rejects.toThrow(StaleVersionConflictError);

      const finalState = await storage.schedules.getById(sampleSchedule.scheduleId);
      expect(finalState?.version).toBe(2);
      expect(finalState?.updatedAt).toBe("2026-10-12T10:00:00Z");

      storage.close();
    });

    it("conserva íntegro el historial de appliedAdjustments y no produce escrituras parciales", async () => {
      const storage = await createIndexedDbStorage({ dbName: TEST_DB_NAME, customFactory: fakeIDB });
      
      const scheduleWithHistory: WeeklySchedule = {
        ...sampleSchedule,
        appliedAdjustments: [
          {
            adjustmentId: "adj-01",
            proposalId: "prop-01",
            action: {
              type: "postpone_item",
              itemId: "item-aws",
              currentCategory: "flexible_options",
              targetReason: "out_of_capacity",
              hoursFreed: 6,
              rationale: "Sobrecarga de foco",
            },
            expectedScheduleVersion: 1,
            decidedAt: "2026-10-12T10:00:00Z",
            humanDecision: "accepted",
            applicationOutcome: "applied",
            appliedAt: "2026-10-12T10:00:00Z",
            lifecycleStatus: "active",
          },
        ],
      };

      await storage.schedules.save(scheduleWithHistory);
      const retrieved = await storage.schedules.getById(scheduleWithHistory.scheduleId);
      expect(retrieved?.appliedAdjustments).toHaveLength(1);
      expect(retrieved?.appliedAdjustments[0]?.adjustmentId).toBe("adj-01");
      expect(retrieved?.appliedAdjustments[0]?.lifecycleStatus).toBe("active");

      storage.close();
    });
  });

  // ==========================================================================
  // 4. Validación defensiva y aislamiento de registros corruptos
  // ==========================================================================
  describe("4. Validación defensiva y aislamiento de datos corruptos", () => {
    it("lanza InvalidRecordDataError al leer un registro individual corrupto", async () => {
      const db = await openDatabase(TEST_DB_NAME, DB_VERSION, fakeIDB);
      // Inserción directa saltándose el repositorio para simular corrupción
      const tx = db.transaction(STORES.PLANS, "readwrite");
      tx.objectStore(STORES.PLANS).put({
        planId: "corrupt-plan",
        invalidField: 123,
      });
      await new Promise<void>((resolve) => {
        tx.oncomplete = () => resolve();
      });
      closeDatabase(db);

      const storage = await createIndexedDbStorage({ dbName: TEST_DB_NAME, customFactory: fakeIDB });
      await expect(storage.plans.getById("corrupt-plan")).rejects.toThrow(
        InvalidRecordDataError
      );
      storage.close();
    });

    it("en memoria, un registro corrupto no bloquea la lectura de registros válidos independientes", async () => {
      const storage = await createIndexedDbStorage({ dbName: TEST_DB_NAME, customFactory: fakeIDB });
      await storage.memories.save(sampleMemory);

      // Insertar directamente un registro inválido en memories
      const tx = storage.db.transaction(STORES.MEMORIES, "readwrite");
      tx.objectStore(STORES.MEMORIES).put({
        id: "corrupt-mem",
        content: "inválido",
      });
      await new Promise<void>((resolve) => {
        tx.oncomplete = () => resolve();
      });

      // getAll debe advertir y aislar el corrupto sin romper la lectura de sampleMemory
      const all = await storage.memories.getAll();
      expect(all).toHaveLength(1);
      expect(all[0]?.id).toBe("mem-01");

      storage.close();
    });
  });

  // ==========================================================================
  // 5. Memoria, soberanía y filtrado temporal
  // ==========================================================================
  describe("5. Memoria, soberanía y separación de candidatos", () => {
    it("filtra recuerdos por categoría, certeza epistémica y vigencia temporal", async () => {
      const storage = await createIndexedDbStorage({ dbName: TEST_DB_NAME, customFactory: fakeIDB });

      const memFact: MemoryItem = {
        id: "mem-fact",
        content: "El proyecto X usa TypeScript",
        category: "fact",
        confirmationStatus: "confirmed",
        temporalStatus: "active",
        tags: ["tech"],
        provenance: { source: "user_explicit", referenceText: "usamos typescript" },
        createdAt: "2026-10-12",
        validUntil: "2026-10-31",
      };

      const memHypothesis: MemoryItem = {
        id: "mem-hyp",
        content: "Quizás el cliente prefiera React",
        category: "working_hypothesis",
        confirmationStatus: "unconfirmed",
        temporalStatus: "active",
        tags: ["tech"],
        provenance: { source: "conversation_inference", referenceText: "creo que prefiere react" },
        createdAt: "2026-10-12",
      };

      await storage.memories.saveBatch([memFact, memHypothesis]);

      // Filtro por certeza
      const confirmedOnly = await storage.memories.getAll({ confirmationStatuses: ["confirmed"] });
      expect(confirmedOnly).toHaveLength(1);
      expect(confirmedOnly[0]?.id).toBe("mem-fact");

      // Filtro por categoría
      const hypothesisOnly = await storage.memories.getAll({ categories: ["working_hypothesis"] });
      expect(hypothesisOnly).toHaveLength(1);
      expect(hypothesisOnly[0]?.id).toBe("mem-hyp");

      // Filtro temporal: fecha posterior a validUntil
      const activeInNovember = await storage.memories.getAll({ referenceDate: "2026-11-01" });
      expect(activeInNovember.some((m) => m.id === "mem-fact")).toBe(false);

      // Archivar memoria
      await storage.memories.archive("mem-fact");
      const archived = await storage.memories.getById("mem-fact");
      expect(archived?.temporalStatus).toBe("outdated");

      // Olvido soberano (eliminación física)
      await storage.memories.delete("mem-fact");
      expect(await storage.memories.getById("mem-fact")).toBeNull();

      storage.close();
    });

    it("rechaza la persistencia de candidatos crudos que violen las invariantes epistémicas", async () => {
      const storage = await createIndexedDbStorage({ dbName: TEST_DB_NAME, customFactory: fakeIDB });

      // Un recuerdo con fuente conversation_inference no puede tener confirmationStatus 'confirmed'
      const invalidEpistemicMemory = {
        id: "mem-unearned",
        content: "Inferencia no ganada",
        category: "fact" as const,
        confirmationStatus: "confirmed" as const,
        temporalStatus: "active" as const,
        tags: [],
        provenance: {
          source: "conversation_inference" as const,
          referenceText: "parece que sí",
        },
        createdAt: "2026-10-12",
      };

      await expect(storage.memories.save(invalidEpistemicMemory as unknown as MemoryItem)).rejects.toThrow();
      expect(await storage.memories.getById("mem-unearned")).toBeNull();

      storage.close();
    });
  });

  // ==========================================================================
  // 6. Reanudación de sesión (resumeSession)
  // ==========================================================================
  describe("6. Reanudación integral de sesión semanal", () => {
    it("recupera coherentemente el plan activo, la agenda vinculada y los recuerdos vigentes", async () => {
      const storage1 = await createIndexedDbStorage({ dbName: TEST_DB_NAME, customFactory: fakeIDB });
      await storage1.plans.save(samplePlan);
      await storage1.schedules.save(sampleSchedule);
      await storage1.closeReports.save(sampleCloseReport);
      await storage1.memories.save(sampleMemory);
      storage1.close();

      const storage2 = await createIndexedDbStorage({ dbName: TEST_DB_NAME, customFactory: fakeIDB });
      const session = await storage2.resumeSession();

      expect(session.activePlan?.planId).toBe(samplePlan.planId);
      expect(session.activeSchedule?.scheduleId).toBe(sampleSchedule.scheduleId);
      expect(session.latestCloseReport?.reportId).toBe(sampleCloseReport.reportId);
      expect(session.memories).toHaveLength(1);
      expect(session.memories[0]?.id).toBe("mem-01");

      storage2.close();
    });
  });
});
