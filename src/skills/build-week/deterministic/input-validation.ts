import {
  isValidCalendarDate,
  BuildWeekInput,
  WeekInvariantValidationResult,
} from "../../../domain/week";
import { WeekValidationError } from "./capacity-math";

/**
 * Validates structural integrity and reference consistency of BuildWeekInput.
 */
export function validateBuildWeekInput(input: BuildWeekInput): WeekInvariantValidationResult {
  const errors: string[] = [];

  // 1. Calendar validation
  if (!isValidCalendarDate(input.currentDate)) {
    errors.push(
      `Invalid currentDate: "${input.currentDate}". Must be a valid real ISO calendar date.`
    );
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
      errors.push(
        `targetWeek.startDate ("${input.targetWeek.startDate}") must be <= targetWeek.endDate ("${input.targetWeek.endDate}").`
      );
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
      if (
        typeof item.estimatedEffort.value !== "number" ||
        !Number.isFinite(item.estimatedEffort.value) ||
        item.estimatedEffort.value <= 0
      ) {
        errors.push(
          `Item "${item.id}" has invalid estimatedEffort value: ${item.estimatedEffort.value}. Must be a positive finite number.`
        );
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
      errors.push(
        `Context groupAssessment references nonexistent groupId: "${groupAssessment.groupId}".`
      );
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
      (!Number.isFinite(input.capacity.totalAvailableHours) ||
        input.capacity.totalAvailableHours < 0)
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
          errors.push(
            `Day constraint for "${day.day}" has invalid availableHours: ${day.availableHours}.`
          );
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
