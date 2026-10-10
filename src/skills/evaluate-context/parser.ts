import { ZodError } from "zod";
import {
  ContextSignal,
  ContextSignalSchema,
  EvaluateContextOutput,
  EvaluateContextOutputSchema,
} from "../../domain/context";

export class ContextValidationError extends Error {
  public issues: unknown[];

  constructor(message: string, issues: unknown[] = []) {
    super(message);
    this.name = "ContextValidationError";
    this.issues = issues;
  }
}

export interface DroppedSignalAudit {
  itemId: string;
  signal: string;
  reason: string;
}

export interface ParseContextOutputResult {
  output: EvaluateContextOutput;
  droppedSignals: DroppedSignalAudit[];
}

const VALID_CONTEXT_SIGNALS = new Set<string>(ContextSignalSchema.options);

/**
 * Sanitizes item signals by stripping unrecognized strings (such as relationship types
 * like "part_of_project", "related_to") and records them for auditability without
 * discarding valid signals or dropping the whole assessment.
 */
export function sanitizeContextItemSignals(rawAssessments: unknown): {
  sanitized: unknown;
  droppedSignals: DroppedSignalAudit[];
} {
  const droppedSignals: DroppedSignalAudit[] = [];

  if (!Array.isArray(rawAssessments)) {
    return { sanitized: rawAssessments, droppedSignals };
  }

  const sanitized = rawAssessments.map((assessment) => {
    if (
      !assessment ||
      typeof assessment !== "object" ||
      !("signals" in assessment) ||
      !Array.isArray(assessment.signals)
    ) {
      return assessment;
    }

    const itemId =
      typeof (assessment as any).itemId === "string"
        ? (assessment as any).itemId
        : "unknown";

    const filteredSignals: ContextSignal[] = [];

    for (const sig of assessment.signals) {
      if (typeof sig === "string") {
        if (VALID_CONTEXT_SIGNALS.has(sig)) {
          filteredSignals.push(sig as ContextSignal);
        } else {
          droppedSignals.push({
            itemId,
            signal: sig,
            reason: `Non-canonical signal "${sig}" discarded; relation types and ad-hoc strings are not allowed in ContextSignalSchema`,
          });
          console.warn(
            `[evaluate_context parser] Descartando señal no canónica "${sig}" en item "${itemId}". Solo se admiten señales válidas del esquema.`
          );
        }
      }
    }

    return {
      ...assessment,
      signals: filteredSignals,
    };
  });

  return { sanitized, droppedSignals };
}

/**
 * Strips markdown code fences (```json ... ```) and extracts raw JSON text.
 */
export function extractJsonFromMarkdown(raw: string): string {
  const trimmed = raw.trim();
  const fenceRegex = /^```(?:json)?\s*([\s\S]*?)\s*```$/i;
  const match = trimmed.match(fenceRegex);
  if (match && match[1]) {
    return match[1].trim();
  }
  return trimmed;
}

/**
 * Parses raw JSON string into EvaluateContextOutput and validates against Zod schema,
 * recording any non-canonical signals that were discarded.
 */
export function parseAndValidateContextOutputWithAudit(
  rawJson: string
): ParseContextOutputResult {
  const cleaned = extractJsonFromMarkdown(rawJson);
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new ContextValidationError(
      `Failed to parse JSON for evaluate_context: ${(err as Error).message}`
    );
  }

  // Handle common wrapper keys if emitted by LLMs
  if (
    parsed &&
    typeof parsed === "object" &&
    !("itemAssessments" in parsed) &&
    "result" in parsed
  ) {
    parsed = (parsed as { result: unknown }).result;
  }

  let droppedSignals: DroppedSignalAudit[] = [];

  if (parsed && typeof parsed === "object" && "itemAssessments" in parsed) {
    const sanitization = sanitizeContextItemSignals((parsed as any).itemAssessments);
    (parsed as any).itemAssessments = sanitization.sanitized;
    droppedSignals = sanitization.droppedSignals;
  }

  const result = EvaluateContextOutputSchema.safeParse(parsed);
  if (!result.success) {
    throw new ContextValidationError(
      "EvaluateContext output failed schema validation",
      (result.error as ZodError).issues
    );
  }

  return {
    output: result.data,
    droppedSignals,
  };
}

/**
 * Parses raw JSON string into EvaluateContextOutput and validates against Zod schema.
 */
export function parseAndValidateContextOutput(rawJson: string): EvaluateContextOutput {
  return parseAndValidateContextOutputWithAudit(rawJson).output;
}

