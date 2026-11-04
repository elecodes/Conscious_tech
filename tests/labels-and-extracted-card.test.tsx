import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
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
  formatIdeasSplitExplanation,
} from "../src/web/labels";
import {
  createIndexedDbStorage,
  deleteDatabase,
  IndexedDbStorageContext,
} from "../src/infrastructure/storage/indexeddb";
import { WeeklySessionService } from "../src/application/weekly-session-service";
import { App } from "../src/web/App";
import { PlanningExtractedItemsReview } from "../src/web/components/planning-extracted-items-review";
import { ProposedWeek } from "../src/domain/week";

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

    it("ensures natural sentence case for multi-word labels (En marcha, Compromiso externo)", () => {
      expect(ITEM_STATUS_LABELS.started).toBe("En marcha");
      expect(ITEM_STATUS_LABELS.started).not.toBe("En Marcha");
      expect(`Compromiso ${formatCommitmentType("external").toLowerCase()}`).toBe(
        "Compromiso externo"
      );
      expect(`Compromiso ${formatCommitmentType("external").toLowerCase()}`).not.toBe(
        "Compromiso Externo"
      );
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
      const html = renderToStaticMarkup(<App service={service} initialTab="prepare" />);

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

  describe("PR D: Sentence case for badges and CSS guard", () => {
    it("ensures .badge CSS rule does NOT use text-transform: capitalize", () => {
      const cssPath = path.resolve(__dirname, "../src/web/style.css");
      const css = fs.readFileSync(cssPath, "utf-8");
      const badgeMatch = css.match(/\.badge\s*\{([^}]+)\}/);
      expect(badgeMatch).not.toBeNull();
      const badgeRules = badgeMatch![1];
      expect(badgeRules).not.toContain("text-transform: capitalize");
    });

    it("ensures badge helper strings and labels use sentence case, not Title Case", () => {
      const titleCaseDenylist = [
        "Borrador En Cuaderno Local",
        "Sin Programar En La Semana",
        "Capacidad No Configurada",
        "Pendiente De Decisión",
        "Pendiente De Información",
      ];

      const filesToCheck = [
        "../src/web/components/weekly-session-formatters.tsx",
        "../src/web/components/capacity-protected-space-section.tsx",
        "../src/web/components/planning-capacity-hud.tsx",
        "../src/web/components/weekly-planning-from-notes.tsx",
        "../src/web/components/planning-deferred-items-section.tsx",
      ];

      for (const relPath of filesToCheck) {
        const fullPath = path.resolve(__dirname, relPath);
        if (fs.existsSync(fullPath)) {
          const content = fs.readFileSync(fullPath, "utf-8");
          for (const forbidden of titleCaseDenylist) {
            expect(content).not.toContain(`"${forbidden}"`);
            expect(content).not.toContain(`>${forbidden}<`);
          }
        }
      }
    });
  });

  describe("Ideas split explanation on Revisar (formatIdeasSplitExplanation)", () => {
    it("formats plural ideas, plural scheduled, plural pending correctly", () => {
      const text = formatIdeasSplitExplanation(5, 2, 3);
      expect(text).toBe("De tus 5 ideas, 2 entran en la semana y 3 quedan pendientes de decidir.");
    });

    it("formats singular scheduled and plural pending correctly", () => {
      const text = formatIdeasSplitExplanation(3, 1, 2);
      expect(text).toBe("De tus 3 ideas, 1 entra en la semana y 2 quedan pendientes de decidir.");
    });

    it("formats plural scheduled and singular pending correctly", () => {
      const text = formatIdeasSplitExplanation(3, 2, 1);
      expect(text).toBe("De tus 3 ideas, 2 entran en la semana y 1 queda pendiente de decidir.");
    });

    it("formats singular idea correctly", () => {
      const text = formatIdeasSplitExplanation(1, 0, 1);
      expect(text).toBe("De tu 1 idea, 0 entran en la semana y 1 queda pendiente de decidir.");
    });

    it("formats singular scheduled and singular pending correctly", () => {
      const text = formatIdeasSplitExplanation(2, 1, 1);
      expect(text).toBe("De tus 2 ideas, 1 entra en la semana y 1 queda pendiente de decidir.");
    });

    it("returns null (hidden) when all selected ideas are scheduled", () => {
      expect(formatIdeasSplitExplanation(5, 5, 0)).toBeNull();
      expect(formatIdeasSplitExplanation(2, 2, 0)).toBeNull();
      expect(formatIdeasSplitExplanation(1, 1, 0)).toBeNull();
    });

    it("returns null when selectedCount <= 0 or pendingCount <= 0", () => {
      expect(formatIdeasSplitExplanation(0, 0, 0)).toBeNull();
      expect(formatIdeasSplitExplanation(3, 3, -1)).toBeNull();
    });

    it("renders split explanation inside PlanningExtractedItemsReview when split exists and hides it when all scheduled", () => {
      const mockExtractedItems = [
        { id: "item-1", title: "Idea 1", rawText: "Idea 1", type: "task" as const },
        { id: "item-2", title: "Idea 2", rawText: "Idea 2", type: "task" as const },
        { id: "item-3", title: "Idea 3", rawText: "Idea 3", type: "task" as const },
      ];
      const acceptedIds = new Set(["item-1", "item-2", "item-3"]);

      const mockProposalWithSplit = {
        foci: [
          {
            id: "f-1",
            title: "Foco",
            desiredOutcome: "Res",
            contributingItemIds: ["item-1"],
            rationale: "r",
          },
        ],
        obligations: [],
        flexibleOptions: [],
        deferredItems: [
          { itemId: "item-2", title: "Idea 2", reason: "low_attention" as const, rationale: "r" },
          { itemId: "item-3", title: "Idea 3", reason: "not_scheduled" as const, rationale: "r" },
        ],
        weekSummary: {
          targetWeek: { startDate: "2026-10-19", endDate: "2026-10-25" },
        },
      } as unknown as ProposedWeek;

      // 1. With split: 3 ideas, 1 scheduled, 2 pending -> rendered
      const htmlWithSplit = renderToStaticMarkup(
        <PlanningExtractedItemsReview
          extractedItems={mockExtractedItems}
          acceptedItemIds={acceptedIds}
          acceptedCount={3}
          handleAcceptAll={() => {}}
          handleDiscardAll={() => {}}
          handleStartFreshWeek={() => {}}
          handleToggleItem={() => {}}
          handleUpdateItemEffort={() => {}}
          handleUpdateItemDeadline={() => {}}
          noteText=""
          setNoteText={() => {}}
          isExtracting={false}
          handleExtract={() => {}}
          userIntent=""
          setUserIntent={() => {}}
          availableHoursInput="20"
          setAvailableHoursInput={() => {}}
          protectedSpacePercentInput="20"
          setProtectedSpacePercentInput={() => {}}
          isPlanning={false}
          planningError={null}
          selectedCarryOverItemIds={new Set()}
          handleGenerateProposal={() => {}}
          proposedWeek={mockProposalWithSplit}
        />
      );

      expect(htmlWithSplit).toContain('data-testid="ideas-split-explanation"');
      expect(htmlWithSplit).toContain(
        "De tus 3 ideas, 1 entra en la semana y 2 quedan pendientes de decidir."
      );

      // 2. All scheduled: 3 ideas, 3 scheduled -> hidden
      const mockProposalAllScheduled = {
        foci: [
          {
            id: "f-1",
            title: "Foco",
            desiredOutcome: "Res",
            contributingItemIds: ["item-1", "item-2", "item-3"],
            rationale: "r",
          },
        ],
        obligations: [],
        flexibleOptions: [],
        deferredItems: [],
        weekSummary: {
          targetWeek: { startDate: "2026-10-19", endDate: "2026-10-25" },
        },
      } as unknown as ProposedWeek;

      const htmlAllScheduled = renderToStaticMarkup(
        <PlanningExtractedItemsReview
          extractedItems={mockExtractedItems}
          acceptedItemIds={acceptedIds}
          acceptedCount={3}
          handleAcceptAll={() => {}}
          handleDiscardAll={() => {}}
          handleStartFreshWeek={() => {}}
          handleToggleItem={() => {}}
          handleUpdateItemEffort={() => {}}
          handleUpdateItemDeadline={() => {}}
          noteText=""
          setNoteText={() => {}}
          isExtracting={false}
          handleExtract={() => {}}
          userIntent=""
          setUserIntent={() => {}}
          availableHoursInput="20"
          setAvailableHoursInput={() => {}}
          protectedSpacePercentInput="20"
          setProtectedSpacePercentInput={() => {}}
          isPlanning={false}
          planningError={null}
          selectedCarryOverItemIds={new Set()}
          handleGenerateProposal={() => {}}
          proposedWeek={mockProposalAllScheduled}
        />
      );

      expect(htmlAllScheduled).not.toContain('data-testid="ideas-split-explanation"');
    });
  });
});
