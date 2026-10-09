import { AIProvider } from "./ai-provider";
import { ExtractItemsInput, ExtractedItems } from "../domain/items";
import { DetectRelationshipsInput, DetectedRelationships } from "../domain/relationships";
import { GroupWorkInput, GroupedWork } from "../domain/work-groups";
import { DetectDeadlinesInput, DetectedDeadlines } from "../domain/deadlines";
import mockCasesData from "../../cases/mock-extractions.json";
import mockRelationshipsData from "../../cases/mock-relationships.json";
import mockGroupingsData from "../../cases/mock-groupings.json";
import mockDeadlinesData from "../../cases/mock-deadlines.json";
import realDumpsData from "../../cases/real-dumps.json";

export type MockHandler = (input: ExtractItemsInput) => Promise<ExtractedItems> | ExtractedItems;
export type MockRelationshipsHandler = (
  input: DetectRelationshipsInput
) => Promise<DetectedRelationships> | DetectedRelationships;
export type MockGroupWorkHandler = (
  input: GroupWorkInput
) => Promise<GroupedWork> | GroupedWork;
export type MockDeadlinesHandler = (
  input: DetectDeadlinesInput
) => Promise<DetectedDeadlines> | DetectedDeadlines;

export class MockProvider implements AIProvider {
  readonly id = "mock" as const;
  readonly model = "deterministic-mock-v1";

  private handler?: MockHandler;
  private relationshipsHandler?: MockRelationshipsHandler;
  private groupWorkHandler?: MockGroupWorkHandler;
  private deadlinesHandler?: MockDeadlinesHandler;

  constructor(
    handler?: MockHandler,
    relationshipsHandler?: MockRelationshipsHandler,
    groupWorkHandler?: MockGroupWorkHandler,
    deadlinesHandler?: MockDeadlinesHandler
  ) {
    this.handler = handler;
    this.relationshipsHandler = relationshipsHandler;
    this.groupWorkHandler = groupWorkHandler;
    this.deadlinesHandler = deadlinesHandler;
  }

  setHandler(handler: MockHandler): void {
    this.handler = handler;
  }

  setRelationshipsHandler(handler: MockRelationshipsHandler): void {
    this.relationshipsHandler = handler;
  }

  setGroupWorkHandler(handler: MockGroupWorkHandler): void {
    this.groupWorkHandler = handler;
  }

  setDeadlinesHandler(handler: MockDeadlinesHandler): void {
    this.deadlinesHandler = handler;
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

  async groupWork(input: GroupWorkInput): Promise<GroupedWork> {
    if (this.groupWorkHandler) {
      return await this.groupWorkHandler(input);
    }

    const itemIds = new Set(input.items.map((i) => i.id));

    // 1. Check if matches any predefined mock grouping in mockGroupingsData
    for (const [_caseId, data] of Object.entries(mockGroupingsData)) {
      const matches = data.groups.some((g) =>
        g.itemIds.some((id) => itemIds.has(id))
      );
      if (matches) {
        return data as GroupedWork;
      }
    }

    // 2. Fallback: conservative mock grouping based on strong signals (same_project, same_objective, part_of)
    // If no relationships or items < 2, return all as ungrouped
    if (input.items.length < 2 || input.relationships.length === 0) {
      return {
        groups: [],
        ungroupedItemIds: input.items.map((i) => i.id),
      };
    }

    // Default: all ungrouped unless explicitly matched
    return {
      groups: [],
      ungroupedItemIds: input.items.map((i) => i.id),
    };
  }

  async detectDeadlines(input: DetectDeadlinesInput): Promise<DetectedDeadlines> {
    if (this.deadlinesHandler) {
      return await this.deadlinesHandler(input);
    }

    if (!input.items || input.items.length === 0) {
      return { deadlines: [] };
    }

    const itemIds = new Set(input.items.map((i) => i.id));

    // 1. Check if matches any predefined mock deadlines in mockDeadlinesData
    for (const [caseId, data] of Object.entries(mockDeadlinesData)) {
      if (data.deadlines.length > 0) {
        const matches = data.deadlines.some((d) => itemIds.has(d.itemId));
        if (matches) {
          // Filter out any deadlines whose items are not in the current input
          const validDeadlines = data.deadlines.filter((d) => itemIds.has(d.itemId));
          return { deadlines: validDeadlines as DetectedDeadlines["deadlines"] };
        }
      } else {
        // Empty deadlines case (e.g., case-03, case-09, case-21): check if items match the case in mockCasesData
        const caseExtraction = (mockCasesData as Record<string, { items: Array<{ id: string }> }>)[caseId];
        if (caseExtraction && caseExtraction.items.some((i) => itemIds.has(i.id))) {
          return { deadlines: [] };
        }
      }
    }

    // Default: no deadlines detected
    return { deadlines: [] };
  }
}
