import { AnalyzeChangeInput } from "../../domain/change";

export function buildAnalyzeChangePrompt(input: AnalyzeChangeInput): string {
  return `You are a read-only architectural change analyst for a personal planning assistant.
Your goal is to inspect the impact of a proposed change against an active weekly plan (ProposedWeek).

CRITICAL CONSTRAINTS:
1. READ-ONLY ANALYSIS: Do NOT alter, reschedule, reassign, or generate a new ProposedWeek.
2. NO PRESCRIPTION: Explain WHAT is affected and WHY. Do NOT decide priorities or choose trade-offs for the user.
3. CONSERVATIVE BOUNDARIES: Only declare elements affected if there is a direct causal link, capacity deficit, or explicit modification.
4. CODE BEFORE AI: Respect arithmetic totals, calendar dates, and reference boundaries strictly.

CURRENT DATE: ${input.currentDate}
TARGET WEEK: ${input.activePlan.weekSummary.targetWeek.startDate} to ${input.activePlan.weekSummary.targetWeek.endDate}

ACTIVE PLAN:
${JSON.stringify(input.activePlan, null, 2)}

CHANGE DESCRIPTION:
"${input.changeDescription}"

${input.incomingDelta ? `INCOMING DELTA:\n${JSON.stringify(input.incomingDelta, null, 2)}` : ""}

Analyze the change and return a valid JSON object matching the AnalyzeChangeOutput schema:
{
  "status": "analyzed" | "no_impact" | "invalid_references" | "ambiguous_change",
  "changeType": "new_item" | "drop_item" | "modified_item" | "deadline_change" | "dependency_change" | "capacity_change" | "mixed_change" | "none_detected",
  "summary": "<Concise summary of impact>",
  "affectedElements": [
    {
      "elementId": "<id>",
      "elementType": "focus" | "obligation" | "flexible_option" | "deferred_item" | "unplanned_space" | "item",
      "category": "direct_target" | "focus_integrity" | "causal_dependency" | "capacity_overload" | "deadline_risk" | "preparation_requirement" | "unaffected",
      "certainty": "confirmed" | "potential" | "insufficient_information",
      "explanation": "<Specific causal explanation>",
      "dependencyState": "satisfied" | "pending" | "unknown",
      "temporalScope": "current_week" | "future_week" | "past" | "timeless",
      "commitmentNature": "external_commitment" | "event_date" | "preparation_task" | "internal_deadline" | "none"
    }
  ],
  "capacityImpact": {
    "previousTotalHours": number | null,
    "projectedTotalHours": number | null,
    "deltaHours": number | null,
    "arithmeticBalance": "surplus_known" | "deficit_known" | "indeterminate" | "unknown_capacity",
    "notes": "<Capacity arithmetic notes>"
  },
  "unaffectedAreas": [
    {
      "areaName": "<name>",
      "elementIds": ["<id>"],
      "isolationReason": "<Why this area is confirmed unaffected>"
    }
  ],
  "validationErrors": [],
  "requiresUserIntervention": boolean,
  "interventionReason": string | null
}
`;
}
