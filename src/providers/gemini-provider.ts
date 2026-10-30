import { GoogleGenAI } from "@google/genai";
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

export interface GeminiProviderOptions {
  apiKey?: string;
  model?: string;
}

export class GeminiProvider implements AIProvider {
  readonly id = "gemini" as const;
  readonly model: string;
  private client: GoogleGenAI;
  private lastExecutionMeta?: ProviderExecutionMeta;

  constructor(options: GeminiProviderOptions = {}) {
    const apiKey =
      options.apiKey || (typeof process !== "undefined" ? process.env?.GEMINI_API_KEY : undefined);
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is required for GeminiProvider");
    }
    this.model =
      options.model ||
      (typeof process !== "undefined" ? process.env?.GEMINI_MODEL : undefined) ||
      "gemini-2.5-flash";
    this.client = new GoogleGenAI({ apiKey });
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
    const response = await this.client.models.generateContent({
      model: this.model,
      contents: userPrompt,
      config: {
        systemInstruction: systemPrompt,
        responseMimeType: "application/json",
        temperature: options.temperature ?? 0.1,
      },
    });

    const content = response.text;
    if (!content) {
      throw new Error("Gemini returned an empty response");
    }

    const durationMs = Date.now() - startTime;
    const meta: ProviderExecutionMeta = {
      provider: this.id,
      model: this.model,
      durationMs,
      tokensUsed: response.usageMetadata
        ? {
            prompt: response.usageMetadata.promptTokenCount,
            completion: response.usageMetadata.candidatesTokenCount,
            total: response.usageMetadata.totalTokenCount,
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
