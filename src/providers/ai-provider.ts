import { ExtractItemsInput, ExtractedItems } from "../domain/items";

export interface ProviderExecutionMeta {
  provider: string;
  model: string;
  durationMs: number;
  tokensUsed?: {
    prompt?: number;
    completion?: number;
    total?: number;
  };
}

export interface AIProvider {
  readonly id: "groq" | "gemini" | "mock";
  readonly model: string;
  extractItems(input: ExtractItemsInput): Promise<ExtractedItems>;
}
