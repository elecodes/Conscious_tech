import { AIProvider } from "./ai-provider";
import { ExtractItemsInput, ExtractedItems } from "../domain/items";
import mockCasesData from "../../cases/mock-extractions.json";
import realDumpsData from "../../cases/real-dumps.json";

export type MockHandler = (input: ExtractItemsInput) => Promise<ExtractedItems> | ExtractedItems;

export class MockProvider implements AIProvider {
  readonly id = "mock" as const;
  readonly model = "deterministic-mock-v1";

  private handler?: MockHandler;

  constructor(handler?: MockHandler) {
    this.handler = handler;
  }

  setHandler(handler: MockHandler): void {
    this.handler = handler;
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
}
