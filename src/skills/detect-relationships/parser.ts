import { DetectedRelationships, DetectedRelationshipsSchema } from "../../domain/relationships";
import { cleanJsonString } from "../extract-items/parser";

export class RelationshipValidationError extends Error {
  constructor(message: string, public readonly issues?: unknown, public readonly rawContent?: string) {
    super(message);
    this.name = "RelationshipValidationError";
  }
}

/**
 * Parses and validates raw LLM output against the DetectedRelationshipsSchema.
 */
export function parseAndValidateRelationships(rawResponse: string): DetectedRelationships {
  const cleaned = cleanJsonString(rawResponse);
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (error) {
    throw new RelationshipValidationError(
      `Failed to parse relationships JSON response: ${(error as Error).message}`,
      undefined,
      rawResponse
    );
  }

  const result = DetectedRelationshipsSchema.safeParse(parsed);
  if (!result.success) {
    throw new RelationshipValidationError(
      "Relationships failed schema validation",
      result.error.issues,
      rawResponse
    );
  }

  return result.data;
}
