import { ExtractedItems, ExtractedItemsSchema } from "../../domain/items";

export class ExtractionValidationError extends Error {
  constructor(message: string, public readonly issues?: unknown, public readonly rawContent?: string) {
    super(message);
    this.name = "ExtractionValidationError";
  }
}

/**
 * Strips markdown code blocks and whitespace to extract pure JSON.
 */
export function cleanJsonString(raw: string): string {
  let cleaned = raw.trim();
  // Strip ```json ... ``` or ``` ... ```
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  }
  return cleaned.trim();
}

/**
 * Parses and validates raw LLM output against the ExtractedItemsSchema.
 */
export function parseAndValidateExtractedItems(rawResponse: string): ExtractedItems {
  const cleaned = cleanJsonString(rawResponse);
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (error) {
    throw new ExtractionValidationError(
      `Failed to parse JSON response: ${(error as Error).message}`,
      undefined,
      rawResponse
    );
  }

  const result = ExtractedItemsSchema.safeParse(parsed);
  if (!result.success) {
    throw new ExtractionValidationError(
      "Extracted items failed schema validation",
      result.error.issues,
      rawResponse
    );
  }

  return result.data;
}
