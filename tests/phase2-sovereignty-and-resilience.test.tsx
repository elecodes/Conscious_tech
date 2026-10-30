import { describe, it, expect, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { indexedDB as fakeIDB, IDBKeyRange as fakeKeyRange } from "fake-indexeddb";
import {
  createIndexedDbStorage,
  deleteDatabase,
  IndexedDbStorageContext,
  exportUserData,
  importUserData,
  UserDataBackupSchema,
} from "../src/infrastructure/storage/indexeddb";
import { StoredWeeklyPlan } from "../src/domain/repositories/types";
import { WeeklySchedule } from "../src/domain/schedule";
import { MemoryItem } from "../src/domain/memory";
import { StoredCloseWeekReport } from "../src/domain/repositories/types";
import { executeCloseWeekDeterministic } from "../src/skills/close-week/deterministic";
import { WeeklySessionService } from "../src/application/weekly-session-service";
import {
  WeeklySessionController,
  WeeklySessionReactContext,
  WeeklySessionContextValue,
} from "../src/web/context/weekly-session-context";
import { WeeklySessionView } from "../src/web/components/weekly-session-view";
import { App } from "../src/web/App";

describe("Fase 2: Soberanía de Datos y Resiliencia (H-03, H-05, H-08)", () => {
  const TEST_DB = "conscious_tech_phase2_test_db";

  if (typeof globalThis.IDBKeyRange === "undefined") {
    (globalThis as unknown as { IDBKeyRange: typeof fakeKeyRange }).IDBKeyRange = fakeKeyRange;
  }

  let storage: IndexedDbStorageContext;
  let service: WeeklySessionService;
  let controller: WeeklySessionController;

  const samplePlan: StoredWeeklyPlan = {
    planId: "plan-2026-10-19-p2",
    createdAt: "2026-10-16T10:00:00.000Z",
    updatedAt: "2026-10-16T10:00:00.000Z",
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
          totalAvailableHours: 25,
          plannableHours: 18.75,
          plannedHours: 10,
          knownEstimatedHours: 10,
          estimationCompleteness: "complete",
          protectedSpaceHours: 6.25,
          capacityStatus: "within_capacity",
          protectedSpaceStatus: "respected",
        },
        intent: "Soberanía de datos",
      },
      foci: [
        {
          id: "focus-1",
          title: "Implementar exportación",
          desiredOutcome: "Respaldo completo",
          rationale: "Seguridad de datos",
          contributingItemIds: ["item-1"],
          estimatedHours: 6,
        },
      ],
      obligations: [],
      flexibleOptions: [],
      deferredItems: [],
      unplannedSpace: {
        recommendedHours: 6.25,
        rationale: "Espacio protegido para margen y calma",
      },
      confirmationPrompt: {
        question: "¿Confirmar?",
        keyTradeoffs: [],
        pendingQuestions: [],
      },
    },
  };

  const sampleSchedule: WeeklySchedule = {
    scheduleId: "sched-2026-10-19-p2",
    planId: "plan-2026-10-19-p2",
    weekRange: {
      startDate: "2026-10-19",
      endDate: "2026-10-25",
    },
    version: 3,
    timeBlocks: [],
    dailyAllocations: [],
    appliedAdjustments: [],
    createdAt: "2026-10-16T10:00:00.000Z",
    updatedAt: "2026-10-16T11:00:00.000Z",
  };

  const closeOutput = executeCloseWeekDeterministic({
    closedAt: "2026-10-25T18:00:00Z",
    activePlan: samplePlan.proposal,
    itemOutcomes: [{ itemId: "item-1", status: "completed", actualHours: 6 }],
  });

  const sampleCloseReport: StoredCloseWeekReport = {
    reportId: "close-report-2026-10-19",
    planId: "plan-2026-10-19-p2",
    scheduleId: "sched-2026-10-19-p2",
    closedAt: "2026-10-25T18:00:00Z",
    output: closeOutput,
  };

  const sampleMemory: MemoryItem = {
    id: "mem-pattern-1",
    content: "Las mañanas de los lunes son mejores para foco profundo",
    category: "preference",
    confirmationStatus: "confirmed",
    temporalStatus: "active",
    tags: ["productividad", "ritmo"],
    provenance: {
      source: "user_explicit",
      referenceText: "Prefiero no agendar reuniones los lunes temprano",
    },
    validUntil: null,
    createdAt: "2026-10-16",
  };

  beforeEach(async () => {
    await deleteDatabase(TEST_DB, fakeIDB);
    storage = await createIndexedDbStorage({
      dbName: TEST_DB,
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

  describe("1. Portabilidad y Respaldo Local (H-08)", () => {
    it("exporta todos los almacenes de IndexedDB con esquema estricto validado por Zod", async () => {
      await storage.plans.save(samplePlan);
      await storage.schedules.save(sampleSchedule);
      await storage.closeReports.save(sampleCloseReport);
      await storage.memories.save(sampleMemory);

      const backup = await exportUserData(storage);

      expect(backup.version).toBe(1);
      expect(backup.app).toBe("conscious_tech");
      expect(typeof backup.exportedAt).toBe("string");
      expect(backup.data.plans).toHaveLength(1);
      expect(backup.data.plans[0]?.planId).toBe(samplePlan.planId);
      expect(backup.data.schedules).toHaveLength(1);
      expect(backup.data.schedules[0]?.scheduleId).toBe(sampleSchedule.scheduleId);
      expect(backup.data.schedules[0]?.version).toBe(3);
      expect(backup.data.closeReports).toHaveLength(1);
      expect(backup.data.closeReports[0]?.reportId).toBe(sampleCloseReport.reportId);
      expect(backup.data.memories).toHaveLength(1);
      expect(backup.data.memories[0]?.id).toBe(sampleMemory.id);

      // Verify schema validates clean
      const validated = UserDataBackupSchema.safeParse(backup);
      expect(validated.success).toBe(true);
    });

    it("restaura completamente los datos reemplazando el estado previo sin errores de versión", async () => {
      // 1. Save original data
      await storage.plans.save(samplePlan);
      await storage.schedules.save(sampleSchedule);
      await storage.closeReports.save(sampleCloseReport);
      await storage.memories.save(sampleMemory);

      const exported = await exportUserData(storage);
      const jsonBackup = JSON.stringify(exported);

      // 2. Clear or mutate database
      await storage.plans.delete(samplePlan.planId);
      await storage.schedules.delete(sampleSchedule.scheduleId);
      await storage.closeReports.delete(sampleCloseReport.reportId);
      await storage.memories.delete(sampleMemory.id);

      expect(await storage.plans.getAll()).toHaveLength(0);
      expect(await storage.schedules.getAll()).toHaveLength(0);
      expect(await storage.closeReports.getAll()).toHaveLength(0);
      expect(await storage.memories.getAll()).toHaveLength(0);

      // 3. Import backup
      const importResult = await importUserData(jsonBackup, storage, { mode: "replace" });
      expect(importResult.importedCounts.plans).toBe(1);
      expect(importResult.importedCounts.schedules).toBe(1);
      expect(importResult.importedCounts.closeReports).toBe(1);
      expect(importResult.importedCounts.memories).toBe(1);

      // 4. Verify restored items
      const restoredPlan = await storage.plans.getById(samplePlan.planId);
      expect(restoredPlan).not.toBeNull();
      expect(restoredPlan?.planId).toBe(samplePlan.planId);

      const restoredSchedule = await storage.schedules.getById(sampleSchedule.scheduleId);
      expect(restoredSchedule).not.toBeNull();
      expect(restoredSchedule?.version).toBe(3);

      const restoredReport = await storage.closeReports.getById(sampleCloseReport.reportId);
      expect(restoredReport).not.toBeNull();

      const restoredMemory = await storage.memories.getById(sampleMemory.id);
      expect(restoredMemory).not.toBeNull();
      expect(restoredMemory?.temporalStatus).toBe("active");
    });

    it("rechaza archivos de respaldo inválidos o corruptos con mensajes descriptivos", async () => {
      await expect(importUserData("not valid json", storage)).rejects.toThrow("JSON no válido");

      const corruptedData = {
        version: 1,
        app: "other_app",
        exportedAt: new Date().toISOString(),
        data: { plans: [], schedules: [], closeReports: [], memories: [] },
      };

      await expect(importUserData(JSON.stringify(corruptedData), storage)).rejects.toThrow(
        "El archivo de respaldo no es válido para Conscious Tech"
      );
    });
  });

  describe("2. Gobernanza de Recuerdos en UI (H-05)", () => {
    it("permite desactivar (archivar) un recuerdo para que no influya en futuras planificaciones", async () => {
      await storage.memories.save(sampleMemory);

      // Archiving
      await service.archiveMemory(sampleMemory.id);

      const updated = await storage.memories.getById(sampleMemory.id);
      expect(updated).not.toBeNull();
      expect(updated?.temporalStatus).toBe("outdated");

      // Active memories query filters it out
      const activeOnly = await storage.memories.getAll({ temporalStatuses: ["active"] });
      expect(activeOnly).toHaveLength(0);
    });

    it("permite olvidar (borrar definitivamente) un recuerdo respetando la privacidad", async () => {
      await storage.memories.save(sampleMemory);

      await service.deleteMemory(sampleMemory.id);

      const deleted = await storage.memories.getById(sampleMemory.id);
      expect(deleted).toBeNull();
    });

    it("renderiza controles explícitos 'Desactivar' y 'Olvidar' en la lista de recuerdos confirmados", () => {
      const mockContextValue: WeeklySessionContextValue = {
        state: {
          status: "session_resumed",
          activePlan: samplePlan,
          activeSchedule: sampleSchedule,
          latestCloseReport: null,
          latestClosedPlan: null,
          latestClosedWeek: null,
          concurrencyConflict: null,
          memories: [sampleMemory],
          memoryCandidates: [],
          ambiguousPlanIds: [],
          inconsistencyReason: null,
          errorMessage: null,
          draftPlan: null,
          draftPlans: [],
        },
        service,
        controller,
        reloadSession: async () => {},
        createOrSavePlan: async () => ({
          status: "success",
          plan: samplePlan,
          schedule: sampleSchedule,
        }),
        applyAdjustment: async () => ({
          status: "success",
          schedule: sampleSchedule,
          appliedRecord: {} as any,
        }),
        closeWeek: async () => ({
          status: "success",
          closeReport: sampleCloseReport,
          memoryCandidates: [],
        }),
        confirmMemoryCandidate: async () => ({
          status: "applied",
          operationType: "add",
          memoryId: "c1",
        }),
        confirmMemoryOperation: async () => ({
          status: "applied",
          operationType: "add",
          memoryId: "m1",
        }),
        archiveMemory: async () => {},
        deleteMemory: async () => {},
        exportBackup: async () => ({
          version: 1,
          app: "conscious_tech",
          exportedAt: "",
          data: { plans: [], schedules: [], closeReports: [], memories: [] },
        }),
        importBackup: async () => ({
          importedCounts: { plans: 0, schedules: 0, closeReports: 0, memories: 0 },
          exportedAt: "",
        }),
        purgeSession: async () => ({ status: "success", purgedPlanId: "p1" }),
        resolveAmbiguity: async () => {},
        saveDraftPlan: async () => ({ status: "success", plan: samplePlan }),
        clearDraftPlan: async () => {},
      };

      const html = renderToStaticMarkup(
        <WeeklySessionReactContext.Provider value={mockContextValue}>
          <WeeklySessionView />
        </WeeklySessionReactContext.Provider>
      );

      expect(html).toContain("Memorias activas confirmadas");
      expect(html).toContain("Las mañanas de los lunes son mejores para foco profundo");
      expect(html).toContain("💤 Desactivar");
      expect(html).toContain("🗑️ Olvidar");
    });
  });

  describe("3. Autoguardado en Captura y Controles de Respaldo en App (H-03)", () => {
    it("renderiza el indicador de borrador y botón de limpiar cuando hay texto en volcado", () => {
      // Mock localStorage with text
      const mockStorage: Record<string, string> = {
        conscious_tech_transient_dump_text: "Mi volcado de prueba pendiente de ordenar",
      };
      const origGetItem = globalThis.localStorage?.getItem;
      globalThis.localStorage = {
        ...globalThis.localStorage,
        getItem: (k: string) => mockStorage[k] || null,
        setItem: (k: string, v: string) => {
          mockStorage[k] = v;
        },
        removeItem: (k: string) => {
          delete mockStorage[k];
        },
      } as Storage;

      const html = renderToStaticMarkup(<App initialTab="dump" service={service} />);

      expect(html).toContain('data-testid="dump-autosave-indicator"');
      expect(html).toContain("Borrador guardado automáticamente");
      expect(html).toContain('data-testid="clear-dump-button"');
      expect(html).toContain("Limpiar volcado");

      // Verify backup section in footer
      expect(html).toContain('data-testid="export-backup-button"');
      expect(html).toContain("Descargar copia (.json)");
      expect(html).toContain('data-testid="import-backup-label"');
      expect(html).toContain("Restaurar copia (.json)");

      if (origGetItem) {
        globalThis.localStorage.getItem = origGetItem;
      }
    });
  });
});
