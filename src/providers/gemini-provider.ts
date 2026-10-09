import { GoogleGenAI } from "@google/genai";
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

export interface GeminiProviderOptions {
  apiKey?: string;
  model?: string;
}

export class GeminiProvider implements AIProvider {
  readonly id = "gemini" as const;
  readonly model: string;
  private client: GoogleGenAI;

  constructor(options: GeminiProviderOptions = {}) {
    const apiKey = options.apiKey || (typeof process !== "undefined" ? process.env?.GEMINI_API_KEY : undefined);
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is required for GeminiProvider");
    }
    this.model = options.model || (typeof process !== "undefined" ? process.env?.GEMINI_MODEL : undefined) || "gemini-2.5-flash";
    this.client = new GoogleGenAI({ apiKey });
  }

  async extractItems(input: ExtractItemsInput): Promise<ExtractedItems> {
    const response = await this.client.models.generateContent({
      model: this.model,
      contents: buildExtractUserPrompt(input),
      config: {
        systemInstruction: EXTRACT_SYSTEM_PROMPT,
        responseMimeType: "application/json",
        temperature: 0.1,
      },
    });

    const content = response.text;
    if (!content) {
      throw new Error("Gemini returned an empty response");
    }

    return parseAndValidateExtractedItems(content);
  }

  async detectRelationships(input: DetectRelationshipsInput): Promise<DetectedRelationships> {
    const response = await this.client.models.generateContent({
      model: this.model,
      contents: buildRelUserPrompt(input),
      config: {
        systemInstruction: REL_SYSTEM_PROMPT,
        responseMimeType: "application/json",
        temperature: 0.1,
      },
    });

    const content = response.text;
    if (!content) {
      throw new Error("Gemini returned an empty response");
    }

    return parseAndValidateRelationships(content);
  }

  async groupWork(input: GroupWorkInput): Promise<GroupedWork> {
    const response = await this.client.models.generateContent({
      model: this.model,
      contents: buildGroupUserPrompt(input),
      config: {
        systemInstruction: GROUP_SYSTEM_PROMPT,
        responseMimeType: "application/json",
        temperature: 0.1,
      },
    });

    const content = response.text;
    if (!content) {
      throw new Error("Gemini returned an empty response");
    }

    return parseAndValidateGroupedWork(content);
  }

  async detectDeadlines(input: DetectDeadlinesInput): Promise<DetectedDeadlines> {
    const response = await this.client.models.generateContent({
      model: this.model,
      contents: buildDeadlinesUserPrompt(input),
      config: {
        systemInstruction: DEADLINES_SYSTEM_PROMPT,
        responseMimeType: "application/json",
        temperature: 0.1,
      },
    });

    const content = response.text;
    if (!content) {
      throw new Error("Gemini returned an empty response");
    }

    return parseAndValidateDeadlines(content);
  }

  async evaluateContext(input: EvaluateContextInput): Promise<EvaluateContextOutput> {
    const response = await this.client.models.generateContent({
      model: this.model,
      contents: buildContextUserPrompt(input),
      config: {
        systemInstruction: CONTEXT_SYSTEM_PROMPT,
        responseMimeType: "application/json",
        temperature: 0.1,
      },
    });

    const content = response.text;
    if (!content) {
      throw new Error("Gemini returned an empty response");
    }

    return parseAndValidateContextOutput(content);
  }
}
