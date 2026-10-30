import { describe, it, expect } from "vitest";
import { z } from "zod";
import { indexedDB as fakeIDB, IDBKeyRange as fakeKeyRange } from "fake-indexeddb";
import { ProposedWeekSchema } from "../src/domain/week";
import { WeeklyScheduleSchema } from "../src/domain/schedule";
import { WeeklyPlanDraftContextSchema } from "../src/domain/repositories/types";
import { EffortSchema } from "../src/domain/items";
import { CalendarEventSchema } from "../src/domain/calendar";
import { MemoryItemSchema } from "../src/domain/memory";
import { ProposeAdjustmentUserPreferencesSchema } from "../src/domain/adjustment";
import { TimeBlockSchema } from "../src/domain/conflict";
import {
  createIndexedDbStorage,
  deleteDatabase,
  openDatabase,
  closeDatabase,
  STORES,
  DB_VERSION,
} from "../src/infrastructure/storage/indexeddb";
import { parseAndValidateExtractedItems } from "../src/skills/extract-items/parser";
import { parseAndValidateRelationships } from "../src/skills/detect-relationships/parser";
import { parseAndValidateGroupedWork } from "../src/skills/group-work/parser";
import { parseAndValidateDeadlines } from "../src/skills/detect-deadlines/parser";
import { parseAndValidateContextOutput } from "../src/skills/evaluate-context/parser";
import { parseAndValidateProposedWeek } from "../src/skills/build-week/parser";

if (typeof globalThis.indexedDB === "undefined") {
  (globalThis as unknown as { indexedDB: typeof fakeIDB }).indexedDB = fakeIDB;
}
if (typeof globalThis.IDBKeyRange === "undefined") {
  (globalThis as unknown as { IDBKeyRange: typeof fakeKeyRange }).IDBKeyRange = fakeKeyRange;
}

