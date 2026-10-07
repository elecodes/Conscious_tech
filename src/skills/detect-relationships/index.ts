import { AIProvider } from "../../providers/ai-provider";
import {
  DetectRelationshipsInput,
  DetectRelationshipsInputSchema,
  DetectedRelationships,
  DetectedRelationshipsSchema,
} from "../../domain/relationships";
import { RelationshipValidationError } from "./parser";
import { cleanAndValidateRelationships, CleanRelationshipsOptions } from "./deterministic";

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

    while (attempts < maxAttempts) {
      attempts++;
      try {
        rawResult = await this.provider.detectRelationships(validatedInput);
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
    return cleanAndValidateRelationships(rawResult.relationships, validatedInput.items, this.options);
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
