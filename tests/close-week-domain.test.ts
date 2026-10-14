import { describe, it, expect } from "vitest";
import {
  CloseWeekInputSchema,
  ItemOutcomeInputSchema,
} from "../src/domain/close-week";
import type { ProposedWeek } from "../src/domain/week";

describe("Skill 11 Domain: close-week schemas & invariants", () => {
  const minimalPlan: ProposedWeek = {
    weekSummary: {
      targetWeek: {
        startDate: "2026-10-12",
        endDate: "2026-10-18",
      },
      capacity: {
        totalAvailableHours: 25,
        plannableHours: 18,
        plannedHours: 15,
        knownEstimatedHours: 15,
        estimationCompleteness: "complete",
        protectedSpaceHours: 7,
        capacityStatus: "within_capacity",
        protectedSpaceStatus: "respected",
      },
    },
    foci: [
      {
        id: "focus-1",
        title: "Preparar certificación AWS",
        desiredOutcome: "Completar simulacro con > 80%",
        rationale: "Foco clave del trimestre",
        contributingItemIds: ["item-1", "item-2"],
        estimatedHours: 10,
      },
    ],
    obligations: [
      {
        itemId: "ob-1",
        title: "Dar clase de Cibervoluntarios",
        dueDate: "2026-10-13",
        commitmentType: "external",
        rationale: "Compromiso externo confirmado",
        estimatedHours: 3,
      },
    ],
    flexibleOptions: [
      {
        itemId: "flex-1",
        title: "Avanzar Zapsac",
        condition: "Si queda tiempo",
        estimatedHours: 2,
      },
    ],
    deferredItems: [
      {
        itemId: "def-1",
        title: "Explorar idea de podcast",
        reason: "not_scheduled",
        rationale: "Fuera de la capacidad de la semana",
      },
    ],
    unplannedSpace: {
      recommendedHours: 7,
      rationale: "Margen protegido para descanso e imprevistos",
    },
    confirmationPrompt: {
      question: "¿Te representa este plan?",
      keyTradeoffs: ["Zapsac queda como opción flexible"],
      pendingQuestions: [],
    },
  };

  it("validates well-formed CloseWeekInput with real UTC timestamp", () => {
    const input = {
      closedAt: "2026-10-18T19:00:00Z",
      activePlan: minimalPlan,
      itemOutcomes: [
        {
          itemId: "item-1",
          status: "completed",
          actualHours: 5,
        },
        {
          itemId: "item-2",
          status: "completed",
          actualHours: 4.5,
        },
        {
          itemId: "ob-1",
          status: "completed",
          actualHours: 3,
        },
        {
          itemId: "flex-1",
          status: "consciously_postponed",
          postponementReason: "Preferí descansar el viernes",
        },
      ],
      userReflection: {
        energyLevel: "balanced",
        generalNotes: "Buena semana sin sobrecargas",
      },
    };

    const parsed = CloseWeekInputSchema.parse(input);
    expect(parsed.closedAt).toBe("2026-10-18T19:00:00Z");
    expect(parsed.itemOutcomes).toHaveLength(4);
  });

  it("rejects invalid UTC timestamps", () => {
    expect(() =>
      CloseWeekInputSchema.parse({
        closedAt: "2026-10-18 19:00:00", // missing T and Z
        activePlan: minimalPlan,
        itemOutcomes: [],
      })
    ).toThrow();

    expect(() =>
      CloseWeekInputSchema.parse({
        closedAt: "2026-02-30T10:00:00Z", // impossible calendar date
        activePlan: minimalPlan,
        itemOutcomes: [],
      })
    ).toThrow();
  });

  it("rejects negative or NaN actualHours", () => {
    expect(() =>
      ItemOutcomeInputSchema.parse({
        itemId: "item-1",
        status: "completed",
        actualHours: -2,
      })
    ).toThrow();

    expect(() =>
      ItemOutcomeInputSchema.parse({
        itemId: "item-1",
        status: "completed",
        actualHours: NaN,
      })
    ).toThrow();
  });

  it("allows null actualHours representing unrecorded time", () => {
    const outcome = ItemOutcomeInputSchema.parse({
      itemId: "item-1",
      status: "completed",
      actualHours: null,
    });
    expect(outcome.actualHours).toBeNull();
  });
});
