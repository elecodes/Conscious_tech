import { AIProvider } from "../../providers/ai-provider";
import {
  GroupWorkInput,
  GroupWorkInputSchema,
  GroupedWork,
  GroupedWorkSchema,
} from "../../domain/work-groups";
import { GroupWorkValidationError } from "./parser";
import { cleanAndValidateGroupedWork } from "./deterministic";

export interface GroupWorkOptions {
  maxRetries?: number;
}

export class GroupWorkService {
  constructor(
    private readonly provider: AIProvider,
    private readonly options: GroupWorkOptions = { maxRetries: 1 }
  ) {}

  async execute(input: GroupWorkInput): Promise<GroupedWork> {
    const validatedInput = GroupWorkInputSchema.parse(input);

    // Deterministic short-circuit 1: empty input
    if (validatedInput.items.length === 0) {
      return { groups: [], ungroupedItemIds: [] };
    }

    // Deterministic short-circuit 2: single item cannot form a group (requires >= 2)
    if (validatedInput.items.length === 1) {
      return { groups: [], ungroupedItemIds: [validatedInput.items[0]!.id] };
    }

    // Deterministic short-circuit 3: no relationships detected means all items are independent
    if (validatedInput.relationships.length === 0) {
      return {
        groups: [],
        ungroupedItemIds: validatedInput.items.map((i) => i.id),
      };
    }

    let attempts = 0;
    const maxAttempts = (this.options.maxRetries ?? 1) + 1;
    let lastError: unknown;
    let rawResult: GroupedWork | null = null;

    while (attempts < maxAttempts) {
      attempts++;
      try {
        rawResult = await this.provider.groupWork(validatedInput);
        const parseCheck = GroupedWorkSchema.safeParse(rawResult);
        if (!parseCheck.success) {
          throw new GroupWorkValidationError(
            "Grouped work failed schema validation",
            parseCheck.error.issues
          );
        }
        break;
      } catch (error) {
        lastError = error;
        if (error instanceof GroupWorkValidationError && attempts < maxAttempts) {
          continue;
        }
        throw error;
      }
    }

    if (!rawResult) {
      throw lastError;
    }

    // Apply deterministic cleaning, invariants enforcement and item conservation
    return cleanAndValidateGroupedWork(rawResult, validatedInput.items);
  }
}

/**
 * Functional convenience wrapper
 */
export async function groupWork(
  provider: AIProvider,
  input: GroupWorkInput,
  options?: GroupWorkOptions
): Promise<GroupedWork> {
  const service = new GroupWorkService(provider, options);
  return service.execute(input);
}
