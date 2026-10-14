import { z } from "zod";
import { CalendarDateSchema } from "./week";

// ============================================================================
// 1. Strict Real ISO-8601 UTC Timestamp Validation
// ============================================================================

/**
 * Validates that a string is a real Gregorian calendar timestamp in ISO-8601 UTC format:
 * YYYY-MM-DDTHH:mm:ssZ or YYYY-MM-DDTHH:mm:ss.sssZ.
 *
 * Explicitly guards against JavaScript Date.UTC() idiosyncrasies where years 0000-0099
 * are mapped to 1900-1999 unless setUTCFullYear() is used explicitly.
 * Rejects invalid leap years, out-of-bounds days (e.g. Feb 30th), invalid months (1-12),
 * and invalid hours (0-23), minutes (0-59), seconds (0-59).
 */
export function isValidIsoUtcTimestamp(timestamp: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{3}))?Z$/.exec(timestamp);
  if (!match) return false;

  const [_, yStr, mStr, dStr, hStr, minStr, sStr, msStr] = match;
  const y = Number(yStr);
  const m = Number(mStr);
  const d = Number(dStr);
  const h = Number(hStr);
  const min = Number(minStr);
  const s = Number(sStr);
  const ms = msStr !== undefined ? Number(msStr) : 0;

  // 1. Validate numerical bounds
  if (y < 1000 || y > 9999) return false;
  if (m < 1 || m > 12) return false;
  if (d < 1 || d > 31) return false;
  if (h < 0 || h > 23) return false;
  if (min < 0 || min > 59) return false;
  if (s < 0 || s > 59) return false;
  if (ms < 0 || ms > 999) return false;

  // 2. Validate calendar date through UTC Date object with explicit setUTCFullYear
  const date = new Date(0);
  date.setUTCFullYear(y, m - 1, d);
  date.setUTCHours(h, min, s, ms);

  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d &&
    date.getUTCHours() === h &&
    date.getUTCMinutes() === min &&
    date.getUTCSeconds() === s &&
    date.getUTCMilliseconds() === ms
  );
}

export const IsoUtcTimestampSchema = z
  .string()
  .refine(isValidIsoUtcTimestamp, {
    message: "Must be a valid real Gregorian ISO-8601 UTC timestamp (YYYY-MM-DDTHH:mm:ssZ)",
  });

// ============================================================================
// 2. Core Enums & Schemas
// ============================================================================

export const MemoryCategorySchema = z.enum([
  "fact",
  "preference",
  "decision",
  "project_context",
  "temporal_constraint",
  "working_hypothesis",
]);
export type MemoryCategory = z.infer<typeof MemoryCategorySchema>;

export const ConfirmationStatusSchema = z.enum([
  "confirmed",
  "inferred",
  "unconfirmed",
]);
export type ConfirmationStatus = z.infer<typeof ConfirmationStatusSchema>;

export const TemporalStatusSchema = z.enum([
  "active",
  "expired",
  "outdated",
  "unknown",
]);
export type TemporalStatus = z.infer<typeof TemporalStatusSchema>;

export const MemoryProvenanceSourceSchema = z.enum([
  "user_explicit",
  "conversation_inference",
  "plan_decision",
  "system",
]);
export type MemoryProvenanceSource = z.infer<typeof MemoryProvenanceSourceSchema>;

export const MemoryProvenanceSchema = z
  .object({
    source: MemoryProvenanceSourceSchema,
    referenceText: z.string().min(1),
    timestamp: IsoUtcTimestampSchema.optional(),
  })
  .strict();
export type MemoryProvenance = z.infer<typeof MemoryProvenanceSchema>;

// ============================================================================
// 3. Epistemic Validation Helpers
// ============================================================================

/**
 * Common hesitation and speculative markers in natural language.
 * When present in an explicit user statement without assertiveness,
 * they prevent raising epistemic status to 'confirmed'.
 */
const HESITATION_REGEX = /\b(quiz[aá]s?|tal vez|a lo mejor|puede ser|no estoy seguro|no s[eé]|creo que|me parece que|posiblemente|veremos|quiz[aá])\b/i;

export function containsHesitationMarkers(text: string): boolean {
  return HESITATION_REGEX.test(text);
}

const NEGATIVE_OR_PENDING_REGEX = /\b(no\b|sin\b|nunca\b|jam[aá]s\b|pendiente\b|draft(ed)?\b|borrador\b|en\s+tr[aá]mite\b|si\b|en\s+caso\s+de\b|hipot[eé]tic[oa]\b|futur[oa]\b|posible\b|rechazad[oa]\b)/i;

