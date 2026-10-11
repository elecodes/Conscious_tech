import { AIProvider } from "../../providers/ai-provider";
import {
  AnalyzeChangeInput,
  AnalyzeChangeInputSchema,
  AnalyzeChangeOutput,
} from "../../domain/change";
import { analyzeChangeDeterministically } from "./deterministic";

export class AnalyzeChangeService {
  constructor(private readonly provider: AIProvider) {}

  async analyze(input: AnalyzeChangeInput): Promise<AnalyzeChangeOutput> {
    const validatedInput = AnalyzeChangeInputSchema.parse(input);

    // If incomingDelta is present, run deterministic baseline
    if (validatedInput.incomingDelta) {
      return analyzeChangeDeterministically(validatedInput);
    }

    // If provider supports analyzeChange natively (e.g. LLM interpreting natural language change)
    if (this.provider.analyzeChange) {
      return this.provider.analyzeChange(validatedInput);
    }

    // Default to deterministic fallback
    return analyzeChangeDeterministically(validatedInput);
  }
}
