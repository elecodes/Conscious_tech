import { ExtractItemsInput, ExtractedItems } from "../domain/items";
import { DetectRelationshipsInput, DetectedRelationships } from "../domain/relationships";
import { GroupWorkInput, GroupedWork } from "../domain/work-groups";
import { DetectDeadlinesInput, DetectedDeadlines } from "../domain/deadlines";
import { EvaluateContextInput, EvaluateContextOutput } from "../domain/context";
import { BuildWeekInput, ProposedWeek } from "../domain/week";

export interface ProviderExecutionMeta {
  provider: string;
  model: string;
  durationMs: number;
  tokensUsed?: {
    prompt?: number;
    completion?: number;
    total?: number;
  };
}

export interface CompletionOptions {
  temperature?: number;
  maxTokens?: number;
}

export interface CompletionResult {
  rawText: string;
  meta: ProviderExecutionMeta;
}

export interface AIProvider {
  readonly id: "groq" | "gemini" | "mock";
  readonly model: string;

  // Generic LLM completion method
  completeJson?(
    systemPrompt: string,
    userPrompt: string,
    options?: CompletionOptions
  ): Promise<CompletionResult>;

  // Semantic domain skills (01 - 06) with full provider parity
  extractItems(input: ExtractItemsInput): Promise<ExtractedItems>;
  detectRelationships(input: DetectRelationshipsInput): Promise<DetectedRelationships>;
  groupWork(input: GroupWorkInput): Promise<GroupedWork>;
  detectDeadlines(input: DetectDeadlinesInput): Promise<DetectedDeadlines>;
  evaluateContext(input: EvaluateContextInput): Promise<EvaluateContextOutput>;
  buildWeek(input: BuildWeekInput): Promise<ProposedWeek>;

  // Optional deprecated deterministic hook stubs
  analyzeChange?(
    input: import("../domain/change").AnalyzeChangeInput
  ): Promise<import("../domain/change").AnalyzeChangeOutput>;
  detectConflict?(
    input: import("../domain/conflict").DetectConflictInput
  ): Promise<import("../domain/conflict").DetectConflictOutput>;

  getLastExecutionMeta?(): ProviderExecutionMeta | undefined;
}
