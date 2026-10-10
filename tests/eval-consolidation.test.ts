import { describe, it, expect } from "vitest";
import {
  mergeConsolidatedWeekResults,
  BuildWeekCaseEvaluationRecord,
} from "../scripts/eval-cases";

function makeFakeRecord(
  caseId: string,
  provider: "mock" | "groq",
  status: "success" | "semantic_failure" = "success",
  executedAt = "2026-10-10T12:00:00.000Z"
): BuildWeekCaseEvaluationRecord {
  return {
    caseId,
    title: `Case ${caseId}`,
    provider,
    model: provider === "groq" ? "qwen/qwen3.8-27b" : "deterministic-mock-v1",
    executedAt,
    status,
    metrics: {
      durationMs: provider === "groq" ? 2500 : 10,
      latencyRating: "fast",
      tokens: provider === "groq" ? { prompt: 1000, completion: 500, total: 1500 } : undefined,
    },
    parsing: {
      success: true,
      repaired: false,
      repairsCount: 0,
      repairs: [],
    },
    invariants: {
      valid: true,
      errors: [],
    },
    conservation: {
      inputCount: 3,
      outputCount: 3,
      isConserved1to1: true,
    },
    classification: {
      fociCount: 1,
      obligationsCount: 1,
      flexibleOptionsCount: 0,
      deferredCount: 1,
      deferredReasons: {},
    },
    fociReview: [],
  };
}

describe("Evaluator Results Consolidation Protection", () => {
  it("does not allow a mock run to overwrite an active Groq evaluation", () => {
    const existing: Record<string, BuildWeekCaseEvaluationRecord> = {
      "case-19": makeFakeRecord("case-19", "groq", "success", "2026-10-10T10:00:00.000Z"),
    };

    const mockRun: Record<string, BuildWeekCaseEvaluationRecord> = {
      "case-19": makeFakeRecord("case-19", "mock", "success", "2026-10-10T11:00:00.000Z"),
    };

    const result = mergeConsolidatedWeekResults(existing, mockRun);

    // Active record remains groq
    expect(result["case-19"].provider).toBe("groq");
    expect(result["case-19"].model).toBe("qwen/qwen3.8-27b");
    expect(result["case-19"].executedAt).toBe("2026-10-10T10:00:00.000Z");

    // The mock execution was appended to history without erasing the real result
    expect(result["case-19"].history).toBeDefined();
    expect(result["case-19"].history?.length).toBe(1);
    expect(result["case-19"].history?.[0].provider).toBe("mock");
  });

  it("updates an existing Groq record with a new Groq run, pushing previous Groq run to history", () => {
    const existing: Record<string, BuildWeekCaseEvaluationRecord> = {
      "case-19": makeFakeRecord("case-19", "groq", "semantic_failure", "2026-10-10T09:00:00.000Z"),
    };

    const newGroqRun: Record<string, BuildWeekCaseEvaluationRecord> = {
      "case-19": makeFakeRecord("case-19", "groq", "success", "2026-10-10T12:00:00.000Z"),
    };

    const result = mergeConsolidatedWeekResults(existing, newGroqRun);

    // Active record is updated to the new Groq run
    expect(result["case-19"].provider).toBe("groq");
    expect(result["case-19"].status).toBe("success");
    expect(result["case-19"].executedAt).toBe("2026-10-10T12:00:00.000Z");

    // Previous failure is preserved in history
    expect(result["case-19"].history).toHaveLength(1);
    expect(result["case-19"].history?.[0].status).toBe("semantic_failure");
    expect(result["case-19"].history?.[0].executedAt).toBe("2026-10-10T09:00:00.000Z");
  });

  it("allows a Groq run to overwrite a previous mock record and archives the mock in history", () => {
    const existing: Record<string, BuildWeekCaseEvaluationRecord> = {
      "case-01": makeFakeRecord("case-01", "mock", "success", "2026-10-10T08:00:00.000Z"),
    };

    const groqRun: Record<string, BuildWeekCaseEvaluationRecord> = {
      "case-01": makeFakeRecord("case-01", "groq", "success", "2026-10-10T14:00:00.000Z"),
    };

    const result = mergeConsolidatedWeekResults(existing, groqRun);

    expect(result["case-01"].provider).toBe("groq");
    expect(result["case-01"].executedAt).toBe("2026-10-10T14:00:00.000Z");
    expect(result["case-01"].history).toHaveLength(1);
    expect(result["case-01"].history?.[0].provider).toBe("mock");
  });

  it("preserves untouched cases when running a subset of cases", () => {
    const existing: Record<string, BuildWeekCaseEvaluationRecord> = {
      "case-01": makeFakeRecord("case-01", "groq", "success"),
      "case-02": makeFakeRecord("case-02", "groq", "success"),
    };

    const subsetRun: Record<string, BuildWeekCaseEvaluationRecord> = {
      "case-02": makeFakeRecord("case-02", "groq", "success", "2026-10-10T15:00:00.000Z"),
    };

    const result = mergeConsolidatedWeekResults(existing, subsetRun);

    // case-01 was not run, but is preserved completely
    expect(result["case-01"]).toBeDefined();
    expect(result["case-01"].provider).toBe("groq");
    // case-02 was updated
    expect(result["case-02"].executedAt).toBe("2026-10-10T15:00:00.000Z");
  });
});