export function containsNegativeOrPendingMarkers(text: string): boolean {
  return NEGATIVE_OR_PENDING_REGEX.test(text);
}

/**
 * Validates whether a memory item satisfies universal epistemic invariants:
 * - Sources 'conversation_inference' and 'system' can NEVER yield 'confirmed'.
 * - Category 'working_hypothesis' can NEVER be 'confirmed'.
 * - 'confirmed' from 'user_explicit' requires absence of hesitation markers.
 * - 'confirmed' from 'plan_decision' requires a non-empty verified acceptance reference
 *   without doubt, negation, pending, or draft markers.
 */
export function isValidEpistemicState(
  category: MemoryCategory,
  confirmationStatus: ConfirmationStatus,
  provenance: MemoryProvenance
): { valid: boolean; reason?: string } {
  if (confirmationStatus === "confirmed") {
    if (provenance.source === "conversation_inference" || provenance.source === "system") {
      return {
        valid: false,
        reason: `Memories with source '${provenance.source}' cannot have confirmationStatus 'confirmed'`,
      };
    }
    if (category === "working_hypothesis") {
      return {
        valid: false,
        reason: "Category 'working_hypothesis' cannot have confirmationStatus 'confirmed'",
      };
    }
    if (provenance.source === "user_explicit" && containsHesitationMarkers(provenance.referenceText)) {
      return {
        valid: false,
        reason: "Explicit user statements containing doubt/speculation markers cannot be 'confirmed'",
      };
    }
    if (provenance.source === "plan_decision") {
      const hasAcceptanceEvidence = /\b(accepted|aceptad[oa]|confirmad[oa]|aprobad[oa])\b/i.test(provenance.referenceText);
      if (!hasAcceptanceEvidence) {
        return {
          valid: false,
          reason: "Decisions from plans require explicit acceptance evidence in referenceText to be 'confirmed'",
        };
      }
      if (
        containsHesitationMarkers(provenance.referenceText) ||
        containsNegativeOrPendingMarkers(provenance.referenceText)
      ) {
        return {
          valid: false,
          reason: "Decisions from plans containing doubt, negation, pending, or draft markers cannot be 'confirmed'",
        };
      }
    }
  }
  return { valid: true };
}

// ============================================================================
// 4. Memory Item Schema (Stored Memory Representation)
// ============================================================================

export const MemoryItemSchema = z
  .object({
    id: z.string().min(1),
    content: z.string().min(1),
    category: MemoryCategorySchema,
    confirmationStatus: ConfirmationStatusSchema,
    temporalStatus: TemporalStatusSchema,
    validUntil: CalendarDateSchema.nullable().optional(),
    tags: z.array(z.string().min(1)).default([]),
    provenance: MemoryProvenanceSchema,
    createdAt: CalendarDateSchema,
    updatedAt: CalendarDateSchema.optional(),
  })
  .strict()
  .refine(
    (data) => {
      const check = isValidEpistemicState(data.category, data.confirmationStatus, data.provenance);
      return check.valid;
    },
    {
      message: "Epistemic invariant violation: unearned or invalid 'confirmed' status",
      path: ["confirmationStatus"],
    }
  );
export type MemoryItem = z.infer<typeof MemoryItemSchema>;

// ============================================================================
// 5. Candidate Memory Input (Discriminated Union on actionIntent)
// ============================================================================

export const StoreCandidateSchema = z
  .object({
    candidateId: z.string().min(1),
    actionIntent: z.literal("store").optional().default("store"),
    rawText: z.string().min(1),
    suggestedCategory: MemoryCategorySchema.optional(),
    isExplicitUserStatement: z.boolean().optional().default(false),
    provenanceSource: MemoryProvenanceSourceSchema.optional(),
    evidenceReference: z.string().min(1).optional(),
    validUntil: CalendarDateSchema.nullable().optional(),
  })
  .strict();
export type StoreCandidate = z.infer<typeof StoreCandidateSchema>;

export const UpdateCandidateSchema = z
  .object({
    candidateId: z.string().min(1),
    actionIntent: z.literal("update"),
    targetMemoryId: z.string().min(1),
    rawText: z.string().min(1),
    suggestedCategory: MemoryCategorySchema.optional(),
    isExplicitUserStatement: z.boolean().optional().default(false),
    provenanceSource: MemoryProvenanceSourceSchema.optional(),
    evidenceReference: z.string().min(1).optional(),
    validUntil: CalendarDateSchema.nullable().optional(),
  })
  .strict();
export type UpdateCandidate = z.infer<typeof UpdateCandidateSchema>;

