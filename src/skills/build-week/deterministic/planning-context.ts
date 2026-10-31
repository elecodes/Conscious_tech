import {
  TargetWeek,
  WeeklyCapacitySummary,
  BuildWeekInput,
  ExtractedItem,
  Relationship,
  WorkGroup,
  ItemContextAssessment,
  GroupContextAssessment,
  DetectedDeadline,
} from "../../../domain/week";
import {
  resolveTargetWeek,
  calculateWeeklyCapacity,
  extractItemHours,
  isDateInTargetWeek,
} from "./capacity-math";
import { assertValidBuildWeekInput } from "./input-validation";

export interface ExternalCommitmentConstraint {
  itemId: string;
  title: string;
  rationale: string;
  estimatedHours: number | null;
  deadlineDate?: string;
}

export interface StrictDeadlineConstraint {
  itemId: string;
  title: string;
  dueDate: string;
  kind: string;
  confidence: string;
  estimatedHours: number | null;
}

export interface OptionalItemConstraint {
  itemId: string;
  title: string;
  reason: string;
  estimatedHours: number | null;
}

export interface ArchivedItemConstraint {
  itemId: string;
  title: string;
  reason: string;
}

export interface BlockedItemConstraint {
  itemId: string;
  title: string;
  blockedByItemIds: string[];
  reasons: string[];
}

export interface WeekConstraints {
  targetWeek: TargetWeek;
  externalCommitments: ExternalCommitmentConstraint[];
  strictDeadlinesInWeek: StrictDeadlineConstraint[];
  optionalItems: OptionalItemConstraint[];
  archivedItems: ArchivedItemConstraint[];
  blockedItems: BlockedItemConstraint[];
  unblockingActionLimitations: string[];
}

/**
 * Prepares deterministic constraints for weekly planning based on inputs from skills 01-05.
 */
export function prepareWeekConstraints(
  input: BuildWeekInput,
  targetWeek: TargetWeek
): WeekConstraints {
  const itemMap = new Map<string, ExtractedItem>(input.items.map((i) => [i.id, i]));
  const assessmentMap = new Map(input.context.itemAssessments.map((a) => [a.itemId, a]));

  const externalCommitments: ExternalCommitmentConstraint[] = [];
  const strictDeadlinesInWeek: StrictDeadlineConstraint[] = [];
  const optionalItems: OptionalItemConstraint[] = [];
  const archivedItems: ArchivedItemConstraint[] = [];
  const blockedItemsMap = new Map<string, { blockedByItemIds: string[]; reasons: string[] }>();

  // 1. Categorize items by status and type
  for (const item of input.items) {
    const hours = extractItemHours(item);
    const assessment = assessmentMap.get(item.id);

    // Archived items
    if (item.status === "archived") {
      archivedItems.push({
        itemId: item.id,
        title: item.title,
        reason: "Item archivado conscientemente por el usuario.",
      });
      continue; // Archived items do not enter active week constraints
    }

    // Optional items (ideas or low attention exploratory items without external commitment)
    const isExplicitIdea = item.type === "idea";
    const isExternal =
      item.commitment === "external" ||
      (item.type === "commitment" && item.commitment !== "personal") ||
      Boolean(assessment?.signals.includes("external_commitment"));

    if (isExplicitIdea) {
      optionalItems.push({
        itemId: item.id,
        title: item.title,
        reason: "Idea u oportunidad exploratoria; no impone presión ni obligación.",
        estimatedHours: hours,
      });
    } else if (isExternal) {
      const matchingDl = input.deadlines.deadlines.find((d) => d.itemId === item.id);
      let deadlineDate = matchingDl
        ? (matchingDl.resolvedStart ?? matchingDl.resolvedEnd ?? undefined)
        : undefined;

      const textToSearch =
        `${item.title} ${matchingDl?.raw || ""} ${item.rawText || ""}`.toLowerCase();
      const dayMatch = textToSearch.match(
        /\b(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)\b/i
      );
      if (dayMatch && targetWeek) {
        const dayMap: Record<string, number> = {
          lunes: 0,
          martes: 1,
          miercoles: 2,
          miércoles: 2,
          jueves: 3,
          viernes: 4,
          sabado: 5,
          sábado: 5,
          domingo: 6,
        };
        const dayIdx = dayMap[dayMatch[1]!.toLowerCase()];
        if (dayIdx !== undefined) {
          const [sy, sm, sd] = targetWeek.startDate.split("-").map(Number);
          const targetDay = new Date(Date.UTC(sy!, sm! - 1, sd! + dayIdx));
          const ry = targetDay.getUTCFullYear();
          const rm = String(targetDay.getUTCMonth() + 1).padStart(2, "0");
          const rd = String(targetDay.getUTCDate()).padStart(2, "0");
          deadlineDate = `${ry}-${rm}-${rd}`;
        }
      }

      externalCommitments.push({
        itemId: item.id,
        title: item.title,
        rationale:
          assessment?.rationale ||
          (item.commitment === "external"
            ? "Compromiso externo asumido con terceros."
            : "Compromiso identificado en contexto."),
        estimatedHours: hours,
        deadlineDate,
      });
    }
  }

  // 2. Deadlines falling strictly inside target week
  for (const dl of input.deadlines.deadlines) {
    const item = itemMap.get(dl.itemId);
    if (!item || item.status === "archived" || item.type === "idea") {
      continue;
    }

    const startInWeek = isDateInTargetWeek(dl.resolvedStart, targetWeek);
    const endInWeek = isDateInTargetWeek(dl.resolvedEnd, targetWeek);

    if (startInWeek || endInWeek) {
      const dueDate = (startInWeek ? dl.resolvedStart : dl.resolvedEnd) ?? targetWeek.endDate;
      const hours = extractItemHours(item);

      if (
        (dl.confidence === "high" || dl.confidence === "medium") &&
        (dl.kind === "exact_date" || dl.kind === "relative_date" || dl.kind === "date_range")
      ) {
        strictDeadlinesInWeek.push({
          itemId: dl.itemId,
          title: item.title,
          dueDate,
          kind: dl.kind,
          confidence: dl.confidence,
          estimatedHours: hours,
        });
      }
    }
  }

  // 3. Explicit dependencies: ONLY `depends_on` (sourceItemId depends on targetItemId)
  for (const rel of input.relationships) {
    if (rel.type !== "depends_on") {
      continue;
    }

    const sourceItem = itemMap.get(rel.sourceItemId);
    const targetItem = itemMap.get(rel.targetItemId);

    if (!sourceItem || !targetItem) continue;
    if (sourceItem.status === "archived") continue;

    if (!blockedItemsMap.has(rel.sourceItemId)) {
      blockedItemsMap.set(rel.sourceItemId, {
        blockedByItemIds: [],
        reasons: [],
      });
    }

    const record = blockedItemsMap.get(rel.sourceItemId)!;
    record.blockedByItemIds.push(rel.targetItemId);
    record.reasons.push(rel.reason || `Depende de "${targetItem.title}"`);
  }

  const blockedItems: BlockedItemConstraint[] = [];
  for (const [itemId, data] of blockedItemsMap.entries()) {
    const item = itemMap.get(itemId);
    if (item) {
      blockedItems.push({
        itemId,
        title: item.title,
        blockedByItemIds: data.blockedByItemIds,
        reasons: data.reasons,
      });
    }
  }

  const unblockingActionLimitations = [
    "El modelo de dominio actual (Skills 01-05) no dispone de un campo explícito para 'acción de desbloqueo' en ExtractedItem ni en Relationship.",
    "Para los elementos bloqueados por dependencias externas, la existencia de acciones ejecutables de desbloqueo no puede inferirse determinísticamente y se mantiene como incertidumbre para confirmación del usuario.",
  ];

  return {
    targetWeek,
    externalCommitments,
    strictDeadlinesInWeek,
    optionalItems,
    archivedItems,
    blockedItems,
    unblockingActionLimitations,
  };
}

