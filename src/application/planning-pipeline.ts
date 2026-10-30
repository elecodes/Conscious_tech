import { AIProvider } from "../providers/ai-provider";
import { ExtractedItem } from "../domain/items";
import { Relationship } from "../domain/relationships";
import { GroupedWork } from "../domain/work-groups";
import { DetectedDeadlines } from "../domain/deadlines";
import { EvaluateContextOutput } from "../domain/context";
import {
  BuildWeekInput,
  ProposedWeek,
  resolveDefaultTargetWeek,
  createEmptyProposedWeek,
} from "../domain/week";
import { detectRelationships } from "../skills/detect-relationships";
import { groupWork } from "../skills/group-work";
import { detectDeadlines } from "../skills/detect-deadlines";
import { evaluateContext } from "../skills/evaluate-context";
import { buildWeek } from "../skills/build-week";

import { TargetWeek } from "../domain/week";

export interface GenerateWeeklyPlanFromItemsParams {
  items: ExtractedItem[];
  currentDate: string;
  targetWeek?: TargetWeek;
  userIntent?: string;
  totalAvailableHours?: number;
  minProtectedSpaceRatio?: number;
}

export type PipelineStage =
  "detect_relationships" | "group_work" | "detect_deadlines" | "evaluate_context";

export interface PipelineDiagnostic {
  stage: PipelineStage;
  status: "success" | "fallback_used";
  fallbackRationale?: string;
  sanitizedError?: string;
}

export interface PreparedPlanningInputResult {
  input: BuildWeekInput;
  diagnostics: PipelineDiagnostic[];
  hasWarnings: boolean;
}

export interface GenerateWeeklyPlanResult {
  proposal: ProposedWeek;
  diagnostics: PipelineDiagnostic[];
  hasWarnings: boolean;
}

function sanitizePipelineError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg
    .replace(/gsk_[A-Za-z0-9_-]+/g, "[REDACTED]")
    .replace(/AIza[A-Za-z0-9_-]+/g, "[REDACTED]")
    .slice(0, 150);
}

/**
 * Prepares a normalized, deterministic BuildWeekInput from a list of accepted items
 * with full structured diagnostics of any fallbacks used.
 */
