import { ZodError } from "zod";
import {
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
 * Parses raw JSON string into EvaluateContextOutput and validates against Zod schema.
 */
export function parseAndValidateContextOutput(rawJson: string): EvaluateContextOutput {
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

  const result = EvaluateContextOutputSchema.safeParse(parsed);
  if (!result.success) {
    throw new ContextValidationError(
      "EvaluateContext output failed schema validation",
      (result.error as ZodError).issues
    );
  }

  return result.data;
}
