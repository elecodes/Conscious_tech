import {
  isValidCalendarDate,
  resolveDefaultTargetWeek,
  TargetWeek,
  TargetWeekSchema,
  WeeklyCapacityConfig,
  WeeklyCapacitySummary,
  EstimationCompleteness,
  BuildWeekInput,
  ProposedWeek,
  WeeklyFocus,
  WeeklyObligation,
  DeferredItem,
  WeekInvariantValidationResult,
  validateProposedWeekInvariants,
  ExtractedItem,
  Relationship,
  WorkGroup,
  ItemContextAssessment,
  GroupContextAssessment,
  DetectedDeadline,
} from "../../domain/week";

// ============================================================================
// 1. Error Types
// ============================================================================

export class WeekValidationError extends Error {
  public issues: unknown[];

  constructor(message: string, issues: unknown[] = []) {
    super(message);
    this.name = "WeekValidationError";
    this.issues = issues;
  }
}

// ============================================================================
// 2. Target Week Resolution
// ============================================================================

/**
 * Pure function to resolve the target planning week.
 *
 * Rules:
 * - If targetWeek is provided, validates that startDate <= endDate and both are real calendar dates.
 * - If targetWeek is omitted, calculates the following natural calendar week (Monday to Sunday)
 *   calculated deterministically from currentDate using UTC.
 * - Does not depend on the system clock.
 */
export function resolveTargetWeek(
  currentDate: string,
  targetWeek?: TargetWeek
): TargetWeek {
  if (!isValidCalendarDate(currentDate)) {
    throw new WeekValidationError(
      `Invalid currentDate: "${currentDate}". Must be a valid ISO YYYY-MM-DD date.`
    );
  }

  if (targetWeek) {
    const parseResult = TargetWeekSchema.safeParse(targetWeek);
    if (!parseResult.success) {
      throw new WeekValidationError(
        `Invalid targetWeek: startDate must be <= endDate and both must be real ISO calendar dates.`,
        parseResult.error.issues
      );
    }
    return parseResult.data;
  }

  return resolveDefaultTargetWeek(currentDate);
}

// ============================================================================
// 3. Constraints Preparation
// ============================================================================

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

function extractItemHours(item: ExtractedItem): number | null {
  if (!item.estimatedEffort || typeof item.estimatedEffort.value !== "number") {
    return null;
  }
  const { value, unit } = item.estimatedEffort;
  if (value <= 0 || !Number.isFinite(value)) return null;
  if (unit === "hours") return value;
  if (unit === "minutes") return Math.round((value / 60) * 100) / 100;
  if (unit === "days") return value * 8;
  return null;
}

function isDateInTargetWeek(dateStr: string | null | undefined, targetWeek: TargetWeek): boolean {
  if (!dateStr || !isValidCalendarDate(dateStr)) return false;
  return dateStr >= targetWeek.startDate && dateStr <= targetWeek.endDate;
}

/**
 * Prepares deterministic constraints for weekly planning based on inputs from skills 01-05.
 *
 * Distinguishes:
 * - External commitments: items with explicit external commitments to third parties.
 * - Strict deadlines in week: items with unambiguous deadlines falling inside targetWeek.
 *   (Note: deadlines do NOT turn optional ideas into obligations).
 * - Optional items: items with type === "idea" or exploratory nature.
 * - Archived items: items with status === "archived".
 * - Blocked items: items blocked strictly by explicit `depends_on` relationships.
 *   (Never inferred from `part_of`, `related_to`, or `same_project`).
 * - Unblocking actions: documents the domain limitation (no entity in current model).
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
      const deadlineDate = matchingDl
        ? (matchingDl.resolvedStart ?? matchingDl.resolvedEnd ?? undefined)
        : undefined;

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
      // Archived items and exploratory ideas are never strict deadlines for the week
      continue;
    }

    const startInWeek = isDateInTargetWeek(dl.resolvedStart, targetWeek);
    const endInWeek = isDateInTargetWeek(dl.resolvedEnd, targetWeek);

    if (startInWeek || endInWeek) {
      const dueDate = (startInWeek ? dl.resolvedStart : dl.resolvedEnd) ?? targetWeek.endDate;
      const hours = extractItemHours(item);

      // Only record as strict deadline if high or medium confidence and exact or relative date
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
      // Rule: part_of, related_to, same_project never imply blocking dependency
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

// ============================================================================
// 4. Capacity Calculation Engine
// ============================================================================

export interface CalculateWeeklyCapacityParams {
  capacityConfig?: WeeklyCapacityConfig;
  foci?: Array<{ estimatedHours?: number | null }>;
  obligations?: Array<{ estimatedHours?: number | null }>;
  explicitKnownEstimatedHours?: number | null;
  explicitCompleteness?: EstimationCompleteness;
}

/**
 * Pure function to calculate weekly capacity and protected space summary.
 *
 * Implements the mathematical formulas and invariants defined in ADR 0006:
 * - totalAvailableHours: user-declared available hours. If null/undefined -> capacityStatus & protectedSpaceStatus are "unknown".
 * - minProtectedSpaceRatio: user-configured ratio, defaulting to 0.25 (25%) by product policy.
 * - plannableHours = totalAvailableHours * (1 - ratio).
 * - protectedSpaceHours = totalAvailableHours * ratio.
 * - knownEstimatedHours = sum of known non-null estimates.
 * - plannedHours = knownEstimatedHours ONLY if completeness is "complete"; null if "partial" or "none".
 * - If knownEstimatedHours > plannableHours -> capacityStatus is "over_capacity" and protectedSpaceStatus is "compromised"
 *   even if estimates are incomplete.
 * - If completeness is "complete" and plannedHours <= plannableHours -> "within_capacity" and "respected".
 * - If completeness is "partial" or "none" and knownEstimatedHours <= plannableHours -> "unknown" and "unknown".
 */
