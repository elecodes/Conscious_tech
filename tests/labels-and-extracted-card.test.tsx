import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { indexedDB as fakeIDB, IDBKeyRange as fakeKeyRange } from "fake-indexeddb";
import {
  ItemTypeSchema,
  ItemStatusSchema,
  CommitmentTypeSchema,
  ImportanceSchema,
} from "../src/domain/items";
import {
  ITEM_TYPE_LABELS,
  ITEM_STATUS_LABELS,
  COMMITMENT_TYPE_LABELS,
  IMPORTANCE_LABELS,
  PLAN_CATEGORY_ORIGIN_LABELS,
  RELATIONSHIP_TYPE_LABELS,
  DEADLINE_KIND_LABELS,
  CONTEXT_SIGNAL_LABELS,
  formatItemType,
  formatItemStatus,
  formatCommitmentType,
  formatImportance,
  formatPlanCategoryOrigin,
  formatRelationshipType,
  formatDeadlineKind,
  formatContextSignal,
} from "../src/web/labels";
import {
  createIndexedDbStorage,
  deleteDatabase,
  IndexedDbStorageContext,
} from "../src/infrastructure/storage/indexeddb";
import { WeeklySessionService } from "../src/application/weekly-session-service";
import { App } from "../src/web/App";

describe("FIX 3: Spanish labels for enum badges", () => {
  describe("Label maps completeness and fallbacks", () => {
    it("every ItemType enum value has a defined Spanish label", () => {
      for (const val of ItemTypeSchema.options) {
        expect(ITEM_TYPE_LABELS[val]).toBeDefined();
        expect(typeof ITEM_TYPE_LABELS[val]).toBe("string");
        expect(ITEM_TYPE_LABELS[val].length).toBeGreaterThan(0);
        expect(formatItemType(val)).toBe(ITEM_TYPE_LABELS[val]);
      }
    });

    it("every ItemStatus enum value has a defined Spanish label", () => {
      for (const val of ItemStatusSchema.options) {
        expect(ITEM_STATUS_LABELS[val]).toBeDefined();
        expect(typeof ITEM_STATUS_LABELS[val]).toBe("string");
        expect(ITEM_STATUS_LABELS[val].length).toBeGreaterThan(0);
        expect(formatItemStatus(val)).toBe(ITEM_STATUS_LABELS[val]);
      }
    });

    it("every CommitmentType enum value has a defined Spanish label", () => {
      for (const val of CommitmentTypeSchema.options) {
        expect(COMMITMENT_TYPE_LABELS[val]).toBeDefined();
        expect(typeof COMMITMENT_TYPE_LABELS[val]).toBe("string");
        expect(COMMITMENT_TYPE_LABELS[val].length).toBeGreaterThan(0);
        expect(formatCommitmentType(val)).toBe(COMMITMENT_TYPE_LABELS[val]);
      }
    });

    it("every Importance enum value has a defined Spanish label", () => {
      for (const val of ImportanceSchema.options) {
        expect(IMPORTANCE_LABELS[val]).toBeDefined();
        expect(typeof IMPORTANCE_LABELS[val]).toBe("string");
        expect(IMPORTANCE_LABELS[val].length).toBeGreaterThan(0);
        expect(formatImportance(val)).toBe(IMPORTANCE_LABELS[val]);
      }
    });

    it("auxiliary label maps (origins, relationships, deadline kinds, signals) are properly defined", () => {
      expect(PLAN_CATEGORY_ORIGIN_LABELS.focus).toBe("Foco");
      expect(RELATIONSHIP_TYPE_LABELS.depends_on).toBe("Depende de");
      expect(DEADLINE_KIND_LABELS.explicit_date).toBe("Fecha explícita");
      expect(CONTEXT_SIGNAL_LABELS.deadline).toBe("Plazo");
    });

    it("falls back to the raw value when encountering an unknown enum value rather than crashing", () => {
      expect(formatItemType("custom_unknown_type")).toBe("custom_unknown_type");
      expect(formatItemStatus("custom_unknown_status")).toBe("custom_unknown_status");
      expect(formatCommitmentType("custom_unknown_commitment")).toBe("custom_unknown_commitment");
      expect(formatImportance("custom_unknown_importance")).toBe("custom_unknown_importance");
      expect(formatPlanCategoryOrigin("custom_unknown_origin")).toBe("custom_unknown_origin");
      expect(formatRelationshipType("custom_unknown_rel")).toBe("custom_unknown_rel");
      expect(formatDeadlineKind("custom_unknown_kind")).toBe("custom_unknown_kind");
      expect(formatContextSignal("custom_unknown_signal")).toBe("custom_unknown_signal");
      expect(formatItemType(null)).toBe("");
      expect(formatItemStatus(undefined)).toBe("");
    });
  });

  describe("Render test for extracted-items card", () => {
    const TEST_DB = "conscious_tech_labels_render_test_db";
    const STORAGE_KEY_CAPTURE_RESULT = "conscious_tech_transient_dump_result";

    if (typeof globalThis.IDBKeyRange === "undefined") {
      (globalThis as unknown as { IDBKeyRange: typeof fakeKeyRange }).IDBKeyRange = fakeKeyRange;
    }

    const storageMap = new Map<string, string>();
    const originalLocalStorage = globalThis.localStorage;
    let storage: IndexedDbStorageContext;
    let service: WeeklySessionService;

    beforeEach(async () => {
      storageMap.clear();
      (globalThis as unknown as { localStorage: Storage }).localStorage = {
        getItem: (key: string) => storageMap.get(key) ?? null,
        setItem: (key: string, value: string) => storageMap.set(key, value),
        removeItem: (key: string) => storageMap.delete(key),
        clear: () => storageMap.clear(),
        key: (index: number) => Array.from(storageMap.keys())[index] ?? null,
        length: storageMap.size,
      };

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

      const mockExtraction = {
        items: [
          {
            id: "mock-item-1",
            rawText: "Enviar balance trimestral a contabilidad el jueves",
            title: "Enviar balance trimestral",
            type: "task",
            status: "pending",
            commitment: "external",
            importance: "high",
            estimatedEffort: { value: 2, unit: "hours" },
            deadline: { raw: "jueves", resolved: "2026-10-15", confidence: "high" },
          },
        ],
      };
      globalThis.localStorage.setItem(STORAGE_KEY_CAPTURE_RESULT, JSON.stringify(mockExtraction));
    });

    afterEach(() => {
      storageMap.clear();
      if (originalLocalStorage) {
        (globalThis as unknown as { localStorage: Storage }).localStorage = originalLocalStorage;
      }
    });

    it("shows 'Tarea' and 'Pendiente' on the extracted-items card while preserving badge-task CSS class", () => {
      const html = renderToStaticMarkup(<App service={service} initialTab="capture" />);

      // CSS class badge-task preserved
      expect(html).toContain('class="badge badge-task"');
      // User-facing label is Spanish "Tarea"
      expect(html).toContain(">Tarea<");
      // Status label is Spanish "Estado: Pendiente"
      expect(html).toContain("Estado: Pendiente");
      // Commitment is Spanish "Compromiso externo"
      expect(html).toContain("Compromiso externo");
      // Importance is Spanish "⭐ Alta"
      expect(html).toContain("⭐ Alta");

      // Verify raw untranslated strings are NOT displayed in tags
      expect(html).not.toContain(">task<");
      expect(html).not.toContain("estado: pending");
      expect(html).not.toContain("compromiso external");
    });
  });
});
