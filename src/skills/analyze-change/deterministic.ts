import {
  AnalyzeChangeInput,
  AnalyzeChangeOutput,
  ChangeType,
  IncomingChangeDelta,
  ValidationError,
  AffectedElement,
  CapacityImpactAnalysis,
  UnaffectedAreaVerification,
} from "../../domain/change";
import { ProposedWeek } from "../../domain/week";
import { ExtractedItem } from "../../domain/items";

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

// ============================================================================
// Delta Reference Validator
// ============================================================================

export function validateDeltaReferences(
  delta: IncomingChangeDelta | undefined,
  plan: ProposedWeek
): { errors: ValidationError[]; fatal: boolean } {
  const errors: ValidationError[] = [];
  if (!delta) return { errors, fatal: false };

  // Collect all known item IDs across the active plan
  const planItemIds = new Set<string>();
  for (const focus of plan.foci) {
    for (const id of focus.contributingItemIds) {
      planItemIds.add(id);
    }
  }
  for (const ob of plan.obligations) {
    planItemIds.add(ob.itemId);
  }
  for (const fl of plan.flexibleOptions) {
    planItemIds.add(fl.itemId);
  }
  for (const def of plan.deferredItems) {
    planItemIds.add(def.itemId);
  }

  // Also collect newly added items in this delta to allow internal referencing
  const addedItemIds = new Set<string>();
  if (delta.itemOperations) {
    for (const op of delta.itemOperations) {
      if (op.op === "add") {
        addedItemIds.add(op.item.id);
      }
    }
  }

  const allKnownIds = new Set<string>([...planItemIds, ...addedItemIds]);

  // Validate item operations
  if (delta.itemOperations) {
    for (const op of delta.itemOperations) {
      if (op.op === "remove" || op.op === "modify") {
        if (!planItemIds.has(op.itemId)) {
          errors.push({
            type: "unresolved_reference",
            referenceId: op.itemId,
            message: `Target item "${op.itemId}" not found in active plan`,
            fatal: true,
          });
        }
      }
    }
  }

  // Validate relationship operations
  if (delta.relationshipOperations) {
    for (const relOp of delta.relationshipOperations) {
      if (!allKnownIds.has(relOp.sourceItemId)) {
        errors.push({
          type: "unresolved_reference",
          referenceId: relOp.sourceItemId,
          message: `Relationship source item "${relOp.sourceItemId}" not found in active plan or added items`,
          fatal: true,
        });
      }
      if (!allKnownIds.has(relOp.targetItemId)) {
        errors.push({
          type: "unresolved_reference",
          referenceId: relOp.targetItemId,
          message: `Relationship target item "${relOp.targetItemId}" not found in active plan or added items`,
          fatal: true,
        });
      }
    }
  }

  // Validate deadline operations
  if (delta.deadlineOperations) {
    for (const dOp of delta.deadlineOperations) {
      if (!allKnownIds.has(dOp.itemId)) {
        errors.push({
          type: "unresolved_reference",
          referenceId: dOp.itemId,
          message: `Deadline target item "${dOp.itemId}" not found in active plan or added items`,
          fatal: true,
        });
      }
    }
  }

  const fatal = errors.some((e) => e.fatal);
  return { errors, fatal };
}

// ============================================================================
// ChangeType Classifier
// ============================================================================

export function classifyChangeType(delta: IncomingChangeDelta | undefined): ChangeType {
  if (!delta) return "none_detected";

  const hasItemOps = Boolean(delta.itemOperations && delta.itemOperations.length > 0);
  const hasRelOps = Boolean(
    delta.relationshipOperations && delta.relationshipOperations.length > 0
  );
  const hasDeadlineOps = Boolean(delta.deadlineOperations && delta.deadlineOperations.length > 0);
  const hasCapacityOps = Boolean(delta.capacityOperations && delta.capacityOperations.length > 0);

  const activeCategoryCount =
    (hasItemOps ? 1 : 0) +
    (hasRelOps ? 1 : 0) +
    (hasDeadlineOps ? 1 : 0) +
    (hasCapacityOps ? 1 : 0);

  if (activeCategoryCount === 0) {
    return "none_detected";
  }

  // If multiple distinct delta categories are present -> mixed_change
  if (activeCategoryCount > 1) {
    return "mixed_change";
  }

  // Exactly one category is active:
  if (hasCapacityOps) {
    return "capacity_change";
  }

  if (hasRelOps) {
    return "dependency_change";
  }

  if (hasDeadlineOps) {
    return "deadline_change";
  }

  // Only hasItemOps is active: check the operations inside
  const ops = delta.itemOperations!;
  const opTypes = new Set(ops.map((o) => o.op));

  if (opTypes.size > 1) {
    return "mixed_change";
  }

  if (opTypes.has("add")) {
    return "new_item";
  }

  if (opTypes.has("remove")) {
    return "drop_item";
  }

  if (opTypes.has("modify")) {
    return "modified_item";
  }

  return "none_detected";
}

