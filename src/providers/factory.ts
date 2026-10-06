import { AIProvider } from "./ai-provider";
import { GroqProvider } from "./groq-provider";
import { GeminiProvider } from "./gemini-provider";
import { MockProvider } from "./mock-provider";

export type ProviderType = "groq" | "gemini" | "mock";

export interface ProviderFactoryOptions {
  provider?: ProviderType;
  groqApiKey?: string;
  groqModel?: string;
  geminiApiKey?: string;
  geminiModel?: string;
}

export function createAIProvider(options: ProviderFactoryOptions = {}): AIProvider {
  const provider =
    options.provider ||
    (typeof process !== "undefined"
      ? (process.env?.AI_PROVIDER as ProviderType)
      : undefined) ||
    "groq";

  switch (provider) {
    case "groq":
      return new GroqProvider({
        apiKey: options.groqApiKey,
        model: options.groqModel,
      });
    case "gemini":
      return new GeminiProvider({
        apiKey: options.geminiApiKey,
        model: options.geminiModel,
      });
    case "mock":
      return new MockProvider();
    default:
      throw new Error(`Unsupported AI provider: ${provider}`);
  }
}
