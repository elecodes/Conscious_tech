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

export interface GroqProviderOptions {
  apiKey?: string;
  model?: string;
}

export class GroqProvider implements AIProvider {
  readonly id = "groq" as const;
  readonly model: string;
  private client: Groq;

  constructor(options: GroqProviderOptions = {}) {
    const apiKey = options.apiKey || (typeof process !== "undefined" ? process.env?.GROQ_API_KEY : undefined);
    if (!apiKey) {
      throw new Error("GROQ_API_KEY is required for GroqProvider");
    }
    this.model = options.model || (typeof process !== "undefined" ? process.env?.GROQ_MODEL : undefined) || "qwen/qwen3.8-27b";
    this.client = new Groq({ apiKey });
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
}
