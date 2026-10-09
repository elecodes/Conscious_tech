import { describe, it, expect } from "vitest";
import {
  DeclaredGoalSchema,
  ContextSignalSchema,
  ContextAttentionLevelSchema,
  ItemContextAssessmentSchema,
  GroupContextAssessmentSchema,
  OpenQuestionSchema,
  EvaluateContextOutputSchema,
  EvaluateContextInputSchema,
} from "../src/domain/context";

describe("Domain Schema: evaluate_context", () => {
  it("validates DeclaredGoal correctly", () => {
    const valid = { id: "goal-1", text: "Lanzar MVP en octubre" };
    expect(DeclaredGoalSchema.parse(valid)).toEqual(valid);

    expect(() => DeclaredGoalSchema.parse({ id: "", text: "test" })).toThrow();
  });

  it("validates ContextSignal enum values", () => {
    const allowed = [
      "external_commitment",
      "approaching_deadline",
      "overdue_deadline",
      "explicit_importance",
      "already_started",
      "dependency",
      "supports_declared_goal",
      "waiting",
      "insufficient_information",
    ];

    for (const sig of allowed) {
      expect(ContextSignalSchema.parse(sig)).toBe(sig);
    }

    expect(() => ContextSignalSchema.parse("invalid_signal")).toThrow();
  });

  it("validates ContextAttentionLevel enum values", () => {
    expect(ContextAttentionLevelSchema.parse("high")).toBe("high");
    expect(ContextAttentionLevelSchema.parse("medium")).toBe("medium");
    expect(ContextAttentionLevelSchema.parse("low")).toBe("low");
    expect(ContextAttentionLevelSchema.parse("unclear")).toBe("unclear");
    expect(() => ContextAttentionLevelSchema.parse("urgent")).toThrow();
  });

  it("validates ItemContextAssessment", () => {
    const valid = {
      itemId: "item-1",
      attention: "high",
      signals: ["external_commitment", "approaching_deadline"],
      rationale: "Compromiso externo con entrega cercana.",
    };
    expect(ItemContextAssessmentSchema.parse(valid)).toEqual(valid);

    expect(() =>
      ItemContextAssessmentSchema.parse({
        itemId: "",
        attention: "high",
        signals: [],
        rationale: "Rationale",
      })
    ).toThrow();
  });

  it("validates GroupContextAssessment", () => {
    const valid = {
      groupId: "group-1",
      relevance: "high",
      rationale: "Línea clave con compromisos.",
    };
    expect(GroupContextAssessmentSchema.parse(valid)).toEqual(valid);
  });

  it("validates OpenQuestion", () => {
    const valid = {
      topic: "Plazo de entrega",
      question: "¿Para cuándo se necesita el informe?",
      relatedItemIds: ["item-1"],
      reason: "El bloqueo no tiene fecha conocida.",
    };
    expect(OpenQuestionSchema.parse(valid)).toEqual(valid);
  });

  it("validates EvaluateContextInputSchema with currentDate format", () => {
    const input = {
      currentDate: "2026-10-09",
      items: [
        {
          id: "item-1",
          rawText: "Enviar informe",
          title: "Enviar informe",
          type: "task",
        },
      ],
      relationships: [],
      groupedWork: {
        groups: [],
        ungroupedItemIds: ["item-1"],
      },
      deadlines: {
        deadlines: [],
      },
    };

    expect(EvaluateContextInputSchema.parse(input).currentDate).toBe("2026-10-09");

    expect(() =>
      EvaluateContextInputSchema.parse({ ...input, currentDate: "09-10-2026" })
    ).toThrow();
  });

  it("validates complete EvaluateContextOutputSchema", () => {
    const output = {
      itemAssessments: [
        {
          itemId: "item-1",
          attention: "high",
          signals: ["external_commitment"],
          rationale: "Compromiso con cliente.",
        },
      ],
      groupAssessments: [
        {
          groupId: "group-1",
          relevance: "high",
          rationale: "Línea prioritaria.",
        },
      ],
      openQuestions: [],
    };

    expect(EvaluateContextOutputSchema.parse(output)).toEqual(output);
  });
});
