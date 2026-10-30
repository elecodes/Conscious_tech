import {
  type CloseWeekInput,
  type CloseWeekOutput,
  type ClassifiedPlanItem,
  type FocusOutcomeSummary,
  type ObligationOutcomeSummary,
  type CapacityAnalysis,
  type CarryOverCandidate,
  type ReflectiveSummary,
  type PlanCategoryOrigin,
  type ItemOutcomeInput,
  CloseWeekInputSchema,
} from "../../domain/close-week";
import type { StoreCandidate } from "../../domain/memory";
import type { ScheduleAdjustmentRecord, PostponeItemAction } from "../../domain/schedule";

interface RawPlanItem {
  itemId: string;
  title: string;
  originCategory: PlanCategoryOrigin;
  estimatedHours: number | null;
  dueDate?: string;
  parentFocusId?: string;
}

/**
 * Deterministic engine for Skill 11: close_week.
 * Evaluates reported outcomes against an active proposed week plan,
 * performs honest capacity balance, item conservation, non-punitive reflective synthesis,
 * and formulates unconfirmed memory candidates for human sovereignty.
 */
export function executeCloseWeekDeterministic(input: CloseWeekInput): CloseWeekOutput {
  // 1. Validate Schema
  const parseResult = CloseWeekInputSchema.safeParse(input);
  if (!parseResult.success) {
    const errorDetails = parseResult.error.issues.map(
      (iss) => `${iss.path.join(".")}: ${iss.message}`
    );
    return {
      status: "invalid_request",
      closedAt: input.closedAt || "1970-01-01T00:00:00Z",
      weekRange: input.activePlan?.weekSummary?.targetWeek || {
        startDate: "1970-01-01",
        endDate: "1970-01-07",
      },
      fociOutcomes: [],
      obligationsOutcomes: [],
      classifiedItems: [],
      itemDispositions: {
        completed: [],
        carryOverCandidates: [],
        dropped: [],
        unreported: [],
      },
      capacityAnalysis: {
        status: "no_actual_data",
        totalPlannedHours: null,
        totalActualHours: null,
        reportedHoursItemCount: 0,
        totalPlanItemCount: 0,
        protectedSpaceHours: null,
        spaceRespected: null,
        explanation: "La solicitud contiene errores estructurales en la entrada.",
      },
      memoryCandidates: [],
      reflectiveSummary: {
        headline: "Cierre no procesado por solicitud inválida.",
        accomplishments: [],
        inProgressWork: [],
        consciousPostponements: [],
        droppedItems: [],
        unreportedItems: [],
        questionsForNextCycle: [],
      },
      warnings: errorDetails,
    };
  }

  const validatedInput = parseResult.data;
  const warnings: string[] = [];

  // 2. Extract and index all plan items uniquely
  const planItemsMap = new Map<string, RawPlanItem>();
  const activePlan = validatedInput.activePlan;

  // Contributing items in foci
  for (const focus of activePlan.foci) {
    for (const itemId of focus.contributingItemIds) {
      if (!planItemsMap.has(itemId)) {
        planItemsMap.set(itemId, {
          itemId,
          title: focus.title, // fallback if item title not directly in contributingItemIds
          originCategory: "focus",
          estimatedHours: null,
          parentFocusId: focus.id,
        });
      }
    }
  }

  // Obligations
  for (const ob of activePlan.obligations) {
    planItemsMap.set(ob.itemId, {
      itemId: ob.itemId,
      title: ob.title,
      originCategory: "obligation",
      estimatedHours: ob.estimatedHours,
      dueDate: ob.dueDate,
    });
  }

  // Flexible options
  for (const opt of activePlan.flexibleOptions) {
    planItemsMap.set(opt.itemId, {
      itemId: opt.itemId,
      title: opt.title,
      originCategory: "flexible_option",
      estimatedHours: opt.estimatedHours,
    });
  }

  // Deferred items
  for (const def of activePlan.deferredItems) {
    planItemsMap.set(def.itemId, {
      itemId: def.itemId,
      title: def.title,
      originCategory: "deferred",
      estimatedHours: null,
    });
  }

  // 3. Process schedule applied adjustments for conscious postponements (ADR 0012 §8)
  interface RecognizedSchedulePostponement {
    record: ScheduleAdjustmentRecord;
    action: PostponeItemAction;
  }
  const schedulePostponementsMap = new Map<string, RecognizedSchedulePostponement>();

  if (validatedInput.schedule) {
    for (const record of validatedInput.schedule.appliedAdjustments) {
      // 1. Only consider actions of type "postpone_item"
      if (record.action.type !== "postpone_item") {
        continue;
      }

      // 2. Human decision must be accepted
      if (record.humanDecision !== "accepted") {
        continue;
      }

      // 3. Technical application outcome must be applied
      if (record.applicationOutcome !== "applied") {
        continue;
      }

      // 4. Lifecycle status must be active (not superseded or reverted)
      if (record.lifecycleStatus !== "active") {
        continue;
      }

      const itemId = record.action.itemId;

      // 5. Must belong to the plan being closed
      if (!planItemsMap.has(itemId)) {
        warnings.push(
          `El reajuste de postergación "${record.adjustmentId}" hace referencia al elemento "${itemId}", que no pertenece al plan activo; fue omitido sin alterar el cierre.`
        );
        continue;
      }

      // 6. Deterministic tie-breaker if multiple active postponements exist for same item
      if (schedulePostponementsMap.has(itemId)) {
        const existing = schedulePostponementsMap.get(itemId)!;
        const existingTime = existing.record.appliedAt || existing.record.decidedAt;
        const currentTime = record.appliedAt || record.decidedAt;

        if (currentTime >= existingTime) {
          warnings.push(
            `Se encontraron múltiples postergaciones activas para el elemento "${itemId}". Se utilizó la más reciente ("${record.adjustmentId}").`
          );
          schedulePostponementsMap.set(itemId, {
            record,
            action: record.action as PostponeItemAction,
          });
        } else {
          warnings.push(
            `Se encontraron múltiples postergaciones activas para el elemento "${itemId}". Se conservó la más reciente ("${existing.record.adjustmentId}").`
          );
        }
      } else {
        schedulePostponementsMap.set(itemId, {
          record,
          action: record.action as PostponeItemAction,
        });
      }
    }
  }

  // 4. Process item outcomes: detect contradictions, deduplicate identicals, isolate unknown references
  const outcomesByItemId = new Map<string, ItemOutcomeInput>();
  const reportedOutcomesList = new Map<string, ItemOutcomeInput[]>();

  for (const outcome of validatedInput.itemOutcomes) {
    if (!reportedOutcomesList.has(outcome.itemId)) {
      reportedOutcomesList.set(outcome.itemId, []);
    }
    reportedOutcomesList.get(outcome.itemId)!.push(outcome);
  }

  const conflictingItemIds = new Set<string>();

  for (const [itemId, reports] of reportedOutcomesList.entries()) {
    if (!planItemsMap.has(itemId)) {
      warnings.push(
        `El elemento reportado "${itemId}" no pertenece al plan activo y fue omitido de la clasificación semanal.`
      );
      continue;
    }

    if (reports.length === 1) {
      outcomesByItemId.set(itemId, reports[0]);
    } else {
      // Check if all reports for this itemId are identical
      const first = reports[0];
      const areIdentical = reports.every(
        (r) =>
          r.status === first.status &&
          (r.actualHours === first.actualHours ||
            (r.actualHours === undefined && first.actualHours === null) ||
            (r.actualHours === null && first.actualHours === undefined)) &&
          (r.userNotes || "") === (first.userNotes || "") &&
          (r.postponementReason || "") === (first.postponementReason || "")
      );

      if (areIdentical) {
        // Safe deduplication
        warnings.push(
          `Se encontraron múltiples reportes idénticos para el elemento "${itemId}". Se unificaron en una única entrada.`
        );
        outcomesByItemId.set(itemId, first);
      } else {
        // Contradictory reports: DO NOT choose silently!
        conflictingItemIds.add(itemId);
        warnings.push(
          `Conflicto en reportes para el elemento "${itemId}": se recibieron resultados contradictorios (${reports.map((r) => r.status).join(", ")}). No se elige silenciosamente; el elemento queda clasificado como no reportado y requiere aclaración.`
        );
      }
    }
  }

  // Cross-reference schedule postponements with reported outcomes
  const postponementEvidenceRefs = new Map<string, string>();
  const scheduleContradictionItemIds = new Set<string>();

  for (const [itemId, schedPostpone] of schedulePostponementsMap.entries()) {
    if (outcomesByItemId.has(itemId)) {
      const reported = outcomesByItemId.get(itemId)!;
      if (reported.status === "consciously_postponed") {
        // Concordance: user confirmed postponement explicitly
        postponementEvidenceRefs.set(itemId, schedPostpone.record.adjustmentId);
        if (!reported.postponementReason) {
          reported.postponementReason = schedPostpone.action.rationale;
        }
      } else {
        // Contradiction between schedule postponement and user report
        conflictingItemIds.add(itemId);
        scheduleContradictionItemIds.add(itemId);
        outcomesByItemId.delete(itemId);
        warnings.push(
          `Contradicción para el elemento "${itemId}": la agenda registra una postergación aplicada ("${schedPostpone.record.adjustmentId}"), pero el reporte de cierre declara "${reported.status}". No se elige arbitrariamente; el elemento queda como no reportado y requiere aclaración.`
        );
      }
    } else {
      // User did not report on this item: adopt schedule postponement if not in conflictingItemIds
      if (!conflictingItemIds.has(itemId)) {
        outcomesByItemId.set(itemId, {
          itemId,
          status: "consciously_postponed",
          postponementReason: schedPostpone.action.rationale,
          userNotes: schedPostpone.record.userNotes || schedPostpone.action.rationale,
        });
        postponementEvidenceRefs.set(itemId, schedPostpone.record.adjustmentId);
      }
    }
  }

  // 4. Classify 100% of plan items
  const classifiedItems: ClassifiedPlanItem[] = [];
  let hasUnreported = false;

  // Canonical sorting of items by itemId
  const allPlanItemIds = Array.from(planItemsMap.keys()).sort();

  for (const itemId of allPlanItemIds) {
    const raw = planItemsMap.get(itemId)!;
    const outcome = outcomesByItemId.get(itemId);

    if (!outcome) {
      // If it's a deferredItem from the plan, user didn't have an obligation to report on it
      // but in the plan it was deferred. We classify as 'unreported' disposition.
      hasUnreported = true;
      const isConflicting = conflictingItemIds.has(itemId);
      const userNotes = scheduleContradictionItemIds.has(itemId)
        ? "Contradicción entre la postergación registrada en la agenda y el resultado reportado; requiere aclaración."
        : isConflicting
          ? "Reportes contradictorios recibidos; requiere aclaración."
          : undefined;

      classifiedItems.push({
        itemId: raw.itemId,
        title: raw.title,
        originCategory: raw.originCategory,
        finalDisposition: "unreported",
        estimatedHours: raw.estimatedHours,
        actualHours: null,
        isReported: false,
        userNotes,
      });
    } else {
      classifiedItems.push({
        itemId: raw.itemId,
        title: raw.title,
        originCategory: raw.originCategory,
        finalDisposition: outcome.status,
        estimatedHours: raw.estimatedHours,
        actualHours: outcome.actualHours !== undefined ? outcome.actualHours : null,
        isReported: true,
        userNotes: outcome.userNotes,
        postponementReason: outcome.postponementReason,
      });
    }
  }

  // 5. Compute Foci Outcomes
  const fociOutcomes: FocusOutcomeSummary[] = [];
  const classifiedByItemId = new Map(classifiedItems.map((c) => [c.itemId, c]));

  for (const focus of activePlan.foci) {
    const contributing = focus.contributingItemIds.slice().sort();
    const completed: string[] = [];
    const pending: string[] = [];
    const unreported: string[] = [];

    for (const cId of contributing) {
      const item = classifiedByItemId.get(cId);
      if (!item || !item.isReported || item.finalDisposition === "unreported") {
        unreported.push(cId);
      } else if (item.finalDisposition === "completed") {
        completed.push(cId);
      } else {
        pending.push(cId);
      }
    }

    let outcomeStatus: FocusOutcomeSummary["outcome"] = "unreported";
    if (completed.length === contributing.length && contributing.length > 0) {
      outcomeStatus = "achieved";
    } else if (completed.length > 0) {
      outcomeStatus = "partially_achieved";
    } else if (unreported.length === contributing.length && contributing.length > 0) {
      outcomeStatus = "unreported";
    } else if (
      pending.some((id) => classifiedByItemId.get(id)?.finalDisposition === "dropped") &&
      pending.every(
        (id) =>
          classifiedByItemId.get(id)?.finalDisposition === "dropped" ||
          classifiedByItemId.get(id)?.finalDisposition === "unreported"
      )
    ) {
      outcomeStatus = "dropped";
    } else {
      outcomeStatus = "deferred";
    }

    fociOutcomes.push({
      focusId: focus.id,
      title: focus.title,
      outcome: outcomeStatus,
      contributingItemIds: contributing,
      completedItemIds: completed,
      pendingItemIds: pending,
      unreportedItemIds: unreported,
    });
  }

  // 6. Compute Obligations Outcomes
  const obligationsOutcomes: ObligationOutcomeSummary[] = [];
  for (const ob of activePlan.obligations) {
    const item = classifiedByItemId.get(ob.itemId);
    let outcome: ObligationOutcomeSummary["outcome"] = "unreported";

    if (item && item.isReported) {
      if (item.finalDisposition === "completed") {
        outcome = "completed";
      } else if (item.finalDisposition === "in_progress") {
        outcome = "in_progress";
      } else if (item.finalDisposition === "consciously_postponed") {
        outcome = "postponed";
      } else if (item.finalDisposition === "dropped") {
        outcome = "dropped";
      } else {
        outcome = "unreported";
      }
    }

    obligationsOutcomes.push({
      itemId: ob.itemId,
      title: ob.title,
      outcome,
      dueDate: ob.dueDate,
    });
  }

  // 7. Partition Item Dispositions (Strict Disjoint Sets)
  const completedIds: string[] = [];
  const carryOverCandidates: CarryOverCandidate[] = [];
  const droppedIds: string[] = [];
  const unreportedIds: string[] = [];

  for (const item of classifiedItems) {
    switch (item.finalDisposition) {
      case "completed":
        completedIds.push(item.itemId);
        break;

      case "in_progress":
        carryOverCandidates.push({
          itemId: item.itemId,
          title: item.title,
          originCategory: item.originCategory,
          reason: "in_progress",
          details:
            item.userNotes || "Trabajo en curso que conserva impulso para el siguiente ciclo.",
        });
        break;

      case "not_started":
        carryOverCandidates.push({
          itemId: item.itemId,
          title: item.title,
          originCategory: item.originCategory,
          reason: "not_started",
          details:
            "Elemento planificado sin comenzar; candidato a reconsiderar sin reactivación automática.",
        });
        break;

      case "consciously_postponed":
        carryOverCandidates.push({
          itemId: item.itemId,
          title: item.title,
          originCategory: item.originCategory,
          reason: "consciously_postponed",
          details:
            item.postponementReason ||
            item.userNotes ||
            "Postergación consciente decidida durante la semana.",
        });
        break;

      case "dropped":
        droppedIds.push(item.itemId);
        break;

      case "unreported":
        if (item.originCategory === "deferred") {
          // Deferred items without report stay quietly as not_scheduled carryover candidates
          carryOverCandidates.push({
            itemId: item.itemId,
            title: item.title,
            originCategory: item.originCategory,
            reason: "not_scheduled",
            details: "Elemento previamente diferido que continúa disponible en el radar.",
          });
        } else {
          unreportedIds.push(item.itemId);
          carryOverCandidates.push({
            itemId: item.itemId,
            title: item.title,
            originCategory: item.originCategory,
            reason: "unreported",
            details: "Sin reporte de estado; pendiente de revisión consciente antes de planificar.",
          });
        }
        break;
    }
  }

  // 8. Honest Capacity & Space Analysis
  const planSummary = activePlan.weekSummary;
  const totalPlannedHours = planSummary.capacity.plannedHours;
  const plannableHours = planSummary.capacity.plannableHours;
  const protectedSpaceHours = planSummary.capacity.protectedSpaceHours;

  let reportedHoursSum = 0;
  let itemsWithActualHoursCount = 0;

  for (const item of classifiedItems) {
    if (item.actualHours !== null && item.actualHours !== undefined) {
      reportedHoursSum += item.actualHours;
      itemsWithActualHoursCount++;
    }
  }

  let capacityStatus: CapacityAnalysis["status"] = "no_actual_data";
  let spaceRespected: boolean | null = null;
  let explanation = "";

  const totalPlanCount = classifiedItems.length;

  if (totalPlanCount === 0) {
    capacityStatus = "complete";
    spaceRespected = true;
    explanation = "La semana no contenía elementos planificados ni horas asignadas.";
  } else if (itemsWithActualHoursCount === 0) {
    capacityStatus = "no_actual_data";
    spaceRespected = null;
    explanation =
      "No se registraron horas reales dedicadas; no es posible evaluar el balance de capacidad.";
  } else if (itemsWithActualHoursCount < totalPlanCount) {
    capacityStatus = "partial";
    spaceRespected = null;
    explanation = `Registro parcial de horas reales (${itemsWithActualHoursCount} de ${totalPlanCount} elementos reportados, sumando ${reportedHoursSum.toFixed(1)} h). No se puede determinar si se respetó el espacio protegido.`;
  } else {
    // 100% of items have reported actual hours
    capacityStatus = "complete";
    if (plannableHours !== null) {
      spaceRespected = reportedHoursSum <= plannableHours;
      const spaceLabel =
        protectedSpaceHours !== null ? ` (${protectedSpaceHours.toFixed(1)} h)` : "";
      explanation = spaceRespected
        ? `Horas reales reportadas (${reportedHoursSum.toFixed(1)} h) dentro del límite planificable (${plannableHours.toFixed(1)} h), respetando el espacio protegido${spaceLabel}.`
        : `Horas reales reportadas (${reportedHoursSum.toFixed(1)} h) superaron el límite de trabajo planificable (${plannableHours.toFixed(1)} h), reduciendo el margen de espacio protegido${spaceLabel}.`;
    } else if (planSummary.capacity.totalAvailableHours !== null && protectedSpaceHours !== null) {
      const maxAllowedWorkHours = planSummary.capacity.totalAvailableHours - protectedSpaceHours;
      spaceRespected = reportedHoursSum <= maxAllowedWorkHours;
      explanation = spaceRespected
        ? `Horas reales reportadas (${reportedHoursSum.toFixed(1)} h) dentro del límite planificable, respetando el espacio protegido (${protectedSpaceHours.toFixed(1)} h).`
        : `Horas reales reportadas (${reportedHoursSum.toFixed(1)} h) superaron el límite de trabajo planificable, reduciendo el margen de espacio protegido.`;
    } else {
      spaceRespected = null;
      explanation = `Se registraron horas reales para todos los elementos (${reportedHoursSum.toFixed(1)} h), pero la capacidad planificable o el espacio protegido original eran desconocidos.`;
    }
  }

  const capacityAnalysis: CapacityAnalysis = {
    status: capacityStatus,
    totalPlannedHours: totalPlannedHours !== undefined ? totalPlannedHours : null,
    totalActualHours: itemsWithActualHoursCount > 0 ? Number(reportedHoursSum.toFixed(2)) : null,
    reportedHoursItemCount: itemsWithActualHoursCount,
    totalPlanItemCount: totalPlanCount,
    protectedSpaceHours: protectedSpaceHours !== undefined ? protectedSpaceHours : null,
    spaceRespected,
    explanation,
  };

  // 9. Formulate Unconfirmed Memory Candidates
  const memoryCandidates: StoreCandidate[] = [];
  let candidateIndex = 1;

  // A. Candidate for achieved foci (Category: fact, unconfirmed)
  for (const focus of fociOutcomes) {
    if (focus.outcome === "achieved") {
      memoryCandidates.push({
        candidateId: `mem-close-${candidateIndex++}`,
        actionIntent: "store",
        rawText: `Foco semanal completado con éxito: "${focus.title}" (${focus.completedItemIds.length} elementos completados).`,
        suggestedCategory: "fact",
        isExplicitUserStatement: false,
        provenanceSource: "conversation_inference",
      });
    }
  }

  // B. Candidate for explicit conscious postponements (Category: decision, unconfirmed)
  const consciousItems = classifiedItems.filter(
    (c) => c.finalDisposition === "consciously_postponed"
  );
  if (consciousItems.length > 0) {
    const titles = consciousItems.map((c) => `"${c.title}"`).join(", ");
    const evidenceRefs = consciousItems
      .map((c) => postponementEvidenceRefs.get(c.itemId))
      .filter((ref): ref is string => Boolean(ref));

    memoryCandidates.push({
      candidateId: `mem-close-${candidateIndex++}`,
      actionIntent: "store",
      rawText: `Decisión de postergación consciente durante la semana: ${titles}.`,
      suggestedCategory: "decision",
      isExplicitUserStatement: false,
      provenanceSource: "plan_decision",
      evidenceReference: evidenceRefs.length > 0 ? evidenceRefs.join(", ") : undefined,
    });
  }

  // C. Candidate from general user reflection notes (Category: preference / context, unconfirmed)
  if (
    validatedInput.userReflection?.generalNotes &&
    validatedInput.userReflection.generalNotes.trim().length > 0
  ) {
    memoryCandidates.push({
      candidateId: `mem-close-${candidateIndex++}`,
      actionIntent: "store",
      rawText: validatedInput.userReflection.generalNotes.trim(),
      suggestedCategory: "project_context",
      isExplicitUserStatement: true,
      provenanceSource: "user_explicit",
    });
  }

  // 10. Reflective Synthesis (Non-punitive, calm tone)
  const accomplishments: string[] = [];
  for (const f of fociOutcomes) {
    if (f.outcome === "achieved") {
      accomplishments.push(`Foco alcanzado: ${f.title}`);
    } else if (f.outcome === "partially_achieved") {
      accomplishments.push(
        `Foco con avance significativo: ${f.title} (${f.completedItemIds.length} elementos completados)`
      );
    }
  }
  for (const cId of completedIds) {
    const item = classifiedByItemId.get(cId);
    if (item && item.originCategory === "obligation") {
      accomplishments.push(`Compromiso completado: ${item.title}`);
    }
  }

  const inProgressWork: string[] = classifiedItems
    .filter((c) => c.finalDisposition === "in_progress")
    .map((c) => `${c.title} (en curso)`);

  const consciousPostponements: string[] = classifiedItems
    .filter((c) => c.finalDisposition === "consciously_postponed")
    .map((c) => `${c.title}${c.postponementReason ? ` — Motivo: ${c.postponementReason}` : ""}`);

  const droppedItemsText: string[] = classifiedItems
    .filter((c) => c.finalDisposition === "dropped")
    .map((c) => `${c.title} (descartado de la atención actual)`);

  const unreportedItemsText: string[] = classifiedItems
    .filter((c) => c.finalDisposition === "unreported" && c.originCategory !== "deferred")
    .map((c) => `${c.title} (sin reporte)`);

  const questionsForNextCycle: string[] = [];
  if (carryOverCandidates.length > 0) {
    questionsForNextCycle.push(
      `Hay ${carryOverCandidates.length} elementos pendientes o en curso. ¿Cuáles de ellos tienen sentido para tu siguiente semana?`
    );
  }
  if (capacityAnalysis.status === "partial" || capacityAnalysis.status === "no_actual_data") {
    questionsForNextCycle.push(
      "¿Te gustaría registrar estimaciones u horas dedicadas con mayor detalle para calibrar mejor tu espacio protegido?"
    );
  }
  if (validatedInput.userReflection?.energyLevel === "drained") {
    questionsForNextCycle.push(
      "Notaste un nivel de energía bajo al cierre. ¿Conviene reservar más espacio protegido en el siguiente plan?"
    );
  }

  let headline = "Cierre de semana completado.";
  if (
    accomplishments.length > 0 &&
    inProgressWork.length === 0 &&
    consciousPostponements.length === 0
  ) {
    headline = "Semana completada con los focos previstos.";
  } else if (consciousPostponements.length > 0) {
    headline = "Semana con foco y decisiones conscientes de postergación.";
  } else if (hasUnreported) {
    headline = "Cierre de semana con información parcial reportada.";
  }

  const reflectiveSummary: ReflectiveSummary = {
    headline,
    accomplishments,
    inProgressWork,
    consciousPostponements,
    droppedItems: droppedItemsText,
    unreportedItems: unreportedItemsText,
    questionsForNextCycle,
  };

  // 11. Determine Global Status
  const globalStatus: CloseWeekOutput["status"] = hasUnreported ? "partial_data" : "success";

  return {
    status: globalStatus,
    closedAt: validatedInput.closedAt,
    weekRange: activePlan.weekSummary.targetWeek,
    fociOutcomes,
    obligationsOutcomes,
    classifiedItems,
    itemDispositions: {
      completed: completedIds,
      carryOverCandidates,
      dropped: droppedIds,
      unreported: unreportedIds,
    },
    capacityAnalysis,
    memoryCandidates,
    reflectiveSummary,
    warnings,
  };
}
