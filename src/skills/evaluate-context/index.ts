import { AIProvider } from "../../providers/ai-provider";
import {
  EvaluateContextInput,
  EvaluateContextInputSchema,
  EvaluateContextOutput,
  EvaluateContextOutputSchema,
} from "../../domain/context";
import { ContextValidationError, parseAndValidateContextOutput } from "./parser";
import { cleanAndValidateContextOutput } from "./deterministic";
import {
  SYSTEM_PROMPT as CONTEXT_SYSTEM_PROMPT,
  buildUserPrompt as buildContextUserPrompt,
} from "./prompt";

export interface EvaluateContextOptions {
  maxRetries?: number;
}

export class EvaluateContextService {
  constructor(
    private readonly provider: AIProvider,
    private readonly options: EvaluateContextOptions = { maxRetries: 1 }
  ) {}

  async execute(input: EvaluateContextInput): Promise<EvaluateContextOutput> {
    const validatedInput = EvaluateContextInputSchema.parse(input);

    // Deterministic short-circuit: 0 items has no context to evaluate
    if (validatedInput.items.length === 0) {
      return {
        itemAssessments: [],
        groupAssessments: [],
        openQuestions: [],
      };
    }

    let attempts = 0;
    const maxAttempts = (this.options.maxRetries ?? 1) + 1;
    let lastError: unknown;
    let rawResult: EvaluateContextOutput | null = null;

    const useCompleteJson =
      Boolean(this.provider.completeJson) &&
      this.provider.id !== "mock" &&
      !("callProxy" in this.provider);

    while (attempts < maxAttempts) {
      attempts++;
      try {
        if (useCompleteJson && this.provider.completeJson) {
          const userPrompt = buildContextUserPrompt(validatedInput);
          const { rawText } = await this.provider.completeJson(CONTEXT_SYSTEM_PROMPT, userPrompt);
          rawResult = parseAndValidateContextOutput(rawText);
        } else if (this.provider.evaluateContext) {
          rawResult = await this.provider.evaluateContext(validatedInput);
        } else if (this.provider.completeJson) {
          const userPrompt = buildContextUserPrompt(validatedInput);
          const { rawText } = await this.provider.completeJson(CONTEXT_SYSTEM_PROMPT, userPrompt);
          rawResult = parseAndValidateContextOutput(rawText);
        } else {
          throw new Error(
            `Provider "${this.provider.id}" does not support completeJson or evaluateContext.`
          );
        }

        const parseCheck = EvaluateContextOutputSchema.safeParse(rawResult);
        if (!parseCheck.success) {
          throw new ContextValidationError(
            "EvaluateContext output failed schema validation",
            parseCheck.error.issues
          );
        }
        break;
      } catch (error) {
        lastError = error;
        if (error instanceof ContextValidationError && attempts < maxAttempts) {
          continue;
        }
        throw error;
      }
    }

    if (!rawResult) {
      throw lastError;
    }

    // Apply deterministic invariant cleaning and conservation guarantees
    return cleanAndValidateContextOutput(rawResult, validatedInput);
  }
}

/**
 * Functional wrapper for executing EvaluateContextService.
 */
export async function evaluateContext(
  provider: AIProvider,
  input: EvaluateContextInput,
  options?: EvaluateContextOptions
): Promise<EvaluateContextOutput> {
  const service = new EvaluateContextService(provider, options);
  return service.execute(input);
}
