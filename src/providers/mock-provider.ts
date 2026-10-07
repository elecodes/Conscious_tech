import { AIProvider } from "./ai-provider";
import { ExtractItemsInput, ExtractedItems } from "../domain/items";
import { DetectRelationshipsInput, DetectedRelationships } from "../domain/relationships";
import mockCasesData from "../../cases/mock-extractions.json";
import mockRelationshipsData from "../../cases/mock-relationships.json";
import realDumpsData from "../../cases/real-dumps.json";

export type MockHandler = (input: ExtractItemsInput) => Promise<ExtractedItems> | ExtractedItems;
export type MockRelationshipsHandler = (
  input: DetectRelationshipsInput
) => Promise<DetectedRelationships> | DetectedRelationships;

export class MockProvider implements AIProvider {
  readonly id = "mock" as const;
  readonly model = "deterministic-mock-v1";

  private handler?: MockHandler;
  private relationshipsHandler?: MockRelationshipsHandler;

  constructor(
    handler?: MockHandler,
    relationshipsHandler?: MockRelationshipsHandler
  ) {
    this.handler = handler;
    this.relationshipsHandler = relationshipsHandler;
  }

  setHandler(handler: MockHandler): void {
    this.handler = handler;
  }

  setRelationshipsHandler(handler: MockRelationshipsHandler): void {
    this.relationshipsHandler = handler;
  }

  async extractItems(input: ExtractItemsInput): Promise<ExtractedItems> {
    if (this.handler) {
      return await this.handler(input);
    }

    // Try finding matching case in real-dumps
    const normalizedInput = input.text.trim();
    const matchedCase = realDumpsData.find(
      (c) => c.text.trim() === normalizedInput || normalizedInput.includes(c.text.trim().slice(0, 30))
    );

    if (matchedCase) {
      const caseItems = (mockCasesData as Record<string, ExtractedItems>)[matchedCase.id];
      if (caseItems) {
        return caseItems;
      }
    }

    // Default fallback mock response
    return {
      items: [
        {
          id: "item-mock-1",
          rawText: input.text.slice(0, 60),
          title: "Elemento detectado (Mock determinista)",
          type: "task",
          status: "pending",
          commitment: "none",
        },
      ],
    };
  }

  async detectRelationships(input: DetectRelationshipsInput): Promise<DetectedRelationships> {
    if (this.relationshipsHandler) {
      return await this.relationshipsHandler(input);
    }

    // Check if input items match any known case in mockRelationshipsData
    const itemIds = new Set(input.items.map((i) => i.id));
    for (const [caseId, data] of Object.entries(mockRelationshipsData)) {
      const match = data.relationships.some(
        (r) => itemIds.has(r.sourceItemId) && itemIds.has(r.targetItemId)
      );
      if (match) {
        return data as DetectedRelationships;
      }
      // If the case is specifically defined as having empty relationships (like case-03)
      if (data.relationships.length === 0 && caseId === "case-03") {
        if (input.items.some((i) => i.title.toLowerCase().includes("postgres"))) {
          return { relationships: [] };
        }
      }
    }

    // Default: independent items have no relationships
    return { relationships: [] };
  }
}
