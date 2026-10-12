import { describe, it, expect } from "vitest";
import {
  isValidIsoUtcTimestamp,
  IsoUtcTimestampSchema,
  MemoryItemSchema,
  CandidateMemoryInputSchema,
  isValidEpistemicState,
  containsHesitationMarkers,
} from "../src/domain/memory";

describe("Skill 10: memory domain & schema invariants", () => {
  describe("IsoUtcTimestampSchema & isValidIsoUtcTimestamp", () => {
    it("accepts valid ISO-8601 UTC timestamps with and without milliseconds", () => {
      expect(isValidIsoUtcTimestamp("2026-10-12T14:30:00Z")).toBe(true);
      expect(isValidIsoUtcTimestamp("2026-10-12T14:30:00.123Z")).toBe(true);
      expect(IsoUtcTimestampSchema.safeParse("2026-10-12T14:30:00Z").success).toBe(true);
    });

    it("rejects timestamps with impossible calendar dates", () => {
      expect(isValidIsoUtcTimestamp("2026-02-30T10:00:00Z")).toBe(false);
      expect(isValidIsoUtcTimestamp("2026-04-31T10:00:00Z")).toBe(false);
      expect(isValidIsoUtcTimestamp("2025-02-29T10:00:00Z")).toBe(false); // 2025 not leap year
      expect(IsoUtcTimestampSchema.safeParse("2026-02-30T10:00:00Z").success).toBe(false);
    });

    it("rejects timestamps with impossible clock components", () => {
      expect(isValidIsoUtcTimestamp("2026-10-12T25:00:00Z")).toBe(false);
      expect(isValidIsoUtcTimestamp("2026-10-12T14:65:00Z")).toBe(false);
      expect(isValidIsoUtcTimestamp("2026-10-12T14:30:60Z")).toBe(false);
    });

    it("rejects timestamps with non-UTC offset or non-canonical year format", () => {
      expect(isValidIsoUtcTimestamp("2026-10-12T14:30:00+02:00")).toBe(false);
      expect(isValidIsoUtcTimestamp("26-10-12T14:30:00Z")).toBe(false);
      expect(isValidIsoUtcTimestamp("0050-10-12T14:30:00Z")).toBe(false); // below 1000
    });
  });

  describe("Epistemic Invariants & Hesitation Detection", () => {
    it("detects common doubt/hesitation markers in natural language", () => {
      expect(containsHesitationMarkers("Quizás empiece un curso el mes que viene")).toBe(true);
      expect(containsHesitationMarkers("Tal vez me mude de ciudad")).toBe(true);
      expect(containsHesitationMarkers("Creo que era en mayo")).toBe(true);
      expect(containsHesitationMarkers("Aprobé la certificación AWS")).toBe(false);
    });

    it("rejects 'confirmed' status from conversation_inference or system", () => {
      const resInference = isValidEpistemicState("fact", "confirmed", {
        source: "conversation_inference",
        referenceText: "User mentioned AWS",
      });
      expect(resInference.valid).toBe(false);

      const resSystem = isValidEpistemicState("fact", "confirmed", {
        source: "system",
        referenceText: "Internal maintenance",
      });
      expect(resSystem.valid).toBe(false);
    });

    it("rejects 'confirmed' status for working_hypothesis", () => {
      const res = isValidEpistemicState("working_hypothesis", "confirmed", {
        source: "user_explicit",
        referenceText: "Hypothesis note",
      });
      expect(res.valid).toBe(false);
    });

    it("rejects 'confirmed' status for user_explicit statements with hesitation markers", () => {
      const res = isValidEpistemicState("fact", "confirmed", {
        source: "user_explicit",
        referenceText: "Tal vez el proyecto termine en diciembre",
      });
      expect(res.valid).toBe(false);
    });

    it("accepts 'confirmed' status for decisive user_explicit statements", () => {
      const res = isValidEpistemicState("fact", "confirmed", {
        source: "user_explicit",
        referenceText: "He aprobado la certificación AWS",
      });
      expect(res.valid).toBe(true);
    });

    it("accepts 'confirmed' status for plan_decision with explicit acceptance evidence", () => {
      const res = isValidEpistemicState("decision", "confirmed", {
        source: "plan_decision",
        referenceText: "Decision accepted in ProposedWeek week-2026-W42",
      });
      expect(res.valid).toBe(true);
    });

    it("rejects 'confirmed' status for plan_decision without acceptance evidence", () => {
      const res = isValidEpistemicState("decision", "confirmed", {
        source: "plan_decision",
        referenceText: "Decision drafted in ProposedWeek",
      });
      expect(res.valid).toBe(false);
    });
  });

  describe("MemoryItemSchema Zod Validation", () => {
    it("validates a compliant confirmed memory item", () => {
      const validItem = {
        id: "mem-01",
        content: "Aprobé la certificación AWS Solutions Architect",
        category: "fact",
        confirmationStatus: "confirmed",
        temporalStatus: "active",
        validUntil: null,
        tags: ["aws", "cert"],
        provenance: {
          source: "user_explicit",
          referenceText: "Aprobé la certificación AWS Solutions Architect",
          timestamp: "2026-10-12T10:00:00Z",
        },
        createdAt: "2026-10-12",
      };
      expect(MemoryItemSchema.safeParse(validItem).success).toBe(true);
    });

    it("fails validation when epistemic invariant is violated", () => {
      const invalidItem = {
        id: "mem-02",
        content: "Al usuario le gusta programar los domingos",
        category: "preference",
        confirmationStatus: "confirmed", // Invalid with inference!
        temporalStatus: "active",
        tags: [],
        provenance: {
          source: "conversation_inference",
          referenceText: "Deduced from chat history",
        },
        createdAt: "2026-10-12",
      };
      const result = MemoryItemSchema.safeParse(invalidItem);
      expect(result.success).toBe(false);
    });
  });

  describe("CandidateMemoryInputSchema Conditional Validation", () => {
    it("validates 'store' candidate without targetMemoryId", () => {
      const cand = {
        candidateId: "cand-01",
        actionIntent: "store",
        rawText: "Anotar libro recomendado",
      };
      expect(CandidateMemoryInputSchema.safeParse(cand).success).toBe(true);
    });

    it("rejects 'store' candidate if targetMemoryId is present", () => {
      const cand = {
        candidateId: "cand-01",
        actionIntent: "store",
        targetMemoryId: "mem-01",
        rawText: "Anotar libro recomendado",
      };
      expect(CandidateMemoryInputSchema.safeParse(cand).success).toBe(false);
    });

    it("validates 'forget' candidate with targetMemoryId (rawText optional)", () => {
      const cand = {
        candidateId: "cand-02",
        actionIntent: "forget",
        targetMemoryId: "mem-01",
      };
      expect(CandidateMemoryInputSchema.safeParse(cand).success).toBe(true);
    });

    it("rejects 'forget' candidate without targetMemoryId", () => {
      const cand = {
        candidateId: "cand-02",
        actionIntent: "forget",
      };
      expect(CandidateMemoryInputSchema.safeParse(cand).success).toBe(false);
    });

    it("validates 'update' candidate with targetMemoryId and rawText", () => {
      const cand = {
        candidateId: "cand-03",
        actionIntent: "update",
        targetMemoryId: "mem-01",
        rawText: "Nueva preferencia de horario",
      };
      expect(CandidateMemoryInputSchema.safeParse(cand).success).toBe(true);
    });

    it("rejects 'update' candidate without targetMemoryId", () => {
      const cand = {
        candidateId: "cand-03",
        actionIntent: "update",
        rawText: "Nueva preferencia de horario",
      };
      expect(CandidateMemoryInputSchema.safeParse(cand).success).toBe(false);
    });
  });
});
