import { ZodError } from "zod";
import { GroupedWork, GroupedWorkSchema } from "../../domain/work-groups";

export class GroupWorkValidationError extends Error {
  public issues: unknown[];

  constructor(message: string, issues: unknown[] = []) {
    super(message);
    this.name = "GroupWorkValidationError";
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
 * Parses raw JSON string into GroupedWork structure and validates against Zod schema.
 */
export function parseAndValidateGroupedWork(rawJson: string): GroupedWork {
  const cleaned = extractJsonFromMarkdown(rawJson);
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new GroupWorkValidationError(
      `Failed to parse JSON for grouped work: ${(err as Error).message}`
    );
  }

  // Handle common LLM root key wraps if necessary
  if (parsed && typeof parsed === "object" && !("groups" in parsed) && "result" in parsed) {
    parsed = (parsed as { result: unknown }).result;
  }

  const result = GroupedWorkSchema.safeParse(parsed);
  if (!result.success) {
    throw new GroupWorkValidationError(
      "Grouped work failed schema validation",
      (result.error as ZodError).issues
    );
  }

  return result.data;
}
