import { GoogleGenAI } from "@google/genai";
import {
  AIProvider,
  CompletionOptions,
  CompletionResult,
  ProviderExecutionMeta,
} from "./ai-provider";
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
import { BuildWeekInput, ProposedWeek, createEmptyProposedWeek } from "../domain/week";
import {
  buildDeterministicPlanningContext,
  WeekValidationError,
} from "../skills/build-week/deterministic";
import { buildWeekPrompt } from "../skills/build-week/prompt";
import { parseProposedWeek } from "../skills/build-week/parser";

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
    const apiKey = options.apiKey || (typeof process !== "undefined" ? process.env?.GEMINI_API_KEY : undefined);
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is required for GeminiProvider");
    }
    this.model = options.model || (typeof process !== "undefined" ? process.env?.GEMINI_MODEL : undefined) || "gemini-2.5-flash";
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
    const { rawText } = await this.completeJson(
      EXTRACT_SYSTEM_PROMPT,
      buildExtractUserPrompt(input)
    );
    return parseAndValidateExtractedItems(rawText);
  }

  async detectRelationships(input: DetectRelationshipsInput): Promise<DetectedRelationships> {
    const { rawText } = await this.completeJson(
      REL_SYSTEM_PROMPT,
      buildRelUserPrompt(input)
    );
    return parseAndValidateRelationships(rawText);
  }

  async groupWork(input: GroupWorkInput): Promise<GroupedWork> {
    const { rawText } = await this.completeJson(
      GROUP_SYSTEM_PROMPT,
      buildGroupUserPrompt(input)
    );
    return parseAndValidateGroupedWork(rawText);
  }

  async detectDeadlines(input: DetectDeadlinesInput): Promise<DetectedDeadlines> {
    const { rawText } = await this.completeJson(
      DEADLINES_SYSTEM_PROMPT,
      buildDeadlinesUserPrompt(input)
    );
    return parseAndValidateDeadlines(rawText);
  }

  async evaluateContext(input: EvaluateContextInput): Promise<EvaluateContextOutput> {
    const { rawText } = await this.completeJson(
      CONTEXT_SYSTEM_PROMPT,
      buildContextUserPrompt(input)
    );
    return parseAndValidateContextOutput(rawText);
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

    const { rawText } = await this.completeJson(systemPrompt, userPrompt, { temperature: 0.1 });
    const parseOutcome = parseProposedWeek(rawText, input);

    if (!parseOutcome.success) {
      const issues = "issues" in parseOutcome ? parseOutcome.issues : [];
      throw new WeekValidationError(parseOutcome.error, issues);
    }

    return parseOutcome.data;
  }
}
