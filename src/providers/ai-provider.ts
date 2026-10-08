import { ExtractItemsInput, ExtractedItems } from "../domain/items";
import { DetectRelationshipsInput, DetectedRelationships } from "../domain/relationships";
import { GroupWorkInput, GroupedWork } from "../domain/work-groups";

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

export interface AIProvider {
  readonly id: "groq" | "gemini" | "mock";
  readonly model: string;
  extractItems(input: ExtractItemsInput): Promise<ExtractedItems>;
  detectRelationships(input: DetectRelationshipsInput): Promise<DetectedRelationships>;
  groupWork(input: GroupWorkInput): Promise<GroupedWork>;
}
