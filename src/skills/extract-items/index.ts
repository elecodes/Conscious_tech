import { AIProvider } from "../../providers/ai-provider";
import { ExtractItemsInput, ExtractItemsInputSchema, ExtractedItems } from "../../domain/items";
import { ExtractionValidationError, parseAndValidateExtractedItems } from "./parser";
import {
  SYSTEM_PROMPT as EXTRACT_SYSTEM_PROMPT,
  buildUserPrompt as buildExtractUserPrompt,
} from "./prompt";

export interface ExtractItemsOptions {
  maxRetries?: number;
}

export class ExtractItemsService {
  constructor(
    private readonly provider: AIProvider,
    private readonly options: ExtractItemsOptions = { maxRetries: 1 }
  ) {}

  async execute(input: ExtractItemsInput): Promise<ExtractedItems> {
    const validatedInput = ExtractItemsInputSchema.parse(input);
    let attempts = 0;
    const maxAttempts = (this.options.maxRetries ?? 1) + 1;
    let lastError: unknown;

    const useCompleteJson =
      Boolean(this.provider.completeJson) &&
      this.provider.id !== "mock" &&
      !("callProxy" in this.provider);

    while (attempts < maxAttempts) {
      attempts++;
      try {
        if (useCompleteJson && this.provider.completeJson) {
          const userPrompt = buildExtractUserPrompt(validatedInput);
          const { rawText } = await this.provider.completeJson(EXTRACT_SYSTEM_PROMPT, userPrompt);
          return parseAndValidateExtractedItems(rawText);
        }
        if (this.provider.extractItems) {
          return await this.provider.extractItems(validatedInput);
        }
        if (this.provider.completeJson) {
          const userPrompt = buildExtractUserPrompt(validatedInput);
          const { rawText } = await this.provider.completeJson(EXTRACT_SYSTEM_PROMPT, userPrompt);
          return parseAndValidateExtractedItems(rawText);
        }
        throw new Error(
          `Provider "${this.provider.id}" does not support completeJson or extractItems.`
        );
      } catch (error) {
        lastError = error;
        if (error instanceof ExtractionValidationError && attempts < maxAttempts) {
          // Retry once if output failed validation
          continue;
        }
        throw error;
      }
    }

    throw lastError;
  }
}

/**
 * Functional convenience wrapper
 */
export async function extractItems(
  provider: AIProvider,
  input: ExtractItemsInput,
  options?: ExtractItemsOptions
): Promise<ExtractedItems> {
  const service = new ExtractItemsService(provider, options);
  return service.execute(input);
}
