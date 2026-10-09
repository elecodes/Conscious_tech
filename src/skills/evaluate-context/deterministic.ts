import {
  EvaluateContextInput,
  EvaluateContextOutput,
  ItemContextAssessment,
  GroupContextAssessment,
  OpenQuestion,
  ContextSignal,
  ContextAttentionLevel,
} from "../../domain/context";

/**
 * Deterministically verifies and guarantees all invariants defined in ADR 0005:
 * 1. 1:1 Item coverage: Every input item appears exactly once in itemAssessments.
 * 2. 1:1 Group coverage: Every group in input.groupedWork.groups appears exactly once in groupAssessments.
 * 3. Phantom ID purging: No item or group IDs not present in input.
 * 4. OpenQuestion integrity: All relatedItemIds must exist in input items.
 * 5. Signal deduplication and validity.
 */
export function cleanAndValidateContextOutput(
  rawOutput: EvaluateContextOutput,
  input: EvaluateContextInput
): EvaluateContextOutput {
  const validItemIds = new Set(input.items.map((i) => i.id));
  const validGroupIds = new Set(input.groupedWork.groups.map((g) => g.id));

  // Identify item IDs with an explicit valid depends_on relationship
  const itemsWithDependsOn = new Set<string>();
  for (const rel of input.relationships) {
    if (
      rel.type === "depends_on" &&
      validItemIds.has(rel.sourceItemId) &&
      validItemIds.has(rel.targetItemId)
    ) {
      itemsWithDependsOn.add(rel.sourceItemId);
      itemsWithDependsOn.add(rel.targetItemId);
    }
  }

  // 1. Clean item assessments
  const seenItemIds = new Set<string>();
  const cleanedItemAssessments: ItemContextAssessment[] = [];

  for (const assessment of rawOutput.itemAssessments) {
    if (!validItemIds.has(assessment.itemId)) {
      continue; // drop phantom items
    }
    if (seenItemIds.has(assessment.itemId)) {
      continue; // drop duplicates
    }
    seenItemIds.add(assessment.itemId);

    // Deduplicate and filter signals
    const uniqueSignals = Array.from(new Set(assessment.signals)) as ContextSignal[];
    const filteredSignals = uniqueSignals.filter((signal) => {
      if (signal === "dependency") {
        return itemsWithDependsOn.has(assessment.itemId);
      }
      return true;
    });

    cleanedItemAssessments.push({
      itemId: assessment.itemId,
      attention: assessment.attention,
      signals: filteredSignals,
      rationale: assessment.rationale.trim() || "Evaluación contextual.",
    });
  }

  // Ensure 100% item coverage (conservation)
  for (const item of input.items) {
    if (!seenItemIds.has(item.id)) {
      cleanedItemAssessments.push(createDefaultItemAssessment(item, input));
    }
  }

  // 2. Clean group assessments
  const seenGroupIds = new Set<string>();
  const cleanedGroupAssessments: GroupContextAssessment[] = [];

  for (const assessment of rawOutput.groupAssessments) {
    if (!validGroupIds.has(assessment.groupId)) {
      continue; // drop phantom groups
    }
    if (seenGroupIds.has(assessment.groupId)) {
      continue; // drop duplicates
    }
    seenGroupIds.add(assessment.groupId);

    cleanedGroupAssessments.push({
      groupId: assessment.groupId,
      relevance: assessment.relevance,
      rationale: assessment.rationale.trim() || "Evaluación de línea de atención.",
    });
  }

  // Ensure 100% group coverage (conservation)
  for (const group of input.groupedWork.groups) {
    if (!seenGroupIds.has(group.id)) {
      cleanedGroupAssessments.push({
        groupId: group.id,
        relevance: "medium",
        rationale: group.rationale || "Línea de trabajo coherente.",
      });
    }
  }

  // 3. Clean open questions
  const cleanedQuestions: OpenQuestion[] = [];
  for (const q of rawOutput.openQuestions) {
    const validRelated = q.relatedItemIds.filter((id) => validItemIds.has(id));
    if (!q.question.trim() || !q.topic.trim()) {
      continue;
    }
    cleanedQuestions.push({
      topic: q.topic.trim(),
      question: q.question.trim(),
      relatedItemIds: validRelated,
      reason: q.reason.trim() || "Incertidumbre relevante identificada.",
    });
  }

  return {
    itemAssessments: cleanedItemAssessments,
    groupAssessments: cleanedGroupAssessments,
    openQuestions: cleanedQuestions,
  };
}

/**
 * Creates a deterministic default assessment if an item was omitted by LLM output.
 */
