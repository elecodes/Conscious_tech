import { AIProvider } from "./ai-provider";
import { ExtractItemsInput, ExtractedItems, ExtractedItemsSchema } from "../domain/items";
import { DetectRelationshipsInput, DetectedRelationships, DetectedRelationshipsSchema } from "../domain/relationships";
import { GroupWorkInput, GroupedWork, GroupedWorkSchema } from "../domain/work-groups";
import { DetectDeadlinesInput, DetectedDeadlines, DetectedDeadlinesSchema } from "../domain/deadlines";
import { EvaluateContextInput, EvaluateContextOutput, EvaluateContextOutputSchema } from "../domain/context";
import { BuildWeekInput, ProposedWeek, ProposedWeekSchema } from "../domain/week";

export interface RemoteAIProviderOptions {
  id: "groq" | "gemini" | "mock";
  baseUrl?: string;
  fetchFn?: typeof fetch;
}

export class RemoteAIProvider implements AIProvider {
  readonly id: "groq" | "gemini" | "mock";
  readonly model: string;
  private readonly baseUrl: string;
  private readonly fetchClient: typeof fetch;

  constructor(options: RemoteAIProviderOptions) {
    this.id = options.id;
    this.model = `remote-${options.id}-v1`;
    this.baseUrl = options.baseUrl || "/api/ai";
    this.fetchClient = options.fetchFn || (typeof fetch !== "undefined" ? fetch.bind(globalThis) : (undefined as unknown as typeof fetch));
  }

  private async callProxy<T>(action: string, payload: unknown, validator?: (data: unknown) => T): Promise<T> {
    if (!this.fetchClient) {
      throw new Error("No fetch client available for RemoteAIProvider.");
    }

    const response = await this.fetchClient(this.baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        provider: this.id,
        action,
        payload,
      }),
    });

    let json: { success?: boolean; data?: unknown; error?: string };
    try {
      json = (await response.json()) as { success?: boolean; data?: unknown; error?: string };
    } catch {
      throw new Error(`El servidor devolvió una respuesta no JSON (${response.status})`);
    }

    if (!response.ok || !json.success) {
      const errorMsg = json?.error || `Error en el servidor de IA (${response.status})`;
      throw new Error(errorMsg);
    }

    if (validator) {
      return validator(json.data);
    }
    return json.data as T;
  }

  async extractItems(input: ExtractItemsInput): Promise<ExtractedItems> {
    return this.callProxy("extract_items", input, (d) => ExtractedItemsSchema.parse(d));
  }

  async detectRelationships(input: DetectRelationshipsInput): Promise<DetectedRelationships> {
    return this.callProxy("detect_relationships", input, (d) => DetectedRelationshipsSchema.parse(d));
  }

  async groupWork(input: GroupWorkInput): Promise<GroupedWork> {
    return this.callProxy("group_work", input, (d) => GroupedWorkSchema.parse(d));
  }

  async detectDeadlines(input: DetectDeadlinesInput): Promise<DetectedDeadlines> {
    return this.callProxy("detect_deadlines", input, (d) => DetectedDeadlinesSchema.parse(d));
  }

  async evaluateContext(input: EvaluateContextInput): Promise<EvaluateContextOutput> {
    return this.callProxy("evaluate_context", input, (d) => EvaluateContextOutputSchema.parse(d));
  }

  async buildWeek(input: BuildWeekInput): Promise<ProposedWeek> {
    return this.callProxy("build_week", input, (d) => ProposedWeekSchema.parse(d));
  }

  async completeJson(
    _systemPrompt: string,
    _userPrompt: string,
    _options?: import("./ai-provider").CompletionOptions
  ): Promise<import("./ai-provider").CompletionResult> {
    return {
      rawText: "{}",
      meta: {
        provider: this.id,
        model: this.model,
        durationMs: 0,
      },
    };
  }
}
