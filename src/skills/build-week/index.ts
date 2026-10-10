import { AIProvider } from "../../providers/ai-provider";
import {
  BuildWeekInput,
  ProposedWeek,
  createEmptyProposedWeek,
} from "../../domain/week";
import {
  assertValidBuildWeekInput,
  buildDeterministicPlanningContext,
  normalizeAndConserveProposedWeek,
  evaluateProposedWeekSemanticQuality,
  SemanticQualityCheckResult,
  ProposalRepairAction,
  WeekValidationError,
} from "./deterministic";
import { buildWeekPrompt } from "./prompt";
import { parseProposedWeek, WeekParseResult } from "./parser";

export interface BuildWeekOptions {
  maxRetries?: number;
}

export interface BuildWeekExecutionResult {
  proposal: ProposedWeek;
  repaired: boolean;
  repairs: ProposalRepairAction[];
}

export class BuildWeekService {
  constructor(
    private readonly provider: AIProvider,
    private readonly options: BuildWeekOptions = { maxRetries: 1 }
  ) {}

  async execute(input: BuildWeekInput): Promise<BuildWeekExecutionResult> {
    // 1. Strict validation of input
    assertValidBuildWeekInput(input);

    // 2. Deterministic zero-token fast-path for empty inputs
    if (input.items.length === 0) {
      return {
        proposal: createEmptyProposedWeek(input.currentDate, input.targetWeek),
        repaired: false,
        repairs: [],
      };
    }

    // 3. Build normalized deterministic planning context
    const planningContext = buildDeterministicPlanningContext(input);

    // 4. Construct prompts (ensuring stability and deterministic verification)
    buildWeekPrompt(planningContext);

    // 5. Invoke provider
    if (!this.provider.buildWeek) {
      throw new Error(`Provider "${this.provider.id}" does not support buildWeek yet.`);
    }

    let attempts = 0;
    const maxAttempts = (this.options.maxRetries ?? 1) + 1;
    let lastError: unknown;
    let parsedResult: BuildWeekExecutionResult | null = null;

    while (attempts < maxAttempts) {
      attempts++;
      try {
        const rawResult: unknown = await this.provider.buildWeek(input);

        const providerParse = typeof (this.provider as any).getLastParseResult === "function"
          ? ((this.provider as any).getLastParseResult() as WeekParseResult | undefined)
          : undefined;

        if (typeof rawResult === "string") {
          const parseOutcome = parseProposedWeek(rawResult, input);
          if (!parseOutcome.success) {
            const issues = "issues" in parseOutcome ? parseOutcome.issues : [];
            throw new WeekValidationError(parseOutcome.error, issues);
          }
          parsedResult = {
            proposal: parseOutcome.data,
            repaired: parseOutcome.repaired,
            repairs: parseOutcome.repairs,
          };
        } else if (providerParse && providerParse.success) {
          parsedResult = {
            proposal: providerParse.data,
            repaired: providerParse.repaired,
            repairs: providerParse.repairs,
          };
        } else {
          // Object returned by provider (e.g. MockProvider)
          const normResult = normalizeAndConserveProposedWeek(rawResult as ProposedWeek, input);
          parsedResult = {
            proposal: normResult.proposal,
            repaired: normResult.repaired,
            repairs: normResult.repairs,
          };
        }
        break;
      } catch (err) {
        lastError = err;
        if (err instanceof WeekValidationError && attempts < maxAttempts) {
          continue;
        }
        throw err;
      }
    }

    if (!parsedResult) {
      throw lastError;
    }

    return parsedResult;
  }
}

/**
 * Functional wrapper executing BuildWeekService and returning ProposedWeek.
 */
export async function buildWeek(
  provider: AIProvider,
  input: BuildWeekInput,
  options?: BuildWeekOptions
): Promise<ProposedWeek> {
  const service = new BuildWeekService(provider, options);
  const result = await service.execute(input);
  return result.proposal;
}

/**
 * Functional wrapper executing BuildWeekService and returning full execution audit with repairs.
 */
export async function buildWeekWithAudit(
  provider: AIProvider,
  input: BuildWeekInput,
  options?: BuildWeekOptions
): Promise<BuildWeekExecutionResult> {
  const service = new BuildWeekService(provider, options);
  return service.execute(input);
}

export {
  evaluateProposedWeekSemanticQuality,
};
export type {
  SemanticQualityCheckResult,
};
