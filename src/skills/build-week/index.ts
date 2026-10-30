import { AIProvider, ProviderExecutionMeta } from "../../providers/ai-provider";
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
  data: ProposedWeek;
  repaired: boolean;
  repairs: ProposalRepairAction[];
  parseResult?: WeekParseResult;
  meta?: ProviderExecutionMeta;
}

export type BuildWeekResult = ProposedWeek & {
  data: ProposedWeek;
  meta?: ProviderExecutionMeta;
  parseResult?: WeekParseResult;
};

export class BuildWeekService {
  constructor(
    private readonly provider: AIProvider,
    private readonly options: BuildWeekOptions = { maxRetries: 1 }
  ) {}

  async execute(input: BuildWeekInput): Promise<BuildWeekExecutionResult> {
    // 1. Deterministic zero-token fast-path for empty inputs
    if (input.items.length === 0) {
      const emptyProposal = createEmptyProposedWeek(input.currentDate, input.targetWeek);
      const meta: ProviderExecutionMeta = {
        provider: this.provider.id,
        model: this.provider.model,
        durationMs: 0,
      };
      return {
        proposal: emptyProposal,
        data: emptyProposal,
        repaired: false,
        repairs: [],
        meta,
      };
    }

    // 2. Strict validation of input
    assertValidBuildWeekInput(input);

    // 3. Build normalized deterministic planning context
    const planningContext = buildDeterministicPlanningContext(input);

    // 4. Construct prompts (ensuring stability and deterministic verification)
    const { systemPrompt, userPrompt } = buildWeekPrompt(planningContext);

    let attempts = 0;
    const maxAttempts = (this.options.maxRetries ?? 1) + 1;
    let lastError: unknown;
    let parsedResult: BuildWeekExecutionResult | null = null;

    const useCompleteJson =
      Boolean(this.provider.completeJson) &&
      this.provider.id !== "mock" &&
      !("callProxy" in this.provider);

    while (attempts < maxAttempts) {
      attempts++;
      try {
        if (useCompleteJson && this.provider.completeJson) {
          const { rawText, meta } = await this.provider.completeJson(
            systemPrompt,
            userPrompt,
            {
              temperature: 0.1,
              maxTokens: 3500,
            }
          );
          const parseOutcome = parseProposedWeek(rawText, input);
          if (!parseOutcome.success) {
            const issues = "issues" in parseOutcome ? parseOutcome.issues : [];
            throw new WeekValidationError(parseOutcome.error, issues);
          }
          parsedResult = {
            proposal: parseOutcome.data,
            data: parseOutcome.data,
            repaired: parseOutcome.repaired,
            repairs: parseOutcome.repairs,
            parseResult: parseOutcome,
            meta,
          };
          break;
        }

        if (this.provider.buildWeek) {
          const rawResult: unknown = await this.provider.buildWeek(input);

          if (typeof rawResult === "string") {
            const parseOutcome = parseProposedWeek(rawResult, input);
            if (!parseOutcome.success) {
              const issues = "issues" in parseOutcome ? parseOutcome.issues : [];
              throw new WeekValidationError(parseOutcome.error, issues);
            }
            parsedResult = {
              proposal: parseOutcome.data,
              data: parseOutcome.data,
              repaired: parseOutcome.repaired,
              repairs: parseOutcome.repairs,
              parseResult: parseOutcome,
            };
          } else {
            // Object returned by provider (e.g. MockProvider, RemoteAIProvider)
            const normResult = normalizeAndConserveProposedWeek(rawResult as ProposedWeek, input);
            const rawObj = rawResult as Record<string, unknown>;
            parsedResult = {
              proposal: normResult.proposal,
              data: normResult.proposal,
              repaired: normResult.repaired,
              repairs: normResult.repairs,
              parseResult: (rawObj.parseResult as WeekParseResult) ?? undefined,
              meta: (rawObj.meta as ProviderExecutionMeta) ?? undefined,
            };
          }
          break;
        }

        if (this.provider.completeJson) {
          const { rawText, meta } = await this.provider.completeJson(
            systemPrompt,
            userPrompt,
            {
              temperature: 0.1,
              maxTokens: 3500,
            }
          );
          const parseOutcome = parseProposedWeek(rawText, input);
          if (!parseOutcome.success) {
            const issues = "issues" in parseOutcome ? parseOutcome.issues : [];
            throw new WeekValidationError(parseOutcome.error, issues);
          }
          parsedResult = {
            proposal: parseOutcome.data,
            data: parseOutcome.data,
            repaired: parseOutcome.repaired,
            repairs: parseOutcome.repairs,
            parseResult: parseOutcome,
            meta,
          };
          break;
        }

        throw new Error(`Provider "${this.provider.id}" does not support buildWeek or completeJson.`);
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
 * Functional wrapper executing BuildWeekService and returning BuildWeekResult.
 */
export async function buildWeek(
  provider: AIProvider,
  input: BuildWeekInput,
  options?: BuildWeekOptions
): Promise<BuildWeekResult> {
  const service = new BuildWeekService(provider, options);
  const result = await service.execute(input);
  const proposal = result.proposal;
  Object.defineProperty(proposal, "data", {
    value: proposal,
    enumerable: false,
    configurable: true,
    writable: true,
  });
  if (result.meta !== undefined) {
    Object.defineProperty(proposal, "meta", {
      value: result.meta,
      enumerable: false,
      configurable: true,
      writable: true,
    });
  }
  if (result.parseResult !== undefined) {
    Object.defineProperty(proposal, "parseResult", {
      value: result.parseResult,
      enumerable: false,
      configurable: true,
      writable: true,
    });
  }
  return proposal as BuildWeekResult;
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