export const ForgetCandidateSchema = z
  .object({
    candidateId: z.string().min(1),
    actionIntent: z.literal("forget"),
    targetMemoryId: z.string().min(1),
    rawText: z.string().min(1).optional(),
    isExplicitUserStatement: z.boolean().optional().default(true),
  })
  .strict();
export type ForgetCandidate = z.infer<typeof ForgetCandidateSchema>;

export const CandidateMemoryInputSchema = z.discriminatedUnion("actionIntent", [
  StoreCandidateSchema,
  UpdateCandidateSchema,
  ForgetCandidateSchema,
]);
export type CandidateMemoryInput = z.input<typeof CandidateMemoryInputSchema>;
export type ParsedCandidateMemoryInput = z.infer<typeof CandidateMemoryInputSchema>;

// ============================================================================
// 6. Typed Proposed Memory Operations (Discriminated Union on type)
// ============================================================================

export const AddMemoryOpSchema = z
  .object({
    type: z.literal("add"),
    candidateId: z.string().min(1),
    proposedMemory: MemoryItemSchema,
    rationale: z.string().min(1),
    requiresHumanConfirmation: z.literal(true).default(true),
  })
  .strict();
export type AddMemoryOp = z.infer<typeof AddMemoryOpSchema>;

export const UpdateMemoryOpSchema = z
  .object({
    type: z.literal("update"),
    targetMemoryId: z.string().min(1),
    sourceCandidateId: z.string().min(1).optional(),
    updatedFields: z
      .object({
        content: z.string().min(1).optional(),
        category: MemoryCategorySchema.optional(),
        confirmationStatus: ConfirmationStatusSchema.optional(),
        temporalStatus: TemporalStatusSchema.optional(),
        validUntil: CalendarDateSchema.nullable().optional(),
      })
      .strict(),
    rationale: z.string().min(1),
    requiresHumanConfirmation: z.literal(true).default(true),
  })
  .strict();
export type UpdateMemoryOp = z.infer<typeof UpdateMemoryOpSchema>;

export const SourceMemoryProvenanceSchema = z
  .object({
    memoryId: z.string().min(1),
    provenance: MemoryProvenanceSchema,
    confirmationStatus: ConfirmationStatusSchema,
    temporalStatus: TemporalStatusSchema.optional(),
  })
  .strict();
export type SourceMemoryProvenance = z.infer<typeof SourceMemoryProvenanceSchema>;

export const BaseMergeMemoriesOpSchema = z
  .object({
    type: z.literal("merge"),
    sourceMemoryIds: z
      .array(z.string().min(1))
      .min(2)
      .refine((ids) => new Set(ids).size === ids.length, {
        message: "sourceMemoryIds must not contain duplicate IDs",
      }),
    sourceProvenances: z.array(SourceMemoryProvenanceSchema).optional(),
    sourceCandidateId: z.string().min(1).optional(),
    mergedMemory: MemoryItemSchema,
    rationale: z.string().min(1),
    requiresHumanConfirmation: z.literal(true).default(true),
  })
  .strict();

export const MergeMemoriesOpSchema = BaseMergeMemoriesOpSchema.refine(
  (data) => {
    if (data.sourceProvenances && data.sourceProvenances.length > 0) {
      // 1. Epistemic conservation:
      // If any source was unconfirmed, inferred, or from automated sources,
      // the merged memory CANNOT be confirmed.
      const hasUnconfirmedSource = data.sourceProvenances.some((sp) => {
        if (sp.confirmationStatus !== "confirmed") return true;
        if (sp.provenance.source === "conversation_inference" || sp.provenance.source === "system") return true;
        if (sp.provenance.source === "plan_decision") {
          if (
            !sp.provenance.referenceText ||
            containsHesitationMarkers(sp.provenance.referenceText) ||
            containsNegativeOrPendingMarkers(sp.provenance.referenceText)
          ) {
            return true;
          }
        }
        return false;
      });

      if (hasUnconfirmedSource && data.mergedMemory.confirmationStatus === "confirmed") {
        return false;
      }

      // 2. Temporal status separation:
      // An outdated or expired source does not automatically make the merged memory active.
      // If all sources are expired/outdated and the mergedMemory claims to be 'active', it's an invariant violation.
      const allSourcesInactive = data.sourceProvenances.every(
        (sp) => sp.temporalStatus === "expired" || sp.temporalStatus === "outdated"
      );
      if (allSourcesInactive && data.mergedMemory.temporalStatus === "active") {
        return false;
      }
    }
    return true;
  },
  {
    message: "Merged memory cannot elevate unconfirmed, inferred, non-accepted, or fully expired sources to active/confirmed status",
    path: ["mergedMemory", "confirmationStatus"],
  }
);
export type MergeMemoriesOp = z.infer<typeof MergeMemoriesOpSchema>;

