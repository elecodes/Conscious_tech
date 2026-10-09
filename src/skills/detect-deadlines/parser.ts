import { ZodError } from "zod";
import { DetectedDeadlines, DetectedDeadlinesSchema } from "../../domain/deadlines";

export class DeadlinesValidationError extends Error {
  public issues: unknown[];

  constructor(message: string, issues: unknown[] = []) {
    super(message);
    this.name = "DeadlinesValidationError";
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
 * Parses raw JSON string into DetectedDeadlines and validates against Zod schema.
 */
export function parseAndValidateDeadlines(rawJson: string): DetectedDeadlines {
  const cleaned = extractJsonFromMarkdown(rawJson);
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new DeadlinesValidationError(
      `Failed to parse JSON for deadlines: ${(err as Error).message}`
    );
  }

  // Handle common wrapper keys if emitted by LLMs
  if (parsed && typeof parsed === "object" && !("deadlines" in parsed) && "result" in parsed) {
    parsed = (parsed as { result: unknown }).result;
  }

  const result = DetectedDeadlinesSchema.safeParse(parsed);
  if (!result.success) {
    throw new DeadlinesValidationError(
      "Deadlines output failed schema validation",
      (result.error as ZodError).issues
    );
  }

  return result.data;
}
