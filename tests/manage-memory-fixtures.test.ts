import { describe, it, expect } from "vitest";
import { ManageMemoryService } from "../src/skills/manage-memory";
import {
  ManageMemoryInput,
  MemoryItem,
  MemoryItemSchema,
  CandidateMemoryInput,
  CandidateMemoryInputSchema,
  MemoryOperationSchema,
} from "../src/domain/memory";

describe("Skill 10: manage_memory canonical fixtures (28 cases)", () => {
  const service = new ManageMemoryService();

  const sampleMemoryFact: MemoryItem = {
    id: "mem-01",
    content: "He completado la certificación AWS Solutions Architect",
    category: "fact",
    confirmationStatus: "confirmed",
    temporalStatus: "active",
    validUntil: null,
    tags: ["aws", "cert"],
    provenance: {
      source: "user_explicit",
      referenceText: "He completado la certificación AWS Solutions Architect",
      timestamp: "2026-10-12T09:00:00Z",
    },
    createdAt: "2026-10-12",
  };

  const sampleMemoryPref: MemoryItem = {
    id: "mem-02",
    content: "Prefiero trabajar en bloques de mañana",
    category: "preference",
    confirmationStatus: "confirmed",
    temporalStatus: "active",
    validUntil: null,
    tags: ["horarios"],
    provenance: {
      source: "user_explicit",
      referenceText: "Prefiero trabajar en bloques de mañana",
      timestamp: "2026-10-10T08:00:00Z",
    },
    createdAt: "2026-10-10",
  };

  // ==========================================================================
  // Group 1: Base Cases (01 - 12)
  // ==========================================================================

  it("mem-01: empty input returns no_action_needed", async () => {
    const input: ManageMemoryInput = {
      referenceDate: "2026-10-12",
      existingMemories: [],
      candidates: [],
    };
    const output = await service.manage(input);
    expect(output.status).toBe("no_action_needed");
    expect(output.proposedOperations).toHaveLength(0);
    expect(output.invalidReferences).toHaveLength(0);
  });

  it("mem-02: new confirmed fact proposes add operation with human confirmation required", async () => {
    const input: ManageMemoryInput = {
      referenceDate: "2026-10-12",
      existingMemories: [],
      candidates: [
        {
          candidateId: "cand-aws",
          actionIntent: "store",
          rawText: "Aprobé la certificación AWS",
          suggestedCategory: "fact",
          isExplicitUserStatement: true,
        },
      ],
    };
    const output = await service.manage(input);
    expect(output.status).toBe("proposals_generated");
    expect(output.proposedOperations).toHaveLength(1);
    const op = output.proposedOperations[0];
    expect(op.type).toBe("add");
    if (op.type === "add") {
      expect(op.proposedMemory.confirmationStatus).toBe("confirmed");
      expect(op.proposedMemory.category).toBe("fact");
      expect(op.requiresHumanConfirmation).toBe(true);
    }
  });

  it("mem-03: exact duplicate does not propose add and issues warning", async () => {
    const input: ManageMemoryInput = {
      referenceDate: "2026-10-12",
      existingMemories: [sampleMemoryFact],
      candidates: [
        {
          candidateId: "cand-dup",
          actionIntent: "store",
          rawText: "He completado la certificación AWS Solutions Architect",
          suggestedCategory: "fact",
        },
      ],
    };
    const output = await service.manage(input);
    expect(output.status).toBe("no_action_needed");
    expect(output.proposedOperations).toHaveLength(0);
    expect(output.warnings.some((w) => w.includes("duplicado exacto"))).toBe(true);
  });

  it("mem-04: similar memories are not merged automatically", async () => {
    const input: ManageMemoryInput = {
      referenceDate: "2026-10-12",
      existingMemories: [
        {
          ...sampleMemoryFact,
          id: "mem-arch",
          content: "Revisar arquitectura de backend de ArchitectAI",
        },
      ],
      candidates: [
        {
          candidateId: "cand-api",
          actionIntent: "store",
          rawText: "Refactorizar endpoints de API de ArchitectAI",
          suggestedCategory: "project_context",
        },
      ],
    };
    const output = await service.manage(input);
    expect(output.status).toBe("proposals_generated");
    // Does not force a destructive merge; generates an add for the distinct nuance
    expect(output.proposedOperations.some((op) => op.type === "add")).toBe(true);
    expect(output.proposedOperations.some((op) => op.type === "merge")).toBe(false);
  });

  it("mem-05: explicit preference update proposes update operation", async () => {
    const input: ManageMemoryInput = {
      referenceDate: "2026-10-12",
      existingMemories: [sampleMemoryPref],
      candidates: [
        {
          candidateId: "cand-upd-pref",
          actionIntent: "update",
          targetMemoryId: "mem-02",
          rawText: "Ahora prefiero trabajar en bloques de tarde",
          suggestedCategory: "preference",
          isExplicitUserStatement: true,
        },
      ],
    };
    const output = await service.manage(input);
    expect(output.status).toBe("proposals_generated");
    expect(output.proposedOperations).toHaveLength(1);
    const op = output.proposedOperations[0];
    expect(op.type).toBe("update");
    if (op.type === "update") {
      expect(op.targetMemoryId).toBe("mem-02");
      expect(op.updatedFields.content).toBe("Ahora prefiero trabajar en bloques de tarde");
      expect(op.requiresHumanConfirmation).toBe(true);
    }
  });

  it("mem-06: direct contradiction without evidence requires clarification", async () => {
    const input: ManageMemoryInput = {
      referenceDate: "2026-10-12",
      existingMemories: [
        {
          ...sampleMemoryPref,
          content: "comer carne",
        },
      ],
      candidates: [
        {
          candidateId: "cand-veg",
          actionIntent: "store",
          rawText: "no comer carne",
          suggestedCategory: "preference",
        },
      ],
    };
    const output = await service.manage(input);
    expect(output.status).toBe("clarification_required");
    expect(output.contradictions).toHaveLength(1);
    expect(output.clarificationQuestions).toHaveLength(1);
    expect(output.proposedOperations.some((op) => op.type === "request_clarification")).toBe(true);
  });

  it("mem-07: expired temporal memory triggers archive proposal", async () => {
    const expiredMemory: MemoryItem = {
      id: "mem-exp",
      content: "Taller intensivo de diseño",
      category: "temporal_constraint",
      confirmationStatus: "confirmed",
      temporalStatus: "active",
      validUntil: "2026-10-10",
      tags: [],
      provenance: {
        source: "user_explicit",
        referenceText: "Taller intensivo hasta el 10 de octubre",
      },
      createdAt: "2026-10-01",
    };
    const input: ManageMemoryInput = {
      referenceDate: "2026-10-12",
      existingMemories: [expiredMemory],
      candidates: [],
    };
    const output = await service.manage(input);
    expect(output.status).toBe("proposals_generated");
    expect(output.proposedOperations).toHaveLength(1);
    const op = output.proposedOperations[0];
    expect(op.type).toBe("archive");
    if (op.type === "archive") {
      expect(op.targetMemoryId).toBe("mem-exp");
      expect(op.reason).toBe("expired_date");
    }
  });

  it("mem-08: explicit forget request suppresses memory and generates forget proposal", async () => {
    const input: ManageMemoryInput = {
      referenceDate: "2026-10-12",
      existingMemories: [sampleMemoryFact],
      explicitForgetRequests: ["mem-01"],
    };
    const output = await service.manage(input);
    expect(output.status).toBe("proposals_generated");
    expect(output.suppressedContextMemoryIds).toContain("mem-01");
    expect(output.proposedOperations).toHaveLength(1);
    const op = output.proposedOperations[0];
    expect(op.type).toBe("forget");
    if (op.type === "forget") {
      expect(op.targetMemoryId).toBe("mem-01");
      expect(op.requiresHumanConfirmation).toBe(true);
    }
  });

  it("mem-09: explicit forget on non-existent memory reports invalid_request", async () => {
    const input: ManageMemoryInput = {
      referenceDate: "2026-10-12",
      existingMemories: [sampleMemoryFact],
      explicitForgetRequests: ["mem-ghost"],
    };
    const output = await service.manage(input);
    expect(output.status).toBe("invalid_request");
    expect(output.invalidReferences).toContain("mem-ghost");
    expect(output.proposedOperations).toHaveLength(0);
  });

  it("mem-10: inferred candidate is restricted from becoming confirmed", async () => {
    const input: ManageMemoryInput = {
      referenceDate: "2026-10-12",
      existingMemories: [],
      candidates: [
        {
          candidateId: "cand-inf",
          actionIntent: "store",
          rawText: "El usuario parece programar mejor por las noches",
          suggestedCategory: "preference",
          isExplicitUserStatement: false, // Inferred from system observation
        },
      ],
    };
    const output = await service.manage(input);
    expect(output.status).toBe("proposals_generated");
    const op = output.proposedOperations[0];
    if (op.type === "add") {
      expect(op.proposedMemory.confirmationStatus).toBe("inferred");
    }
  });

  it("mem-11: merge operation with invalid reference is rejected and flagged", async () => {
    // If an external runner proposes a merge via candidate targeting a non-existent item
    const input: ManageMemoryInput = {
      referenceDate: "2026-10-12",
      existingMemories: [sampleMemoryFact],
      candidates: [
        {
          candidateId: "cand-invalid-upd",
          actionIntent: "update",
          targetMemoryId: "mem-nonexistent",
          rawText: "Update non-existent",
        },
      ],
    };
    const output = await service.manage(input);
    expect(output.status).toBe("invalid_request");
    expect(output.invalidReferences).toContain("mem-nonexistent");
    expect(output.proposedOperations).toHaveLength(0);
  });

  it("mem-12: identical input reprocessing guarantees idempotent output", async () => {
    const input: ManageMemoryInput = {
      referenceDate: "2026-10-12",
      existingMemories: [sampleMemoryFact],
      candidates: [
        {
          candidateId: "cand-1",
          actionIntent: "store",
          rawText: "Anotación de prueba 1",
        },
        {
          candidateId: "cand-2",
          actionIntent: "store",
          rawText: "Anotación de prueba 2",
        },
      ],
    };
    const run1 = await service.manage(input);
    const run2 = await service.manage(input);
    expect(run1).toEqual(run2);
  });

  // ==========================================================================
  // Group 2: Cross-Operation & Conflict Fixtures (13 - 18)
  // ==========================================================================

  it("mem-13: forget strictly supersedes concurrent update on same memory", async () => {
    const input: ManageMemoryInput = {
      referenceDate: "2026-10-12",
      existingMemories: [sampleMemoryFact],
      explicitForgetRequests: ["mem-01"],
      candidates: [
        {
          candidateId: "cand-conflict-upd",
          actionIntent: "update",
          targetMemoryId: "mem-01",
          rawText: "Update on item to be forgotten",
        },
      ],
    };
    const output = await service.manage(input);
    expect(output.status).toBe("proposals_generated");
    expect(output.suppressedContextMemoryIds).toContain("mem-01");
    // Update must be suppressed; forget must prevail
    expect(output.proposedOperations).toHaveLength(1);
    expect(output.proposedOperations[0].type).toBe("forget");
    expect(output.warnings.some((w) => w.includes("suprimida"))).toBe(true);
  });

  it("mem-14: forget strictly supersedes memory involved in candidate forget", async () => {
    const input: ManageMemoryInput = {
      referenceDate: "2026-10-12",
      existingMemories: [sampleMemoryFact, sampleMemoryPref],
      candidates: [
        {
          candidateId: "cand-f1",
          actionIntent: "forget",
          targetMemoryId: "mem-01",
        },
        {
          candidateId: "cand-u1",
          actionIntent: "update",
          targetMemoryId: "mem-01",
          rawText: "Updated content",
        },
      ],
    };
    const output = await service.manage(input);
    expect(output.suppressedContextMemoryIds).toContain("mem-01");
    expect(output.proposedOperations).toHaveLength(1);
    expect(output.proposedOperations[0].type).toBe("forget");
  });

  it("mem-15: merge schema rejects duplicate source IDs at parse time", () => {
    const invalidMergeOp = {
      type: "merge",
      sourceMemoryIds: ["mem-01", "mem-01"],
      mergedMemory: sampleMemoryFact,
      rationale: "Merge duplicates",
      requiresHumanConfirmation: true,
    };
    expect(MemoryOperationSchema.safeParse(invalidMergeOp).success).toBe(false);
  });

  it("mem-16: temporal inclusive boundary keeps memory active on referenceDate == validUntil", async () => {
    const memoryToday: MemoryItem = {
      ...sampleMemoryFact,
      id: "mem-today",
      validUntil: "2026-10-12",
    };
    const input: ManageMemoryInput = {
      referenceDate: "2026-10-12",
      existingMemories: [memoryToday],
      candidates: [],
    };
    const output = await service.manage(input);
    // Boundary is inclusive: today is still active!
    expect(output.status).toBe("no_action_needed");
    expect(output.proposedOperations).toHaveLength(0);
  });

  it("mem-17: invalid calendar date in validUntil is rejected at schema level", () => {
    const badCandidate = {
      candidateId: "cand-bad-date",
      actionIntent: "store",
      rawText: "Evento",
      validUntil: "2026-02-30", // Impossible date
    };
    expect(CandidateMemoryInputSchema.safeParse(badCandidate).success).toBe(false);
  });

  it("mem-18: epistemic violation of conversation_inference being confirmed is rejected", () => {
    const invalidItem = {
      ...sampleMemoryFact,
      confirmationStatus: "confirmed",
      provenance: {
        source: "conversation_inference",
        referenceText: "Deduced from conversation",
      },
    };
    expect(MemoryItemSchema.safeParse(invalidItem).success).toBe(false);
  });

  // ==========================================================================
  // Group 3: Specific Error & Precedence Cases (19 - 28)
  // ==========================================================================

  it("mem-19: forget candidate missing targetMemoryId is rejected", () => {
    const badForget = {
      candidateId: "cand-f-err",
      actionIntent: "forget",
    };
    expect(CandidateMemoryInputSchema.safeParse(badForget).success).toBe(false);
  });

  it("mem-20: update candidate missing targetMemoryId is rejected", () => {
    const badUpdate = {
      candidateId: "cand-u-err",
      actionIntent: "update",
      rawText: "New text",
    };
    expect(CandidateMemoryInputSchema.safeParse(badUpdate).success).toBe(false);
  });

  it("mem-21: store candidate with unnecessary targetMemoryId is rejected", () => {
    const badStore = {
      candidateId: "cand-s-err",
      actionIntent: "store",
      targetMemoryId: "mem-01",
      rawText: "New memory",
    };
    expect(CandidateMemoryInputSchema.safeParse(badStore).success).toBe(false);
  });

  it("mem-22: epistemic violation of system being confirmed is rejected", () => {
    const invalidItem = {
      ...sampleMemoryFact,
      confirmationStatus: "confirmed",
      provenance: {
        source: "system",
        referenceText: "Generated by maintenance cycle",
      },
    };
    expect(MemoryItemSchema.safeParse(invalidItem).success).toBe(false);
  });

  it("mem-23: invalid ISO timestamp clock hours (25:00) is rejected", () => {
    const invalidItem = {
      ...sampleMemoryFact,
      provenance: {
        source: "user_explicit",
        referenceText: "Explicit text",
        timestamp: "2026-10-12T25:00:00Z",
      },
    };
    expect(MemoryItemSchema.safeParse(invalidItem).success).toBe(false);
  });

  it("mem-24: invalid ISO timestamp calendar date (Feb 30) is rejected", () => {
    const invalidItem = {
      ...sampleMemoryFact,
      provenance: {
        source: "user_explicit",
        referenceText: "Explicit text",
        timestamp: "2026-02-30T10:00:00Z",
      },
    };
    expect(MemoryItemSchema.safeParse(invalidItem).success).toBe(false);
  });

  it("mem-25: partially invalid references still preserve valid independent proposals", async () => {
    const input: ManageMemoryInput = {
      referenceDate: "2026-10-12",
      existingMemories: [sampleMemoryFact],
      explicitForgetRequests: ["mem-ghost", "mem-01"],
    };
    const output = await service.manage(input);
    // Invalid reference triggers invalid_request
    expect(output.status).toBe("invalid_request");
    expect(output.invalidReferences).toContain("mem-ghost");
    // But valid independent proposal for mem-01 is preserved!
    expect(output.proposedOperations).toHaveLength(1);
    expect(output.proposedOperations[0].type).toBe("forget");
    expect(output.suppressedContextMemoryIds).toContain("mem-01");
  });

  it("mem-26: divergent concurrent updates for same target generate clarification request", async () => {
    const input: ManageMemoryInput = {
      referenceDate: "2026-10-12",
      existingMemories: [sampleMemoryPref],
      candidates: [
        {
          candidateId: "cand-upd-1",
          actionIntent: "update",
          targetMemoryId: "mem-02",
          rawText: "Preferencia: Bloques de tarde",
        },
        {
          candidateId: "cand-upd-2",
          actionIntent: "update",
          targetMemoryId: "mem-02",
          rawText: "Preferencia: Bloques de noche",
        },
      ],
    };
    const output = await service.manage(input);
    expect(output.status).toBe("clarification_required");
    expect(output.contradictions).toHaveLength(1);
    expect(output.clarificationQuestions).toHaveLength(1);
    expect(output.proposedOperations.some((op) => op.type === "request_clarification")).toBe(true);
    expect(output.proposedOperations.some((op) => op.type === "update")).toBe(false);
  });

  it("mem-27: divergent duplicate store candidates generate clarification request", async () => {
    const input: ManageMemoryInput = {
      referenceDate: "2026-10-12",
      existingMemories: [],
      candidates: [
        {
          candidateId: "cand-div",
          actionIntent: "store",
          rawText: "Versión A del candidato",
        },
        {
          candidateId: "cand-div",
          actionIntent: "store",
          rawText: "Versión B incompatible del candidato",
        },
      ],
    };
    const output = await service.manage(input);
    expect(output.status).toBe("clarification_required");
    expect(output.proposedOperations.some((op) => op.type === "request_clarification")).toBe(true);
  });

  it("mem-28: order-invariance idempotency across candidates permutation", async () => {
    const candA: CandidateMemoryInput = {
      candidateId: "cand-alpha",
      actionIntent: "store",
      rawText: "Nota Alpha",
    };
    const candB: CandidateMemoryInput = {
      candidateId: "cand-beta",
      actionIntent: "store",
      rawText: "Nota Beta",
    };

    const inputOrder1: ManageMemoryInput = {
      referenceDate: "2026-10-12",
      existingMemories: [sampleMemoryFact],
      candidates: [candA, candB],
    };

    const inputOrder2: ManageMemoryInput = {
      referenceDate: "2026-10-12",
      existingMemories: [sampleMemoryFact],
      candidates: [candB, candA],
    };

    const res1 = await service.manage(inputOrder1);
    const res2 = await service.manage(inputOrder2);

    expect(res1).toEqual(res2);
  });

  // ==========================================================================
  // Group 4: Audit Regression Tests (29 - 32)
  // ==========================================================================

  it("mem-29: malformed candidate is isolated without dropping valid candidates or independent forget requests", async () => {
    const malformedCandidate = {
      candidateId: "cand-malformed",
      actionIntent: "store",
      targetMemoryId: "mem-01", // Invalid for store!
      rawText: "Texto inválido con targetMemoryId",
    };
    const validCandidate = {
      candidateId: "cand-valid",
      actionIntent: "store",
      rawText: "Candidato completamente válido",
    };

    const input: ManageMemoryInput = {
      referenceDate: "2026-10-12",
      existingMemories: [sampleMemoryFact, sampleMemoryPref],
      explicitForgetRequests: ["mem-01"],
      candidates: [malformedCandidate, validCandidate],
    };

    const output = await service.manage(input);

    // 1. Status indicates invalid_request due to isolated candidate error, without confusing candidate IDs with non-existent memory references
    expect(output.status).toBe("invalid_request");
    expect(output.invalidReferences).not.toContain("cand-malformed");
    expect(output.warnings.some((w) => w.includes("cand-malformed"))).toBe(true);

    // 2. Forget request on mem-01 is fully preserved and executed
    expect(output.suppressedContextMemoryIds).toContain("mem-01");
    expect(
      output.proposedOperations.some((op) => op.type === "forget" && op.targetMemoryId === "mem-01")
    ).toBe(true);

    // 3. Valid candidate is NOT dropped
    expect(
      output.proposedOperations.some((op) => op.type === "add" && op.candidateId === "cand-valid")
    ).toBe(true);
  });

  it("mem-30: normalization preserves technical symbols (+, #, @, /, -, _, ., :) to avoid collapsing distinct technical terms", async () => {
    const memoryCpp: MemoryItem = {
      ...sampleMemoryFact,
      id: "mem-cpp",
      content: "Dominio de C++ avanzado",
    };
    const inputC: ManageMemoryInput = {
      referenceDate: "2026-10-12",
      existingMemories: [memoryCpp],
      candidates: [
        {
          candidateId: "cand-c",
          actionIntent: "store",
          rawText: "Dominio de C avanzado",
          suggestedCategory: "fact",
        },
      ],
    };

    const output = await service.manage(inputC);
    // Must NOT be treated as duplicate of "C++"!
    expect(output.status).toBe("proposals_generated");
    expect(output.proposedOperations.some((op) => op.type === "add")).toBe(true);
    expect(output.warnings.some((w) => w.includes("duplicado exacto"))).toBe(false);
  });

  it("mem-31: merge operation rejects elevation to confirmed if any source memory has unconfirmed/inferred provenance", () => {
    const invalidMergedOp = {
      type: "merge",
      sourceMemoryIds: ["mem-01", "mem-inferred"],
      sourceProvenances: [
        {
          memoryId: "mem-01",
          provenance: {
            source: "user_explicit",
            referenceText: "Confirmed fact",
          },
          confirmationStatus: "confirmed",
        },
        {
          memoryId: "mem-inferred",
          provenance: {
            source: "conversation_inference",
            referenceText: "Inferred context",
          },
          confirmationStatus: "inferred",
        },
      ],
      mergedMemory: {
        ...sampleMemoryFact,
        id: "mem-merged-elevated",
        confirmationStatus: "confirmed", // ILLEGAL: elevates inferred source!
      },
      rationale: "Merged synthesis",
      requiresHumanConfirmation: true,
    };

    expect(MemoryOperationSchema.safeParse(invalidMergedOp).success).toBe(false);
  });

  it("mem-32: merge operation accepts conservative unconfirmed/inferred status inheriting weakest provenance", () => {
    const validMergedOp = {
      type: "merge",
      sourceMemoryIds: ["mem-01", "mem-inferred"],
      sourceProvenances: [
        {
          memoryId: "mem-01",
          provenance: {
            source: "user_explicit",
            referenceText: "Confirmed fact",
          },
          confirmationStatus: "confirmed",
        },
        {
          memoryId: "mem-inferred",
          provenance: {
            source: "conversation_inference",
            referenceText: "Inferred context",
          },
          confirmationStatus: "inferred",
        },
      ],
      mergedMemory: {
        ...sampleMemoryFact,
        id: "mem-merged-conservative",
        confirmationStatus: "inferred", // CONSERVATIVE: inherits weakest status
        provenance: {
          source: "conversation_inference",
          referenceText: "Merged synthesis of mem-01 and mem-inferred",
        },
      },
      rationale: "Merged synthesis",
      requiresHumanConfirmation: true,
    };

    expect(MemoryOperationSchema.safeParse(validMergedOp).success).toBe(true);
  });

  it("mem-33: merge rejects elevation if sources are unconfirmed user_explicit, unaccepted plan_decision, or fully expired", () => {
    // A: user_explicit but unconfirmed cannot yield confirmed in merge
    const mergeWithUnconfirmedUser = {
      type: "merge",
      sourceMemoryIds: ["mem-01", "mem-unconfirmed"],
      sourceProvenances: [
        {
          memoryId: "mem-01",
          provenance: { source: "user_explicit", referenceText: "Confirmed fact" },
          confirmationStatus: "confirmed",
        },
        {
          memoryId: "mem-unconfirmed",
          provenance: { source: "user_explicit", referenceText: "Quizás haga esto" },
          confirmationStatus: "unconfirmed",
        },
      ],
      mergedMemory: {
        ...sampleMemoryFact,
        id: "mem-merged-err1",
        confirmationStatus: "confirmed", // Invalid!
      },
      rationale: "Synthesis",
      requiresHumanConfirmation: true,
    };
    expect(MemoryOperationSchema.safeParse(mergeWithUnconfirmedUser).success).toBe(false);

    // B: plan_decision without acceptance evidence cannot yield confirmed in merge
    const mergeWithUnacceptedPlan = {
      type: "merge",
      sourceMemoryIds: ["mem-01", "mem-plan"],
      sourceProvenances: [
        {
          memoryId: "mem-01",
          provenance: { source: "user_explicit", referenceText: "Confirmed fact" },
          confirmationStatus: "confirmed",
        },
        {
          memoryId: "mem-plan",
          provenance: { source: "plan_decision", referenceText: "Draft decision in plan" }, // Missing acceptance!
          confirmationStatus: "confirmed",
        },
      ],
      mergedMemory: {
        ...sampleMemoryFact,
        id: "mem-merged-err2",
        confirmationStatus: "confirmed", // Invalid!
      },
      rationale: "Synthesis",
      requiresHumanConfirmation: true,
    };
    expect(MemoryOperationSchema.safeParse(mergeWithUnacceptedPlan).success).toBe(false);

    // C: all sources expired/outdated cannot yield active in merge
    const mergeWithAllExpired = {
      type: "merge",
      sourceMemoryIds: ["mem-exp1", "mem-exp2"],
      sourceProvenances: [
        {
          memoryId: "mem-exp1",
          provenance: { source: "user_explicit", referenceText: "Old event 1" },
          confirmationStatus: "confirmed",
          temporalStatus: "expired",
        },
        {
          memoryId: "mem-exp2",
          provenance: { source: "user_explicit", referenceText: "Old event 2" },
          confirmationStatus: "confirmed",
          temporalStatus: "outdated",
        },
      ],
      mergedMemory: {
        ...sampleMemoryFact,
        id: "mem-merged-err3",
        confirmationStatus: "confirmed",
        temporalStatus: "active", // Invalid: all sources are inactive!
      },
      rationale: "Synthesis",
      requiresHumanConfirmation: true,
    };
    expect(MemoryOperationSchema.safeParse(mergeWithAllExpired).success).toBe(false);
  });

  it("mem-34: synthesized postponement candidate yields unconfirmed plan_decision without fabricating user quote", async () => {
    const input: ManageMemoryInput = {
      referenceDate: "2026-10-19",
      existingMemories: [],
      candidates: [
        {
          candidateId: "cand-postpone-synth",
          actionIntent: "store",
          rawText: 'Decisión de postergación consciente durante la semana: "Avanzar Zapsac".',
          suggestedCategory: "decision",
          isExplicitUserStatement: false,
          provenanceSource: "plan_decision",
        },
      ],
    };

    const output = await service.manage(input);
    expect(output.status).toBe("proposals_generated");
    expect(output.proposedOperations).toHaveLength(1);
    const op = output.proposedOperations[0];
    expect(op.type).toBe("add");
    if (op.type === "add") {
      // Invariantes obligatorias:
      // 1. Procedencia auténtica como plan_decision, NO user_explicit
      expect(op.proposedMemory.provenance.source).toBe("plan_decision");
      // 2. Sin evidencia verificable de aceptación -> unconfirmed
      expect(op.proposedMemory.confirmationStatus).toBe("unconfirmed");
      // 3. Categoría preservada como decisión (no preferencia)
      expect(op.proposedMemory.category).toBe("decision");
      // 4. Operación requiere confirmación humana para guardarse
      expect(op.requiresHumanConfirmation).toBe(true);
    }
  });

  it("mem-35: plan decision with verifiable acceptance evidence achieves confirmed status without inventing citation", async () => {
    const input: ManageMemoryInput = {
      referenceDate: "2026-10-19",
      existingMemories: [],
      verifiedAcceptedDecisionRefs: [
        "Propuesta de ajuste prop-postpone-flex aceptada por el usuario",
      ],
      candidates: [
        {
          candidateId: "cand-decision-accepted",
          actionIntent: "store",
          rawText: "Postergación de Zapsac para dar cabida a la auditoría",
          suggestedCategory: "decision",
          isExplicitUserStatement: false,
          provenanceSource: "plan_decision",
          evidenceReference: "Propuesta de ajuste prop-postpone-flex aceptada por el usuario",
        },
      ],
    };

    const output = await service.manage(input);
    expect(output.status).toBe("proposals_generated");
    const op = output.proposedOperations[0];
    expect(op.type).toBe("add");
    if (op.type === "add") {
      // Invariante 2 & 5: Conserva procedencia plan_decision y alcanza 'confirmed' con evidencia autoritativa verificada
      expect(op.proposedMemory.provenance.source).toBe("plan_decision");
      expect(op.proposedMemory.provenance.referenceText).toContain("aceptada");
      expect(op.proposedMemory.confirmationStatus).toBe("confirmed");
      expect(op.requiresHumanConfirmation).toBe(true);
    }
  });

  it("mem-36: genuine explicit user statement processes under existing assertiveness rules", async () => {
    // A: Asertivo -> confirmed
    const inputAssertive: ManageMemoryInput = {
      referenceDate: "2026-10-19",
      existingMemories: [],
      candidates: [
        {
          candidateId: "cand-user-assertive",
          actionIntent: "store",
          rawText: "Prefiero no agendar reuniones los viernes",
          suggestedCategory: "preference",
          isExplicitUserStatement: true,
          provenanceSource: "user_explicit",
        },
      ],
    };
    const resAssertive = await service.manage(inputAssertive);
    const opAssertive = resAssertive.proposedOperations[0];
    if (opAssertive.type === "add") {
      expect(opAssertive.proposedMemory.provenance.source).toBe("user_explicit");
      expect(opAssertive.proposedMemory.confirmationStatus).toBe("confirmed");
      expect(opAssertive.requiresHumanConfirmation).toBe(true);
    }

    // B: Con vacilación -> unconfirmed
    const inputHesitant: ManageMemoryInput = {
      referenceDate: "2026-10-19",
      existingMemories: [],
      candidates: [
        {
          candidateId: "cand-user-hesitant",
          actionIntent: "store",
          rawText: "Quizás prefiera no agendar reuniones los viernes",
          suggestedCategory: "preference",
          isExplicitUserStatement: true,
          provenanceSource: "user_explicit",
        },
      ],
    };
    const resHesitant = await service.manage(inputHesitant);
    const opHesitant = resHesitant.proposedOperations[0];
    if (opHesitant.type === "add") {
      expect(opHesitant.proposedMemory.provenance.source).toBe("user_explicit");
      expect(opHesitant.proposedMemory.confirmationStatus).toBe("unconfirmed");
      expect(opHesitant.requiresHumanConfirmation).toBe(true);
    }
  });

  it("mem-37: single postponement candidate is never transformed into a stable preference", async () => {
    const input: ManageMemoryInput = {
      referenceDate: "2026-10-19",
      existingMemories: [],
      candidates: [
        {
          candidateId: "cand-single-postpone",
          actionIntent: "store",
          rawText: "Avanzar Zapsac postergado en el cierre semanal",
          suggestedCategory: "decision",
          isExplicitUserStatement: false,
          provenanceSource: "plan_decision",
        },
      ],
    };

    const output = await service.manage(input);
    const op = output.proposedOperations[0];
    if (op.type === "add") {
      expect(op.proposedMemory.category).toBe("decision");
      expect(op.proposedMemory.category).not.toBe("preference");
    }
  });

  it("mem-38 (req 1): plan_decision with negation ('Propuesta no aceptada por el usuario') remains unconfirmed", async () => {
    const input: ManageMemoryInput = {
      referenceDate: "2026-10-19",
      existingMemories: [],
      verifiedAcceptedDecisionRefs: ["Propuesta no aceptada por el usuario"], // Even if passed as string, contains negative marker!
      candidates: [
        {
          candidateId: "cand-negation",
          actionIntent: "store",
          rawText: "Propuesta no aceptada por el usuario",
          suggestedCategory: "decision",
          isExplicitUserStatement: false,
          provenanceSource: "plan_decision",
          evidenceReference: "Propuesta no aceptada por el usuario",
        },
      ],
    };

    const output = await service.manage(input);
    const op = output.proposedOperations[0];
    expect(op.type).toBe("add");
    if (op.type === "add") {
      expect(op.proposedMemory.provenance.source).toBe("plan_decision");
      expect(op.proposedMemory.confirmationStatus).toBe("unconfirmed");
    }
  });

  it("mem-39 (req 2): plan_decision with pending status ('Pendiente de ser aprobado') remains unconfirmed", async () => {
    const input: ManageMemoryInput = {
      referenceDate: "2026-10-19",
      existingMemories: [],
      verifiedAcceptedDecisionRefs: ["Pendiente de ser aprobado"],
      candidates: [
        {
          candidateId: "cand-pending",
          actionIntent: "store",
          rawText: "Ajuste de calendario pendiente de ser aprobado",
          suggestedCategory: "decision",
          isExplicitUserStatement: false,
          provenanceSource: "plan_decision",
          evidenceReference: "Pendiente de ser aprobado",
        },
      ],
    };

    const output = await service.manage(input);
    const op = output.proposedOperations[0];
    expect(op.type).toBe("add");
    if (op.type === "add") {
      expect(op.proposedMemory.provenance.source).toBe("plan_decision");
      expect(op.proposedMemory.confirmationStatus).toBe("unconfirmed");
    }
  });

  it("mem-40 (req 3): plan_decision with conditional hypothesis ('Si es aceptada la propuesta') remains unconfirmed", async () => {
    const input: ManageMemoryInput = {
      referenceDate: "2026-10-19",
      existingMemories: [],
      verifiedAcceptedDecisionRefs: ["Si es aceptada la propuesta"],
      candidates: [
        {
          candidateId: "cand-conditional",
          actionIntent: "store",
          rawText: "Si es aceptada la propuesta de postergación",
          suggestedCategory: "decision",
          isExplicitUserStatement: false,
          provenanceSource: "plan_decision",
          evidenceReference: "Si es aceptada la propuesta",
        },
      ],
    };

    const output = await service.manage(input);
    const op = output.proposedOperations[0];
    expect(op.type).toBe("add");
    if (op.type === "add") {
      expect(op.proposedMemory.provenance.source).toBe("plan_decision");
      expect(op.proposedMemory.confirmationStatus).toBe("unconfirmed");
    }
  });

  it("mem-41 (req 4): circular evidence in free text ('Examen aprobado') never confirms itself", async () => {
    const input: ManageMemoryInput = {
      referenceDate: "2026-10-19",
      existingMemories: [],
      // No verified authoritative event supplied
      candidates: [
        {
          candidateId: "cand-circular",
          actionIntent: "store",
          rawText: "Examen de certificación aprobado con éxito",
          suggestedCategory: "decision",
          isExplicitUserStatement: false,
          provenanceSource: "plan_decision",
          // evidenceReference is omitted or self-referential
        },
      ],
    };

    const output = await service.manage(input);
    const op = output.proposedOperations[0];
    expect(op.type).toBe("add");
    if (op.type === "add") {
      expect(op.proposedMemory.provenance.source).toBe("plan_decision");
      expect(op.proposedMemory.confirmationStatus).toBe("unconfirmed");
    }
  });

  it("mem-42 (req 5): invented reference format not in verified registry remains unconfirmed", async () => {
    const input: ManageMemoryInput = {
      referenceDate: "2026-10-19",
      existingMemories: [],
      // Empty or different verified references
      verifiedAcceptedDecisionRefs: ["audit:log-999:accepted"],
      candidates: [
        {
          candidateId: "cand-invented-format",
          actionIntent: "store",
          rawText: "Ajuste de foco acordado en reunión",
          suggestedCategory: "decision",
          isExplicitUserStatement: false,
          provenanceSource: "plan_decision",
          evidenceReference: "decision:2026-w42:accepted", // Valid format, but not verified in registry!
        },
      ],
    };

    const output = await service.manage(input);
    const op = output.proposedOperations[0];
    expect(op.type).toBe("add");
    if (op.type === "add") {
      expect(op.proposedMemory.provenance.source).toBe("plan_decision");
      expect(op.proposedMemory.confirmationStatus).toBe("unconfirmed");
    }
  });

  it("mem-43 (req 6): genuine verified reference in registry achieves confirmed status with human confirmation required", async () => {
    const input: ManageMemoryInput = {
      referenceDate: "2026-10-19",
      existingMemories: [],
      verifiedAcceptedDecisionRefs: ["decision:2026-w42:adjustment-accepted"],
      candidates: [
        {
          candidateId: "cand-verified-real",
          actionIntent: "store",
          rawText: "Postergación acordada de la tarea Zapsac para w43",
          suggestedCategory: "decision",
          isExplicitUserStatement: false,
          provenanceSource: "plan_decision",
          evidenceReference: "decision:2026-w42:adjustment-accepted",
        },
      ],
    };

    const output = await service.manage(input);
    const op = output.proposedOperations[0];
    expect(op.type).toBe("add");
    if (op.type === "add") {
      expect(op.proposedMemory.provenance.source).toBe("plan_decision");
      expect(op.proposedMemory.confirmationStatus).toBe("confirmed");
      expect(op.requiresHumanConfirmation).toBe(true);
    }
  });

  it("mem-44 (req 7): update operation enforces identical authoritative verification for plan_decision", async () => {
    const existingDecisionMem: MemoryItem = {
      id: "mem-dec-exist",
      content: "Decisión inicial en borrador",
      category: "decision",
      confirmationStatus: "unconfirmed",
      temporalStatus: "active",
      validUntil: null,
      createdAt: "2026-10-12",
      tags: [],
      provenance: {
        source: "plan_decision",
        referenceText: "Plan draft",
      },
    };

    // Sub-case A: Unverified reference in update -> remains unconfirmed
    const inputUnverified: ManageMemoryInput = {
      referenceDate: "2026-10-19",
      existingMemories: [existingDecisionMem],
      verifiedAcceptedDecisionRefs: [],
      candidates: [
        {
          candidateId: "cand-upd-unverified",
          actionIntent: "update",
          targetMemoryId: "mem-dec-exist",
          rawText: "Decisión actualizada pero sin verificación registrada",
          suggestedCategory: "decision",
          isExplicitUserStatement: false,
          provenanceSource: "plan_decision",
          evidenceReference: "event:unregistered:accepted",
        },
      ],
    };

    const outUnverified = await service.manage(inputUnverified);
    const opUnverified = outUnverified.proposedOperations[0];
    expect(opUnverified.type).toBe("update");
    if (opUnverified.type === "update") {
      expect(opUnverified.updatedFields.confirmationStatus).toBe("unconfirmed");
    }

    // Sub-case B: Negated reference in update -> remains unconfirmed
    const inputNegated: ManageMemoryInput = {
      referenceDate: "2026-10-19",
      existingMemories: [existingDecisionMem],
      verifiedAcceptedDecisionRefs: ["event:reg:no-aceptado"],
      candidates: [
        {
          candidateId: "cand-upd-negated",
          actionIntent: "update",
          targetMemoryId: "mem-dec-exist",
          rawText: "Propuesta no aceptada por el usuario",
          suggestedCategory: "decision",
          isExplicitUserStatement: false,
          provenanceSource: "plan_decision",
          evidenceReference: "event:reg:no-aceptado",
        },
      ],
    };

    const outNegated = await service.manage(inputNegated);
    const opNegated = outNegated.proposedOperations[0];
    expect(opNegated.type).toBe("update");
    if (opNegated.type === "update") {
      expect(opNegated.updatedFields.confirmationStatus).toBe("unconfirmed");
    }

    // Sub-case C: Verified real event in update -> becomes confirmed
    const inputVerified: ManageMemoryInput = {
      referenceDate: "2026-10-19",
      existingMemories: [existingDecisionMem],
      verifiedAcceptedDecisionRefs: ["event:reg:accepted-01"],
      candidates: [
        {
          candidateId: "cand-upd-verified",
          actionIntent: "update",
          targetMemoryId: "mem-dec-exist",
          rawText: "Decisión confirmada por evento de ajuste aceptado",
          suggestedCategory: "decision",
          isExplicitUserStatement: false,
          provenanceSource: "plan_decision",
          evidenceReference: "event:reg:accepted-01",
        },
      ],
    };

    const outVerified = await service.manage(inputVerified);
    const opVerified = outVerified.proposedOperations[0];
    expect(opVerified.type).toBe("update");
    if (opVerified.type === "update") {
      expect(opVerified.updatedFields.confirmationStatus).toBe("confirmed");
      expect(opVerified.requiresHumanConfirmation).toBe(true);
    }
  });

  it("mem-45 (req 8): user_explicit preservation (assertive confirmed vs hesitant unconfirmed)", async () => {
    // Assertive user explicit -> confirmed
    const inputAssertive: ManageMemoryInput = {
      referenceDate: "2026-10-19",
      existingMemories: [],
      candidates: [
        {
          candidateId: "cand-user-direct",
          actionIntent: "store",
          rawText: "Nunca trabajo los domingos por la tarde.",
          suggestedCategory: "preference",
          isExplicitUserStatement: true,
          provenanceSource: "user_explicit",
        },
      ],
    };

    const outAssertive = await service.manage(inputAssertive);
    const opAssertive = outAssertive.proposedOperations[0];
    if (opAssertive.type === "add") {
      expect(opAssertive.proposedMemory.provenance.source).toBe("user_explicit");
      expect(opAssertive.proposedMemory.confirmationStatus).toBe("confirmed");
      expect(opAssertive.requiresHumanConfirmation).toBe(true);
    }

    // Hesitant user explicit -> unconfirmed
    const inputHesitant: ManageMemoryInput = {
      referenceDate: "2026-10-19",
      existingMemories: [],
      candidates: [
        {
          candidateId: "cand-user-hesitant-2",
          actionIntent: "store",
          rawText: "Tal vez no deba trabajar los domingos por la tarde.",
          suggestedCategory: "preference",
          isExplicitUserStatement: true,
          provenanceSource: "user_explicit",
        },
      ],
    };

    const outHesitant = await service.manage(inputHesitant);
    const opHesitant = outHesitant.proposedOperations[0];
    if (opHesitant.type === "add") {
      expect(opHesitant.proposedMemory.provenance.source).toBe("user_explicit");
      expect(opHesitant.proposedMemory.confirmationStatus).toBe("unconfirmed");
      expect(opHesitant.requiresHumanConfirmation).toBe(true);
    }
  });
});
