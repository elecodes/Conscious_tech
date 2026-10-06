import Groq from "groq-sdk";
import { AIProvider } from "./ai-provider";
import { ExtractItemsInput, ExtractedItems } from "../domain/items";
import { SYSTEM_PROMPT, buildUserPrompt } from "../skills/extract-items/prompt";
import { parseAndValidateExtractedItems } from "../skills/extract-items/parser";

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
    this.model = options.model || (typeof process !== "undefined" ? process.env?.GROQ_MODEL : undefined) || "llama-3.3-70b-versatile";
    this.client = new Groq({ apiKey });
  }

  async extractItems(input: ExtractItemsInput): Promise<ExtractedItems> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserPrompt(input) },
      ],
      response_format: { type: "json_object" },
      temperature: 0.1,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error("Groq returned an empty response");
    }

    return parseAndValidateExtractedItems(content);
  }
}
