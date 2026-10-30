import Groq from "groq-sdk";
import {
  AIProvider,
  CompletionOptions,
  CompletionResult,
  ProviderExecutionMeta,
} from "./ai-provider";
import { ExtractItemsInput, ExtractedItems } from "../domain/items";
import { DetectRelationshipsInput, DetectedRelationships } from "../domain/relationships";
import { GroupWorkInput, GroupedWork } from "../domain/work-groups";
import { DetectDeadlinesInput, DetectedDeadlines } from "../domain/deadlines";
import { EvaluateContextInput, EvaluateContextOutput } from "../domain/context";
import { BuildWeekInput } from "../domain/week";
import { extractItems } from "../skills/extract-items";
import { detectRelationships } from "../skills/detect-relationships";
import { groupWork } from "../skills/group-work";
import { detectDeadlines } from "../skills/detect-deadlines";
import { evaluateContext } from "../skills/evaluate-context";
import { buildWeek, BuildWeekResult } from "../skills/build-week";

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

  async completeJson(
    systemPrompt: string,
    userPrompt: string,
    options: CompletionOptions = {}
  ): Promise<CompletionResult> {
    const startTime = Date.now();
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
      temperature: options.temperature ?? 0.1,
      max_tokens: options.maxTokens ?? 3500,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error("Groq returned an empty response");
    }

    const durationMs = Date.now() - startTime;
    const meta: ProviderExecutionMeta = {
      provider: this.id,
      model: this.model,
      durationMs,
      tokensUsed: response.usage
        ? {
            prompt: response.usage.prompt_tokens,
            completion: response.usage.completion_tokens,
            total: response.usage.total_tokens,
          }
        : undefined,
    };
    this.lastExecutionMeta = meta;

    return { rawText: content, meta };
  }

  async extractItems(input: ExtractItemsInput): Promise<ExtractedItems> {
    return extractItems(this, input);
  }

  async detectRelationships(input: DetectRelationshipsInput): Promise<DetectedRelationships> {
    return detectRelationships(this, input);
  }

  async groupWork(input: GroupWorkInput): Promise<GroupedWork> {
    return groupWork(this, input);
  }

  async detectDeadlines(input: DetectDeadlinesInput): Promise<DetectedDeadlines> {
    return detectDeadlines(this, input);
  }

  async evaluateContext(input: EvaluateContextInput): Promise<EvaluateContextOutput> {
    return evaluateContext(this, input);
  }

  async buildWeek(input: BuildWeekInput): Promise<BuildWeekResult> {
    const result = await buildWeek(this, input);
    if (result.meta) {
      this.lastExecutionMeta = result.meta;
    }
    return result;
  }
}
