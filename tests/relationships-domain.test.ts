import { describe, it, expect } from "vitest";
import {
  RelationshipSchema,
  RelationshipTypeSchema,
} from "../src/domain/relationships";
import { cleanAndValidateRelationships } from "../src/skills/detect-relationships/deterministic";
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
  });

  it("rejects invalid relationship types", () => {
    const invalid = {
      sourceItemId: "item-1",
      targetItemId: "item-2",
      type: "causes", // not in enum
      confidence: "high",
      reason: "explicación",
    };
    expect(RelationshipSchema.safeParse(invalid).success).toBe(false);
  });

  it("validates all supported RelationshipTypes", () => {
    const types = [
      "same_project",
      "same_objective",
      "related_to",
      "part_of",
      "depends_on",
      "blocks",
      "duplicate",
    ];
    for (const t of types) {
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

  it("filters out self-relations (sourceItemId === targetItemId)", () => {
    const raw = [
      {
        sourceItemId: "item-1",
        targetItemId: "item-1",
        type: "related_to" as const,
        confidence: "high" as const,
        reason: "auto-relacion",
      },
    ];
    const result = cleanAndValidateRelationships(raw, [dummyItem1, dummyItem2], {
      inferSameProject: false,
    });
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
    const result = cleanAndValidateRelationships(raw, [dummyItem1, dummyItem2], {
      inferSameProject: false,
    });
    expect(result.relationships).toHaveLength(0);
  });

  it("canonicalizes 'blocks' into 'depends_on'", () => {
    const raw = [
      {
        sourceItemId: "item-2", // B blocks A
        targetItemId: "item-1",
        type: "blocks" as const,
        confidence: "high" as const,
        reason: "B bloquea a A",
      },
    ];
    const result = cleanAndValidateRelationships(raw, [dummyItem1, dummyItem2], {
      inferSameProject: false,
    });
    expect(result.relationships).toHaveLength(1);
    expect(result.relationships[0]?.sourceItemId).toBe("item-1"); // A depends_on B
    expect(result.relationships[0]?.targetItemId).toBe("item-2");
    expect(result.relationships[0]?.type).toBe("depends_on");
  });

  it("deduplicates identical relationships", () => {
    const raw = [
      {
        sourceItemId: "item-1",
        targetItemId: "item-2",
        type: "related_to" as const,
        confidence: "high" as const,
        reason: "razon 1",
      },
      {
        sourceItemId: "item-1",
        targetItemId: "item-2",
        type: "related_to" as const,
        confidence: "medium" as const,
        reason: "razon duplicada",
      },
    ];
    const result = cleanAndValidateRelationships(raw, [dummyItem1, dummyItem2], {
      inferSameProject: false,
    });
    expect(result.relationships).toHaveLength(1);
  });

  it("deterministically detects same_project when items share the exact project name", () => {
    const itemA: ExtractedItem = {
      ...dummyItem1,
      project: "Conscious Tech",
    };
    const itemB: ExtractedItem = {
      ...dummyItem2,
      project: "Conscious Tech",
    };
    const result = cleanAndValidateRelationships([], [itemA, itemB], {
      inferSameProject: true,
    });
    expect(result.relationships).toHaveLength(1);
    expect(result.relationships[0]?.type).toBe("same_project");
    expect(result.relationships[0]?.confidence).toBe("high");
    expect(result.relationships[0]?.reason).toContain("Conscious Tech");
  });
});
