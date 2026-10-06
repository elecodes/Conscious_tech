import { describe, it, expect } from "vitest";
import {
  cleanJsonString,
  parseAndValidateExtractedItems,
  ExtractionValidationError,
} from "../src/skills/extract-items/parser";

describe("Parser & Validator", () => {
  it("cleans markdown fences around json", () => {
    const raw = '```json\n{"items": []}\n```';
    expect(cleanJsonString(raw)).toBe('{"items": []}');

    const rawNoLang = '```\n{"items": []}\n```';
    expect(cleanJsonString(rawNoLang)).toBe('{"items": []}');
  });

  it("parses valid JSON into ExtractedItems", () => {
    const jsonStr = JSON.stringify({
      items: [
        {
          id: "item-1",
          rawText: "comprar café",
          title: "Comprar café",
          type: "task",
        },
      ],
    });
    const result = parseAndValidateExtractedItems(jsonStr);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.title).toBe("Comprar café");
  });

  it("throws ExtractionValidationError on malformed JSON", () => {
    const malformed = '{"items": [ incomplete';
    expect(() => parseAndValidateExtractedItems(malformed)).toThrow(
      ExtractionValidationError
    );
  });

  it("throws ExtractionValidationError when schema fields are missing or invalid", () => {
    const invalidSchema = JSON.stringify({
      items: [
        {
          id: "item-1",
          // missing rawText and title
          type: "invalid-type",
        },
      ],
    });
    expect(() => parseAndValidateExtractedItems(invalidSchema)).toThrow(
      ExtractionValidationError
    );
  });
});
