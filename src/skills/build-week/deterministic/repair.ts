import {
  BuildWeekInput,
  ProposedWeek,
  WeeklyFocus,
  WeeklyObligation,
  DeferredItem,
  validateProposedWeekInvariants,
} from "../../../domain/week";
import {
  WeekValidationError,
  resolveTargetWeek,
  calculateWeeklyCapacity,
  extractItemHours,
} from "./capacity-math";
import { prepareWeekConstraints } from "./planning-context";

export interface ProposalRepairAction {
  type:
    | "rescued_archived_to_deferred"
    | "rescued_blocked_to_deferred"
    | "rescued_idea_to_flexible"
    | "rescued_omitted_to_not_scheduled"
    | "deduplicated_intra_category"
    | "resolved_obligation_focus_conflict"
    | "recalculated_capacity_summary"
    | "reclassified_false_obligation"
    | "excess_foci_deferred";
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

  // 5.5. SAFE REPAIR: Focus count limit (max 3 foci)
  let boundedFoci = cleanedFoci;
  const excessFociDeferred: DeferredItem[] = [];

  if (cleanedFoci.length > 3) {
    boundedFoci = cleanedFoci.slice(0, 3);
    const excessFoci = cleanedFoci.slice(3);

    for (const ef of excessFoci) {
      for (const cid of ef.contributingItemIds) {
        const itm = input.items.find((i) => i.id === cid);
        excessFociDeferred.push({
          itemId: cid,
          title: itm?.title ?? ef.title ?? cid,
          reason: "out_of_capacity",
          rationale: `Límite máximo de 3 focos principales alcanzado (${ef.title}); conservado para decisión de la persona sin saturar la semana.`,
        });
        repairs.push({
          type: "excess_foci_deferred",
          itemId: cid,
          description: `Focus "${ef.id}" (${ef.title}) exceeded the maximum limit of 3 foci; contributing item "${cid}" was conserved in deferredItems as "out_of_capacity".`,
        });
      }
    }
  }

  // 6. OMITTED ITEMS: Honest rescue or explicit rejection
  const dependsOnBlockers = new Set<string>();
  for (const rel of input.relationships) {
    if (rel.type === "depends_on") {
      dependsOnBlockers.add(rel.sourceItemId);
    }
  }

  const cleanedDeferred = [
    ...rawProposal.deferredItems,
    ...falseObligationsToDefer,
    ...excessFociDeferred,
  ];
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
    foci: boundedFoci,
    obligations: validObligations,
    flexibleOptions: cleanedFlexible,
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
    foci: boundedFoci,
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
