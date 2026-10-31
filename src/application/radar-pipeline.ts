import { AIProvider } from "../providers/ai-provider";
import { ProposedWeek } from "../domain/week";
import { ExtractedItem } from "../domain/items";
import {
  AnalyzeChangeOutput,
  IncomingChangeDelta,
  ItemDeltaOperation,
  DeadlineDeltaOperation,
} from "../domain/change";
import { DetectConflictOutput, TimeBlock, DailyWorkAllocation } from "../domain/conflict";
import { AdjustmentProposal } from "../domain/adjustment";
import { extractItems } from "../skills/extract-items";
import { AnalyzeChangeService } from "../skills/analyze-change";
import { DetectConflictService } from "../skills/detect-conflict";
import { ProposeAdjustmentService } from "../skills/propose-adjustment";

export type RadarVerdictOutcome =
  | "no_change" // 🟢 No cambia la semana (idea, inquietud, reflexión)
  | "flexible_option" // 🟡 Puede entrar si hay espacio (opción flexible sin compromiso)
  | "fits_available_space" // 🟢 Cabe en el espacio disponible (cabe en el margen sin tocar focos)
  | "changes_balance"; // 🔴 Cambia el equilibrio (déficit de horas o conflicto; requiere decisión)

export interface EvaluateRadarParams {
  changeDescription: string;
  currentDate: string;
  activePlan: ProposedWeek;
  timeBlocks?: TimeBlock[];
  dailyAllocations?: DailyWorkAllocation[];
}

export interface RadarEvaluationResult {
  outcome: RadarVerdictOutcome;
  verdictTitle: string;
  verdictExplanation: string;
  extractedItems: ExtractedItem[];
  changeAnalysis: AnalyzeChangeOutput;
  conflictReport: DetectConflictOutput;
  adjustmentProposals?: AdjustmentProposal[];
  incomingDelta: IncomingChangeDelta;
}

/**
 * Evaluates an incoming change description against the active weekly plan
 * following the 4 canonical outcomes of Section 22 of PROJECT_CONTEXT.md.
 *
 * Immutability Guarantee: The active plan is never mutated or replaced.
 * Core Principle: "AI proposes. The person decides."
 */
