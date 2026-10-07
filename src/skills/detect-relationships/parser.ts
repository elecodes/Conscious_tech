import { DetectedRelationships, DetectedRelationshipsSchema } from "../../domain/relationships";
import { cleanJsonString } from "../extract-items/parser";

export class RelationshipValidationError extends Error {
  constructor(message: string, public readonly issues?: unknown, public readonly rawContent?: string) {
    super(message);
    this.name = "RelationshipValidationError";
  }
}

/**
 * Normalizes raw relationship objects before schema parsing:
 * - If an item uses type "blocks" (A blocks B), canonicalizes to "depends_on" (B depends_on A).
 */
function normalizeRawRelationships(data: unknown): unknown {
  if (!data || typeof data !== "object") return data;

  const maybeObj = data as Record<string, unknown>;
  if (!Array.isArray(maybeObj.relationships)) return data;

  const normalizedRels = maybeObj.relationships.map((rel) => {
    if (!rel || typeof rel !== "object") return rel;
    const r = rel as Record<string, unknown>;

    if (r.type === "blocks" && typeof r.sourceItemId === "string" && typeof r.targetItemId === "string") {
      return {
        ...r,
        sourceItemId: r.targetItemId,
        targetItemId: r.sourceItemId,
        type: "depends_on",
      };
    }
    return r;
  });

  return {
    ...maybeObj,
    relationships: normalizedRels,
  };
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

  const normalized = normalizeRawRelationships(parsed);

  const result = DetectedRelationshipsSchema.safeParse(normalized);
  if (!result.success) {
    throw new RelationshipValidationError(
      "Relationships failed schema validation",
      result.error.issues,
      rawResponse
    );
  }

  return result.data;
}
