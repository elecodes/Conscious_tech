import { AIProvider } from "../../providers/ai-provider";
import {
  ExtractItemsInput,
  ExtractItemsInputSchema,
  ExtractedItems,
} from "../../domain/items";
import { ExtractionValidationError } from "./parser";

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

    while (attempts < maxAttempts) {
      attempts++;
      try {
        const result = await this.provider.extractItems(validatedInput);
        return result;
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