// ============================================================================
// Capacity Impact Calculator
// ============================================================================

export function calculateCapacityImpact(
  plan: ProposedWeek,
  delta: IncomingChangeDelta | undefined
): CapacityImpactAnalysis {
  const cap = plan.weekSummary.capacity;
  const previousTotalHours = cap.totalAvailableHours ?? null;
  const plannableHours = cap.plannableHours ?? null;
  const plannedHours = cap.plannedHours ?? null;
  const completeness = cap.estimationCompleteness;

  // Check if capacity operation exists in delta
  let projectedTotalHours = previousTotalHours;
  let deltaHours: number | null = 0;

  if (delta?.capacityOperations && delta.capacityOperations.length > 0) {
    const cOp = delta.capacityOperations[0];
    projectedTotalHours = cOp.newAvailableHours ?? null;
    if (previousTotalHours !== null && projectedTotalHours !== null) {
      deltaHours = projectedTotalHours - previousTotalHours;
    } else {
      deltaHours = null;
    }
  }

  // Determine item-level estimation delta
  let itemEstimateDelta = 0;
  let anyUnestimatedItemAddedOrModified = false;

  if (delta?.itemOperations) {
    for (const op of delta.itemOperations) {
      if (op.op === "add") {
        const itemHours = extractItemHours(op.item);
        if (itemHours != null) {
          itemEstimateDelta += itemHours;
        } else {
          anyUnestimatedItemAddedOrModified = true;
        }
      } else if (op.op === "remove") {
        // Find existing item estimate in plan
        const existingEst = findExistingItemEstimate(plan, op.itemId);
        if (existingEst != null) {
          itemEstimateDelta -= existingEst;
        } else {
          anyUnestimatedItemAddedOrModified = true;
        }
      } else if (op.op === "modify") {
        if (op.patch.estimatedHours !== undefined) {
          const oldEst = findExistingItemEstimate(plan, op.itemId);
          if (oldEst != null && op.patch.estimatedHours != null) {
            itemEstimateDelta += op.patch.estimatedHours - oldEst;
          } else {
            anyUnestimatedItemAddedOrModified = true;
          }
        }
      }
    }
  }

  // Capacity arithmetic balance logic:
  // 1. If totalAvailableHours is unknown (null) -> "unknown_capacity"
  if (projectedTotalHours === null) {
    return {
      previousTotalHours,
      projectedTotalHours,
      deltaHours,
      arithmeticBalance: "unknown_capacity",
      notes: "Total available hours is not specified; arithmetic balance cannot be computed.",
    };
  }

  // Calculate projected plannable hours:
  // If previousTotalHours was positive and plannableHours was known, preserve protected space ratio
  let projectedPlannableHours = plannableHours;
  if (previousTotalHours !== null && previousTotalHours > 0 && plannableHours !== null) {
    const plannableRatio = plannableHours / previousTotalHours;
    projectedPlannableHours = Math.round(projectedTotalHours * plannableRatio * 100) / 100;
  } else if (plannableHours === null) {
    projectedPlannableHours = projectedTotalHours;
  }

  if (projectedPlannableHours === null) {
    return {
      previousTotalHours,
      projectedTotalHours,
      deltaHours,
      arithmeticBalance: "unknown_capacity",
      notes: "Plannable capacity cannot be determined; arithmetic balance cannot be computed.",
    };
  }

  // 2. If estimations are incomplete or new unestimated items exist -> "indeterminate"
  // Exception: if known hours already strictly exceed plannable hours, deficit_known holds even if incomplete!
  const knownPlanned = plannedHours ?? 0;
  const projectedKnownPlanned = Math.max(0, knownPlanned + itemEstimateDelta);

  if (projectedKnownPlanned > projectedPlannableHours) {
    return {
      previousTotalHours,
      projectedTotalHours,
      deltaHours,
      arithmeticBalance: "deficit_known",
      notes: `Known estimated hours (${projectedKnownPlanned}h) exceed plannable capacity (${projectedPlannableHours}h).`,
    };
  }

  if (completeness !== "complete" || anyUnestimatedItemAddedOrModified) {
    return {
      previousTotalHours,
      projectedTotalHours,
      deltaHours,
      arithmeticBalance: "indeterminate",
      notes: `Estimation is incomplete (${completeness}); total required load cannot be certified. Known load is ${projectedKnownPlanned}h for ${plannableHours}h plannable.`,
    };
  }

  // 3. Complete estimations and within plannable hours -> "surplus_known"
  return {
    previousTotalHours,
    projectedTotalHours,
    deltaHours,
    arithmeticBalance: "surplus_known",
    notes: `All items have confirmed estimates. Projected planned hours (${projectedKnownPlanned}h) fit within plannable capacity (${plannableHours}h).`,
  };
}