function createDefaultItemAssessment(
  item: EvaluateContextInput["items"][0],
  input: EvaluateContextInput
): ItemContextAssessment {
  const signals: ContextSignal[] = [];
  let attention: ContextAttentionLevel = "medium";
  let rationale = `Evaluación de contexto para "${item.title}".`;

  if (item.status === "archived") {
    attention = "low";
    rationale = `Elemento archivado conscientemente ("${item.title}"); no requiere atención activa.`;
    return {
      itemId: item.id,
      attention,
      signals,
      rationale,
    };
  }

  if (item.commitment === "external") {
    signals.push("external_commitment");
    attention = "high";
  }
  if (item.status === "started") {
    signals.push("already_started");
  }
  if (item.importance === "high") {
    signals.push("explicit_importance");
    attention = "high";
  }

  // Check deadline
  const deadline = input.deadlines.deadlines.find((d) => d.itemId === item.id);
  if (deadline) {
    const targetDate = deadline.resolvedEnd || deadline.resolvedStart;
    if (targetDate) {
      if (targetDate < input.currentDate) {
        signals.push("overdue_deadline");
        attention = "high";
      } else {
        const diffDays = getDayDifference(input.currentDate, targetDate);
        if (diffDays <= 7) {
          signals.push("approaching_deadline");
          // If the item is expressly optional/exploring ("si tengo un rato", "si me da tiempo"), keep LOW
          if (item.type !== "idea" && item.status !== "exploring") {
            attention = "high";
          }
        }
      }
    }
  }

  // Check dependencies: only causal "depends_on" between valid items implies dependency signal
  const validItemIds = new Set(input.items.map((i) => i.id));
  const isSourceOfDepends = input.relationships.some(
    (r) =>
      r.sourceItemId === item.id &&
      r.type === "depends_on" &&
      validItemIds.has(r.targetItemId)
  );
  const isTargetOfDepends = input.relationships.some(
    (r) =>
      r.targetItemId === item.id &&
      r.type === "depends_on" &&
      validItemIds.has(r.sourceItemId)
  );

  if (isSourceOfDepends || isTargetOfDepends) {
    signals.push("dependency");
  }

  // Check if item is waiting/blocked by third party (not the concern itself)
  const isBlockedByConcern = input.relationships.some((r) => {
    if (r.sourceItemId === item.id && r.type === "depends_on") {
      const targetItem = input.items.find((i) => i.id === r.targetItemId);
      return targetItem && targetItem.type === "concern";
    }
    return false;
  });

  const rawLower = item.rawText.toLowerCase();
  if (
    item.type !== "concern" &&
    (isBlockedByConcern ||
      rawLower.includes("frenada") ||
      rawLower.includes("frenado"))
  ) {
    signals.push("waiting");
  }

  if (item.type === "idea" || item.status === "exploring") {
    attention = "low";
    rationale = `Actividad exploratoria o contingente ("${item.title}") sin presión explícita.`;
  }

  return {
    itemId: item.id,
    attention,
    signals,
    rationale,
  };
}

export function getDayDifference(isoFrom: string, isoTo: string): number {
  const dFrom = new Date(`${isoFrom}T00:00:00Z`).getTime();
  const dTo = new Date(`${isoTo}T00:00:00Z`).getTime();
  return Math.round((dTo - dFrom) / (1000 * 60 * 60 * 24));
}

/**
 * Validates output invariants for test assertions and eval audits.
 */
export function validateContextInvariants(
  output: EvaluateContextOutput,
  input: EvaluateContextInput
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  const inputItemIds = new Set(input.items.map((i) => i.id));
  const inputGroupIds = new Set(input.groupedWork.groups.map((g) => g.id));

  // 1. Item coverage & uniqueness
  const assessedItemIds = new Set<string>();
  for (const ia of output.itemAssessments) {
    if (!inputItemIds.has(ia.itemId)) {
      errors.push(`Phantom itemId in itemAssessments: ${ia.itemId}`);
    }
    if (assessedItemIds.has(ia.itemId)) {
      errors.push(`Duplicate assessment for itemId: ${ia.itemId}`);
    }
    assessedItemIds.add(ia.itemId);
  }

  for (const item of input.items) {
    if (!assessedItemIds.has(item.id)) {
      errors.push(`Missing assessment for input item: ${item.id}`);
    }
  }

  // 2. Group coverage & uniqueness
  const assessedGroupIds = new Set<string>();
  for (const ga of output.groupAssessments) {
    if (!inputGroupIds.has(ga.groupId)) {
      errors.push(`Phantom groupId in groupAssessments: ${ga.groupId}`);
    }
    if (assessedGroupIds.has(ga.groupId)) {
      errors.push(`Duplicate assessment for groupId: ${ga.groupId}`);
    }
    assessedGroupIds.add(ga.groupId);
  }

  for (const group of input.groupedWork.groups) {
    if (!assessedGroupIds.has(group.id)) {
      errors.push(`Missing assessment for input group: ${group.id}`);
    }
  }

  // 3. Question references
  for (const q of output.openQuestions) {
    for (const relId of q.relatedItemIds) {
      if (!inputItemIds.has(relId)) {
        errors.push(`Open question refers to phantom itemId: ${relId}`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
