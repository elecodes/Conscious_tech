import { AIProvider } from "./ai-provider";
import { ExtractItemsInput, ExtractedItems } from "../domain/items";

export type MockHandler = (input: ExtractItemsInput) => Promise<ExtractedItems> | ExtractedItems;

export class MockProvider implements AIProvider {
  readonly id = "mock" as const;
  readonly model = "mock-model";

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

    // Default mock response
    return {
      items: [
        {
          id: "item-1",
          rawText: input.text.slice(0, 50),
          title: "Mock Item",
          type: "task",
          status: "pending",
          commitment: "none",
        },
      ],
    };
  }
}