export const ArchiveMemoryOpSchema = z
  .object({
    type: z.literal("archive"),
    targetMemoryId: z.string().min(1),
    sourceCandidateId: z.string().min(1).optional(),
    reason: z.enum(["expired_date", "completed_project", "superseded_by_context"]),
    rationale: z.string().min(1),
    requiresHumanConfirmation: z.literal(true).default(true),
  })
  .strict();
export type ArchiveMemoryOp = z.infer<typeof ArchiveMemoryOpSchema>;

export const ForgetMemoryOpSchema = z
  .object({
    type: z.literal("forget"),
    targetMemoryId: z.string().min(1),
    sourceCandidateId: z.string().min(1).optional(),
    rationale: z.string().min(1),
    requiresHumanConfirmation: z.literal(true).default(true),
  })
  .strict();
export type ForgetMemoryOp = z.infer<typeof ForgetMemoryOpSchema>;

export const KeepMemoryOpSchema = z
  .object({
    type: z.literal("keep"),
    targetMemoryId: z.string().min(1),
    rationale: z.string().min(1),
    requiresHumanConfirmation: z.literal(false).default(false),
  })
  .strict();
export type KeepMemoryOp = z.infer<typeof KeepMemoryOpSchema>;

export const RequestClarificationOpSchema = z
  .object({
    type: z.literal("request_clarification"),
    relatedMemoryIds: z.array(z.string().min(1)),
    candidateId: z.string().min(1).optional(),
    question: z.string().min(1),
    rationale: z.string().min(1),
  })
  .strict();
export type RequestClarificationOp = z.infer<typeof RequestClarificationOpSchema>;

export const MemoryOperationSchema = z
  .discriminatedUnion("type", [
    AddMemoryOpSchema,
    UpdateMemoryOpSchema,
    BaseMergeMemoriesOpSchema,
    ArchiveMemoryOpSchema,
    ForgetMemoryOpSchema,
    KeepMemoryOpSchema,
    RequestClarificationOpSchema,
  ])
  .refine(
    (op) => {
      if (op.type === "merge") {
        return MergeMemoriesOpSchema.safeParse(op).success;
      }
      return true;
    },
    {
      message: "Invalid merge operation epistemic provenance or constraints",
    }
  );
export type MemoryOperation = z.infer<typeof MemoryOperationSchema>;

// ============================================================================
// 7. Input & Output Contracts
// ============================================================================

export const ManageMemoryInputSchema = z
  .object({
    referenceDate: CalendarDateSchema,
    existingMemories: z.array(MemoryItemSchema),
    candidates: z.array(z.unknown()).optional().default([]),
    explicitForgetRequests: z.array(z.string().min(1)).optional().default([]),
    verifiedAcceptedDecisionRefs: z.array(z.string().min(1)).optional().default([]),
    preferences: z
      .object({
        autoDetectExpired: z.boolean().default(true),
      })
      .optional()
      .default({ autoDetectExpired: true }),
  })
  .strict();
export type ManageMemoryInput = z.input<typeof ManageMemoryInputSchema>;
export type ParsedManageMemoryInput = z.infer<typeof ManageMemoryInputSchema>;

export const MemoryContradictionSchema = z
  .object({
    existingMemoryId: z.string().min(1),
    contradictingCandidateId: z.string().min(1).optional(),
    conflictingMemoryId: z.string().min(1).optional(),
    description: z.string().min(1),
    nature: z.enum(["factual_conflict", "preference_drift", "temporal_inconsistency"]),
  })
  .strict();
export type MemoryContradiction = z.infer<typeof MemoryContradictionSchema>;

export const ManageMemoryStatusSchema = z.enum([
  "invalid_request",
  "clarification_required",
  "proposals_generated",
  "no_action_needed",
]);
export type ManageMemoryStatus = z.infer<typeof ManageMemoryStatusSchema>;

export const ManageMemoryOutputSchema = z
  .object({
    status: ManageMemoryStatusSchema,
    proposedOperations: z.array(MemoryOperationSchema),
    suppressedContextMemoryIds: z.array(z.string().min(1)),
    contradictions: z.array(MemoryContradictionSchema),
    clarificationQuestions: z.array(z.string().min(1)),
    invalidReferences: z.array(z.string().min(1)),
    warnings: z.array(z.string().min(1)),
  })
  .strict();
export type ManageMemoryOutput = z.infer<typeof ManageMemoryOutputSchema>;
