import { AIProvider } from "../../providers/ai-provider";
import {
  DetectRelationshipsInput,
  DetectRelationshipsInputSchema,
  DetectedRelationships,
  DetectedRelationshipsSchema,
} from "../../domain/relationships";
import { RelationshipValidationError, parseAndValidateRelationships } from "./parser";
import { cleanAndValidateRelationships, CleanRelationshipsOptions } from "./deterministic";
import {
  SYSTEM_PROMPT as REL_SYSTEM_PROMPT,
  buildUserPrompt as buildRelUserPrompt,
} from "./prompt";

export interface DetectRelationshipsOptions extends CleanRelationshipsOptions {
  maxRetries?: number;
}

export class DetectRelationshipsService {
  constructor(
    private readonly provider: AIProvider,
    private readonly options: DetectRelationshipsOptions = { maxRetries: 1, inferSameProject: true }
  ) {}

  async execute(input: DetectRelationshipsInput): Promise<DetectedRelationships> {
    const validatedInput = DetectRelationshipsInputSchema.parse(input);

    // Deterministic short-circuit: < 2 items cannot have relationships
    if (validatedInput.items.length < 2) {
      return { relationships: [] };
    }

    let attempts = 0;
    const maxAttempts = (this.options.maxRetries ?? 1) + 1;
    let lastError: unknown;
    let rawResult: DetectedRelationships | null = null;

    const useCompleteJson =
      Boolean(this.provider.completeJson) &&
      this.provider.id !== "mock" &&
      !("callProxy" in this.provider);

    while (attempts < maxAttempts) {
      attempts++;
      try {
        if (useCompleteJson && this.provider.completeJson) {
          const userPrompt = buildRelUserPrompt(validatedInput);
          const { rawText } = await this.provider.completeJson(REL_SYSTEM_PROMPT, userPrompt);
          rawResult = parseAndValidateRelationships(rawText);
        } else if (this.provider.detectRelationships) {
          rawResult = await this.provider.detectRelationships(validatedInput);
        } else if (this.provider.completeJson) {
          const userPrompt = buildRelUserPrompt(validatedInput);
          const { rawText } = await this.provider.completeJson(REL_SYSTEM_PROMPT, userPrompt);
          rawResult = parseAndValidateRelationships(rawText);
        } else {
          throw new Error(
            `Provider "${this.provider.id}" does not support completeJson or detectRelationships.`
          );
        }

        const parseCheck = DetectedRelationshipsSchema.safeParse(rawResult);
        if (!parseCheck.success) {
          throw new RelationshipValidationError(
            "Relationships failed schema validation",
            parseCheck.error.issues
          );
        }
        break;
      } catch (error) {
        lastError = error;
        if (error instanceof RelationshipValidationError && attempts < maxAttempts) {
          continue;
        }
        throw error;
      }
    }

    if (!rawResult) {
      throw lastError;
    }

    // Apply deterministic cleaning, validation, deduplication and canonicalization
    return cleanAndValidateRelationships(
      rawResult.relationships,
      validatedInput.items,
      this.options
    );
  }
}

/**
 * Functional convenience wrapper
 */
export async function detectRelationships(
  provider: AIProvider,
  input: DetectRelationshipsInput,
  options?: DetectRelationshipsOptions
): Promise<DetectedRelationships> {
  const service = new DetectRelationshipsService(provider, options);
  return service.execute(input);
}
