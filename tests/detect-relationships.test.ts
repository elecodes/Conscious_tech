import { describe, it, expect } from "vitest";
import { MockProvider } from "../src/providers/mock-provider";
import { detectRelationships, DetectRelationshipsService } from "../src/skills/detect-relationships";
import { ExtractedItem } from "../src/domain/items";
import mockCasesData from "../cases/mock-extractions.json";

describe("DetectRelationships Skill - Behavioral & Integration Tests", () => {
  it("1. No self relation: drops self-referencing relationship emitted by provider", async () => {
    const items: ExtractedItem[] = [
      { id: "item-1", rawText: "tarea 1", title: "Tarea 1", type: "task" },
      { id: "item-2", rawText: "tarea 2", title: "Tarea 2", type: "task" },
    ];
    const provider = new MockProvider();
    provider.setRelationshipsHandler(async () => ({
      relationships: [
        {
          sourceItemId: "item-1",
          targetItemId: "item-1", // self relation
          type: "related_to",
          confidence: "high",
          reason: "auto-relacion errónea",
        },
      ],
    }));

    const result = await detectRelationships(provider, { items }, { inferSameProject: false });
    expect(result.relationships).toHaveLength(0);
  });

  it("2. Valid IDs: drops relationships pointing to phantom IDs", async () => {
    const items: ExtractedItem[] = [
      { id: "item-1", rawText: "tarea 1", title: "Tarea 1", type: "task" },
      { id: "item-2", rawText: "tarea 2", title: "Tarea 2", type: "task" },
    ];
    const provider = new MockProvider();
    provider.setRelationshipsHandler(async () => ({
      relationships: [
        {
          sourceItemId: "item-1",
          targetItemId: "phantom-id",
          type: "depends_on",
          confidence: "high",
          reason: "depende de algo fantasma",
        },
      ],
    }));

    const result = await detectRelationships(provider, { items }, { inferSameProject: false });
    expect(result.relationships).toHaveLength(0);
  });

  it("3. No duplicates: deduplicates redundant relationship pairs", async () => {
    const items: ExtractedItem[] = [
      { id: "item-1", rawText: "tarea 1", title: "Tarea 1", type: "task" },
      { id: "item-2", rawText: "tarea 2", title: "Tarea 2", type: "task" },
    ];
    const provider = new MockProvider();
    provider.setRelationshipsHandler(async () => ({
      relationships: [
        {
          sourceItemId: "item-1",
          targetItemId: "item-2",
          type: "related_to",
          confidence: "high",
          reason: "razon 1",
        },
        {
          sourceItemId: "item-2",
          targetItemId: "item-1",
          type: "related_to", // symmetric duplicate
          confidence: "medium",
          reason: "razon 2",
        },
      ],
    }));

    const result = await detectRelationships(provider, { items }, { inferSameProject: false });
    expect(result.relationships).toHaveLength(1);
  });

  it("4. Empty result: single item or zero items short-circuits to empty array without provider call", async () => {
    let providerCalled = false;
    const provider = new MockProvider();
    provider.setRelationshipsHandler(async () => {
      providerCalled = true;
      return { relationships: [] };
    });

    const singleItem: ExtractedItem[] = [
      { id: "item-1", rawText: "solo una tarea", title: "Tarea solitaria", type: "task" },
    ];
    const result = await detectRelationships(provider, { items: singleItem });
    expect(result.relationships).toEqual([]);
    expect(providerCalled).toBe(false);
  });

  it("5. Case Stripe (case-06): detects dependency between Stripe integration and webhook credentials", async () => {
    const case06Items = mockCasesData["case-06"]!.items as ExtractedItem[];
    const provider = new MockProvider();

    const result = await detectRelationships(provider, { items: case06Items });

    const stripeDep = result.relationships.find(
      (r) => r.sourceItemId === "c06-1" && r.targetItemId === "c06-2" && r.type === "depends_on"
    );
    expect(stripeDep).toBeDefined();
    expect(stripeDep?.confidence).toBe("high");
    expect(stripeDep?.reason).toContain("credenciales");
  });

  it("6. Case 19: detects dependency 'Enviar presupuesto depends_on Hablar con Pablo'", async () => {
    const case19Items = mockCasesData["case-19"]!.items as ExtractedItem[];
    const provider = new MockProvider();

    const result = await detectRelationships(provider, { items: case19Items }, { inferSameProject: false });

    const pabloDep = result.relationships.find(
      (r) => r.sourceItemId === "c19-1" && r.targetItemId === "c19-2" && r.type === "depends_on"
    );
    expect(pabloDep).toBeDefined();
    expect(pabloDep?.reason).toContain("Pablo");

    // Hotfix (c19-3) must NOT be related to budget/Pablo
    const hotfixRel = result.relationships.find(
      (r) => r.sourceItemId === "c19-3" || r.targetItemId === "c19-3"
    );
    expect(hotfixRel).toBeUndefined();
  });

  it("7. Case 12: detects part_of constituent tasks with beta launch project", async () => {
    const case12Items = mockCasesData["case-12"]!.items as ExtractedItem[];
    const provider = new MockProvider();

    const result = await detectRelationships(provider, { items: case12Items }, { inferSameProject: false });

    const partOfRels = result.relationships.filter(
      (r) => r.targetItemId === "c12-1" && r.type === "part_of"
    );
    expect(partOfRels).toHaveLength(4); // testing, onboarding, bugs safari, privacidad
  });

  it("8. Independent items: Case 03 produces no artificial relationships", async () => {
    const case03Items = mockCasesData["case-03"]!.items as ExtractedItem[];
    const provider = new MockProvider();

    const result = await detectRelationships(provider, { items: case03Items }, { inferSameProject: false });
    expect(result.relationships).toEqual([]);
  });

  it("9. Service retry on invalid response", async () => {
    const items: ExtractedItem[] = [
      { id: "item-1", rawText: "tarea 1", title: "Tarea 1", type: "task" },
      { id: "item-2", rawText: "tarea 2", title: "Tarea 2", type: "task" },
    ];
    let callCount = 0;
    const provider = new MockProvider();
    provider.setRelationshipsHandler(async () => {
      callCount++;
      if (callCount === 1) {
        throw new Error("Temporary network glitch");
      }
      return {
        relationships: [
          {
            sourceItemId: "item-1",
            targetItemId: "item-2",
            type: "related_to",
            confidence: "medium",
            reason: "recuperado tras retry",
          },
        ],
      };
    });

    // Should throw if generic error without RelationshipValidationError
    const service = new DetectRelationshipsService(provider, { maxRetries: 1 });
    await expect(service.execute({ items })).rejects.toThrow("Temporary network glitch");
  });
});
