import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { createIndexedDbStorage } from "../src/infrastructure/storage/indexeddb";
import { WeeklySessionService } from "../src/application/weekly-session-service";
import {
  StoredWeeklyPlan,
  AmbiguousDraftPlanError,
  StaleVersionConflictError,
} from "../src/domain/repositories/types";
import { WeeklySchedule } from "../src/domain/schedule";
import { TargetWeek, ProposedWeek } from "../src/domain/week";

const fakeIDB = new IDBFactory();

function createDummyProposal(targetWeek: TargetWeek, title = "Tarea Demo"): ProposedWeek {
  return {
    weekSummary: {
      targetWeek,
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
      intent: `Plan para la semana ${targetWeek.startDate}`,
    },
    foci: [
      {
        id: "focus-1",
        title,
        desiredOutcome: "Resultado de foco",
        rationale: "Razón para foco",
        contributingItemIds: ["item-1"],
        estimatedHours: 6,
      },
    ],
    obligations: [
      {
        itemId: "item-2",
        title: "Obligación",
        commitmentType: "strict_deadline",
        rationale: "Razón de obligación",
        estimatedHours: 4,
      },
    ],
    flexibleOptions: [],
    deferredItems: [],
    unplannedSpace: {
      recommendedHours: 5,
      rationale: "Espacio protegido",
    },
    confirmationPrompt: {
      question: "¿Confirmar?",
      keyTradeoffs: [],
      pendingQuestions: [],
    },
  };
}