export async function prepareBuildWeekInputDetailed(
  provider: AIProvider,
  params: GenerateWeeklyPlanFromItemsParams
): Promise<PreparedPlanningInputResult> {
  const {
    items,
    currentDate,
    targetWeek: explicitTargetWeek,
    userIntent,
    totalAvailableHours,
    minProtectedSpaceRatio,
  } = params;

  const targetWeek = explicitTargetWeek ?? resolveDefaultTargetWeek(currentDate);
  const diagnostics: PipelineDiagnostic[] = [];

  if (items.length === 0) {
    return {
      input: {
        currentDate,
        targetWeek,
        userIntent,
        items: [],
        relationships: [],
        groupedWork: { groups: [], ungroupedItemIds: [] },
        deadlines: { deadlines: [] },
        context: { itemAssessments: [], groupAssessments: [], openQuestions: [] },
        capacity:
          totalAvailableHours !== undefined
            ? {
                totalAvailableHours,
                minProtectedSpaceRatio: minProtectedSpaceRatio ?? 0.25,
              }
            : undefined,
      },
      diagnostics: [],
      hasWarnings: false,
    };
  }

  // 1. Detect relationships
  let relationships: Relationship[] = [];
  try {
    const relResult = await detectRelationships(provider, { items });
    relationships = relResult.relationships || [];
    diagnostics.push({ stage: "detect_relationships", status: "success" });
  } catch (err) {
    relationships = [];
    diagnostics.push({
      stage: "detect_relationships",
      status: "fallback_used",
      fallbackRationale: "Lista vacía de relaciones (elementos tratados como independientes)",
      sanitizedError: sanitizePipelineError(err),
    });
  }

  // 2. Group work
  let groupedWork: GroupedWork = {
    groups: [],
    ungroupedItemIds: items.map((i) => i.id),
  };
  try {
    groupedWork = await groupWork(provider, { items, relationships });
    diagnostics.push({ stage: "group_work", status: "success" });
  } catch (err) {
    groupedWork = {
      groups: [],
      ungroupedItemIds: items.map((i) => i.id),
    };
    diagnostics.push({
      stage: "group_work",
      status: "fallback_used",
      fallbackRationale:
        "Sin agrupamiento temático (todos los elementos asignados individualmente)",
      sanitizedError: sanitizePipelineError(err),
    });
  }

  // 3. Detect deadlines
  let deadlines: DetectedDeadlines = { deadlines: [] };
  try {
    deadlines = await detectDeadlines(provider, { items, currentDate });
    diagnostics.push({ stage: "detect_deadlines", status: "success" });
  } catch (err) {
    deadlines = { deadlines: [] };
    diagnostics.push({
      stage: "detect_deadlines",
      status: "fallback_used",
      fallbackRationale: "Sin inferencia automática de fechas límite",
      sanitizedError: sanitizePipelineError(err),
    });
  }

  // 4. Evaluate context
  let context: EvaluateContextOutput = {
    itemAssessments: [],
    groupAssessments: [],
    openQuestions: [],
  };
  try {
    context = await evaluateContext(provider, {
      items,
      relationships,
      groupedWork,
      deadlines,
      currentDate,
    });
    diagnostics.push({ stage: "evaluate_context", status: "success" });
  } catch (err) {
    context = {
      itemAssessments: items.map((item) => ({
        itemId: item.id,
        attention: "medium" as const,
        signals: [],
        rationale: "Elemento incluido por confirmación directa del usuario.",
      })),
      groupAssessments: [],
      openQuestions: [],
    };
    diagnostics.push({
      stage: "evaluate_context",
      status: "fallback_used",
      fallbackRationale: "Evaluación contextual predeterminada como clara y lista",
      sanitizedError: sanitizePipelineError(err),
    });
  }

  const hasWarnings = diagnostics.some((d) => d.status === "fallback_used");

  return {
    input: {
      currentDate,
      targetWeek,
      userIntent,
      items,
      relationships,
      groupedWork,
      deadlines,
      context,
      capacity:
        totalAvailableHours !== undefined
          ? {
              totalAvailableHours,
              minProtectedSpaceRatio: minProtectedSpaceRatio ?? 0.25,
            }
          : undefined,
    },
    diagnostics,
    hasWarnings,
  };
}

/**
 * Backward-compatible helper returning BuildWeekInput directly.
 */
export async function prepareBuildWeekInput(
  provider: AIProvider,
  params: GenerateWeeklyPlanFromItemsParams
): Promise<BuildWeekInput> {
  const result = await prepareBuildWeekInputDetailed(provider, params);
  return result.input;
}

/**
 * High-level pipeline function with detailed structured diagnostics.
 */
export async function generateWeeklyProposalFromItemsDetailed(
  provider: AIProvider,
  params: GenerateWeeklyPlanFromItemsParams
): Promise<GenerateWeeklyPlanResult> {
  const { items, currentDate, targetWeek: explicitTargetWeek } = params;

  if (items.length === 0) {
    const targetWeek = explicitTargetWeek ?? resolveDefaultTargetWeek(currentDate);
    return {
      proposal: createEmptyProposedWeek(currentDate, targetWeek),
      diagnostics: [],
      hasWarnings: false,
    };
  }

  const detailedInput = await prepareBuildWeekInputDetailed(provider, params);
  const proposal = await buildWeek(provider, detailedInput.input);

  return {
    proposal,
    diagnostics: detailedInput.diagnostics,
    hasWarnings: detailedInput.hasWarnings,
  };
}

/**
 * High-level pipeline function that coordinates turning accepted items
 * into a structured ProposedWeek proposal.
 */
export async function generateWeeklyProposalFromItems(
  provider: AIProvider,
  params: GenerateWeeklyPlanFromItemsParams
): Promise<ProposedWeek> {
  const result = await generateWeeklyProposalFromItemsDetailed(provider, params);
  return result.proposal;
}
