import Groq from "groq-sdk";
import { AIProvider } from "./ai-provider";
import { ExtractItemsInput, ExtractedItems } from "../domain/items";
import { DetectRelationshipsInput, DetectedRelationships } from "../domain/relationships";
import {
  SYSTEM_PROMPT as EXTRACT_SYSTEM_PROMPT,
  buildUserPrompt as buildExtractUserPrompt,
} from "../skills/extract-items/prompt";
import { parseAndValidateExtractedItems } from "../skills/extract-items/parser";
import {
  SYSTEM_PROMPT as REL_SYSTEM_PROMPT,
  buildUserPrompt as buildRelUserPrompt,
} from "../skills/detect-relationships/prompt";
import { parseAndValidateRelationships } from "../skills/detect-relationships/parser";
import { GroupWorkInput, GroupedWork } from "../domain/work-groups";
import {
  SYSTEM_PROMPT as GROUP_SYSTEM_PROMPT,
  buildUserPrompt as buildGroupUserPrompt,
} from "../skills/group-work/prompt";
import { parseAndValidateGroupedWork } from "../skills/group-work/parser";
import { DetectDeadlinesInput, DetectedDeadlines } from "../domain/deadlines";
import {
  SYSTEM_PROMPT as DEADLINES_SYSTEM_PROMPT,
  buildUserPrompt as buildDeadlinesUserPrompt,
} from "../skills/detect-deadlines/prompt";
import { parseAndValidateDeadlines } from "../skills/detect-deadlines/parser";
import { EvaluateContextInput, EvaluateContextOutput } from "../domain/context";
import {
  SYSTEM_PROMPT as CONTEXT_SYSTEM_PROMPT,
  buildUserPrompt as buildContextUserPrompt,
} from "../skills/evaluate-context/prompt";
import { parseAndValidateContextOutput } from "../skills/evaluate-context/parser";
import { ProviderExecutionMeta } from "./ai-provider";
import { BuildWeekInput, ProposedWeek, createEmptyProposedWeek } from "../domain/week";
import {
  buildDeterministicPlanningContext,
  WeekValidationError,
} from "../skills/build-week/deterministic";
import { buildWeekPrompt } from "../skills/build-week/prompt";
import { parseProposedWeek, WeekParseResult } from "../skills/build-week/parser";

export interface GroqProviderOptions {
  apiKey?: string;
  model?: string;
  client?: Groq;
}

export class GroqProvider implements AIProvider {
  readonly id = "groq" as const;
  readonly model: string;
  private client: Groq;
  private lastExecutionMeta?: ProviderExecutionMeta;
  private lastRawResponse?: string;
  private lastParseResult?: WeekParseResult;

  constructor(options: GroqProviderOptions = {}) {
    if (options.client) {
      this.client = options.client;
    } else {
      const apiKey = options.apiKey || (typeof process !== "undefined" ? process.env?.GROQ_API_KEY : undefined);
      if (!apiKey) {
        throw new Error("GROQ_API_KEY is required for GroqProvider");
      }
      this.client = new Groq({ apiKey });
    }
    this.model = options.model || (typeof process !== "undefined" ? process.env?.GROQ_MODEL : undefined) || "qwen/qwen3.8-27b";
  }

  getLastExecutionMeta(): ProviderExecutionMeta | undefined {
    return this.lastExecutionMeta;
  }

  getLastRawResponse(): string | undefined {
    return this.lastRawResponse;
  }

  getLastParseResult(): WeekParseResult | undefined {
    return this.lastParseResult;
  }

  async extractItems(input: ExtractItemsInput): Promise<ExtractedItems> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: "system", content: EXTRACT_SYSTEM_PROMPT },
        { role: "user", content: buildExtractUserPrompt(input) },
      ],
      response_format: { type: "json_object" },
      temperature: 0.1,
      max_tokens: 1000,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error("Groq returned an empty response");
    }

    return parseAndValidateExtractedItems(content);
  }

  async detectRelationships(input: DetectRelationshipsInput): Promise<DetectedRelationships> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: "system", content: REL_SYSTEM_PROMPT },
        { role: "user", content: buildRelUserPrompt(input) },
      ],
      response_format: { type: "json_object" },
      temperature: 0.1,
      max_tokens: 1000,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error("Groq returned an empty response");
    }

    return parseAndValidateRelationships(content);
  }

  async groupWork(input: GroupWorkInput): Promise<GroupedWork> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: "system", content: GROUP_SYSTEM_PROMPT },
        { role: "user", content: buildGroupUserPrompt(input) },
      ],
      response_format: { type: "json_object" },
      temperature: 0.1,
      max_tokens: 1200,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error("Groq returned an empty response");
    }

    return parseAndValidateGroupedWork(content);
  }

  async detectDeadlines(input: DetectDeadlinesInput): Promise<DetectedDeadlines> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: "system", content: DEADLINES_SYSTEM_PROMPT },
        { role: "user", content: buildDeadlinesUserPrompt(input) },
      ],
      response_format: { type: "json_object" },
      temperature: 0.1,
      max_tokens: 1200,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error("Groq returned an empty response");
    }

    return parseAndValidateDeadlines(content);
  }

  async evaluateContext(input: EvaluateContextInput): Promise<EvaluateContextOutput> {
    const startTime = Date.now();
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: "system", content: CONTEXT_SYSTEM_PROMPT },
        { role: "user", content: buildContextUserPrompt(input) },
      ],
      response_format: { type: "json_object" },
      temperature: 0.1,
      max_tokens: 1500,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error("Groq returned an empty response");
    }

    this.lastRawResponse = content;
    this.lastExecutionMeta = {
      provider: this.id,
      model: this.model,
      durationMs: Date.now() - startTime,
      tokensUsed: response.usage
        ? {
            prompt: response.usage.prompt_tokens,
            completion: response.usage.completion_tokens,
            total: response.usage.total_tokens,
          }
        : undefined,
    };

    return parseAndValidateContextOutput(content);
  }

  async buildWeek(input: BuildWeekInput): Promise<ProposedWeek> {
    const startTime = Date.now();
    if (input.items.length === 0) {
      this.lastExecutionMeta = {
        provider: this.id,
        model: this.model,
        durationMs: Date.now() - startTime,
      };
      return createEmptyProposedWeek(input.currentDate, input.targetWeek);
    }

    const planningContext = buildDeterministicPlanningContext(input);
    const { systemPrompt, userPrompt } = buildWeekPrompt(planningContext);

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0.1,
      max_tokens: 3500,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error("Groq returned an empty response");
    }

    this.lastRawResponse = content;
    this.lastExecutionMeta = {
      provider: this.id,
      model: this.model,
      durationMs: Date.now() - startTime,
      tokensUsed: response.usage
        ? {
            prompt: response.usage.prompt_tokens,
            completion: response.usage.completion_tokens,
            total: response.usage.total_tokens,
          }
        : undefined,
    };

    const parseOutcome = parseProposedWeek(content, input);
    this.lastParseResult = parseOutcome;

    if (!parseOutcome.success) {
      const issues = "issues" in parseOutcome ? parseOutcome.issues : [];
      throw new WeekValidationError(parseOutcome.error, issues);
    }

    return parseOutcome.data;
  }
}