function findExistingItemEstimate(plan: ProposedWeek, itemId: string): number | null {
  for (const focus of plan.foci) {
    if (focus.contributingItemIds.includes(itemId)) {
      // Focus estimate is aggregate, but let's check obligations/flexible
    }
  }
  for (const ob of plan.obligations) {
    if (ob.itemId === itemId) return ob.estimatedHours;
  }
  for (const fl of plan.flexibleOptions) {
    if (fl.itemId === itemId) return fl.estimatedHours;
  }
  return null;
}

// ============================================================================
// Pure Deterministic Analyzer
// ============================================================================

export function analyzeChangeDeterministically(input: AnalyzeChangeInput): AnalyzeChangeOutput {
  const { activePlan, changeDescription: _changeDescription, incomingDelta } = input;

  // 1. Validate references
  const { errors: validationErrors, fatal } = validateDeltaReferences(incomingDelta, activePlan);
  if (fatal) {
    return {
      status: "invalid_references",
      changeType: classifyChangeType(incomingDelta),
      summary: `Analysis blocked due to unresolved references: ${validationErrors.map((e) => e.message).join("; ")}`,
      affectedElements: [],
      capacityImpact: calculateCapacityImpact(activePlan, incomingDelta),
      unaffectedAreas: [],
      validationErrors,
      requiresUserIntervention: true,
      interventionReason:
        "One or more modified or deleted elements refer to IDs that do not exist in the active plan.",
    };
  }

  // 2. Classify change type
  const changeType = classifyChangeType(incomingDelta);

  // 3. Compute capacity impact
  const capacityImpact = calculateCapacityImpact(activePlan, incomingDelta);

  // If no delta operations and description indicates empty/chit-chat
  if (
    changeType === "none_detected" &&
    (!incomingDelta || Object.keys(incomingDelta).length === 0)
  ) {
    return {
      status: "no_impact",
      changeType: "none_detected",
      summary: "No change delta or structural modifications detected for the active plan.",
      affectedElements: [],
      capacityImpact,
      unaffectedAreas: [
        {
          areaName: "foci",
          elementIds: activePlan.foci.map((f) => f.id),
          isolationReason: "No modifications detected in input delta.",
        },
        {
          areaName: "obligations",
          elementIds: activePlan.obligations.map((o) => o.itemId),
          isolationReason: "No modifications detected in input delta.",
        },
      ],
      validationErrors: [],
      requiresUserIntervention: false,
      interventionReason: null,
    };
  }

  // 4. Trace affected elements & build isolation proofs
  const affectedElements: AffectedElement[] = [];
  const directlyTouchedItemIds = new Set<string>();

  // Process item operations
  if (incomingDelta?.itemOperations) {
    for (const op of incomingDelta.itemOperations) {
      if (op.op === "add") {
        directlyTouchedItemIds.add(op.item.id);
        affectedElements.push({
          elementId: op.item.id,
          elementType: "item",
          category: "direct_target",
          certainty: "confirmed",
          explanation: `New item "${op.item.title}" introduced into planning scope.`,
        });
      } else if (op.op === "remove") {
        directlyTouchedItemIds.add(op.itemId);
        // Find how it was scheduled in active plan
        const focus = activePlan.foci.find((f) => f.contributingItemIds.includes(op.itemId));
        if (focus) {
          affectedElements.push({
            elementId: focus.id,
            elementType: "focus",
            category: "focus_integrity",
            certainty: "confirmed",
            explanation: `Focus "${focus.title}" loses contributing item "${op.itemId}".`,
          });
        }
        const ob = activePlan.obligations.find((o) => o.itemId === op.itemId);
        if (ob) {
          affectedElements.push({
            elementId: ob.itemId,
            elementType: "obligation",
            category: "direct_target",
            certainty: "confirmed",
            explanation: `Obligation "${ob.title}" removed from active plan.`,
          });
        }
        const fl = activePlan.flexibleOptions.find((f) => f.itemId === op.itemId);
        if (fl) {
          affectedElements.push({
            elementId: fl.itemId,
            elementType: "flexible_option",
            category: "direct_target",
            certainty: "confirmed",
            explanation: `Flexible option "${fl.title}" removed from active plan.`,
          });
        }
      } else if (op.op === "modify") {
        directlyTouchedItemIds.add(op.itemId);
        // Check if modifying an item in a focus or obligation
        const focus = activePlan.foci.find((f) => f.contributingItemIds.includes(op.itemId));
        if (focus) {
          affectedElements.push({
            elementId: focus.id,
            elementType: "focus",
            category: "direct_target",
            certainty: "confirmed",
            explanation: `Focus "${focus.title}" element "${op.itemId}" attributes modified.`,
          });
        }
        const ob = activePlan.obligations.find((o) => o.itemId === op.itemId);
        if (ob) {
          affectedElements.push({
            elementId: ob.itemId,
            elementType: "obligation",
            category: "direct_target",
            certainty: "confirmed",
            explanation: `Obligation "${ob.title}" modified: ${JSON.stringify(op.patch)}.`,
          });
        }
      }
    }
  }

  // Process deadline operations
  if (incomingDelta?.deadlineOperations) {
    for (const dOp of incomingDelta.deadlineOperations) {
      directlyTouchedItemIds.add(dOp.itemId);
      const isObligation = activePlan.obligations.find((o) => o.itemId === dOp.itemId);
      const isFocus = activePlan.foci.find((f) => f.contributingItemIds.includes(dOp.itemId));

      const newDate = dOp.newDueDate;
      const targetStart = activePlan.weekSummary.targetWeek.startDate;
      const targetEnd = activePlan.weekSummary.targetWeek.endDate;

      let temporalScope: "current_week" | "future_week" | "past" | "timeless" = "timeless";
      if (newDate) {
        if (newDate < targetStart) {
          temporalScope = "past";
        } else if (newDate > targetEnd) {
          temporalScope = "future_week";
        } else {
          temporalScope = "current_week";
        }
      }

      affectedElements.push({
        elementId: dOp.itemId,
        elementType: isObligation ? "obligation" : isFocus ? "focus" : "item",
        category: "deadline_risk",
        certainty: "confirmed",
        temporalScope,
        commitmentNature: isObligation ? "external_commitment" : "internal_deadline",
        explanation: `Due date changed from ${dOp.previousDueDate ?? "none"} to ${dOp.newDueDate ?? "none"}. Scope: ${temporalScope}.`,
      });
    }
  }

  // Process relationship operations (causal dependencies)
  if (incomingDelta?.relationshipOperations) {
    for (const relOp of incomingDelta.relationshipOperations) {
      directlyTouchedItemIds.add(relOp.sourceItemId);
      directlyTouchedItemIds.add(relOp.targetItemId);

      if (relOp.type === "depends_on" || !relOp.type) {
        // Causal dependency: source depends on target
        // Check if target is satisfied, pending, or unknown in active plan
        const targetInPlan =
          activePlan.foci.some((f) => f.contributingItemIds.includes(relOp.targetItemId)) ||
          activePlan.obligations.some((o) => o.itemId === relOp.targetItemId) ||
          activePlan.flexibleOptions.some((fl) => fl.itemId === relOp.targetItemId);

        const targetDeferred = activePlan.deferredItems.some(
          (d) => d.itemId === relOp.targetItemId
        );

        let depState: "satisfied" | "pending" | "unknown" = "unknown";
        if (relOp.op === "remove") {
          depState = "satisfied"; // condition removed/unblocked
        } else if (targetInPlan) {
          depState = "pending";
        } else if (targetDeferred) {
          depState = "pending";
        }

        affectedElements.push({
          elementId: relOp.sourceItemId,
          elementType: "item",
          category: "causal_dependency",
          certainty: "confirmed",
          dependencyState: depState,
          explanation: `Causal dependency (${relOp.op}): "${relOp.sourceItemId}" depends on "${relOp.targetItemId}". State: ${depState}.`,
        });
      }
    }
  }

  // Process capacity operations
  if (incomingDelta?.capacityOperations && incomingDelta.capacityOperations.length > 0) {
    if (capacityImpact.arithmeticBalance === "deficit_known") {
      affectedElements.push({
        elementId: "capacity",
        elementType: "unplanned_space",
        category: "capacity_overload",
        certainty: "confirmed",
        explanation: `Available capacity reduced to ${capacityImpact.projectedTotalHours}h, causing an arithmetic deficit.`,
      });
    }
  }

  // 5. Positive Unafeected Areas Verification
  const unaffectedAreas: UnaffectedAreaVerification[] = [];

  // Check foci isolation
  const untouchedFoci = activePlan.foci.filter((f) => {
    return (
      !f.contributingItemIds.some((id) => directlyTouchedItemIds.has(id)) &&
      !affectedElements.some((ae) => ae.elementId === f.id)
    );
  });
  if (untouchedFoci.length > 0) {
    unaffectedAreas.push({
      areaName: "foci",
      elementIds: untouchedFoci.map((f) => f.id),
      isolationReason:
        "No items or dependencies within these foci were modified by the change delta.",
    });
  }

  // Check obligations isolation
  const untouchedObligations = activePlan.obligations.filter((o) => {
    return (
      !directlyTouchedItemIds.has(o.itemId) &&
      !affectedElements.some((ae) => ae.elementId === o.itemId)
    );
  });
  if (untouchedObligations.length > 0) {
    unaffectedAreas.push({
      areaName: "obligations",
      elementIds: untouchedObligations.map((o) => o.itemId),
      isolationReason:
        "No external commitments or obligations in this group were modified or affected by dependency changes.",
    });
  }

  // 6. User Intervention Triggers
  // Intervene ONLY if:
  // - Deficit known
  // - Critical deadline moved to past or outside feasible window
  // - Focus integrity broken (contributing item removed or invalidated)
  // - Pending dependency blocks an active obligation or focus
  // Note: Satisfied dependency (unblock) DOES NOT require intervention!
  let requiresUserIntervention = false;
  let interventionReason: string | null = null;

  if (capacityImpact.arithmeticBalance === "deficit_known") {
    requiresUserIntervention = true;
    interventionReason = "Arithmetic deficit detected: planned hours exceed available capacity.";
  } else if (affectedElements.some((ae) => ae.category === "focus_integrity")) {
    requiresUserIntervention = true;
    interventionReason = "A scheduled weekly focus lost one or more of its contributing items.";
  } else if (
    affectedElements.some(
      (ae) => ae.category === "causal_dependency" && ae.dependencyState === "pending"
    )
  ) {
    requiresUserIntervention = true;
    interventionReason = "An active work item is blocked by a pending causal dependency.";
  } else if (
    affectedElements.some((ae) => ae.category === "deadline_risk" && ae.temporalScope === "past")
  ) {
    requiresUserIntervention = true;
    interventionReason = "A deadline was moved to a date prior to the target week.";
  }

  return {
    status: "analyzed",
    changeType,
    summary: `Change analysis completed for ${changeType}. ${affectedElements.length} elements affected.`,
    affectedElements,
    capacityImpact,
    unaffectedAreas,
    validationErrors: [],
    requiresUserIntervention,
    interventionReason,
  };
}