describe("Fase 1: Estabilización de Transacciones, Concurrencia y Aislamiento de Borradores", () => {
  let storage: Awaited<ReturnType<typeof createIndexedDbStorage>>;
  let service: WeeklySessionService;

  const weekA: TargetWeek = {
    startDate: "2026-10-12",
    endDate: "2026-10-18",
  };

  const weekB: TargetWeek = {
    startDate: "2026-10-19",
    endDate: "2026-10-25",
  };

  beforeEach(async () => {
    const testDbName = "test-phase1-db-" + Math.random().toString(36).substring(7) + "-" + Date.now();
    storage = await createIndexedDbStorage({
      dbName: testDbName,
      customFactory: fakeIDB,
    });
    service = new WeeklySessionService({
      plans: storage.plans,
      schedules: storage.schedules,
      closeReports: storage.closeReports,
      memories: storage.memories,
      getDb: () => storage.db,
    });
  });

  afterEach(() => {
    storage.close();
  });

  // ==========================================================================
  // H-01: Evitar que createOrSavePlanAndSchedule elimine planes preexistentes
  // ==========================================================================
  describe("H-01: Preservación de plan existente ante fallo en schedule save", () => {
    it("elimina el plan si era nuevo y falla el guardado de la agenda (rollback de nuevo plan)", async () => {
      const plan: StoredWeeklyPlan = {
        planId: "plan-new-weekA",
        status: "active",
        targetWeek: weekA,
        proposal: createDummyProposal(weekA),
        createdAt: "2026-10-12T08:00:00.000Z",
        updatedAt: "2026-10-12T08:00:00.000Z",
      };

      const schedule: WeeklySchedule = {
        scheduleId: "sched-plan-new-weekA",
        planId: "plan-new-weekA",
        weekRange: weekA,
        timeBlocks: [],
        dailyAllocations: [],
        dayConstraints: [],
        appliedAdjustments: [],
        version: 1,
        createdAt: "2026-10-12T08:00:00.000Z",
        updatedAt: "2026-10-12T08:00:00.000Z",
      };

      // Forzamos fallo en el repositorio de schedules
      const originalSave = storage.schedules.save.bind(storage.schedules);
      storage.schedules.save = vi.fn().mockRejectedValue(new Error("Simulated schedule disk failure"));

      await expect(service.createOrSavePlanAndSchedule(plan, schedule)).rejects.toThrow(
        "Simulated schedule disk failure"
      );

      // Como era un plan nuevo, debe haberse limpiado para no dejar un huérfano sin agenda
      const foundPlan = await storage.plans.getById("plan-new-weekA");
      expect(foundPlan).toBeNull();

      storage.schedules.save = originalSave;
    });

    it("NO elimina un plan existente si falla la actualización de su agenda: restaura su estado anterior", async () => {
      // 1. Guardamos un plan existente inicial
      const initialPlan: StoredWeeklyPlan = {
        planId: "plan-existing-weekA",
        status: "active",
        targetWeek: weekA,
        proposal: createDummyProposal(weekA, "Foco Original"),
        createdAt: "2026-10-12T08:00:00.000Z",
        updatedAt: "2026-10-12T08:00:00.000Z",
      };
      await storage.plans.save(initialPlan);

      // 2. Intentamos actualizar el plan con nuevos focos, pero la agenda falla
      const updatedPlan: StoredWeeklyPlan = {
        ...initialPlan,
        proposal: createDummyProposal(weekA, "Foco Modificado que debería compensarse"),
        updatedAt: "2026-10-12T12:00:00.000Z",
      };

      const schedule: WeeklySchedule = {
        scheduleId: "sched-plan-existing-weekA",
        planId: "plan-existing-weekA",
        weekRange: weekA,
        timeBlocks: [],
        dailyAllocations: [],
        dayConstraints: [],
        appliedAdjustments: [],
        version: 2,
        createdAt: "2026-10-12T08:00:00.000Z",
        updatedAt: "2026-10-12T12:00:00.000Z",
      };

      const originalSave = storage.schedules.save.bind(storage.schedules);
      storage.schedules.save = vi.fn().mockRejectedValue(new Error("Disk IO error while saving schedule"));

      await expect(service.createOrSavePlanAndSchedule(updatedPlan, schedule)).rejects.toThrow(
        "Disk IO error while saving schedule"
      );

      // 3. Verificamos que el plan NO FUE ELIMINADO de la base de datos
      const preservedPlan = await storage.plans.getById("plan-existing-weekA");
      expect(preservedPlan).not.toBeNull();
      // Y además verificamos que se compensó restaurando su contenido original
      expect(preservedPlan?.proposal.foci[0]?.title).toBe("Foco Original");

      storage.schedules.save = originalSave;
    });

    it("conserva un borrador previo si la activación a active falla durante el guardado de la agenda", async () => {
      // 1. Un borrador existe en storage
      const draftPlan: StoredWeeklyPlan = {
        planId: "draft-weekA",
        status: "draft",
        targetWeek: weekA,
        proposal: createDummyProposal(weekA, "Borrador de semana"),
        createdAt: "2026-10-12T08:00:00.000Z",
        updatedAt: "2026-10-12T08:00:00.000Z",
      };
      await storage.plans.save(draftPlan);

      // 2. Se intenta activar ese mismo plan pasando status: 'active', pero la agenda falla
      const activatingPlan: StoredWeeklyPlan = {
        ...draftPlan,
        status: "active",
        updatedAt: "2026-10-12T09:00:00.000Z",
      };

      const schedule: WeeklySchedule = {
        scheduleId: "sched-draft-weekA",
        planId: "draft-weekA",
        weekRange: weekA,
        timeBlocks: [],
        dailyAllocations: [],
        dayConstraints: [],
        appliedAdjustments: [],
        version: 1,
        createdAt: "2026-10-12T09:00:00.000Z",
        updatedAt: "2026-10-12T09:00:00.000Z",
      };

      const originalSave = storage.schedules.save.bind(storage.schedules);
      storage.schedules.save = vi.fn().mockRejectedValue(new Error("Schedule failure on activation"));

      await expect(service.createOrSavePlanAndSchedule(activatingPlan, schedule)).rejects.toThrow(
        "Schedule failure on activation"
      );

      // El plan NO fue eliminado: se restauró su estado previo de borrador
      const recoveredDraft = await storage.plans.getById("draft-weekA");
      expect(recoveredDraft).not.toBeNull();
      expect(recoveredDraft?.status).toBe("draft");

      storage.schedules.save = originalSave;
    });
  });

  // ==========================================================================
  // H-02: Manejo de versiones al reactivar / actualizar y concurrencia
  // ==========================================================================
  describe("H-02: Manejo de versiones y no duplicación al reactivar o actualizar", () => {
    it("permite actualizar una semana activa conservando y avanzando la versión de la agenda sin colisión", async () => {
      // 1. Activar semana inicial (versión 1)
      const plan: StoredWeeklyPlan = {
        planId: "plan-weekA-v1",
        status: "active",
        targetWeek: weekA,
        proposal: createDummyProposal(weekA),
        createdAt: "2026-10-12T08:00:00.000Z",
        updatedAt: "2026-10-12T08:00:00.000Z",
      };
      const schedule: WeeklySchedule = {
        scheduleId: "sched-plan-weekA-v1",
        planId: "plan-weekA-v1",
        weekRange: weekA,
        timeBlocks: [],
        dailyAllocations: [],
        dayConstraints: [],
        appliedAdjustments: [],
        version: 1,
        createdAt: "2026-10-12T08:00:00.000Z",
        updatedAt: "2026-10-12T08:00:00.000Z",
      };
      const res1 = await service.createOrSavePlanAndSchedule(plan, schedule);
      expect(res1.status).toBe("success");

      // 2. Simular que la agenda avanzó a versión 3 (por ejemplo tras 2 ajustes)
      const advancedSchedule: WeeklySchedule = {
        ...schedule,
        version: 3,
        updatedAt: "2026-10-12T10:00:00.000Z",
      };
      await storage.schedules.save(advancedSchedule, 1); // pasa a 2
      await storage.schedules.save(advancedSchedule, 2); // pasa a 3

      const currentSched = await storage.schedules.getById(schedule.scheduleId);
      expect(currentSched?.version).toBe(3);

      // 3. Reactivar o actualizar la misma semana activa esperando versión 3
      const updatedPlan: StoredWeeklyPlan = {
        ...plan,
        updatedAt: "2026-10-12T11:00:00.000Z",
      };
      const updatedSchedule: WeeklySchedule = {
        ...currentSched!,
        version: 4,
        updatedAt: "2026-10-12T11:00:00.000Z",
      };

      const res2 = await service.createOrSavePlanAndSchedule(
        updatedPlan,
        updatedSchedule,
        3 // expectedScheduleVersion
      );
      expect(res2.status).toBe("success");

      // Verificamos que la agenda ahora está en versión 4 y no se crearon planes duplicados
      const finalSched = await storage.schedules.getById(schedule.scheduleId);
      expect(finalSched?.version).toBe(4);

      const allActivePlans = await storage.plans.getActivePlans();
      expect(allActivePlans).toHaveLength(1);
      expect(allActivePlans[0]?.planId).toBe("plan-weekA-v1");
    });

    it("rechaza sobrescrituras obsoletas cuando la versión de la agenda no coincide (concurrency guard)", async () => {
      // 1. Crear agenda en versión 1 y avanzar a versión 2
      const plan: StoredWeeklyPlan = {
        planId: "plan-concurrency-test",
        status: "active",
        targetWeek: weekA,
        proposal: createDummyProposal(weekA),
        createdAt: "2026-10-12T08:00:00.000Z",
        updatedAt: "2026-10-12T08:00:00.000Z",
      };
      const schedule: WeeklySchedule = {
        scheduleId: "sched-concurrency-test",
        planId: "plan-concurrency-test",
        weekRange: weekA,
        timeBlocks: [],
        dailyAllocations: [],
        dayConstraints: [],
        appliedAdjustments: [],
        version: 1,
        createdAt: "2026-10-12T08:00:00.000Z",
        updatedAt: "2026-10-12T08:00:00.000Z",
      };
      await service.createOrSavePlanAndSchedule(plan, schedule);

      // Otra pestaña avanza la agenda a versión 2
      await storage.schedules.save(schedule, 1);

      // 2. La pestaña actual intenta guardar asumiendo versión 1
      const staleSchedule: WeeklySchedule = {
        ...schedule,
        dailyAllocations: [{ day: "2026-10-12", allocatedHours: 2, itemId: "item-1" }],
        version: 1,
      };

      await expect(
        service.createOrSavePlanAndSchedule(plan, staleSchedule, 1)
      ).rejects.toThrow(StaleVersionConflictError);

      // Comprobar que la agenda en BD sigue en versión 2 intacta sin sobrescribirse
      const currentInDb = await storage.schedules.getById("sched-concurrency-test");
      expect(currentInDb?.version).toBe(2);
      expect(currentInDb?.dailyAllocations).toHaveLength(0);
    });

    it("activación repetida de la misma semana no crea planes ni agendas duplicadas", async () => {
      const plan: StoredWeeklyPlan = {
        planId: "plan-repeat-activation",
        status: "active",
        targetWeek: weekA,
        proposal: createDummyProposal(weekA),
        createdAt: "2026-10-12T08:00:00.000Z",
        updatedAt: "2026-10-12T08:00:00.000Z",
      };
      const schedule: WeeklySchedule = {
        scheduleId: "sched-repeat-activation",
        planId: "plan-repeat-activation",
        weekRange: weekA,
        timeBlocks: [],
        dailyAllocations: [],
        dayConstraints: [],
        appliedAdjustments: [],
        version: 1,
        createdAt: "2026-10-12T08:00:00.000Z",
        updatedAt: "2026-10-12T08:00:00.000Z",
      };

      // Primera activación
      const r1 = await service.createOrSavePlanAndSchedule(plan, schedule);
      expect(r1.status).toBe("success");

      // Segunda activación con el mismo planId
      const r2 = await service.createOrSavePlanAndSchedule(plan, schedule);
      expect(r2.status).toBe("success");

      // Verificamos que solo existe 1 plan activo y 1 agenda
      const activePlans = await storage.plans.getActivePlans();
      expect(activePlans).toHaveLength(1);
      expect(activePlans[0]?.planId).toBe("plan-repeat-activation");

      const sched = await storage.schedules.getByPlanId("plan-repeat-activation");
      expect(sched).not.toBeNull();
      expect(sched?.scheduleId).toBe("sched-repeat-activation");
    });
  });

  // ==========================================================================
  // H-07: Recuperación, resolución explícita y aislamiento de múltiples borradores
  // ==========================================================================
  describe("H-07: Recuperación y aislamiento de múltiples borradores", () => {
    it("recupera exactamente el borrador de cada semana sin mezclar datos", async () => {
      const draftA: StoredWeeklyPlan = {
        planId: "draft-2026-10-12",
        status: "draft",
        targetWeek: weekA,
        proposal: createDummyProposal(weekA, "Foco Semana A"),
        createdAt: "2026-10-12T08:00:00.000Z",
        updatedAt: "2026-10-12T08:00:00.000Z",
      };
      const draftB: StoredWeeklyPlan = {
        planId: "draft-2026-10-19",
        status: "draft",
        targetWeek: weekB,
        proposal: createDummyProposal(weekB, "Foco Semana B"),
        createdAt: "2026-10-12T09:00:00.000Z",
        updatedAt: "2026-10-12T09:00:00.000Z",
      };

      await service.saveDraftPlan(draftA);
      await service.saveDraftPlan(draftB);

      const recoveredA = await service.getDraftPlan(weekA);
      expect(recoveredA?.planId).toBe("draft-2026-10-12");
      expect(recoveredA?.proposal.foci[0]?.title).toBe("Foco Semana A");

      const recoveredB = await service.getDraftPlan(weekB);
      expect(recoveredB?.planId).toBe("draft-2026-10-19");
      expect(recoveredB?.proposal.foci[0]?.title).toBe("Foco Semana B");
    });

    it("lanza AmbiguousDraftPlanError si se llama getDraftPlan() sin targetWeek habiendo múltiples borradores", async () => {
      const draftA: StoredWeeklyPlan = {
        planId: "draft-weekA",
        status: "draft",
        targetWeek: weekA,
        proposal: createDummyProposal(weekA),
        createdAt: "2026-10-12T08:00:00.000Z",
        updatedAt: "2026-10-12T08:00:00.000Z",
      };
      const draftB: StoredWeeklyPlan = {
        planId: "draft-weekB",
        status: "draft",
        targetWeek: weekB,
        proposal: createDummyProposal(weekB),
        createdAt: "2026-10-12T09:00:00.000Z",
        updatedAt: "2026-10-12T09:00:00.000Z",
      };

      await service.saveDraftPlan(draftA);
      await service.saveDraftPlan(draftB);

      // Llamada sin targetWeek debe fallar con error explícito de ambigüedad
      await expect(service.getDraftPlan()).rejects.toThrow(AmbiguousDraftPlanError);
    });

    it("al activar la Semana A, se elimina exclusivamente el borrador de la Semana A y se conserva el de la Semana B", async () => {
      const draftA: StoredWeeklyPlan = {
        planId: "draft-weekA-to-activate",
        status: "draft",
        targetWeek: weekA,
        proposal: createDummyProposal(weekA),
        createdAt: "2026-10-12T08:00:00.000Z",
        updatedAt: "2026-10-12T08:00:00.000Z",
      };
      const draftB: StoredWeeklyPlan = {
        planId: "draft-weekB-to-keep",
        status: "draft",
        targetWeek: weekB,
        proposal: createDummyProposal(weekB),
        createdAt: "2026-10-12T09:00:00.000Z",
        updatedAt: "2026-10-12T09:00:00.000Z",
      };

      await service.saveDraftPlan(draftA);
      await service.saveDraftPlan(draftB);

      // Activamos Semana A
      const activePlanA: StoredWeeklyPlan = {
        planId: "plan-weekA-active",
        status: "active",
        targetWeek: weekA,
        proposal: createDummyProposal(weekA),
        createdAt: "2026-10-12T10:00:00.000Z",
        updatedAt: "2026-10-12T10:00:00.000Z",
      };
      const scheduleA: WeeklySchedule = {
        scheduleId: "sched-plan-weekA-active",
        planId: "plan-weekA-active",
        weekRange: weekA,
        timeBlocks: [],
        dailyAllocations: [],
        dayConstraints: [],
        appliedAdjustments: [],
        version: 1,
        createdAt: "2026-10-12T10:00:00.000Z",
        updatedAt: "2026-10-12T10:00:00.000Z",
      };

      const res = await service.createOrSavePlanAndSchedule(activePlanA, scheduleA);
      expect(res.status).toBe("success");

      // Verificamos que el borrador de Semana A ya no existe
      const remainingDraftA = await service.getDraftPlan(weekA);
      expect(remainingDraftA).toBeNull();

      // Y que el borrador de Semana B sigue intacto
      const remainingDraftB = await service.getDraftPlan(weekB);
      expect(remainingDraftB).not.toBeNull();
      expect(remainingDraftB?.planId).toBe("draft-weekB-to-keep");
    });

    it("al cancelar la propuesta de la Semana A con clearDraftPlan(targetWeek), se elimina solo el borrador de A y B permanece", async () => {
      const draftA: StoredWeeklyPlan = {
        planId: "draft-weekA-cancel",
        status: "draft",
        targetWeek: weekA,
        proposal: createDummyProposal(weekA),
        createdAt: "2026-10-12T08:00:00.000Z",
        updatedAt: "2026-10-12T08:00:00.000Z",
      };
      const draftB: StoredWeeklyPlan = {
        planId: "draft-weekB-preserve",
        status: "draft",
        targetWeek: weekB,
        proposal: createDummyProposal(weekB),
        createdAt: "2026-10-12T09:00:00.000Z",
        updatedAt: "2026-10-12T09:00:00.000Z",
      };

      await service.saveDraftPlan(draftA);
      await service.saveDraftPlan(draftB);

      // Cancelamos específicamente semana A pasando TargetWeek
      await service.clearDraftPlan(weekA);

      expect(await service.getDraftPlan(weekA)).toBeNull();

      const preservedDraftB = await service.getDraftPlan(weekB);
      expect(preservedDraftB).not.toBeNull();
      expect(preservedDraftB?.planId).toBe("draft-weekB-preserve");
    });
  });
});
