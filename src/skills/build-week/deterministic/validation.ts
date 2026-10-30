import {
  isValidCalendarDate,
  BuildWeekInput,
  ProposedWeek,
  WeekInvariantValidationResult,
  ExtractedItem,
} from "../../../domain/week";
import {
  WeekValidationError,
  resolveTargetWeek,
  calculateWeeklyCapacity,
  extractItemHours,
  isDateInTargetWeek,
} from "./capacity-math";
import { prepareWeekConstraints } from "./planning-context";

export { WeekValidationError };

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
    if (!obligationItemIds.has(cId)) {
      explicitCommitmentsPreserved = false;
      const item = itemsMap.get(cId);
      errors.push(
        `External commitment "${cId}" (${item?.title || "unknown"}) was omitted or deferred. External commitments must remain visible as obligations; a dependency does not justify unilateral deferral.`
      );
    } else {
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
    flexibleOptions: proposal.flexibleOptions,
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

  for (const sdl of constraints.strictDeadlinesInWeek) {
    const ob = proposal.obligations.find((o) => o.itemId === sdl.itemId);
    if (ob && ob.dueDate != null && ob.dueDate !== sdl.dueDate) {
      deadlinesPreservedWithoutShifting = false;
      errors.push(
        `Strict deadline item "${sdl.itemId}" (${sdl.title}) declared dueDate="${ob.dueDate}", but strict deadline in week requires exact date "${sdl.dueDate}". Shifting deadlines is not permitted.`
      );
    }
  }

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