export async function evaluateRadarInput(
  provider: AIProvider,
  params: EvaluateRadarParams
): Promise<RadarEvaluationResult> {
  const { changeDescription, currentDate, activePlan, timeBlocks, dailyAllocations } = params;
  const trimmedDescription = changeDescription.trim();

  // 1. Guard against empty / whitespace input
  if (!trimmedDescription) {
    const emptyAnalysis: AnalyzeChangeOutput = {
      status: "no_impact",
      changeType: "none_detected",
      summary: "Sin cambios detectados en la entrada.",
      affectedElements: [],
      capacityImpact: {
        previousTotalHours: activePlan.weekSummary.capacity.totalAvailableHours ?? null,
        projectedTotalHours: activePlan.weekSummary.capacity.totalAvailableHours ?? null,
        deltaHours: 0,
        arithmeticBalance: "surplus_known",
        notes: "Sin impacto en capacidad.",
      },
      unaffectedAreas: [],
      validationErrors: [],
      requiresUserIntervention: false,
      interventionReason: null,
    };

    const emptyConflictReport: DetectConflictOutput = {
      status: "no_conflicts",
      summary: "No se identificaron conflictos.",
      conflicts: [],
      unconflictedAreas: [],
      hasBlockingConflicts: false,
    };

    return {
      outcome: "no_change",
      verdictTitle: "🟢 No cambia la semana",
      verdictExplanation: "No se ingresó ninguna descripción de cambio para evaluar.",
      extractedItems: [],
      changeAnalysis: emptyAnalysis,
      conflictReport: emptyConflictReport,
      incomingDelta: {},
    };
  }

  // 2. Extract semantic items using Skill 01
  const extracted = await extractItems(provider, { text: trimmedDescription, currentDate });
  const items = extracted.items;

  // 3. Check for pure ideas / concerns (🟢 No cambia la semana)
  const isPureIdeaOrConcern =
    items.length > 0 && items.every((it) => it.type === "idea" || it.type === "concern");

  if (isPureIdeaOrConcern || items.length === 0) {
    const noImpactAnalysis: AnalyzeChangeOutput = {
      status: "no_impact",
      changeType: items.length > 0 ? "new_item" : "none_detected",
      summary: "La entrada corresponde a ideas o inquietudes que no alteran el compromiso semanal.",
      affectedElements: [],
      capacityImpact: {
        previousTotalHours: activePlan.weekSummary.capacity.totalAvailableHours ?? null,
        projectedTotalHours: activePlan.weekSummary.capacity.totalAvailableHours ?? null,
        deltaHours: 0,
        arithmeticBalance: "surplus_known",
        notes: "Ideas e inquietudes no consumen horas plannables de la semana.",
      },
      unaffectedAreas: [],
      validationErrors: [],
      requiresUserIntervention: false,
      interventionReason: null,
    };

    const noConflictsReport: DetectConflictOutput = {
      status: "no_conflicts",
      summary: "Sin conflictos detectados en la semana.",
      conflicts: [],
      unconflictedAreas: [],
      hasBlockingConflicts: false,
    };

    return {
      outcome: "no_change",
      verdictTitle: "🟢 No cambia la semana",
      verdictExplanation:
        "Esto representa una idea o inquietud. No necesita interrumpir tu semana; puedes guardarla como idea o nota sin tocar tu planificación.",
      extractedItems: items,
      changeAnalysis: noImpactAnalysis,
      conflictReport: noConflictsReport,
      incomingDelta: {
        itemOperations: items.map((it): ItemDeltaOperation => ({ op: "add", item: it })),
      },
    };
  }

  // 4. Check for flexible / optional items (🟡 Puede entrar si hay espacio)
  const isExplicitlyFlexible =
    /\b(si\s+(?:me\s+da|tengo|queda)\s+tiempo|opcional(?:mente)?|cuando\s+pueda)\b/i.test(
      trimmedDescription
    ) ||
    items.every(
      (it) =>
        it.type === "task" &&
        it.commitment === "none" &&
        (!it.deadline || !it.deadline.resolved) &&
        (!it.estimatedEffort || it.estimatedEffort.value <= 2)
    );

  // 5. Construct IncomingChangeDelta
  const itemOperations: ItemDeltaOperation[] = items.map((it) => ({
    op: "add",
    item: it,
  }));

  const deadlineOperations: DeadlineDeltaOperation[] = items
    .filter((it) => it.deadline?.resolved)
    .map((it) => ({
      itemId: it.id,
      newDueDate: it.deadline!.resolved!,
    }));

  const incomingDelta: IncomingChangeDelta = {
    itemOperations,
    deadlineOperations: deadlineOperations.length > 0 ? deadlineOperations : undefined,
  };

  // 6. Run Skill 07: Analyze Change
  const changeService = new AnalyzeChangeService(provider);
  const changeAnalysis = await changeService.analyze({
    currentDate,
    activePlan,
    changeDescription: trimmedDescription,
    incomingDelta,
  });

  // 7. Run Skill 08: Detect Conflict
  const conflictService = new DetectConflictService();
  const conflictReport = await conflictService.detect({
    currentDate,
    activePlan,
    changeAnalysis,
    items,
    timeBlocks,
    dailyAllocations,
  });

  // 8. Classify Outcome based on Section 22
  const hasDeficit = changeAnalysis.capacityImpact.arithmeticBalance === "deficit_known";
  const hasBlocking = conflictReport.hasBlockingConflicts;

  if (hasDeficit || hasBlocking) {
    // 🔴 Cambia el equilibrio -> propose adjustments
    const adjustmentService = new ProposeAdjustmentService();
    const adjustmentResult = await adjustmentService.propose({
      activePlan,
      conflictReport,
      changeAnalysis,
      timeBlocks,
      dailyAllocations,
    });

    return {
      outcome: "changes_balance",
      verdictTitle: "🔴 Cambia el equilibrio",
      verdictExplanation:
        "La nueva actividad no cabe en el margen disponible o genera un conflicto directo. La IA te propone alternativas, pero tú decides qué trade-off quieres realizar.",
      extractedItems: items,
      changeAnalysis,
      conflictReport,
      adjustmentProposals: adjustmentResult.proposals,
      incomingDelta,
    };
  }

  if (isExplicitlyFlexible) {
    // 🟡 Puede entrar si hay espacio
    return {
      outcome: "flexible_option",
      verdictTitle: "🟡 Puede entrar si hay espacio",
      verdictExplanation:
        "Es una tarea opcional que no compromete plazos fijos ni compromisos externos. Puedes incorporarla a tus opciones flexibles si te queda resto.",
      extractedItems: items,
      changeAnalysis,
      conflictReport,
      incomingDelta,
    };
  }

  // 🟢 Cabe en el espacio disponible
  return {
    outcome: "fits_available_space",
    verdictTitle: "🟢 Cabe en el espacio disponible",
    verdictExplanation:
      "Tienes suficiente margen en tu semana para incorporar esta tarea sin comprometer tus focos principales ni el espacio protegido.",
    extractedItems: items,
    changeAnalysis,
    conflictReport,
    incomingDelta,
  };
}
