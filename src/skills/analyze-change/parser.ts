import { AnalyzeChangeOutput, AnalyzeChangeOutputSchema } from "../../domain/change";

export function parseAnalyzeChangeOutput(raw: string): AnalyzeChangeOutput {
  let cleaned = raw.trim();

  // Strip markdown code fences if present
  if (cleaned.startsWith("```")) {
    const lines = cleaned.split("\n");
    if (lines[0].startsWith("```")) {
      lines.shift();
    }
    if (lines.length > 0 && lines[lines.length - 1].startsWith("```")) {
      lines.pop();
    }
    cleaned = lines.join("\n").trim();
  }

  const parsed = JSON.parse(cleaned);
  return AnalyzeChangeOutputSchema.parse(parsed);
}