export function calculateWeeklyCapacity(
  params: CalculateWeeklyCapacityParams
): WeeklyCapacitySummary {
  const { capacityConfig, foci, obligations } = params;

  // 1. Resolve capacity boundaries
  const total = capacityConfig?.totalAvailableHours ?? null;
  const ratio = capacityConfig?.minProtectedSpaceRatio ?? 0.25;

  let plannableHours: number | null = null;
  let protectedSpaceHours: number | null = null;

  if (total != null) {
    protectedSpaceHours = Math.round(total * ratio * 100) / 100;
    plannableHours = Math.round(total * (1 - ratio) * 100) / 100;
  }

  // 2. Resolve estimated workload from foci and obligations
  let knownEstimatedHours: number | null = null;
  let estimationCompleteness: EstimationCompleteness = "none";

  if (params.explicitKnownEstimatedHours !== undefined) {
    knownEstimatedHours = params.explicitKnownEstimatedHours;
    estimationCompleteness = params.explicitCompleteness ?? "none";
  } else if (foci || obligations) {
    const plannedEntries = [...(foci ?? []), ...(obligations ?? [])];

    if (plannedEntries.length > 0) {
      let sum = 0;
      let nonNullCount = 0;

      for (const entry of plannedEntries) {
        if (typeof entry.estimatedHours === "number" && Number.isFinite(entry.estimatedHours)) {
          sum += entry.estimatedHours;
          nonNullCount++;
        }
      }

      if (nonNullCount === plannedEntries.length) {
        estimationCompleteness = "complete";
        knownEstimatedHours = Math.round(sum * 100) / 100;
      } else if (nonNullCount > 0) {
        estimationCompleteness = "partial";
        knownEstimatedHours = Math.round(sum * 100) / 100;
      } else {
        estimationCompleteness = "none";
        knownEstimatedHours = null;
      }
    }
  }

  // plannedHours is strictly null unless completeness is complete
  const plannedHours =
    estimationCompleteness === "complete" ? knownEstimatedHours : null;

  // 3. Resolve capacityStatus and protectedSpaceStatus
  if (total == null) {
    return {
      totalAvailableHours: null,
      plannableHours: null,
      plannedHours,
      knownEstimatedHours,
      estimationCompleteness,
      protectedSpaceHours: null,
      capacityStatus: "unknown",
      protectedSpaceStatus: "unknown",
    };
  }

  // Case: known estimated hours exceed plannable capacity
  if (
    knownEstimatedHours != null &&
    plannableHours != null &&
    knownEstimatedHours > plannableHours
  ) {
    return {
      totalAvailableHours: total,
      plannableHours,
      plannedHours,
      knownEstimatedHours,
      estimationCompleteness,
      protectedSpaceHours,
      capacityStatus: "over_capacity",
      protectedSpaceStatus: "compromised",
    };
  }

  // Case: complete estimations fitting within plannable capacity
  if (estimationCompleteness === "complete") {
    return {
      totalAvailableHours: total,
      plannableHours,
      plannedHours,
      knownEstimatedHours,
      estimationCompleteness,
      protectedSpaceHours,
      capacityStatus: "within_capacity",
      protectedSpaceStatus: "respected",
    };
  }

  // Case: incomplete or missing estimations fitting or unknown
  return {
    totalAvailableHours: total,
    plannableHours,
    plannedHours: null,
    knownEstimatedHours,
    estimationCompleteness,
    protectedSpaceHours,
    capacityStatus: "unknown",
    protectedSpaceStatus: "unknown",
  };
}

// ============================================================================
// 5. Build Week Input Validation
// ============================================================================

/**
 * Validates structural integrity and reference consistency of BuildWeekInput.
 */