export interface DeterministicPlanningContext {
  targetWeek: TargetWeek;
  userIntent?: string;
  validItems: ExtractedItem[];
  validItemIds: string[];
  relevantRelationships: Relationship[];
  workGroups: WorkGroup[];
  itemAssessments: ItemContextAssessment[];
  groupAssessments: GroupContextAssessment[];
  relevantDeadlines: DetectedDeadline[];
  constraints: WeekConstraints;
  capacitySummary: WeeklyCapacitySummary;
  unresolvedUncertainties: string[];
}

/**
 * Builds a normalized, deterministic planning context for the downstream AI planning step.
 */
export function buildDeterministicPlanningContext(
  input: BuildWeekInput
): DeterministicPlanningContext {
  assertValidBuildWeekInput(input);

  const targetWeek = resolveTargetWeek(input.currentDate, input.targetWeek);
  const constraints = prepareWeekConstraints(input, targetWeek);
  const capacitySummary = calculateWeeklyCapacity({
    capacityConfig: input.capacity,
  });

  const unresolvedUncertainties: string[] = [];

  // Capacity uncertainty
  if (input.capacity?.totalAvailableHours == null) {
    unresolvedUncertainties.push(
      "Capacidad total no declarada por el usuario (totalAvailableHours: null); la viabilidad temporal del plan no puede ser garantizada."
    );
  }

  // Effort estimation uncertainty
  const itemsWithoutHours = input.items.filter(
    (i) => i.status !== "archived" && extractItemHours(i) === null
  );
  if (itemsWithoutHours.length > 0) {
    unresolvedUncertainties.push(
      `Existen ${itemsWithoutHours.length} elementos sin estimación horaria explícita; la completitud de estimación es parcial o nula.`
    );
  }

  // Dependency unblocking action uncertainty
  if (constraints.blockedItems.length > 0) {
    unresolvedUncertainties.push(
      `Existen ${constraints.blockedItems.length} elementos bloqueados por dependencias externas; el modelo actual no identifica acciones deterministas de desbloqueo.`
    );
  }

  // Open questions from context
  if (input.context.openQuestions.length > 0) {
    unresolvedUncertainties.push(
      `Existen ${input.context.openQuestions.length} preguntas abiertas contextuales sin responder.`
    );
  }

  // Relevant deadlines (those in the target week)
  const relevantDeadlines = input.deadlines.deadlines.filter((dl) => {
    return (
      isDateInTargetWeek(dl.resolvedStart, targetWeek) ||
      isDateInTargetWeek(dl.resolvedEnd, targetWeek)
    );
  });

  return {
    targetWeek,
    userIntent: input.userIntent,
    validItems: input.items,
    validItemIds: input.items.map((i) => i.id),
    relevantRelationships: input.relationships,
    workGroups: input.groupedWork.groups,
    itemAssessments: input.context.itemAssessments,
    groupAssessments: input.context.groupAssessments,
    relevantDeadlines,
    constraints,
    capacitySummary,
    unresolvedUncertainties,
  };
}
