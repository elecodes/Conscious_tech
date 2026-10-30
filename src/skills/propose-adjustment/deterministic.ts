import {
  ProposeAdjustmentInput,
  ProposeAdjustmentOutput,
  AdjustmentProposal,
  SuggestedAdjustmentAction,
  getAllPlanItemIds,
  validateProposalInvariants,
} from "../../domain/adjustment";
import { DetectConflictOutput } from "../../domain/conflict";
import { detectConflictsDeterministically } from "../detect-conflict/deterministic";

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
// Deterministic Adjustment Engine
// ============================================================================

export function proposeAdjustmentsDeterministically(
  input: ProposeAdjustmentInput
): ProposeAdjustmentOutput {
  const {
    activePlan,
    changeAnalysis,
    timeBlocks = [],
    dailyAllocations = [],
    relationships = [],
    dayConstraints = [],
    userPreferences = { maxProposals: 3 },
  } = input;

  const maxProposals = userPreferences.maxProposals ?? 3;

  // 1. Resolve conflict report
  let conflictReport: DetectConflictOutput;
  if (input.conflictReport) {
    conflictReport = input.conflictReport;
  } else {
    conflictReport = detectConflictsDeterministically({
      currentDate: activePlan.weekSummary.targetWeek.startDate,
      activePlan,
      changeAnalysis,
      relationships,
      dayConstraints,
      timeBlocks,
      dailyAllocations,
    });
  }

  const conflicts = conflictReport.conflicts;
  const allPlanIds = getAllPlanItemIds(activePlan);
  const previouslyDeferredIds = new Set(activePlan.deferredItems.map((d) => d.itemId));

  const cap = activePlan.weekSummary.capacity;
  const origPlanned = cap.plannedHours;
  const plannable = cap.plannableHours;
  const totalAvailable = cap.totalAvailableHours;

  // --------------------------------------------------------------------------
  // Check 1: Missing Essential Capacity Information
  // --------------------------------------------------------------------------
  if (totalAvailable === null || plannable === null) {
    return {
      status: "clarification_required",
      unaddressedConflictIds: conflicts.map((c) => c.id),
      proposals: [],
      clarificationQuestions: [
        "Por favor define las horas disponibles de la semana para evaluar la capacidad y balance de carga.",
      ],
      summary:
        "No es posible evaluar la viabilidad matemática de ajustes porque la capacidad semanal no está definida.",
    };
  }

  // --------------------------------------------------------------------------
  // Check 2: Perfectly Balanced / No Adjustments Needed
  // --------------------------------------------------------------------------
  if (
    conflicts.length === 0 &&
    cap.capacityStatus === "within_capacity" &&
    cap.estimationCompleteness === "complete"
  ) {
    return {
      status: "no_adjustment_needed",
      unaddressedConflictIds: [],
      proposals: [],
      clarificationQuestions: [],
      summary: "El plan está equilibrado y verificado positivamente sin conflictos ni sobrecargas.",
    };
  }

  // --------------------------------------------------------------------------
  // Check 3: Missing Estimates with Uncertainty (No confirmed conflicts, but tension)
  // --------------------------------------------------------------------------
  const confirmedConflicts = conflicts.filter((c) => c.certainty === "confirmed");
  const potentialConflicts = conflicts.filter((c) => c.certainty === "potential");
  const uncertainConflicts = conflicts.filter((c) => c.certainty === "insufficient_information");

  if (confirmedConflicts.length === 0 && uncertainConflicts.length > 0) {
    return {
      status: "clarification_required",
      unaddressedConflictIds: conflicts.map((c) => c.id),
      proposals: [],
      clarificationQuestions: [
        "Existen tareas clave sin estimación horaria. Por favor indica las horas estimadas para poder calcular el balance de capacidad.",
      ],
      summary:
        "Faltan estimaciones de tiempo esenciales para certificar la holgura del plan o calcular propuestas viables.",
    };
  }

  // --------------------------------------------------------------------------
  // 4. Generate Strategy Proposals
  // --------------------------------------------------------------------------
  const proposals: AdjustmentProposal[] = [];

  // Helper to build partition and breakdown
  const buildProposal = (params: {
    id: string;
    strategy: AdjustmentProposal["strategy"];
    title: string;
    explanation: string;
    viability: AdjustmentProposal["viability"];
    viabilityCondition: string | null;
    addressedConflictIds: string[];
    resolvedConflictIds: string[];
    netHoursFreed: number | null;
    resultingPlannedHours: number | null;
    affectedPlanItemIds: string[];
    actions: SuggestedAdjustmentAction[];
    tradeoffs: string[];
  }): AdjustmentProposal => {
    const affectedSet = new Set(params.affectedPlanItemIds);
    const retainedPlanItemIds = Array.from(allPlanIds).filter(
      (id) => !affectedSet.has(id) && !previouslyDeferredIds.has(id)
    );
    const previouslyDeferredItemIds = Array.from(previouslyDeferredIds);

    const resolvedSet = new Set(params.resolvedConflictIds);
    const unresolvedConflictIds = conflicts.map((c) => c.id).filter((id) => !resolvedSet.has(id));

    const unresolvedBreakdown = {
      confirmed: conflicts
        .filter((c) => c.certainty === "confirmed" && !resolvedSet.has(c.id))
        .map((c) => c.id),
      potential: conflicts
        .filter((c) => c.certainty === "potential" && !resolvedSet.has(c.id))
        .map((c) => c.id),
      insufficientInformation: conflicts
        .filter((c) => c.certainty === "insufficient_information" && !resolvedSet.has(c.id))
        .map((c) => c.id),
    };

    const prop: AdjustmentProposal = {
      id: params.id,
      strategy: params.strategy,
      title: params.title,
      explanation: params.explanation,
      viability: params.viability,
      viabilityCondition: params.viabilityCondition,
      addressedConflictIds: params.addressedConflictIds,
      resolvedConflictIds: params.resolvedConflictIds,
      unresolvedConflictIds,
      unresolvedBreakdown,
      netHoursFreed: params.netHoursFreed,
      resultingPlannedHours: params.resultingPlannedHours,
      affectedPlanItemIds: params.affectedPlanItemIds,
      retainedPlanItemIds,
      previouslyDeferredItemIds,
      actions: params.actions,
      tradeoffs: params.tradeoffs,
    };

    return prop;
  };

  // --------------------------------------------------------------------------
  // Generator A: Weekly Capacity Deficit
  // --------------------------------------------------------------------------
  const weeklyCapConflict = conflicts.find(
    (c) => c.type === "capacity_deficit" && c.scope === "weekly" && c.certainty === "confirmed"
  );

  if (weeklyCapConflict && origPlanned !== null && plannable !== null) {
    const deficit = origPlanned - plannable;

    // Check flexible options first
    for (const opt of activePlan.flexibleOptions) {
      if (opt.estimatedHours !== null && opt.estimatedHours >= deficit) {
        const netFreed = opt.estimatedHours;
        const rawBalance = origPlanned - netFreed;
        if (rawBalance >= 0) {
          proposals.push(
            buildProposal({
              id: `prop-postpone-flex-${opt.itemId}`,
              strategy: "postpone_flexible",
              title: `Postergar opción flexible "${opt.title}"`,
              explanation: `Al postergar "${opt.title}" se liberan ${netFreed} h, cubriendo el déficit semanal de ${deficit} h.`,
              viability: "viable",
              viabilityCondition: null,
              addressedConflictIds: [weeklyCapConflict.id],
              resolvedConflictIds: [weeklyCapConflict.id],
              netHoursFreed: netFreed,
              resultingPlannedHours: rawBalance,
              affectedPlanItemIds: [opt.itemId],
              actions: [
                {
                  type: "postpone_item",
                  itemId: opt.itemId,
                  currentCategory: "flexible_options",
                  targetReason: "out_of_capacity",
                  hoursFreed: netFreed,
                  rationale: `Liberar ${netFreed} h para resolver el déficit de capacidad semanal.`,
                },
              ],
              tradeoffs: [
                `La opción flexible "${opt.title}" queda diferida para semanas posteriores.`,
              ],
            })
          );
        }
      } else if (opt.estimatedHours !== null && opt.estimatedHours < deficit) {
        // Reducción parcial con opción flexible
        const netFreed = opt.estimatedHours;
        const rawBalance = origPlanned - netFreed;
        if (rawBalance >= 0) {
          proposals.push(
            buildProposal({
              id: `prop-postpone-flex-${opt.itemId}-partial`,
              strategy: "postpone_flexible",
              title: `Postergar opción flexible "${opt.title}" (reducción parcial)`,
              explanation: `Al postergar "${opt.title}" se liberan ${netFreed} h, pero aún resta un déficit de ${deficit - netFreed} h.`,
              viability: "conditional",
              viabilityCondition: `Se requieren ajustes adicionales de al menos ${deficit - netFreed} h para resolver el déficit semanal.`,
              addressedConflictIds: [weeklyCapConflict.id],
              resolvedConflictIds: [],
              netHoursFreed: netFreed,
              resultingPlannedHours: rawBalance,
              affectedPlanItemIds: [opt.itemId],
              actions: [
                {
                  type: "postpone_item",
                  itemId: opt.itemId,
                  currentCategory: "flexible_options",
                  targetReason: "out_of_capacity",
                  hoursFreed: netFreed,
                  rationale: `Liberar parcialmente ${netFreed} h.`,
                },
              ],
              tradeoffs: [
                `La opción flexible "${opt.title}" queda diferida pero persiste un déficit de ${deficit - netFreed} h.`,
              ],
            })
          );
        }
      }
    }

    // Check foci
    for (const focus of activePlan.foci) {
      if (focus.estimatedHours !== null && focus.estimatedHours >= deficit) {
        const netFreed = focus.estimatedHours;
        const rawBalance = origPlanned - netFreed;
        if (rawBalance >= 0) {
          proposals.push(
            buildProposal({
              id: `prop-postpone-focus-${focus.id}`,
              strategy: "postpone_foci",
              title: `Postergar foco semanal "${focus.title}"`,
              explanation: `Al postergar el foco "${focus.title}" se liberan ${netFreed} h, resolviendo el déficit de ${deficit} h.`,
              viability: "viable",
              viabilityCondition: null,
              addressedConflictIds: [weeklyCapConflict.id],
              resolvedConflictIds: [weeklyCapConflict.id],
              netHoursFreed: netFreed,
              resultingPlannedHours: rawBalance,
              affectedPlanItemIds: focus.contributingItemIds,
              actions: focus.contributingItemIds.map((itemId) => ({
                type: "postpone_item",
                itemId,
                currentCategory: "foci",
                targetReason: "out_of_capacity",
                hoursFreed: netFreed / focus.contributingItemIds.length,
                rationale: `Liberar capacidad posponiendo foco "${focus.title}".`,
              })),
              tradeoffs: [`El foco "${focus.title}" no se ejecutará en la semana planificada.`],
            })
          );
        }
      } else if (focus.estimatedHours !== null && focus.estimatedHours < deficit) {
        // Reducción parcial: libera horas pero no resuelve el déficit por completo
        const netFreed = focus.estimatedHours;
        const rawBalance = origPlanned - netFreed;
        if (rawBalance >= 0) {
          proposals.push(
            buildProposal({
              id: `prop-postpone-focus-${focus.id}-partial`,
              strategy: "postpone_foci",
              title: `Postergar foco semanal "${focus.title}" (reducción parcial)`,
              explanation: `Al postergar el foco "${focus.title}" se liberan ${netFreed} h, pero aún resta un déficit de ${deficit - netFreed} h para alcanzar la capacidad planificable.`,
              viability: "conditional",
              viabilityCondition: `Se requieren recortes o postergaciones adicionales de al menos ${deficit - netFreed} h para absorber el déficit restante.`,
              addressedConflictIds: [weeklyCapConflict.id],
              resolvedConflictIds: [],
              netHoursFreed: netFreed,
              resultingPlannedHours: rawBalance,
              affectedPlanItemIds: focus.contributingItemIds,
              actions: focus.contributingItemIds.map((itemId) => ({
                type: "postpone_item",
                itemId,
                currentCategory: "foci",
                targetReason: "out_of_capacity",
                hoursFreed: netFreed / focus.contributingItemIds.length,
                rationale: `Reducir parcialmente la sobrecarga posponiendo foco "${focus.title}".`,
              })),
              tradeoffs: [
                `El foco "${focus.title}" queda diferido, pero el plan aún excede la capacidad por ${deficit - netFreed} h.`,
              ],
            })
          );
        }
      } else if (focus.estimatedHours === null) {
        // Tarea sin estimación no puede resolver con certeza
        proposals.push(
          buildProposal({
            id: `prop-clarify-focus-${focus.id}`,
            strategy: "clarify_missing_data",
            title: `Estimar horas del foco "${focus.title}"`,
            explanation: `El foco "${focus.title}" no tiene estimación de horas. No es posible certificar la resolución del déficit sin conocer su duración real.`,
            viability: "requires_clarification",
            viabilityCondition: null,
            addressedConflictIds: [weeklyCapConflict.id],
            resolvedConflictIds: [],
            netHoursFreed: null,
            resultingPlannedHours: null,
            affectedPlanItemIds: focus.contributingItemIds,
            actions: [
              {
                type: "request_information",
                targetItemId: focus.contributingItemIds[0],
                missingField: "estimated_hours",
                question: `¿Cuántas horas estimas para completar el foco "${focus.title}"?`,
              },
            ],
            tradeoffs: ["Se requiere estimación precisa antes de reajustar el plan."],
          })
        );
      }
    }
  }

  // --------------------------------------------------------------------------
  // Generator B: Daily Capacity Deficit (Reallocate Day Work)
  // --------------------------------------------------------------------------
  const dailyCapConflicts = conflicts.filter(
    (c) => c.type === "capacity_deficit" && c.scope === "daily" && c.certainty === "confirmed"
  );

  for (const dailyConflict of dailyCapConflicts) {
    // Find allocations for the conflicting day
    for (const alloc of dailyAllocations) {
      if (dailyConflict.involvedElementIds.includes(alloc.itemId)) {
        // Look for target days with capacity
        for (const targetConstraint of dayConstraints) {
          if (targetConstraint.day !== alloc.day) {
            const currentTargetAllocated = dailyAllocations
              .filter((a) => a.day === targetConstraint.day)
              .reduce((sum, a) => sum + a.allocatedHours, 0);

            const availableMargin = targetConstraint.availableHours - currentTargetAllocated;

            if (availableMargin >= alloc.allocatedHours) {
              proposals.push(
                buildProposal({
                  id: `prop-reallocate-day-${alloc.itemId}-${targetConstraint.day}`,
                  strategy: "reallocate_daily_work",
                  title: `Reasignar trabajo de "${alloc.itemId}" al ${targetConstraint.day}`,
                  explanation: `Mover ${alloc.allocatedHours} h desde ${alloc.day} hacia ${targetConstraint.day} (que tiene ${availableMargin} h disponibles) resuelve la sobrecarga diaria.`,
                  viability: "viable",
                  viabilityCondition: null,
                  addressedConflictIds: [dailyConflict.id],
                  resolvedConflictIds: [dailyConflict.id],
                  netHoursFreed: 0,
                  resultingPlannedHours: origPlanned,
                  affectedPlanItemIds: [alloc.itemId],
                  actions: [
                    {
                      type: "reallocate_day_work",
                      itemId: alloc.itemId,
                      sourceDay: alloc.day,
                      targetDay: targetConstraint.day,
                      hoursToMove: alloc.allocatedHours,
                      rationale: `Equilibrar carga diaria trasladando trabajo a ${targetConstraint.day}.`,
                    },
                  ],
                  tradeoffs: [
                    `El trabajo de "${alloc.itemId}" se realizará el ${targetConstraint.day} en lugar de ${alloc.day}.`,
                  ],
                })
              );
              break; // one viable reallocation proposal per item
            }
          }
        }
      }
    }
  }

  // --------------------------------------------------------------------------
  // Generator C: Schedule Overlap (Reassign Time Block with Dynamic Duration)
  // --------------------------------------------------------------------------
  const overlapConflicts = conflicts.filter(
    (c) => c.type === "schedule_overlap" && c.certainty === "confirmed"
  );

  for (const overlapConflict of overlapConflicts) {
    const involvedIds = overlapConflict.involvedElementIds;
    const blocksInConflict = timeBlocks.filter((tb) => involvedIds.includes(tb.itemId));

    if (blocksInConflict.length >= 2) {
      // Try to reassign the second block (or a non-obligation block)
      const b2 = blocksInConflict[1];

      const b2StartMin =
        parseInt(b2.startTime.slice(0, 2), 10) * 60 + parseInt(b2.startTime.slice(3, 5), 10);
      const b2EndMin =
        parseInt(b2.endTime.slice(0, 2), 10) * 60 + parseInt(b2.endTime.slice(3, 5), 10);
      const b2DurationMin = b2EndMin - b2StartMin;

      // Find an open day slot in dayConstraints / timeBlocks
      const targetDays = [
        ...new Set(timeBlocks.map((tb) => tb.day).concat(dayConstraints.map((dc) => dc.day))),
      ];

      let foundSlot: { day: string; startTime: string; endTime: string } | null = null;
      const candidateStarts = ["14:00", "15:00", "11:00"];

      for (const tDay of targetDays) {
        // Check day constraint capacity if defined
        const dayConstraint = dayConstraints.find((dc) => dc.day === tDay);
        if (dayConstraint && dayConstraint.availableHours < b2DurationMin / 60) {
          continue;
        }

        for (const cStart of candidateStarts) {
          const cStartMin =
            parseInt(cStart.slice(0, 2), 10) * 60 + parseInt(cStart.slice(3, 5), 10);
          const cEndMin = cStartMin + b2DurationMin;
          if (cEndMin > 20 * 60) continue; // exceed workday

          const cEnd = `${String(Math.floor(cEndMin / 60)).padStart(2, "0")}:${String(
            cEndMin % 60
          ).padStart(2, "0")}`;

          // Collides with existing blocks (excluding b2 itself if on same day)
          const collides = timeBlocks.some((tb) => {
            const isSelf =
              tb.itemId === b2.itemId &&
              tb.day === b2.day &&
              tb.startTime === b2.startTime &&
              tb.endTime === b2.endTime;
            if (isSelf) return false;

            return (
              tb.day === tDay && isTimeIntervalOverlapping(cStart, cEnd, tb.startTime, tb.endTime)
            );
          });

          if (!collides) {
            foundSlot = { day: tDay, startTime: cStart, endTime: cEnd };
            break;
          }
        }
        if (foundSlot) break;
      }

      if (foundSlot) {
        proposals.push(
          buildProposal({
            id: `prop-reassign-block-${b2.itemId}`,
            strategy: "reallocate_time_blocks",
            title: `Reubicar franja horaria de "${b2.itemId}"`,
            explanation: `Mover el bloque de "${b2.itemId}" a ${foundSlot.day} ${foundSlot.startTime}-${foundSlot.endTime} elimina el solapamiento horario de forma demostrable sin alterar su duración de ${b2DurationMin} min.`,
            viability: "viable",
            viabilityCondition: null,
            addressedConflictIds: [overlapConflict.id],
            resolvedConflictIds: [overlapConflict.id],
            netHoursFreed: 0,
            resultingPlannedHours: origPlanned,
            affectedPlanItemIds: [b2.itemId],
            actions: [
              {
                type: "reassign_time_block",
                itemId: b2.itemId,
                currentBlock: b2,
                proposedBlock: {
                  itemId: b2.itemId,
                  day: foundSlot.day,
                  startTime: foundSlot.startTime,
                  endTime: foundSlot.endTime,
                },
                rationale: `Eliminar colisión horaria moviendo bloque a horario libre conservando duración de ${b2DurationMin} min.`,
              },
            ],
            tradeoffs: [
              `"${b2.itemId}" pasa a ejecutarse el ${foundSlot.day} de ${foundSlot.startTime} a ${foundSlot.endTime}.`,
            ],
          })
        );
      }
    }
  }

  // --------------------------------------------------------------------------
  // Generator D: Dependency Blocks
  // --------------------------------------------------------------------------
  const depConflicts = conflicts.filter((c) => c.type === "blocked_by_dependency");

  for (const depConflict of depConflicts) {
    const dependentId = depConflict.involvedElementIds[0];
    const prereqId = depConflict.involvedElementIds[1] || "prerequisite";

    proposals.push(
      buildProposal({
        id: `prop-unblock-dep-${dependentId}`,
        strategy: "unblock_prerequisite",
        title: `Condicionar inicio de "${dependentId}" a entrega externa`,
        explanation: `"${dependentId}" requiere que "${prereqId}" esté disponible antes de ejecutarse.`,
        viability: "conditional",
        viabilityCondition: `El actor o prerrequisito "${prereqId}" debe completarse antes de la fecha límite acordada.`,
        addressedConflictIds: [depConflict.id],
        resolvedConflictIds: [],
        netHoursFreed: 0,
        resultingPlannedHours: origPlanned,
        affectedPlanItemIds: [dependentId],
        actions: [
          {
            type: "unblock_dependency",
            dependentItemId: dependentId,
            prerequisiteItemId: prereqId,
            requiredAction: `Obtener confirmación o entrega de "${prereqId}".`,
            rationale: "Desbloquear dependencia causal antes de iniciar el trabajo activo.",
          },
        ],
        tradeoffs: [`El avance de "${dependentId}" queda sujeto a cumplimiento de terceros.`],
      })
    );
  }

  // --------------------------------------------------------------------------
  // Generator E: Potential Risks or Tradeoff Acceptance
  // --------------------------------------------------------------------------
  for (const potConflict of potentialConflicts) {
    proposals.push(
      buildProposal({
        id: `prop-accept-risk-${potConflict.id}`,
        strategy: "accept_tradeoff",
        title: `Aceptar riesgo consciente: "${potConflict.title}"`,
        explanation: `Mantener el plan activo asumiendo el riesgo potencial detectado.`,
        viability: "risk_accepted",
        viabilityCondition: null,
        addressedConflictIds: [potConflict.id],
        resolvedConflictIds: [],
        netHoursFreed: 0,
        resultingPlannedHours: origPlanned,
        affectedPlanItemIds: [],
        actions: [
          {
            type: "accept_risk",
            conflictId: potConflict.id,
            toleratedRisk: potConflict.explanation,
            rationale: "Decisión consciente del usuario de asumir la tensión sin alterar el plan.",
          },
        ],
        tradeoffs: [
          `El riesgo "${potConflict.title}" permanece activo y requiere supervisión durante la semana.`,
        ],
      })
    );
  }

  // --------------------------------------------------------------------------
  // 5. Filter, Deduplicate & Validate Proposals
  // --------------------------------------------------------------------------
  const validProposals: AdjustmentProposal[] = [];

  for (const prop of proposals) {
    if (validProposals.length >= maxProposals) break;

    // Check invariants
    const check = validateProposalInvariants(
      prop,
      activePlan,
      conflicts,
      timeBlocks,
      dailyAllocations
    );

    if (check.valid) {
      // Avoid duplicate strategies on the same items
      const isDuplicate = validProposals.some(
        (existing) =>
          existing.strategy === prop.strategy &&
          existing.affectedPlanItemIds.join(",") === prop.affectedPlanItemIds.join(",")
      );
      if (!isDuplicate) {
        validProposals.push(prop);
      }
    }
  }

  // --------------------------------------------------------------------------
  // 6. Determine Output Status & Priorities
  // --------------------------------------------------------------------------
  const allAddressedIds = new Set(validProposals.flatMap((p) => p.addressedConflictIds));
  const unaddressedConflictIds = conflicts
    .map((c) => c.id)
    .filter((id) => !allAddressedIds.has(id));

  // If there are confirmed blocking conflicts, but NO proposal addresses ANY confirmed conflict
  // (e.g. unresolvable external obligations in overlap, and only secondary accept_tradeoff exists):
  const addressesAnyConfirmed = validProposals.some((p) =>
    p.addressedConflictIds.some((id) => confirmedConflicts.some((c) => c.id === id))
  );

  if (confirmedConflicts.length > 0 && (!addressesAnyConfirmed || validProposals.length === 0)) {
    return {
      status: "no_viable_alternatives",
      unaddressedConflictIds: conflicts.map((c) => c.id),
      proposals: [],
      clarificationQuestions: [],
      summary:
        "Existen conflictos bloqueantes confirmados pero ninguna alternativa es viable sin renegociar obligaciones externas o límites rígidos.",
    };
  }

  if (validProposals.length === 0 && uncertainConflicts.length > 0) {
    return {
      status: "clarification_required",
      unaddressedConflictIds: conflicts.map((c) => c.id),
      proposals: [],
      clarificationQuestions: [
        "Se requiere información adicional del usuario para evaluar alternativas viables.",
      ],
      summary: "No fue posible formular propuestas válidas por falta de información.",
    };
  }

  const anyConfirmedUnresolved = confirmedConflicts.some(
    (c) =>
      unaddressedConflictIds.includes(c.id) ||
      validProposals.every((p) => p.unresolvedConflictIds.includes(c.id))
  );

  const summary = anyConfirmedUnresolved
    ? `Se propusieron ${validProposals.length} alternativas parciales o condicionales, pero persisten conflictos bloqueantes confirmados sin resolución completa.`
    : `Se propusieron ${validProposals.length} alternativas estructuradas para atender los conflictos detectados.`;

  return {
    status: "adjustments_proposed",
    unaddressedConflictIds,
    proposals: validProposals,
    clarificationQuestions: [],
    summary,
  };
}