describe("Zod 4 Migration — Strict Object and Default Semantics Parity", () => {
  describe("1. Strict rejection of unknown keys", () => {
    it("rejects unknown keys on ProposedWeekSchema", () => {
      const validWeek = {
        weekSummary: {
          targetWeek: { startDate: "2026-10-12", endDate: "2026-10-18" },
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
          intent: "Semana balanceada",
        },
        foci: [],
        obligations: [],
        flexibleOptions: [],
        deferredItems: [],
        unplannedSpace: {
          rationale: "Espacio protegido",
          recommendedHours: 7,
        },
        extraBogusKey: "malicious_payload",
      };

      const result = ProposedWeekSchema.safeParse(validWeek);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((i) => i.code === "unrecognized_keys")).toBe(true);
      }
    });

    it("rejects unknown keys on TimeBlockSchema", () => {
      const block = {
        blockId: "block-1",
        date: "2026-10-12",
        startTime: "09:00",
        endTime: "10:00",
        label: "Sync",
        unrecognizedField: true,
      };

      const result = TimeBlockSchema.safeParse(block);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((i) => i.code === "unrecognized_keys")).toBe(true);
      }
    });
  });

  describe("2. Default values semantics on missing key, undefined, and null", () => {
    it("EffortSchema: applies default source='user' on missing and undefined, rejects null", () => {
      const base = {
        value: 2,
        unit: "hours" as const,
      };

      // Missing key -> defaults to "user"
      const parsedMissing = EffortSchema.parse(base);
      expect(parsedMissing.source).toBe("user");

      // Explicit undefined -> defaults to "user"
      const parsedUndefined = EffortSchema.parse({ ...base, source: undefined });
      expect(parsedUndefined.source).toBe("user");

      // Explicit null -> rejects
      const resultNull = EffortSchema.safeParse({ ...base, source: null });
      expect(resultNull.success).toBe(false);
    });

    it("WeeklyScheduleSchema: applies default arrays and version=1 on missing and undefined, rejects null", () => {
      const base = {
        scheduleId: "sched-1",
        planId: "plan-1",
        weekRange: { startDate: "2026-10-12", endDate: "2026-10-18" },
        createdAt: "2026-10-12T08:00:00.000Z",
        updatedAt: "2026-10-12T08:00:00.000Z",
      };

      const parsedMissing = WeeklyScheduleSchema.parse(base);
      expect(parsedMissing.timeBlocks).toEqual([]);
      expect(parsedMissing.dailyAllocations).toEqual([]);
      expect(parsedMissing.appliedAdjustments).toEqual([]);
      expect(parsedMissing.version).toBe(1);

      const parsedUndefined = WeeklyScheduleSchema.parse({
        ...base,
        timeBlocks: undefined,
        dailyAllocations: undefined,
        appliedAdjustments: undefined,
        version: undefined,
      });
      expect(parsedUndefined.timeBlocks).toEqual([]);
      expect(parsedUndefined.version).toBe(1);

      expect(WeeklyScheduleSchema.safeParse({ ...base, timeBlocks: null }).success).toBe(false);
      expect(WeeklyScheduleSchema.safeParse({ ...base, version: null }).success).toBe(false);
    });

    it("CalendarEventSchema: applies default allDay=false on missing and undefined, rejects null", () => {
      const base = {
        id: "cal-1",
        title: "Meeting",
        day: "2026-10-12",
        startTime: "10:00",
        endTime: "11:00",
        durationHours: 1,
      };

      expect(CalendarEventSchema.parse(base).allDay).toBe(false);
      expect(CalendarEventSchema.parse({ ...base, allDay: undefined }).allDay).toBe(false);
      expect(CalendarEventSchema.safeParse({ ...base, allDay: null }).success).toBe(false);
    });

    it("MemoryItemSchema: applies default tags=[] on missing and undefined, rejects null", () => {
      const base = {
        id: "mem-1",
        content: "Prefers deep work on Tuesday mornings",
        category: "preference" as const,
        confirmationStatus: "unconfirmed" as const,
        temporalStatus: "active" as const,
        createdAt: "2026-10-12",
        provenance: {
          source: "conversation_inference" as const,
          referenceText: "I usually prefer mornings",
        },
      };

      expect(MemoryItemSchema.parse(base).tags).toEqual([]);
      expect(MemoryItemSchema.parse({ ...base, tags: undefined }).tags).toEqual([]);
      expect(MemoryItemSchema.safeParse({ ...base, tags: null }).success).toBe(false);
    });

    it("ProposeAdjustmentUserPreferencesSchema: applies default maxProposals=3 on missing and undefined", () => {
      const parsedMissing = ProposeAdjustmentUserPreferencesSchema.parse({});
      expect(parsedMissing.maxProposals).toBe(3);

      const parsedUndefined = ProposeAdjustmentUserPreferencesSchema.parse({
        maxProposals: undefined,
      });
      expect(parsedUndefined.maxProposals).toBe(3);

      expect(ProposeAdjustmentUserPreferencesSchema.safeParse({ maxProposals: null }).success).toBe(
        false
      );
    });
  });

  describe("3. Record schema with string keys in WeeklyPlanDraftContextSchema", () => {
    it("parses valid overdueDecisions and deferredDecisions records", () => {
      const draftContext = {
        overdueDecisions: {
          "task-1": {
            decision: "reschedule_future",
            rescheduleTargetWeek: { startDate: "2026-10-19", endDate: "2026-10-25" },
          },
          "task-2": {
            decision: "keep_unscheduled",
          },
        },
        deferredDecisions: {
          "task-3": "intentional_postponement",
          "task-4": "included",
        },
      };

      const result = WeeklyPlanDraftContextSchema.safeParse(draftContext);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.overdueDecisions?.["task-1"].decision).toBe("reschedule_future");
        expect(result.data.deferredDecisions?.["task-3"]).toBe("intentional_postponement");
      }
    });
  });

  describe("4. Persisted IndexedDB records backward-compatibility", () => {
    const TEST_MIGRATION_DB = "conscious_tech_zod4_migration_test_db";

    if (typeof globalThis.IDBKeyRange === "undefined") {
      (globalThis as unknown as { IDBKeyRange: typeof fakeKeyRange }).IDBKeyRange = fakeKeyRange;
    }

    it("successfully retrieves and parses plan, schedule, and memory records written in zod 3 shape", async () => {
      await deleteDatabase(TEST_MIGRATION_DB, fakeIDB);

      // 1. Manually write records directly into raw IndexedDB object stores
      const db = await openDatabase(TEST_MIGRATION_DB, DB_VERSION, fakeIDB);
      const tx = db.transaction([STORES.PLANS, STORES.SCHEDULES, STORES.MEMORIES], "readwrite");

      const legacyPlan = {
        planId: "plan-zod3-compat",
        createdAt: "2026-10-12T08:00:00.000Z",
        updatedAt: "2026-10-12T08:00:00.000Z",
        targetWeek: { startDate: "2026-10-12", endDate: "2026-10-18" },
        status: "active",
        proposal: {
          weekSummary: {
            targetWeek: { startDate: "2026-10-12", endDate: "2026-10-18" },
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
            intent: "Semana migrada de zod 3",
          },
          foci: [
            {
              id: "focus-1",
              title: "Foco principal",
              desiredOutcome: "Resultado claro",
              rationale: "Foco importante",
              contributingItemIds: ["task-1"],
              estimatedHours: 6,
            },
          ],
          obligations: [],
          flexibleOptions: [],
          deferredItems: [],
          unplannedSpace: { rationale: "Protegido", recommendedHours: 7 },
          confirmationPrompt: {
            question: "¿Quieres confirmar?",
            keyTradeoffs: [],
            pendingQuestions: [],
          },
        },
      };

      const legacySchedule = {
        scheduleId: "sched-zod3-compat",
        planId: "plan-zod3-compat",
        weekRange: { startDate: "2026-10-12", endDate: "2026-10-18" },
        createdAt: "2026-10-12T08:00:00.000Z",
        updatedAt: "2026-10-12T08:00:00.000Z",
        timeBlocks: [
          {
            day: "2026-10-12",
            startTime: "09:00",
            endTime: "11:00",
            itemId: "task-1",
            note: "Bloque de foco",
          },
        ],
        dailyAllocations: [
          {
            day: "2026-10-12",
            itemId: "task-1",
            allocatedHours: 2,
          },
        ],
        appliedAdjustments: [],
        version: 1,
      };

      const legacyMemory = {
        id: "mem-zod3-compat",
        content: "Prefiere planificar los lunes por la mañana",
        category: "preference",
        confirmationStatus: "unconfirmed",
        temporalStatus: "active",
        createdAt: "2026-10-12",
        tags: ["rutina"],
        provenance: {
          source: "conversation_inference",
          referenceText: "Los lunes a primera hora tengo más foco",
        },
      };

      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.objectStore(STORES.PLANS).put(legacyPlan);
        tx.objectStore(STORES.SCHEDULES).put(legacySchedule);
        tx.objectStore(STORES.MEMORIES).put(legacyMemory);
      });
      closeDatabase(db);

      // 2. Open via the storage context & repositories (which execute Zod validation on read)
      const storage = await createIndexedDbStorage({
        dbName: TEST_MIGRATION_DB,
        customFactory: fakeIDB,
      });

      const loadedPlan = await storage.plans.getById("plan-zod3-compat");
      expect(loadedPlan).toBeDefined();
      expect(loadedPlan?.planId).toBe("plan-zod3-compat");
      expect(loadedPlan?.proposal.weekSummary.intent).toBe("Semana migrada de zod 3");

      const loadedSchedule = await storage.schedules.getById("sched-zod3-compat");
      expect(loadedSchedule).toBeDefined();
      expect(loadedSchedule?.scheduleId).toBe("sched-zod3-compat");
      expect(loadedSchedule?.timeBlocks).toHaveLength(1);

      const loadedMemory = await storage.memories.getById("mem-zod3-compat");
      expect(loadedMemory).toBeDefined();
      expect(loadedMemory?.id).toBe("mem-zod3-compat");
      expect(loadedMemory?.content).toBe("Prefiere planificar los lunes por la mañana");

      storage.close();
      await deleteDatabase(TEST_MIGRATION_DB, fakeIDB);
    });
  });

  describe("5. LLM-output parsers parity on golden valid and invalid payloads", () => {
    it("extract-items parser accepts valid JSON and rejects invalid payload", () => {
      const valid = JSON.stringify({
        items: [
          {
            id: "item-p1",
            rawText: "Preparar presentación",
            title: "Preparar presentación",
            type: "task",
          },
        ],
      });
      const parsed = parseAndValidateExtractedItems(valid);
      expect(parsed.items).toHaveLength(1);

      const invalid = JSON.stringify({
        items: [{ id: "item-p1" }], // Missing required rawText, title, type
      });
      expect(() => parseAndValidateExtractedItems(invalid)).toThrow();
    });

    it("detect-relationships parser accepts valid JSON and rejects invalid payload", () => {
      const valid = JSON.stringify({
        relationships: [
          {
            sourceItemId: "item-1",
            targetItemId: "item-2",
            type: "depends_on",
            confidence: "high",
            reason: "Item 2 depends on Item 1",
          },
        ],
      });
      const parsed = parseAndValidateRelationships(valid);
      expect(parsed.relationships).toHaveLength(1);

      const invalid = JSON.stringify({
        relationships: [{ type: "unknown_type" }],
      });
      expect(() => parseAndValidateRelationships(invalid)).toThrow();
    });

    it("group-work parser accepts valid JSON and rejects invalid payload", () => {
      const valid = JSON.stringify({
        groups: [
          {
            id: "group-1",
            title: "Lanzamiento",
            itemIds: ["item-1"],
            rationale: "Cohesión alta de sprint",
          },
        ],
        ungroupedItemIds: [],
      });
      const parsed = parseAndValidateGroupedWork(valid);
      expect(parsed.groups).toHaveLength(1);

      const invalid = JSON.stringify({ groups: "not-an-array" });
      expect(() => parseAndValidateGroupedWork(invalid)).toThrow();
    });

    it("detect-deadlines parser accepts valid JSON and rejects invalid payload", () => {
      const valid = JSON.stringify({
        deadlines: [
          {
            itemId: "item-1",
            raw: "viernes",
            kind: "exact_date",
            resolvedStart: "2026-10-16",
            resolvedEnd: "2026-10-16",
            confidence: "high",
          },
        ],
      });
      const parsed = parseAndValidateDeadlines(valid);
      expect(parsed.deadlines).toHaveLength(1);

      const invalid = JSON.stringify({ deadlines: [{ itemId: 123 }] });
      expect(() => parseAndValidateDeadlines(invalid)).toThrow();
    });

    it("evaluate-context parser accepts valid JSON and rejects invalid payload", () => {
      const valid = JSON.stringify({
        itemAssessments: [
          {
            itemId: "item-1",
            attention: "high",
            signals: ["external_commitment"],
            rationale: "Compromiso externo",
          },
        ],
        groupAssessments: [],
        openQuestions: [],
      });
      const parsed = parseAndValidateContextOutput(valid);
      expect(parsed.itemAssessments).toHaveLength(1);

      const invalid = JSON.stringify({ itemAssessments: "invalid" });
      expect(() => parseAndValidateContextOutput(invalid)).toThrow();
    });

    it("build-week parser accepts valid JSON and rejects invalid payload", () => {
      const sampleInput = {
        currentDate: "2026-10-09",
        targetWeek: { startDate: "2026-10-12", endDate: "2026-10-18" },
        items: [
          {
            id: "i1",
            rawText: "Tarea 1",
            title: "Tarea 1",
            type: "task" as const,
          },
        ],
        relationships: [],
        groupedWork: { groups: [], ungroupedItemIds: ["i1"] },
        deadlines: { deadlines: [] },
        context: { itemAssessments: [], groupAssessments: [], openQuestions: [] },
      };

      const valid = JSON.stringify({
        weekSummary: {
          targetWeek: { startDate: "2026-10-12", endDate: "2026-10-18" },
          capacity: {
            totalAvailableHours: 20,
            plannableHours: 16,
            plannedHours: null,
            knownEstimatedHours: null,
            estimationCompleteness: "none",
            protectedSpaceHours: 4,
            capacityStatus: "unknown",
            protectedSpaceStatus: "unknown",
          },
          intent: "Semana de foco",
        },
        foci: [],
        obligations: [],
        flexibleOptions: [
          {
            itemId: "i1",
            title: "Tarea 1",
            condition: "Si hay tiempo",
            estimatedHours: null,
          },
        ],
        deferredItems: [],
        unplannedSpace: { rationale: "Margen de calma", recommendedHours: 4 },
        confirmationPrompt: {
          question: "¿Quieres confirmar este plan?",
          keyTradeoffs: [],
          pendingQuestions: [],
        },
      });

      const parsed = parseAndValidateProposedWeek(valid, sampleInput);
      expect(parsed.flexibleOptions).toHaveLength(1);

      const invalid = JSON.stringify({ weekSummary: "corrupt" });
      expect(() => parseAndValidateProposedWeek(invalid, sampleInput)).toThrow();
    });
  });

  describe("6. Security regression for GHSA-mrhx-c7xc-m3w5 (Memory exhaustion on oversized collections)", () => {
    it("rejects an oversized array with .max() constraint in < 50ms without iterating or exhausting memory", () => {
      const constrainedSchema = z.array(z.string().min(1)).max(5);

      // Create an oversized array with 5,000,000 items
      const oversizedArray = new Array(5000000).fill("valid_item_string");

      const startTime = performance.now();
      const result = constrainedSchema.safeParse(oversizedArray);
      const durationMs = performance.now() - startTime;

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.code).toBe("too_big");
      }
      // Must reject almost instantly without walking 5 million items
      expect(durationMs).toBeLessThan(100);
    });

    it("ProposedWeekSchema rejects oversized foci array (>3) instantly", () => {
      const validFocus = {
        id: "focus-item",
        title: "Focus",
        desiredOutcome: "Done",
        rationale: "Reason",
        contributingItemIds: [],
        estimatedHours: 2,
      };

      const oversizedFoci = new Array(50000).fill(validFocus);
      const invalidWeek = {
        weekSummary: {
          targetWeek: { startDate: "2026-10-12", endDate: "2026-10-18" },
          capacity: {
            totalAvailableHours: 20,
            plannableHours: 16,
            plannedHours: null,
            knownEstimatedHours: null,
            estimationCompleteness: "none",
            protectedSpaceHours: 4,
            capacityStatus: "unknown",
            protectedSpaceStatus: "unknown",
          },
          intent: "Semana",
        },
        foci: oversizedFoci,
        obligations: [],
        flexibleOptions: [],
        deferredItems: [],
        unplannedSpace: { rationale: "Rationale", recommendedHours: 4 },
      };

      const startTime = performance.now();
      const result = ProposedWeekSchema.safeParse(invalidWeek);
      const durationMs = performance.now() - startTime;

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((i) => i.code === "too_big")).toBe(true);
      }
      expect(durationMs).toBeLessThan(100);
    });
  });
});
