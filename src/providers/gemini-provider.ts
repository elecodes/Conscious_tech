import { GoogleGenAI } from "@google/genai";
import { AIProvider } from "./ai-provider";
import { ExtractItemsInput, ExtractedItems } from "../domain/items";
import { SYSTEM_PROMPT, buildUserPrompt } from "../skills/extract-items/prompt";
import { parseAndValidateExtractedItems } from "../skills/extract-items/parser";

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
      contents: buildUserPrompt(input),
      config: {
        systemInstruction: SYSTEM_PROMPT,
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
}
