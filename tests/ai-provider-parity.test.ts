import { describe, it, expect, vi } from "vitest";
import { GeminiProvider } from "../src/providers/gemini-provider";
import { GroqProvider } from "../src/providers/groq-provider";
import { MockProvider } from "../src/providers/mock-provider";
import { RemoteAIProvider } from "../src/providers/remote-ai-provider";
import { BuildWeekInput } from "../src/domain/week";

describe("AI Provider Parity and completeJson Refactoring", () => {
  const sampleInput: BuildWeekInput = {
    currentDate: "2026-10-29",
    targetWeek: {
      startDate: "2026-11-02",
      endDate: "2026-11-08",
    },
    items: [],
    relationships: [],
    groupedWork: {
      groups: [],
      ungroupedItemIds: [],
    },
    deadlines: {
      deadlines: [],
    },
    context: {
      itemAssessments: [],
      groupAssessments: [],
      openQuestions: [],
    },
  };

  describe("GeminiProvider Parity", () => {
    it("implements all 6 core semantic skills including buildWeek", () => {
      const provider = new GeminiProvider({ apiKey: "fake-key" });
      expect(typeof provider.extractItems).toBe("function");
      expect(typeof provider.detectRelationships).toBe("function");
      expect(typeof provider.groupWork).toBe("function");
      expect(typeof provider.detectDeadlines).toBe("function");
      expect(typeof provider.evaluateContext).toBe("function");
      expect(typeof provider.buildWeek).toBe("function");
      expect(typeof provider.completeJson).toBe("function");
    });

    it("buildWeek returns clean empty week for empty items without calling LLM", async () => {
      const provider = new GeminiProvider({ apiKey: "fake-key" });
      const result = await provider.buildWeek(sampleInput);

      expect(result.weekSummary.targetWeek.startDate).toBe("2026-11-02");
      expect(result.foci).toHaveLength(0);
      expect(result.obligations).toHaveLength(0);
    });

    it("buildWeek formats prompt and parses LLM response correctly with completeJson", async () => {
      const provider = new GeminiProvider({ apiKey: "fake-key" });
      const fakeJson = JSON.stringify({
        weekSummary: {
          targetWeek: { startDate: "2026-11-02", endDate: "2026-11-08" },
          intent: "Foco principal en entrega",
          capacity: {
            totalAvailableHours: 40,
            protectedSpaceHours: 10,
            plannableHours: 30,
            plannedHours: null,
            knownEstimatedHours: null,
            estimationCompleteness: "none",
            capacityStatus: "unknown",
            protectedSpaceStatus: "unknown",
          },
        },
        foci: [
          {
            id: "f1",
            title: "Desarrollo central",
            desiredOutcome: "Completar la tarea A",
            rationale: "Foco prioritario",
            contributingItemIds: ["i1"],
            estimatedHours: null,
          },
        ],
        obligations: [],
        flexibleOptions: [],
        deferredItems: [],
        unplannedSpace: {
          recommendedHours: 10,
          rationale: "Margen de calma",
        },
        confirmationPrompt: {
          question: "¿Deseas proceder con esta propuesta?",
          keyTradeoffs: [],
          pendingQuestions: [],
        },
      });

      vi.spyOn(provider, "completeJson").mockResolvedValue({
        rawText: fakeJson,
        meta: {
          provider: "gemini",
          model: "gemini-2.5-flash",
          durationMs: 120,
        },
      });

      const inputWithItem: BuildWeekInput = {
        ...sampleInput,
        items: [
          {
            id: "i1",
            title: "Implementar feature A",
            rawText: "Implementar feature A",
            type: "task",
            status: "pending",
            commitment: "personal",
          },
        ],
        groupedWork: {
          groups: [],
          ungroupedItemIds: ["i1"],
        },
        context: {
          itemAssessments: [
            {
              itemId: "i1",
              attention: "medium",
              rationale: "Importancia media",
              signals: [],
            },
          ],
          groupAssessments: [],
          openQuestions: [],
        },
      };

      const result = await provider.buildWeek(inputWithItem);
      expect(result.weekSummary.intent).toBe("Foco principal en entrega");
      expect(result.foci).toHaveLength(1);
      expect(result.foci[0]?.title).toBe("Desarrollo central");
    });
  });

  describe("GroqProvider completeJson and Concurrency Safety", () => {
    it("implements completeJson and buildWeek without leaking parse state on instance", () => {
      const provider = new GroqProvider({ apiKey: "fake-key" });
      expect(typeof provider.completeJson).toBe("function");
      expect(typeof provider.buildWeek).toBe("function");
      // Must not carry lastRawResponse or lastParseResult properties
      expect("lastRawResponse" in provider).toBe(false);
      expect("lastParseResult" in provider).toBe(false);
      expect("getLastParseResult" in provider).toBe(false);
    });
  });

  describe("MockProvider & RemoteAIProvider Parity", () => {
    it("MockProvider implements completeJson and buildWeek", async () => {
      const mock = new MockProvider();
      expect(typeof mock.completeJson).toBe("function");
      expect(typeof mock.buildWeek).toBe("function");

      const comp = await mock.completeJson("system", "user");
      expect(comp.meta.provider).toBe("mock");

      const week = await mock.buildWeek(sampleInput);
      expect(week.weekSummary.targetWeek.startDate).toBe("2026-11-02");
    });

    it("RemoteAIProvider implements completeJson and buildWeek without any casts", async () => {
      const remote = new RemoteAIProvider({ id: "mock" });
      expect(typeof remote.completeJson).toBe("function");
      expect(typeof remote.buildWeek).toBe("function");

      const comp = await remote.completeJson("system", "user");
      expect(comp.meta.provider).toBe("mock");
    });
  });
});
