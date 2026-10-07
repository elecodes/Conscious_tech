import { describe, it, expect } from "vitest";
import {
  RelationshipSchema,
  RelationshipTypeSchema,
  DetectedRelationshipsSchema,
} from "../src/domain/relationships";
import { cleanAndValidateRelationships } from "../src/skills/detect-relationships/deterministic";
import { parseAndValidateRelationships } from "../src/skills/detect-relationships/parser";
import { ExtractedItem } from "../src/domain/items";

describe("Relationships Domain & Deterministic Cleaning", () => {
  const dummyItem1: ExtractedItem = {
    id: "item-1",
    rawText: "tarea 1",
    title: "Tarea 1",
    type: "task",
  };

  const dummyItem2: ExtractedItem = {
    id: "item-2",
    rawText: "tarea 2",
    title: "Tarea 2",
    type: "task",
  };

  it("validates RelationshipSchema with valid data", () => {
    const valid = {
      sourceItemId: "item-1",
      targetItemId: "item-2",
      type: "depends_on",
      confidence: "high",
      reason: "Item 1 requiere a Item 2",
    };
    expect(RelationshipSchema.safeParse(valid).success).toBe(true);
    expect(DetectedRelationshipsSchema.safeParse({ relationships: [valid] }).success).toBe(true);
  });

  it("rejects self-relations via schema refine (sourceItemId === targetItemId)", () => {
    const selfRel = {
      sourceItemId: "item-1",
      targetItemId: "item-1",
      type: "related_to",
      confidence: "high",
      reason: "Auto-relación inválida",
    };
    const result = RelationshipSchema.safeParse(selfRel);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe("sourceItemId and targetItemId must be different");
      expect(result.error.issues[0]?.path).toEqual(["targetItemId"]);
    }
  });

  it("rejects invalid relationship types including 'blocks'", () => {
    expect(RelationshipTypeSchema.safeParse("blocks").success).toBe(false);
    expect(RelationshipTypeSchema.safeParse("causes").success).toBe(false);
    expect(
      RelationshipSchema.safeParse({
        sourceItemId: "item-1",
        targetItemId: "item-2",
        type: "blocks",
        confidence: "high",
        reason: "inválido",
      }).success
    ).toBe(false);
  });

  it("validates all 6 supported RelationshipTypes", () => {
    const supportedTypes = [
      "same_project",
      "same_objective",
      "related_to",
      "part_of",
      "depends_on",
      "duplicate",
    ];
    for (const t of supportedTypes) {
      expect(RelationshipTypeSchema.safeParse(t).success).toBe(true);
    }
  });

  it("returns empty relationships if items array has fewer than 2 items", () => {
    const result = cleanAndValidateRelationships(
      [
        {
          sourceItemId: "item-1",
          targetItemId: "item-2",
          type: "related_to",
          confidence: "high",
          reason: "alguna razon",
        },
      ],
      [dummyItem1]
    );
    expect(result.relationships).toEqual([]);
  });

  it("filters out self-relations in deterministic cleaner", () => {
    const raw = [
      {
        sourceItemId: "item-1",
        targetItemId: "item-1",
        type: "related_to" as const,
        confidence: "high" as const,
        reason: "auto-relacion",
      },
    ];
    const result = cleanAndValidateRelationships(raw, [dummyItem1, dummyItem2]);
    expect(result.relationships).toHaveLength(0);
  });

  it("filters out relationships with non-existent item IDs", () => {
    const raw = [
      {
        sourceItemId: "item-1",
        targetItemId: "item-inexistente",
        type: "depends_on" as const,
        confidence: "high" as const,
        reason: "id fantasma",
      },
    ];
    const result = cleanAndValidateRelationships(raw, [dummyItem1, dummyItem2]);
    expect(result.relationships).toHaveLength(0);
  });

  it("parser canonicalizes raw 'blocks' into 'depends_on'", () => {
    const rawJson = JSON.stringify({
      relationships: [
        {
          sourceItemId: "item-2", // B blocks A
          targetItemId: "item-1",
          type: "blocks",
          confidence: "high",
          reason: "B bloquea a A",
        },
      ],
    });
    const parsed = parseAndValidateRelationships(rawJson);
    expect(parsed.relationships).toHaveLength(1);
    expect(parsed.relationships[0]?.sourceItemId).toBe("item-1"); // canonical: A depends_on B
    expect(parsed.relationships[0]?.targetItemId).toBe("item-2");
    expect(parsed.relationships[0]?.type).toBe("depends_on");
  });

  it("deduplicates identical relationships and canonicalizes symmetric types", () => {
    const raw = [
      {
        sourceItemId: "item-2",
        targetItemId: "item-1",
        type: "same_project" as const,
        confidence: "high" as const,
        reason: "razon 1",
      },
      {
        sourceItemId: "item-1",
        targetItemId: "item-2",
        type: "same_project" as const,
        confidence: "medium" as const,
        reason: "razon redundante",
      },
    ];
    const result = cleanAndValidateRelationships(raw, [dummyItem1, dummyItem2]);
    expect(result.relationships).toHaveLength(1);
    expect(result.relationships[0]?.sourceItemId).toBe("item-1");
    expect(result.relationships[0]?.targetItemId).toBe("item-2");
  });
});
