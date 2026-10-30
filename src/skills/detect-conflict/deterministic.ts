import {
  DetectConflictInput,
  DetectConflictOutput,
  DetectedConflict,
  UnconflictedAreaVerification,
} from "../../domain/conflict";

// ============================================================================
// Helper: Check interval overlap (HH:MM strings)
// ============================================================================
function isTimeIntervalOverlapping(
  startA: string,
  endA: string,
  startB: string,
  endB: string
): boolean {
  return startA < endB && startB < endA;
}

// ============================================================================
// Deterministic Conflict Detection Engine
// ============================================================================
export function detectConflictsDeterministically(input: DetectConflictInput): DetectConflictOutput {
  const {
    activePlan,
    changeAnalysis,
    relationships = [],
    dayConstraints = [],
    timeBlocks = [],
    dailyAllocations = [],
  } = input;

  const conflicts: DetectedConflict[] = [];
  const conflictingElementIds = new Set<string>();

  // --------------------------------------------------------------------------
  // 1. Weekly Capacity Deficit Detection
  // --------------------------------------------------------------------------
  const cap = activePlan.weekSummary.capacity;
  const plannableHours = cap.plannableHours;
  const totalAvailable = cap.totalAvailableHours;

  // Compute total confirmed planned hours
  let confirmedPlannedHours = cap.plannedHours ?? 0;
  let hasIncompleteEstimates = cap.estimationCompleteness !== "complete";

  let sumItemHours = 0;
  for (const focus of activePlan.foci) {
    if (focus.estimatedHours !== null) {
      sumItemHours += focus.estimatedHours;
    } else {
      hasIncompleteEstimates = true;
    }
  }
  for (const ob of activePlan.obligations) {
    if (ob.estimatedHours !== null) {
      sumItemHours += ob.estimatedHours;
    } else {
      hasIncompleteEstimates = true;
    }
  }

  if (sumItemHours > 0) {
    confirmedPlannedHours = Math.max(confirmedPlannedHours, sumItemHours);
  }

  // Also include change analysis if present
  if (changeAnalysis?.capacityImpact) {
    if (changeAnalysis.capacityImpact.arithmeticBalance === "deficit_known") {
      conflicts.push({
        id: "conflict-cap-deficit-change",
        type: "capacity_deficit",
        certainty: "confirmed",
        scope: "weekly",
        title: "Déficit de capacidad semanal tras cambio",
        explanation: changeAnalysis.capacityImpact.notes,
        involvedElementIds: ["weekly_capacity"],
        evidence: {
          metric: "hours_balance",
          description: "Horas planificadas exceden la capacidad disponible proyectada.",
          availableOrRequired: changeAnalysis.capacityImpact.projectedTotalHours ?? 0,
          conflictingValue: confirmedPlannedHours,
        },
      });
      conflictingElementIds.add("weekly_capacity");
    }
  }

  if (plannableHours !== null) {
    if (confirmedPlannedHours > plannableHours) {
      conflicts.push({
        id: "conflict-weekly-capacity-deficit",
        type: "capacity_deficit",
        certainty: "confirmed",
        scope: "weekly",
        title: "Déficit de capacidad semanal confirmado",
        explanation: `Las horas estimadas confirmadas (${confirmedPlannedHours} h) superan la capacidad planificable de la semana (${plannableHours} h).`,
        involvedElementIds: ["weekly_capacity"],
        evidence: {
          metric: "hours_balance",
          description: "Capacidad planificable vs horas estimadas totales",
          availableOrRequired: plannableHours,
          conflictingValue: confirmedPlannedHours,
        },
      });
      conflictingElementIds.add("weekly_capacity");
    } else if (hasIncompleteEstimates && confirmedPlannedHours >= plannableHours * 0.9) {
      // Near ceiling with missing estimates -> insufficient_information
      conflicts.push({
        id: "conflict-weekly-capacity-uncertain",
        type: "capacity_deficit",
        certainty: "insufficient_information",
        scope: "weekly",
        title: "Tensión de capacidad con estimaciones incompletas",
        explanation: `El plan conocido consume ${confirmedPlannedHours} h de ${plannableHours} h disponibles, pero existen elementos sin estimar que podrían desbordar la capacidad.`,
        involvedElementIds: ["weekly_capacity"],
        evidence: {
          metric: "hours_balance",
          description: "Horas conocidas cercanas al límite con datos incompletos",
          availableOrRequired: plannableHours,
          conflictingValue: confirmedPlannedHours,
        },
      });
    }
  }

  // --------------------------------------------------------------------------
  // 2. Daily Capacity Deficit (Explicit Window Allocations)
  // --------------------------------------------------------------------------
  for (const constraint of dayConstraints) {
    const dayAllocations = dailyAllocations.filter((a) => a.day === constraint.day);
    const dayAllocatedHours = dayAllocations.reduce((sum, a) => sum + a.allocatedHours, 0);

    if (dayAllocatedHours > constraint.availableHours) {
      conflicts.push({
        id: `conflict-daily-capacity-${constraint.day}`,
        type: "capacity_deficit",
        certainty: "confirmed",
        scope: "daily",
        title: `Déficit de capacidad en ventana diaria (${constraint.day})`,
        explanation: `El trabajo asignado explícitamente a ${constraint.day} (${dayAllocatedHours} h) supera el límite disponible del día (${constraint.availableHours} h).`,
        involvedElementIds: dayAllocations.map((a) => a.itemId),
        evidence: {
          metric: "hours_balance",
          description: `Disponibilidad diaria de ${constraint.day} excedida`,
          availableOrRequired: constraint.availableHours,
          conflictingValue: dayAllocatedHours,
        },
      });
      dayAllocations.forEach((a) => conflictingElementIds.add(a.itemId));
    }
  }

  // --------------------------------------------------------------------------
  // 3. Schedule Overlap (Fixed Time Blocks Colision)
  // --------------------------------------------------------------------------
  for (let i = 0; i < timeBlocks.length; i++) {
    for (let j = i + 1; j < timeBlocks.length; j++) {
      const b1 = timeBlocks[i];
      const b2 = timeBlocks[j];

      if (
        b1.day === b2.day &&
        isTimeIntervalOverlapping(b1.startTime, b1.endTime, b2.startTime, b2.endTime)
      ) {
        conflicts.push({
          id: `conflict-schedule-overlap-${b1.itemId}-${b2.itemId}`,
          type: "schedule_overlap",
          certainty: "confirmed",
          scope: "daily",
          title: `Solapamiento de horario fijo el ${b1.day}`,
          explanation: `Los bloques horarios para "${b1.itemId}" (${b1.startTime}-${b1.endTime}) y "${b2.itemId}" (${b2.startTime}-${b2.endTime}) colisionan en la misma franja.`,
          involvedElementIds: [b1.itemId, b2.itemId],
          evidence: {
            metric: "fixed_time_interval",
            description: "Intervalos horarios superpuestos",
            availableOrRequired: `${b1.startTime}-${b1.endTime}`,
            conflictingValue: `${b2.startTime}-${b2.endTime}`,
          },
        });
        conflictingElementIds.add(b1.itemId);
        conflictingElementIds.add(b2.itemId);
      }
    }
  }

  // --------------------------------------------------------------------------
  // 4. Dependency Blocks & Temporal Incompatibility
  // --------------------------------------------------------------------------
  const deferredItemIds = new Set(activePlan.deferredItems.map((d) => d.itemId));
  const activeItemIds = new Set<string>();
  for (const focus of activePlan.foci) {
    focus.contributingItemIds.forEach((id) => activeItemIds.add(id));
  }
  for (const ob of activePlan.obligations) {
    activeItemIds.add(ob.itemId);
  }
  for (const fl of activePlan.flexibleOptions) {
    activeItemIds.add(fl.itemId);
  }

  // Strict depends_on checking only
  const causalRelations = relationships.filter((r) => r.type === "depends_on");

  for (const rel of causalRelations) {
    const sourceId = rel.sourceItemId; // dependent
    const targetId = rel.targetItemId; // prerequisite

    const isSourceActive = activeItemIds.has(sourceId);
    const isTargetDeferred = deferredItemIds.has(targetId);

    // If source is active in plan and prerequisite is deferred -> confirmed block
    if (isSourceActive && isTargetDeferred) {
      conflicts.push({
        id: `conflict-blocked-dep-${sourceId}-${targetId}`,
        type: "blocked_by_dependency",
        certainty: "confirmed",
        scope: "task",
        title: `Dependencia bloqueante activa sobre elemento postergado`,
        explanation: `El elemento activo "${sourceId}" depende causalmente de "${targetId}", que ha sido postergado o no está programado.`,
        involvedElementIds: [sourceId, targetId],
        evidence: {
          metric: "dependency_state",
          description: "Prerrequisito en estado postergado",
          availableOrRequired: "completado o en curso",
          conflictingValue: "deferred",
        },
      });
      conflictingElementIds.add(sourceId);
      conflictingElementIds.add(targetId);
    }

    // Check dates in dependency chain
    const sourceObligation = activePlan.obligations.find((o) => o.itemId === sourceId);
    const targetObligation = activePlan.obligations.find((o) => o.itemId === targetId);

    if (sourceObligation?.dueDate && targetObligation?.dueDate) {
      if (targetObligation.dueDate > sourceObligation.dueDate) {
        // If both have strict external commitment dates -> confirmed
        // If internal or movable dates -> potential
        const isStrictIncompatibility =
          sourceObligation.commitmentType === "external" &&
          targetObligation.commitmentType === "external";

        conflicts.push({
          id: `conflict-deadline-incompatibility-${sourceId}-${targetId}`,
          type: "deadline_incompatibility",
          certainty: isStrictIncompatibility ? "confirmed" : "potential",
          scope: "task",
          title: `Incompatibilidad de fechas en cadena de dependencias`,
          explanation: `El prerrequisito "${targetId}" tiene fecha límite (${targetObligation.dueDate}) posterior a su sucesor "${sourceId}" (${sourceObligation.dueDate}).`,
          involvedElementIds: [sourceId, targetId],
          evidence: {
            metric: "calendar_dates",
            description: "Fecha de prerrequisito posterior a fecha de entrega sucesora",
            availableOrRequired: sourceObligation.dueDate,
            conflictingValue: targetObligation.dueDate,
          },
        });
        conflictingElementIds.add(sourceId);
        conflictingElementIds.add(targetId);
      }
    }
  }

  // --------------------------------------------------------------------------
  // 5. Positive Unconflicted Area Verification
  // --------------------------------------------------------------------------
  const unconflictedAreas: UnconflictedAreaVerification[] = [];

  // Only verify areas if capacity is known and complete, or if the area is completely isolated
  const isCapacityKnown = totalAvailable !== null && plannableHours !== null;
  const areEstimatesFullyKnown = cap.estimationCompleteness === "complete";

  // Check foci isolation
  const validFoci = activePlan.foci.filter((f) => {
    const hasConflictingItem = f.contributingItemIds.some((id) => conflictingElementIds.has(id));
    const allItemsEstimated = f.estimatedHours !== null;
    return !hasConflictingItem && isCapacityKnown && areEstimatesFullyKnown && allItemsEstimated;
  });

  if (validFoci.length > 0) {
    unconflictedAreas.push({
      areaName: "foci",
      elementIds: validFoci.map((f) => f.id),
      verificationReason:
        "Focos verificados positivamente: sin dependencias bloqueantes, estimaciones completas y margen asegurado.",
    });
  }

  // Check obligations isolation
  const validObligations = activePlan.obligations.filter((o) => {
    return !conflictingElementIds.has(o.itemId) && o.estimatedHours !== null && isCapacityKnown;
  });

  if (validObligations.length > 0) {
    unconflictedAreas.push({
      areaName: "obligations",
      elementIds: validObligations.map((o) => o.itemId),
      verificationReason:
        "Obligaciones verificadas positivamente: sin solapamientos horarios ni dependencias bloqueantes.",
    });
  }

  // --------------------------------------------------------------------------
  // 6. Deterministic Status and Blocking Evaluation
  // --------------------------------------------------------------------------
  const hasConfirmedConflicts = conflicts.some((c) => c.certainty === "confirmed");
  const hasPotentialOrUncertain = conflicts.some(
    (c) => c.certainty === "potential" || c.certainty === "insufficient_information"
  );

  const hasBlockingConflicts = hasConfirmedConflicts;

  let status: "conflicts_detected" | "no_conflicts" | "potential_risks_only" = "no_conflicts";
  if (hasConfirmedConflicts) {
    status = "conflicts_detected";
  } else if (hasPotentialOrUncertain) {
    status = "potential_risks_only";
  }

  let summary = "No se han detectado conflictos estructurales en el plan analizado.";
  if (status === "conflicts_detected") {
    summary = `Se han detectado ${conflicts.filter((c) => c.certainty === "confirmed").length} conflicto(s) confirmado(s) que impiden ejecutar el plan tal como está formulado.`;
  } else if (status === "potential_risks_only") {
    summary = `No hay bloqueos confirmados, pero existen ${conflicts.length} riesgo(s) potencial(es) o áreas con información insuficiente.`;
  }

  return {
    status,
    summary,
    conflicts,
    unconflictedAreas,
    hasBlockingConflicts,
  };
}