export function validateBuildWeekInput(input: BuildWeekInput): WeekInvariantValidationResult {
  const errors: string[] = [];

  // 1. Calendar validation
  if (!isValidCalendarDate(input.currentDate)) {
    errors.push(`Invalid currentDate: "${input.currentDate}". Must be a valid real ISO calendar date.`);
  }

  if (input.targetWeek) {
    if (!isValidCalendarDate(input.targetWeek.startDate)) {
      errors.push(`Invalid targetWeek.startDate: "${input.targetWeek.startDate}".`);
    }
    if (!isValidCalendarDate(input.targetWeek.endDate)) {
      errors.push(`Invalid targetWeek.endDate: "${input.targetWeek.endDate}".`);
    }
    if (
      isValidCalendarDate(input.targetWeek.startDate) &&
      isValidCalendarDate(input.targetWeek.endDate) &&
      input.targetWeek.startDate > input.targetWeek.endDate
    ) {
      errors.push(`targetWeek.startDate ("${input.targetWeek.startDate}") must be <= targetWeek.endDate ("${input.targetWeek.endDate}").`);
    }
  }

  // 2. Duplicate item IDs in items
  const itemIds = new Set<string>();
  for (const item of input.items) {
    if (itemIds.has(item.id)) {
      errors.push(`Duplicate item ID detected in input.items: "${item.id}".`);
    }
    itemIds.add(item.id);

    if (item.estimatedEffort) {
      if (typeof item.estimatedEffort.value !== "number" || !Number.isFinite(item.estimatedEffort.value) || item.estimatedEffort.value <= 0) {
        errors.push(`Item "${item.id}" has invalid estimatedEffort value: ${item.estimatedEffort.value}. Must be a positive finite number.`);
      }
    }
  }

  // 3. Relationships reference integrity
  for (const rel of input.relationships) {
    if (!itemIds.has(rel.sourceItemId)) {
      errors.push(`Relationship references nonexistent sourceItemId: "${rel.sourceItemId}".`);
    }
    if (!itemIds.has(rel.targetItemId)) {
      errors.push(`Relationship references nonexistent targetItemId: "${rel.targetItemId}".`);
    }
    if (rel.sourceItemId === rel.targetItemId) {
      errors.push(`Relationship has identical source and target itemId: "${rel.sourceItemId}".`);
    }
  }

  // 4. GroupedWork reference integrity
  const groupIds = new Set<string>();
  for (const group of input.groupedWork.groups) {
    if (groupIds.has(group.id)) {
      errors.push(`Duplicate group ID detected in groupedWork.groups: "${group.id}".`);
    }
    groupIds.add(group.id);

    for (const itemId of group.itemIds) {
      if (!itemIds.has(itemId)) {
        errors.push(`Group "${group.id}" references nonexistent itemId: "${itemId}".`);
      }
    }
  }

  for (const ungroupedId of input.groupedWork.ungroupedItemIds) {
    if (!itemIds.has(ungroupedId)) {
      errors.push(`ungroupedItemIds references nonexistent itemId: "${ungroupedId}".`);
    }
  }

  // 5. Deadlines reference integrity
  for (const dl of input.deadlines.deadlines) {
    if (!itemIds.has(dl.itemId)) {
      errors.push(`Deadline references nonexistent itemId: "${dl.itemId}".`);
    }
  }

  // 6. Context reference integrity
  const seenAssessmentItemIds = new Set<string>();
  for (const assessment of input.context.itemAssessments) {
    if (!itemIds.has(assessment.itemId)) {
      errors.push(`Context itemAssessment references nonexistent itemId: "${assessment.itemId}".`);
    }
    if (seenAssessmentItemIds.has(assessment.itemId)) {
      errors.push(`Duplicate context itemAssessment for itemId: "${assessment.itemId}".`);
    }
    seenAssessmentItemIds.add(assessment.itemId);
  }

  const seenAssessmentGroupIds = new Set<string>();
  for (const groupAssessment of input.context.groupAssessments) {
    if (!groupIds.has(groupAssessment.groupId)) {
      errors.push(`Context groupAssessment references nonexistent groupId: "${groupAssessment.groupId}".`);
    }
    if (seenAssessmentGroupIds.has(groupAssessment.groupId)) {
      errors.push(`Duplicate context groupAssessment for groupId: "${groupAssessment.groupId}".`);
    }
    seenAssessmentGroupIds.add(groupAssessment.groupId);
  }

  for (const question of input.context.openQuestions) {
    for (const relId of question.relatedItemIds) {
      if (!itemIds.has(relId)) {
        errors.push(`Context openQuestion references nonexistent relatedItemId: "${relId}".`);
      }
    }
  }

  // 7. Capacity validation
  if (input.capacity) {
    if (
      input.capacity.totalAvailableHours != null &&
      (!Number.isFinite(input.capacity.totalAvailableHours) || input.capacity.totalAvailableHours < 0)
    ) {
      errors.push(`Capacity totalAvailableHours must be a non-negative finite number.`);
    }

    if (
      input.capacity.minProtectedSpaceRatio != null &&
      (!Number.isFinite(input.capacity.minProtectedSpaceRatio) ||
        input.capacity.minProtectedSpaceRatio < 0 ||
        input.capacity.minProtectedSpaceRatio > 1)
    ) {
      errors.push(`Capacity minProtectedSpaceRatio must be a float between 0 and 1.`);
    }

    if (input.capacity.daysWithConstraints) {
      for (const day of input.capacity.daysWithConstraints) {
        if (!Number.isFinite(day.availableHours) || day.availableHours < 0) {
          errors.push(`Day constraint for "${day.day}" has invalid availableHours: ${day.availableHours}.`);
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function assertValidBuildWeekInput(input: BuildWeekInput): void {
  const result = validateBuildWeekInput(input);
  if (!result.valid) {
    throw new WeekValidationError(
      `BuildWeekInput validation failed:\n- ${result.errors.join("\n- ")}`,
      result.errors
    );
  }
}

// ============================================================================
// 6. Deterministic Planning Context Builder
// ============================================================================

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
 *
 * Guarantees:
 * - Validates input thoroughly with assertValidBuildWeekInput.
 * - Resolves targetWeek cleanly.
 * - Identifies constraints and capacity baseline.
 * - Collects unresolved uncertainties without inventing data.
 * - Consumes 0 tokens and executes 0 network calls.
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

// ============================================================================
// 7. Proposal Normalizer & Exact Item Conservation
// ============================================================================

export interface ProposalRepairAction {
  type:
    | "rescued_archived_to_deferred"
    | "rescued_blocked_to_deferred"
    | "rescued_idea_to_flexible"
    | "rescued_omitted_to_not_scheduled"
    | "deduplicated_intra_category"
    | "resolved_obligation_focus_conflict"
    | "recalculated_capacity_summary"
    | "reclassified_false_obligation";
  itemId?: string;
  description: string;
}

export interface ProposalNormalizationResult {
  proposal: ProposedWeek;
  repaired: boolean;
  repairs: ProposalRepairAction[];
}

/**
 * Normalizes a proposed week to guarantee 100% exact item conservation, auditability, and invariant consistency.
 *
 * Rules:
 * 1. REJECTS proposals with phantom item IDs (hallucinations cannot be silently dropped).
 * 2. REJECTS proposals with nonexistent group IDs in foci (structural corruption cannot be silently rewritten).
 * 3. REJECTS proposals with contradictory assignments across multiple distinct categories (planner contradictions).
 * 4. REJECTS proposals where regular tasks are omitted without an explicit ground-truth deferral reason
 *    (preventing arbitrary fabrication of "out_of_capacity" or "intentional_postponement").
 * 5. REPAIRS deterministically:
 *    - Deduplicates repeated item IDs within the same list (e.g. contributingItemIds in a focus).
 *    - Rescues omitted archived items into deferredItems with ground-truth reason "archived".
 *    - Rescues omitted blocked items into deferredItems with ground-truth reason "waiting_dependency".
 *    - Rescues omitted ideas into flexibleOptions.
 *    - Recalculates capacity summary mathematically to prevent AI status hallucinations.
 * 6. Every repair is recorded in a structured, privacy-safe audit record.
 */
export function normalizeAndConserveProposedWeek(
  rawProposal: ProposedWeek,
  input: BuildWeekInput
): ProposalNormalizationResult {
  const inputItemMap = new Map(input.items.map((i) => [i.id, i]));
  const validItemIds = new Set(inputItemMap.keys());
  const inputGroupIds = new Set(input.groupedWork.groups.map((g) => g.id));
  const repairs: ProposalRepairAction[] = [];

  // 1. REJECTION CHECK: Phantom item IDs in proposal
  const proposalItemIds = new Set<string>();
  const phantomItemIds: string[] = [];

  for (const focus of rawProposal.foci) {
    for (const id of focus.contributingItemIds) {
      if (!validItemIds.has(id)) phantomItemIds.push(id);
      proposalItemIds.add(id);
    }
  }
  for (const ob of rawProposal.obligations) {
    if (!validItemIds.has(ob.itemId)) phantomItemIds.push(ob.itemId);
    proposalItemIds.add(ob.itemId);
  }
  for (const opt of rawProposal.flexibleOptions) {
    if (!validItemIds.has(opt.itemId)) phantomItemIds.push(opt.itemId);
    proposalItemIds.add(opt.itemId);
  }
  for (const def of rawProposal.deferredItems) {
    if (!validItemIds.has(def.itemId)) phantomItemIds.push(def.itemId);
    proposalItemIds.add(def.itemId);
  }

  if (phantomItemIds.length > 0) {
    const uniquePhantoms = Array.from(new Set(phantomItemIds));
    throw new WeekValidationError(
      `Proposal rejected: phantom item IDs detected in proposal: ${uniquePhantoms.join(", ")}. Hallucinated references cannot be silently dropped.`,
      uniquePhantoms
    );
  }

  // 2. REJECTION CHECK: Nonexistent group IDs in foci
  for (const focus of rawProposal.foci) {
    if (focus.groupId && !inputGroupIds.has(focus.groupId)) {
      throw new WeekValidationError(
        `Proposal rejected: focus "${focus.id}" references nonexistent groupId "${focus.groupId}". Cannot silently drop focus or rewrite its association.`,
        [{ focusId: focus.id, groupId: focus.groupId }]
      );
    }
  }

  // 3. SAFE REPAIR: Reclassify false obligations without structured backing
  // Rule: An item can ONLY be an obligation if it is an external commitment (externalCommitments)
  // or a strict deadline falling within the target week (strictDeadlinesInWeek).
  // Urgent words ("urgente", "hotfix"), high importance, or past/overdue deadlines do not constitute obligations.
  const targetWeek = resolveTargetWeek(input.currentDate, input.targetWeek);
  const constraints = prepareWeekConstraints(input, targetWeek);
  const legitimateObligationIds = new Set<string>([
    ...constraints.externalCommitments.map((c) => c.itemId),
    ...constraints.strictDeadlinesInWeek.map((d) => d.itemId),
  ]);

  const rawFocusItemIds = new Set(rawProposal.foci.flatMap((f) => f.contributingItemIds));
  const validObligations: WeeklyObligation[] = [];
  const falseObligationsToDefer: DeferredItem[] = [];

  for (const ob of rawProposal.obligations) {
    if (!legitimateObligationIds.has(ob.itemId)) {
      if (rawFocusItemIds.has(ob.itemId)) {
        repairs.push({
          type: "reclassified_false_obligation",
          itemId: ob.itemId,
          description: `Item "${ob.itemId}" (${ob.title}) was proposed as an obligation without external commitment or in-week strict deadline; preserved within its weekly focus.`,
        });
      } else {
        falseObligationsToDefer.push({
          itemId: ob.itemId,
          title: ob.title,
          reason: "not_scheduled",
          rationale:
            "Reclasificado determinísticamente desde obligaciones: carece de compromiso externo o fecha límite estricta respaldada en la semana objetivo.",
        });
        repairs.push({
          type: "reclassified_false_obligation",
          itemId: ob.itemId,
          description: `Item "${ob.itemId}" (${ob.title}) was proposed as an obligation without external commitment or in-week strict deadline; reclassified to deferredItems as "not_scheduled".`,
        });
      }
    } else {
      validObligations.push(ob);
    }
  }

  // 4. SAFE REPAIR: Resolve obligation vs focus overlap
  // Rule: If an item is classified as an obligation, its ID cannot appear in foci[].contributingItemIds.
  // The obligation and its dueDate are strictly preserved, and the duplicate reference is removed from the focus.
  const obligationItemIds = new Set(validObligations.map((o) => o.itemId));
  const fociWithoutObligations: WeeklyFocus[] = [];

  for (const focus of rawProposal.foci) {
    const overlappingObligationIds = focus.contributingItemIds.filter((id) =>
      obligationItemIds.has(id)
    );

    if (overlappingObligationIds.length > 0) {
      for (const ovId of overlappingObligationIds) {
        repairs.push({
          type: "resolved_obligation_focus_conflict",
          itemId: ovId,
          description: `Resolved conflict: removed obligation item "${ovId}" from focus "${focus.id}" contributingItemIds to preserve strict obligation priority.`,
        });
      }

      const remainingItemIds = focus.contributingItemIds.filter(
        (id) => !obligationItemIds.has(id)
      );

      if (remainingItemIds.length === 0) {
        repairs.push({
          type: "resolved_obligation_focus_conflict",
          description: `Removed empty focus "${focus.id}" because all its contributing items were assigned to obligations.`,
        });
        continue;
      }

      // Recalculate focus estimatedHours if it was set
      let adjustedHours = focus.estimatedHours;
      if (adjustedHours !== null) {
        let sum = 0;
        let hasHours = false;
        for (const remId of remainingItemIds) {
          const it = inputItemMap.get(remId);
          const h = it ? extractItemHours(it) : null;
          if (h !== null) {
            sum += h;
            hasHours = true;
          }
        }
        adjustedHours = hasHours ? Math.round(sum * 100) / 100 : null;
      }

      fociWithoutObligations.push({
        ...focus,
        contributingItemIds: remainingItemIds,
        estimatedHours: adjustedHours,
      });
    } else {
      fociWithoutObligations.push(focus);
    }
  }

  // 5. REJECTION CHECK: Contradictory assignments across different categories
  const itemCategoryMap = new Map<string, string[]>();
  const registerCategory = (id: string, category: string) => {
    if (!itemCategoryMap.has(id)) itemCategoryMap.set(id, []);
    itemCategoryMap.get(id)!.push(category);
  };

  for (const focus of fociWithoutObligations) {
    for (const id of focus.contributingItemIds) {
      registerCategory(id, `focus:${focus.id}`);
    }
  }
  for (const ob of validObligations) {
    registerCategory(ob.itemId, "obligation");
  }
  for (const opt of rawProposal.flexibleOptions) {
    registerCategory(opt.itemId, "flexibleOption");
  }
  for (const def of [...rawProposal.deferredItems, ...falseObligationsToDefer]) {
    registerCategory(def.itemId, "deferredItem");
  }

  const contradictoryConflicts: Array<{ itemId: string; categories: string[] }> = [];
  for (const [id, categories] of itemCategoryMap.entries()) {
    const distinctCategories = Array.from(new Set(categories));
    if (distinctCategories.length > 1) {
      contradictoryConflicts.push({ itemId: id, categories: distinctCategories });
    }
  }

  if (contradictoryConflicts.length > 0) {
    const descriptions = contradictoryConflicts
      .map((c) => `"${c.itemId}" in [${c.categories.join(", ")}]`)
      .join("; ");
    throw new WeekValidationError(
      `Proposal rejected: contradictory category assignments detected for: ${descriptions}. An item cannot belong to multiple distinct categories.`,
      contradictoryConflicts
    );
  }

  // 5. SAFE REPAIR: Intra-category duplicates (repeated IDs within the same list)
  const cleanedFoci = fociWithoutObligations.map((focus) => {
    const seenInFocus = new Set<string>();
    const deduplicatedIds: string[] = [];

    for (const id of focus.contributingItemIds) {
      if (seenInFocus.has(id)) {
        repairs.push({
          type: "deduplicated_intra_category",
          itemId: id,
          description: `Deduplicated repeated itemId "${id}" within focus "${focus.id}".`,
        });
        continue;
      }
      seenInFocus.add(id);
      deduplicatedIds.push(id);
    }

    return {
      ...focus,
      contributingItemIds: deduplicatedIds,
    };
  });

  // 6. OMITTED ITEMS: Honest rescue or explicit rejection
  const dependsOnBlockers = new Set<string>();
  for (const rel of input.relationships) {
    if (rel.type === "depends_on") {
      dependsOnBlockers.add(rel.sourceItemId);
    }
  }

  const cleanedDeferred = [...rawProposal.deferredItems, ...falseObligationsToDefer];
  const cleanedFlexible = [...rawProposal.flexibleOptions];

  for (const item of input.items) {
    if (!proposalItemIds.has(item.id)) {
      if (item.status === "archived") {
        cleanedDeferred.push({
          itemId: item.id,
          title: item.title,
          reason: "archived",
          rationale: "Item archivado; conservado determinísticamente como archivado.",
        });
        repairs.push({
          type: "rescued_archived_to_deferred",
          itemId: item.id,
          description: `Archived item "${item.id}" was omitted by planner; preserved in deferredItems as "archived".`,
        });
      } else if (dependsOnBlockers.has(item.id)) {
        cleanedDeferred.push({
          itemId: item.id,
          title: item.title,
          reason: "waiting_dependency",
          rationale: "Dependencia externa bloqueante; conservado determinísticamente en espera.",
        });
        repairs.push({
          type: "rescued_blocked_to_deferred",
          itemId: item.id,
          description: `Blocked item "${item.id}" was omitted by planner; preserved in deferredItems as "waiting_dependency".`,
        });
      } else if (item.type === "idea") {
        cleanedFlexible.push({
          itemId: item.id,
          title: item.title,
          condition: "Oportunidad exploratoria u opcional; conservada sin presión semanal.",
          estimatedHours: extractItemHours(item),
        });
        repairs.push({
          type: "rescued_idea_to_flexible",
          itemId: item.id,
          description: `Idea "${item.id}" was omitted by planner; preserved in flexibleOptions.`,
        });
      } else {
        // Regular unclassified task/commitment without demonstrable deferral reason.
        // Conserved honestly as "not_scheduled" without fabricating "out_of_capacity" or "intentional_postponement".
        cleanedDeferred.push({
          itemId: item.id,
          title: item.title,
          reason: "not_scheduled",
          rationale: "Elemento no programado en la propuesta; conservado para decisión de la persona sin motivo demostrado.",
        });
        repairs.push({
          type: "rescued_omitted_to_not_scheduled",
          itemId: item.id,
          description: `Item "${item.id}" was omitted by planner; preserved in deferredItems as "not_scheduled" without fabricating intent.`,
        });
      }
    }
  }

  // 6. SAFE REPAIR: Recalculate deterministic capacity summary
  const honestCapacity = calculateWeeklyCapacity({
    capacityConfig: input.capacity,
    foci: cleanedFoci,
    obligations: validObligations,
  });

  const prevCapacity = rawProposal.weekSummary.capacity;
  const capacityMismatch =
    prevCapacity.capacityStatus !== honestCapacity.capacityStatus ||
    prevCapacity.protectedSpaceStatus !== honestCapacity.protectedSpaceStatus ||
    prevCapacity.plannedHours !== honestCapacity.plannedHours ||
    prevCapacity.knownEstimatedHours !== honestCapacity.knownEstimatedHours ||
    prevCapacity.plannableHours !== honestCapacity.plannableHours;

  if (capacityMismatch) {
    repairs.push({
      type: "recalculated_capacity_summary",
      description: `Recalculated capacity summary to guarantee mathematical consistency (status: ${honestCapacity.capacityStatus}, protectedSpace: ${honestCapacity.protectedSpaceStatus}).`,
    });
  }

  const normalizedProposal: ProposedWeek = {
    ...rawProposal,
    weekSummary: {
      ...rawProposal.weekSummary,
      capacity: honestCapacity,
    },
    foci: cleanedFoci,
    obligations: validObligations,
    flexibleOptions: cleanedFlexible,
    deferredItems: cleanedDeferred,
  };

  // 7. Final Invariant Validation
  const invariantCheck = validateProposedWeekInvariants(normalizedProposal, input);
  if (!invariantCheck.valid) {
    throw new WeekValidationError(
      `Normalized proposal failed invariants: ${invariantCheck.errors.join("; ")}`,
      invariantCheck.errors
    );
  }

  return {
    proposal: normalizedProposal,
    repaired: repairs.length > 0,
    repairs,
  };
}

// ============================================================================
// 8. Semantic Quality Evaluation
// ============================================================================

export interface SemanticQualityCheckResult {
  valid: boolean;
  status: "success" | "semantic_failure";
  errors: string[];
  warnings: string[];
  checks: {
    explicitCommitmentsPreserved: boolean;
    ideasNotObligations: boolean;
    dependenciesBackedByExplicitDependsOn: boolean;
    archivedItemsPreserved: boolean;
    noInventedEstimates: boolean;
    honestCapacityStatus: boolean;
    highImportanceNotFlexible: boolean;
    deadlinesPreservedWithoutShifting: boolean;
  };
}

export function evaluateProposedWeekSemanticQuality(
  proposal: ProposedWeek,
  input: BuildWeekInput
): SemanticQualityCheckResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const itemsMap = new Map(input.items.map((i) => [i.id, i]));
  const targetWeek = resolveTargetWeek(input.currentDate, input.targetWeek);

  // 1. Explicit commitments preserved
  // External commitments and deadlines falling inside target week
  const externalCommitmentIds = new Set<string>();
  for (const item of input.items) {
    if (
      item.status !== "archived" &&
      item.type !== "idea" &&
      (item.commitment === "external" || (item.type === "commitment" && item.commitment !== "personal"))
    ) {
      externalCommitmentIds.add(item.id);
    }
  }
  for (const asmt of input.context.itemAssessments) {
    if (asmt.signals.includes("external_commitment")) {
      const it = itemsMap.get(asmt.itemId);
      if (it && it.status !== "archived" && it.type !== "idea") {
        externalCommitmentIds.add(asmt.itemId);
      }
    }
  }
  for (const dl of input.deadlines.deadlines) {
    const it = itemsMap.get(dl.itemId);
    if (!it || it.status === "archived" || it.type === "idea") continue;
    const inWeek =
      isDateInTargetWeek(dl.resolvedStart, targetWeek) ||
      isDateInTargetWeek(dl.resolvedEnd, targetWeek);
    if (inWeek && (dl.confidence === "high" || dl.confidence === "medium")) {
      externalCommitmentIds.add(dl.itemId);
    }
  }

  const obligationItemIds = new Set(proposal.obligations.map((o) => o.itemId));

  let explicitCommitmentsPreserved = true;
  for (const cId of externalCommitmentIds) {
    // Rule: A depends_on relationship does NOT make an external commitment disappear
    // or justify unilaterally deferring it to deferredItems. It must remain visible as an obligation.
    if (!obligationItemIds.has(cId)) {
      explicitCommitmentsPreserved = false;
      const item = itemsMap.get(cId);
      errors.push(
        `External commitment "${cId}" (${item?.title || "unknown"}) was omitted or deferred. External commitments must remain visible as obligations; a dependency does not justify unilateral deferral.`
      );
    } else {
      // Check if blocked by depends_on: tension / impediment must be recorded
      const hasBlocker = input.relationships.some(
        (r) => r.type === "depends_on" && r.sourceItemId === cId
      );
      if (hasBlocker) {
        const ob = proposal.obligations.find((o) => o.itemId === cId)!;
        const obMentionsBlocker = /depend|bloque|espera/i.test(ob.rationale);
        const tradeoffsMentionBlocker = proposal.confirmationPrompt.keyTradeoffs.some(
          (t) => t.includes(ob.title) || /depend|bloque|espera/i.test(t)
        );
        if (!obMentionsBlocker && !tradeoffsMentionBlocker) {
          warnings.push(
            `External commitment "${cId}" (${ob.title}) is blocked by a depends_on relationship, but neither its obligation rationale nor confirmation keyTradeoffs record the execution impediment.`
          );
        }
      }
    }
  }

  // 2. Ideas not converted into obligations
  let ideasNotObligations = true;
  for (const ob of proposal.obligations) {
    const originalItem = itemsMap.get(ob.itemId);
    if (originalItem?.type === "idea") {
      ideasNotObligations = false;
      errors.push(
        `Idea item "${ob.itemId}" (${ob.title}) was converted into an obligation. Ideas must remain flexible or deferred.`
      );
    }
  }

  // 3. Dependencies backed ONLY by explicit depends_on
  let dependenciesBacked = true;
  const dependsOnItemIds = new Set<string>();
  for (const rel of input.relationships) {
    if (rel.type === "depends_on") {
      dependsOnItemIds.add(rel.sourceItemId);
      dependsOnItemIds.add(rel.targetItemId);
    }
  }

  for (const def of proposal.deferredItems) {
    if (def.reason === "waiting_dependency" && !dependsOnItemIds.has(def.itemId)) {
      dependenciesBacked = false;
      errors.push(
        `Item "${def.itemId}" (${def.title}) was deferred with "waiting_dependency", but has no explicit depends_on relationship in input.`
      );
    }
  }

  // 4. Archived items preserved as archived
  let archivedPreserved = true;
  const archivedItemIds = new Set<string>(
    input.items.filter((i) => i.status === "archived").map((i) => i.id)
  );

  for (const archId of archivedItemIds) {
    const inActive =
      proposal.obligations.some((o) => o.itemId === archId) ||
      proposal.flexibleOptions.some((f) => f.itemId === archId) ||
      proposal.foci.some((f) => f.contributingItemIds.includes(archId));
    if (inActive) {
      archivedPreserved = false;
      errors.push(`Archived item "${archId}" was assigned to active schedule categories.`);
    }

    const inDeferredArchived = proposal.deferredItems.some(
      (d) => d.itemId === archId && d.reason === "archived"
    );
    if (!inDeferredArchived) {
      archivedPreserved = false;
      errors.push(`Archived item "${archId}" is not preserved in deferredItems with reason "archived".`);
    }
  }

  // 5. No invented estimates: structured estimatedEffort is the single source of truth
  let noInventedEstimates = true;
  for (const ob of proposal.obligations) {
    if (ob.estimatedHours !== null) {
      const original = itemsMap.get(ob.itemId);
      const structuredHours = original ? extractItemHours(original) : null;
      if (structuredHours === null) {
        noInventedEstimates = false;
        errors.push(
          `Obligation "${ob.itemId}" (${ob.title}) declared estimatedHours=${ob.estimatedHours}, but input item has no structured estimatedEffort.`
        );
      } else if (Math.abs(ob.estimatedHours - structuredHours) > 0.05) {
        noInventedEstimates = false;
        errors.push(
          `Obligation "${ob.itemId}" (${ob.title}) declared estimatedHours=${ob.estimatedHours}, which contradicts structured input effort (${structuredHours}h).`
        );
      }
    }
  }

  for (const opt of proposal.flexibleOptions) {
    if (opt.estimatedHours !== null) {
      const original = itemsMap.get(opt.itemId);
      const structuredHours = original ? extractItemHours(original) : null;
      if (structuredHours === null) {
        noInventedEstimates = false;
        errors.push(
          `Flexible option "${opt.itemId}" (${opt.title}) declared estimatedHours=${opt.estimatedHours}, but input item has no structured estimatedEffort.`
        );
      } else if (Math.abs(opt.estimatedHours - structuredHours) > 0.05) {
        noInventedEstimates = false;
        errors.push(
          `Flexible option "${opt.itemId}" (${opt.title}) declared estimatedHours=${opt.estimatedHours}, which contradicts structured input effort (${structuredHours}h).`
        );
      }
    }
  }

  for (const focus of proposal.foci) {
    if (focus.estimatedHours !== null) {
      const contributingItems = focus.contributingItemIds
        .map((id) => itemsMap.get(id))
        .filter(Boolean) as ExtractedItem[];
      const knownContributingHours = contributingItems
        .map((it) => extractItemHours(it))
        .filter((h): h is number => h !== null);

      if (knownContributingHours.length === 0) {
        noInventedEstimates = false;
        errors.push(
          `Focus "${focus.id}" (${focus.title}) declared estimatedHours=${focus.estimatedHours}, but none of its contributing items have structured estimatedEffort.`
        );
      } else {
        const expectedFocusHours = Math.round(knownContributingHours.reduce((sum, h) => sum + h, 0) * 100) / 100;
        if (knownContributingHours.length === contributingItems.length && Math.abs(focus.estimatedHours - expectedFocusHours) > 0.05) {
          noInventedEstimates = false;
          errors.push(
            `Focus "${focus.id}" (${focus.title}) declared estimatedHours=${focus.estimatedHours}, which contradicts sum of contributing items (${expectedFocusHours}h).`
          );
        }
      }
    }
  }

  // 6. Capacity recalculation consistency and honesty
  let honestCapacityStatus = true;
  const propCap = proposal.weekSummary.capacity;
  const expectedCapacity = calculateWeeklyCapacity({
    capacityConfig: input.capacity,
    foci: proposal.foci,
    obligations: proposal.obligations,
  });

  if (propCap.estimationCompleteness !== expectedCapacity.estimationCompleteness) {
    honestCapacityStatus = false;
    errors.push(
      `estimationCompleteness mismatch: proposal declared "${propCap.estimationCompleteness}", deterministic engine calculates "${expectedCapacity.estimationCompleteness}".`
    );
  }

  if (
    (propCap.estimationCompleteness === "partial" || propCap.estimationCompleteness === "none") &&
    propCap.capacityStatus === "within_capacity"
  ) {
    honestCapacityStatus = false;
    errors.push(
      `capacityStatus cannot be "within_capacity" when estimation completeness is "${propCap.estimationCompleteness}"; capacity status must remain "unknown".`
    );
  }

  if (
    (propCap.estimationCompleteness === "partial" || propCap.estimationCompleteness === "none") &&
    propCap.protectedSpaceStatus === "respected"
  ) {
    honestCapacityStatus = false;
    errors.push(
      `protectedSpaceStatus cannot be "respected" when estimation completeness is "${propCap.estimationCompleteness}"; protected space status must remain "unknown".`
    );
  }

  if (propCap.capacityStatus !== expectedCapacity.capacityStatus) {
    honestCapacityStatus = false;
    errors.push(
      `capacityStatus mismatch: proposal declared "${propCap.capacityStatus}", but deterministic engine calculates "${expectedCapacity.capacityStatus}".`
    );
  }

  if (propCap.protectedSpaceStatus !== expectedCapacity.protectedSpaceStatus) {
    honestCapacityStatus = false;
    errors.push(
      `protectedSpaceStatus mismatch: proposal declared "${propCap.protectedSpaceStatus}", but deterministic engine calculates "${expectedCapacity.protectedSpaceStatus}".`
    );
  }

  if (expectedCapacity.estimationCompleteness !== "complete" && propCap.plannedHours !== null) {
    honestCapacityStatus = false;
    errors.push(
      `plannedHours must be null when estimation completeness is "${expectedCapacity.estimationCompleteness}"; partial estimates (${propCap.knownEstimatedHours}h) cannot be presented as a complete total.`
    );
  }

  if (propCap.knownEstimatedHours !== expectedCapacity.knownEstimatedHours) {
    honestCapacityStatus = false;
    errors.push(
      `knownEstimatedHours mismatch: proposal declared ${propCap.knownEstimatedHours}, deterministic engine calculated ${expectedCapacity.knownEstimatedHours}.`
    );
  }

  // 7. High importance tasks must not be degraded to flexibleOptions, nor converted to false obligations
  let highImportanceNotFlexible = true;
  for (const opt of proposal.flexibleOptions) {
    const originalItem = itemsMap.get(opt.itemId);
    if (originalItem?.importance === "high" && originalItem.type === "task") {
      highImportanceNotFlexible = false;
      errors.push(
        `High importance task "${opt.itemId}" (${opt.title}) cannot be classified as a flexible option. It must be structured as a weekly focus or conserved in deferred items without inventing false obligations.`
      );
    }
  }

  for (const ob of proposal.obligations) {
    const originalItem = itemsMap.get(ob.itemId);
    if (!externalCommitmentIds.has(ob.itemId)) {
      highImportanceNotFlexible = false;
      if (originalItem?.importance === "high") {
        errors.push(
          `High importance task "${ob.itemId}" (${ob.title}) was converted into an obligation without external commitment or strict deadline. High importance alone does not constitute a weekly obligation.`
        );
      } else {
        errors.push(
          `Task "${ob.itemId}" (${ob.title}) was converted into an obligation without external commitment or strict deadline. Urgency, critical importance, or past deadlines alone do not constitute a weekly obligation.`
        );
      }
    }
  }

  // 8. Deadlines preserved without shifting or invention
  let deadlinesPreservedWithoutShifting = true;
  const constraints = prepareWeekConstraints(input, targetWeek);

  // 8.1. Check strict deadlines in the week: if obligation provides dueDate, it cannot be shifted.
  for (const sdl of constraints.strictDeadlinesInWeek) {
    const ob = proposal.obligations.find((o) => o.itemId === sdl.itemId);
    if (ob && ob.dueDate != null && ob.dueDate !== sdl.dueDate) {
      deadlinesPreservedWithoutShifting = false;
      errors.push(
        `Strict deadline item "${sdl.itemId}" (${sdl.title}) declared dueDate="${ob.dueDate}", but strict deadline in week requires exact date "${sdl.dueDate}". Shifting deadlines is not permitted.`
      );
    }
  }

  // 8.2. Every obligation that declares a dueDate must match a detected deadline for that item
  const deadlinesByItem = new Map<string, string[]>();
  for (const dl of input.deadlines.deadlines) {
    const dates: string[] = [];
    if (dl.resolvedStart) dates.push(dl.resolvedStart);
    if (dl.resolvedEnd) dates.push(dl.resolvedEnd);
    if (dates.length > 0) {
      const existing = deadlinesByItem.get(dl.itemId) || [];
      deadlinesByItem.set(dl.itemId, [...existing, ...dates]);
    }
  }

  for (const ob of proposal.obligations) {
    if (ob.dueDate != null) {
      const itemDates = deadlinesByItem.get(ob.itemId);
      if (!itemDates || itemDates.length === 0) {
        deadlinesPreservedWithoutShifting = false;
        errors.push(
          `Obligation "${ob.itemId}" (${ob.title}) declared dueDate="${ob.dueDate}", but input item has no detected deadline.`
        );
      } else if (!itemDates.includes(ob.dueDate)) {
        deadlinesPreservedWithoutShifting = false;
        errors.push(
          `Obligation "${ob.itemId}" (${ob.title}) declared dueDate="${ob.dueDate}", which contradicts or shifts the detected deadline (${itemDates.join(", ")}).`
        );
      }
    }
  }

  // 9. Integrity of deferredItems and not_scheduled rationale
  for (const def of proposal.deferredItems) {
    if (def.reason === "not_scheduled") {
      if (/(el\s+usuario\s+decidi|decisi(ó|o)n\s+del\s+usuario|usuario\s+pospuso|decidi(ó|o)\s+posponer)/i.test(def.rationale)) {
        errors.push(
          `Item "${def.itemId}" (${def.title}) was deferred with reason "not_scheduled", but its rationale falsely asserts a deliberate user decision to postpone.`
        );
      }
    }
  }

  // 10. High-importance tasks deferred as not_scheduled must alert the user in confirmationPrompt
  for (const def of proposal.deferredItems) {
    if (def.reason === "not_scheduled") {
      const orig = itemsMap.get(def.itemId);
      if (orig?.importance === "high" && orig.type === "task") {
        const mentionsInTradeoffs = proposal.confirmationPrompt.keyTradeoffs.some(
          (t) => t.includes(orig.title) || t.includes(def.itemId) || /alta importancia/i.test(t)
        );
        const mentionsInQuestion =
          proposal.confirmationPrompt.question.includes(orig.title) ||
          proposal.confirmationPrompt.question.includes(def.itemId) ||
          /alta importancia/i.test(proposal.confirmationPrompt.question);

        if (!mentionsInTradeoffs && !mentionsInQuestion) {
          warnings.push(
            `High importance task "${def.itemId}" (${def.title}) was deferred with "not_scheduled", but neither confirmationPrompt.keyTradeoffs nor question alert the user about this omission.`
          );
        }
      }
    }
  }

  const isValid = errors.length === 0;

  return {
    valid: isValid,
    status: isValid ? "success" : "semantic_failure",
    errors,
    warnings,
    checks: {
      explicitCommitmentsPreserved,
      ideasNotObligations,
      dependenciesBackedByExplicitDependsOn: dependenciesBacked,
      archivedItemsPreserved: archivedPreserved,
      noInventedEstimates,
      honestCapacityStatus,
      highImportanceNotFlexible,
      deadlinesPreservedWithoutShifting,
    },
  };
}
