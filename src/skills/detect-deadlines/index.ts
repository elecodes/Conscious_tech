import { AIProvider } from "../../providers/ai-provider";
import {
  DetectDeadlinesInput,
  DetectDeadlinesInputSchema,
  DetectedDeadlines,
  DetectedDeadlinesSchema,
} from "../../domain/deadlines";
import { DeadlinesValidationError } from "./parser";
import { cleanAndValidateDeadlines } from "./deterministic";

export interface DetectDeadlinesOptions {
  maxRetries?: number;
}

export class DetectDeadlinesService {
  constructor(
    private readonly provider: AIProvider,
    private readonly options: DetectDeadlinesOptions = { maxRetries: 1 }
  ) {}

  async execute(input: DetectDeadlinesInput): Promise<DetectedDeadlines> {
    const validatedInput = DetectDeadlinesInputSchema.parse(input);

    // Deterministic short-circuit: 0 items has no deadlines
    if (validatedInput.items.length === 0) {
      return { deadlines: [] };
    }

    let attempts = 0;
    const maxAttempts = (this.options.maxRetries ?? 1) + 1;
    let lastError: unknown;
    let rawResult: DetectedDeadlines | null = null;

    while (attempts < maxAttempts) {
      attempts++;
      try {
        rawResult = await this.provider.detectDeadlines(validatedInput);
        const parseCheck = DetectedDeadlinesSchema.safeParse(rawResult);
        if (!parseCheck.success) {
          throw new DeadlinesValidationError(
            "Deadlines failed schema validation",
            parseCheck.error.issues
          );
        }
        break;
      } catch (error) {
        lastError = error;
        if (error instanceof DeadlinesValidationError && attempts < maxAttempts) {
          continue;
        }
        throw error;
      }
    }

    if (!rawResult) {
      throw lastError;
    }

    // Apply deterministic cleaning, ISO date normalization and invariant validation
    return cleanAndValidateDeadlines(
      rawResult.deadlines,
      validatedInput.items,
      validatedInput.currentDate
    );
  }
}

/**
 * Functional convenience wrapper
 */
export async function detectDeadlines(
  provider: AIProvider,
  input: DetectDeadlinesInput,
  options?: DetectDeadlinesOptions
): Promise<DetectedDeadlines> {
  const service = new DetectDeadlinesService(provider, options);
  return service.execute(input);
}
