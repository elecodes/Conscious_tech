import { ZodError } from "zod";
import {
  BuildWeekInput,
  ProposedWeek,
  ProposedWeekSchema,
  createEmptyProposedWeek,
} from "../../domain/week";
import {
  calculateWeeklyCapacity,
  normalizeAndConserveProposedWeek,
  ProposalRepairAction,
  WeekValidationError,
} from "./deterministic";

// ============================================================================
// Types
// ============================================================================

export type WeekParseResult =
  | {
      success: true;
      data: ProposedWeek;
      repaired: boolean;
      repairs: ProposalRepairAction[];
    }
  | {
      success: false;
      errorType: "invalid_json";
      error: string;
    }
  | {
      success: false;
      errorType: "schema_validation_error";
      error: string;
      issues: unknown[];
    }
  | {
      success: false;
      errorType: "invariant_violation";
      error: string;
      issues: unknown[];
    };

// ============================================================================
// JSON Extraction & Safe Parsing
// ============================================================================

/**
 * Strips markdown code fences (```json ... ```) and extracts raw JSON text.
 * Rejects ambiguous responses with multiple code blocks.
 */
export function extractJsonFromMarkdown(raw: string): string {
  const trimmed = raw.trim();
  const allBlocks = Array.from(trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)\s*```/gi));
  if (allBlocks.length > 1) {
    throw new Error(
      `Ambiguous markdown response: multiple code blocks detected (${allBlocks.length} blocks)`
    );
  }
  if (allBlocks.length === 1 && allBlocks[0][1]) {
    return allBlocks[0][1].trim();
  }
  return trimmed;
}

// ============================================================================
// Optional Null Fields Sanitization
// ============================================================================

/**
 * Normalizes optional fields where the LLM returned `null` instead of omitting the key.
 *
 * Rules:
 * - Only normalizes fields that are genuinely optional in the domain contract:
 *   - `weekSummary.intent`: string | undefined
 *   - `foci[].groupId`: string | undefined
 *   - `obligations[].dueDate`: string | undefined
 *   - `flexibleOptions[].condition`: string | undefined
 * - Does NOT convert nulls in mandatory fields (e.g. title, rationale, id, reason) so that
 *   schema validation correctly fails.
 * - Leaves fields that legitimately accept `null` in domain untouched (e.g. estimatedHours, recommendedHours).
 */
export function sanitizeOptionalNullFields(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const obj = raw as Record<string, unknown>;

  // 1. weekSummary.intent
  if (obj.weekSummary && typeof obj.weekSummary === "object") {
    const ws = obj.weekSummary as Record<string, unknown>;
    if (ws.intent === null) {
      delete ws.intent;
    }
  }

  // 2. foci[].groupId
  if (Array.isArray(obj.foci)) {
    for (const f of obj.foci) {
      if (f && typeof f === "object") {
        const focus = f as Record<string, unknown>;
        if (focus.groupId === null) {
          delete focus.groupId;
        }
      }
    }
  }

  // 3. obligations[].dueDate
  if (Array.isArray(obj.obligations)) {
    for (const o of obj.obligations) {
      if (o && typeof o === "object") {
        const obligation = o as Record<string, unknown>;
        if (obligation.dueDate === null) {
          delete obligation.dueDate;
        }
      }
    }
  }

  // 4. flexibleOptions[].condition
  if (Array.isArray(obj.flexibleOptions)) {
    for (const opt of obj.flexibleOptions) {
      if (opt && typeof opt === "object") {
        const option = opt as Record<string, unknown>;
        if (option.condition === null) {
          delete option.condition;
        }
      }
    }
  }

  return obj;
}

/**
 * Parses raw JSON string and returns a typed WeekParseResult.
 *
 * Enforces:
 * 1. Safe JSON parsing with markdown stripping (rejects ambiguous multiple code blocks).
 * 2. Unwrapping of root wrappers with strict ambiguity check (rejects multiple candidate roots).
 * 3. Deterministic initialization of capacity summary when omitted by planner.
 * 4. Strict Zod schema validation (catches unknown fields, enums, wrong types, >3 foci, >2 questions).
 * 5. Strict rejection of phantom IDs, nonexistent group IDs and contradictory multi-category assignments.
 * 6. Deterministic conservation of omitted regular items via "not_scheduled" rescue.
 * 7. Invariant cross-validation against BuildWeekInput without using silent .filter() drops.
 * 8. Zero external network calls or AI provider imports.
 */
export function parseProposedWeek(
  rawJson: string,
  input: BuildWeekInput
): WeekParseResult {
  // Empty input zero-token fast-path
  if (input.items.length === 0 && rawJson.trim() === "") {
    return {
      success: true,
      data: createEmptyProposedWeek(input.currentDate, input.targetWeek),
      repaired: false,
      repairs: [],
    };
  }

  // 1. Extract and parse JSON
  let cleaned: string;
  try {
    cleaned = extractJsonFromMarkdown(rawJson);
  } catch (err) {
    return {
      success: false,
      errorType: "invalid_json",
      error: `Failed to parse JSON for build_week: ${(err as Error).message}`,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    return {
      success: false,
      errorType: "invalid_json",
      error: `Failed to parse JSON for build_week: ${(err as Error).message}`,
    };
  }

  // 2. Unwrap wrapper keys if present (rejecting ambiguous multi-candidate roots)
  if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    if (!("foci" in obj) && !("weekSummary" in obj)) {
      const candidateKeys = ["proposedWeek", "week", "result"].filter(
        (k) => k in obj && obj[k] && typeof obj[k] === "object"
      );
      if (candidateKeys.length > 1) {
        return {
          success: false,
          errorType: "schema_validation_error",
          error: `Ambiguous response structure: multiple candidate roots detected (${candidateKeys.join(", ")}).`,
          issues: [{ code: "custom", message: "Multiple candidate roots detected" }],
        };
      }
      if (candidateKeys.length === 1) {
        parsed = obj[candidateKeys[0]];
      }
    }
  }

  // 3. Deterministically initialize capacity if planner omitted it
  if (parsed && typeof parsed === "object" && "weekSummary" in parsed) {
    const obj = parsed as Record<string, unknown>;
    const ws = obj.weekSummary as Record<string, unknown> | undefined;
    if (ws && typeof ws === "object" && !("capacity" in ws)) {
      const fociArray = Array.isArray(obj.foci)
        ? (obj.foci as Array<{ estimatedHours?: number | null }>)
        : undefined;
      const obligationsArray = Array.isArray(obj.obligations)
        ? (obj.obligations as Array<{ estimatedHours?: number | null }>)
        : undefined;

      ws.capacity = calculateWeeklyCapacity({
        capacityConfig: input.capacity,
        foci: fociArray,
        obligations: obligationsArray,
      });
    }
  }

  // 3.5. Sanitize optional fields where planner returned null instead of omitting the key
  parsed = sanitizeOptionalNullFields(parsed);

  // 4. Validate against ProposedWeekSchema
  const schemaResult = ProposedWeekSchema.safeParse(parsed);
  if (!schemaResult.success) {
    return {
      success: false,
      errorType: "schema_validation_error",
      error: `ProposedWeek failed schema validation: ${schemaResult.error.message}`,
      issues: (schemaResult.error as ZodError).issues,
    };
  }

  // 5. Cross-domain invariant checks & safe normalization
  try {
    const normResult = normalizeAndConserveProposedWeek(schemaResult.data, input);
    return {
      success: true,
      data: normResult.proposal,
      repaired: normResult.repaired,
      repairs: normResult.repairs,
    };
  } catch (err) {
    if (err instanceof WeekValidationError) {
      return {
        success: false,
        errorType: "invariant_violation",
        error: err.message,
        issues: err.issues,
      };
    }
    return {
      success: false,
      errorType: "invariant_violation",
      error: (err as Error).message,
      issues: [],
    };
  }
}

/**
 * Convenience unwrapper that throws WeekValidationError when parsing or invariants fail.
 */
export function parseAndValidateProposedWeek(
  rawJson: string,
  input: BuildWeekInput
): ProposedWeek {
  const result = parseProposedWeek(rawJson, input);
  if (!result.success) {
    if ("issues" in result && Array.isArray(result.issues)) {
      throw new WeekValidationError(result.error, result.issues);
    }
    throw new WeekValidationError(result.error);
  }
  return result.data;
}
