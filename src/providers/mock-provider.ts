import { AIProvider, ProviderExecutionMeta } from "./ai-provider";
import { ExtractItemsInput, ExtractedItems } from "../domain/items";
import { DetectRelationshipsInput, DetectedRelationships } from "../domain/relationships";
import { GroupWorkInput, GroupedWork } from "../domain/work-groups";
import { DetectDeadlinesInput, DetectedDeadlines } from "../domain/deadlines";
import {
  EvaluateContextInput,
  EvaluateContextOutput,
  ItemContextAssessment,
  GroupContextAssessment,
  OpenQuestion,
  ContextSignal,
  ContextAttentionLevel,
} from "../domain/context";
import {
  BuildWeekInput,
  ProposedWeek,
  WeeklyFocus,
  WeeklyObligation,
  WeeklyFlexibleOption,
  DeferredItem,
  createEmptyProposedWeek,
} from "../domain/week";
import {
  resolveTargetWeek,
  prepareWeekConstraints,
  calculateWeeklyCapacity,
  normalizeAndConserveProposedWeek,
} from "../skills/build-week/deterministic";
import mockCasesData from "../../cases/mock-extractions.json";
import mockRelationshipsData from "../../cases/mock-relationships.json";
import mockGroupingsData from "../../cases/mock-groupings.json";
import mockDeadlinesData from "../../cases/mock-deadlines.json";
import realDumpsData from "../../cases/real-dumps.json";

export type MockHandler = (input: ExtractItemsInput) => Promise<ExtractedItems> | ExtractedItems;
export type MockRelationshipsHandler = (
  input: DetectRelationshipsInput
) => Promise<DetectedRelationships> | DetectedRelationships;
export type MockGroupWorkHandler = (
  input: GroupWorkInput
) => Promise<GroupedWork> | GroupedWork;
export type MockDeadlinesHandler = (
  input: DetectDeadlinesInput
) => Promise<DetectedDeadlines> | DetectedDeadlines;
export type MockContextHandler = (
  input: EvaluateContextInput
) => Promise<EvaluateContextOutput> | EvaluateContextOutput;
export type MockBuildWeekHandler = (
  input: BuildWeekInput
) => Promise<ProposedWeek | string> | ProposedWeek | string;

export class MockProvider implements AIProvider {
  readonly id = "mock" as const;
  readonly model = "deterministic-mock-v1";

  private handler?: MockHandler;
  private relationshipsHandler?: MockRelationshipsHandler;
  private groupWorkHandler?: MockGroupWorkHandler;
  private deadlinesHandler?: MockDeadlinesHandler;
  private contextHandler?: MockContextHandler;
  private buildWeekHandler?: MockBuildWeekHandler;
  private lastExecutionMeta?: ProviderExecutionMeta;

  getLastExecutionMeta(): ProviderExecutionMeta | undefined {
    return this.lastExecutionMeta;
  }

  constructor(
    handler?: MockHandler,
    relationshipsHandler?: MockRelationshipsHandler,
    groupWorkHandler?: MockGroupWorkHandler,
    deadlinesHandler?: MockDeadlinesHandler,
    contextHandler?: MockContextHandler
  ) {
    this.handler = handler;
    this.relationshipsHandler = relationshipsHandler;
    this.groupWorkHandler = groupWorkHandler;
    this.deadlinesHandler = deadlinesHandler;
    this.contextHandler = contextHandler;
  }

  setHandler(handler: MockHandler): void {
    this.handler = handler;
  }

  setRelationshipsHandler(handler: MockRelationshipsHandler): void {
    this.relationshipsHandler = handler;
  }

  setGroupWorkHandler(handler: MockGroupWorkHandler): void {
    this.groupWorkHandler = handler;
  }

  setDeadlinesHandler(handler: MockDeadlinesHandler): void {
    this.deadlinesHandler = handler;
  }

  setContextHandler(handler: MockContextHandler): void {
    this.contextHandler = handler;
  }

  setBuildWeekHandler(handler: MockBuildWeekHandler): void {
    this.buildWeekHandler = handler;
  }

  async extractItems(input: ExtractItemsInput): Promise<ExtractedItems> {
    if (this.handler) {
      return await this.handler(input);
    }

    // Try finding matching case in real-dumps
    const normalizedInput = input.text.trim();
    const matchedCase = realDumpsData.find(
      (c) => c.text.trim() === normalizedInput || normalizedInput.includes(c.text.trim().slice(0, 30))
    );

    if (matchedCase) {
      const caseItems = (mockCasesData as Record<string, ExtractedItems>)[matchedCase.id];
      if (caseItems) {
        return caseItems;
      }
    }

    // Default fallback mock response
    return {
      items: [
        {
          id: "item-mock-1",
          rawText: input.text.slice(0, 60),
          title: "Elemento detectado (Mock determinista)",
          type: "task",
          status: "pending",
          commitment: "none",
        },
      ],
    };
  }

  async detectRelationships(input: DetectRelationshipsInput): Promise<DetectedRelationships> {
    if (this.relationshipsHandler) {
      return await this.relationshipsHandler(input);
    }

    // Check if input items match any known case in mockRelationshipsData
    const itemIds = new Set(input.items.map((i) => i.id));
    for (const [caseId, data] of Object.entries(mockRelationshipsData)) {
      const match = data.relationships.some(
        (r) => itemIds.has(r.sourceItemId) && itemIds.has(r.targetItemId)
      );
      if (match) {
        return data as DetectedRelationships;
      }
      // If the case is specifically defined as having empty relationships (like case-03)
      if (data.relationships.length === 0 && caseId === "case-03") {
        if (input.items.some((i) => i.title.toLowerCase().includes("postgres"))) {
          return { relationships: [] };
        }
      }
    }

    // Default: independent items have no relationships
    return { relationships: [] };
  }

  async groupWork(input: GroupWorkInput): Promise<GroupedWork> {
    if (this.groupWorkHandler) {
      return await this.groupWorkHandler(input);
    }

    const itemIds = new Set(input.items.map((i) => i.id));

    // 1. Check if matches any predefined mock grouping in mockGroupingsData
    for (const [_caseId, data] of Object.entries(mockGroupingsData)) {
      const matches = data.groups.some((g) =>
        g.itemIds.some((id) => itemIds.has(id))
      );
      if (matches) {
        return data as GroupedWork;
      }
    }

    // 2. Fallback: conservative mock grouping based on strong signals (same_project, same_objective, part_of)
    // If no relationships or items < 2, return all as ungrouped
    if (input.items.length < 2 || input.relationships.length === 0) {
      return {
        groups: [],
        ungroupedItemIds: input.items.map((i) => i.id),
      };
    }

    // Default: all ungrouped unless explicitly matched
    return {
      groups: [],
      ungroupedItemIds: input.items.map((i) => i.id),
    };
  }

  async detectDeadlines(input: DetectDeadlinesInput): Promise<DetectedDeadlines> {
    if (this.deadlinesHandler) {
      return await this.deadlinesHandler(input);
    }

    if (!input.items || input.items.length === 0) {
      return { deadlines: [] };
    }

    const itemIds = new Set(input.items.map((i) => i.id));

    // 1. Check if matches any predefined mock deadlines in mockDeadlinesData
    for (const [caseId, data] of Object.entries(mockDeadlinesData)) {
      if (data.deadlines.length > 0) {
        const matches = data.deadlines.some((d) => itemIds.has(d.itemId));
        if (matches) {
          // Filter out any deadlines whose items are not in the current input
          const validDeadlines = data.deadlines.filter((d) => itemIds.has(d.itemId));
          return { deadlines: validDeadlines as DetectedDeadlines["deadlines"] };
        }
      } else {
        // Empty deadlines case (e.g., case-03, case-09, case-21): check if items match the case in mockCasesData
        const caseExtraction = (mockCasesData as Record<string, { items: Array<{ id: string }> }>)[caseId];
        if (caseExtraction && caseExtraction.items.some((i) => itemIds.has(i.id))) {
          return { deadlines: [] };
        }
      }
    }

    // Default: no deadlines detected
    return { deadlines: [] };
  }

  async evaluateContext(input: EvaluateContextInput): Promise<EvaluateContextOutput> {
    if (this.contextHandler) {
      return await this.contextHandler(input);
    }

    if (!input.items || input.items.length === 0) {
      return {
        itemAssessments: [],
        groupAssessments: [],
        openQuestions: [],
      };
    }

    // Default deterministic evaluation based on observed attributes
    const itemAssessments: ItemContextAssessment[] = input.items.map((item) => {
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
            const dFrom = new Date(`${input.currentDate}T00:00:00Z`).getTime();
            const dTo = new Date(`${targetDate}T00:00:00Z`).getTime();
            const diffDays = Math.round((dTo - dFrom) / (1000 * 60 * 60 * 24));
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

      // Check dependencies: ONLY causal "depends_on" implies dependency signal
      const isSourceOfDepends = input.relationships.some(
        (r) => r.sourceItemId === item.id && r.type === "depends_on"
      );
      const isTargetOfDepends = input.relationships.some(
        (r) => r.targetItemId === item.id && r.type === "depends_on"
      );
      if (isSourceOfDepends || isTargetOfDepends) {
        signals.push("dependency");
      }

      // Check waiting: actionable item is waiting/blocked by third party (not the concern itself)
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

      // Check declared goals
      if (input.declaredGoals && input.declaredGoals.length > 0) {
        const itemText = (item.title + " " + item.rawText).toLowerCase();
        const matchesGoal = input.declaredGoals.some((g) => {
          const words = g.text.toLowerCase().split(/\s+/).filter((w) => w.length >= 3);
          return words.some((w) => itemText.includes(w));
        });
        if (matchesGoal) {
          signals.push("supports_declared_goal");
        }
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
    });

    const groupAssessments: GroupContextAssessment[] = input.groupedWork.groups.map((group) => {
      const groupItemAssessments = itemAssessments.filter((ia) => group.itemIds.includes(ia.itemId));
      const hasHigh = groupItemAssessments.some((ia) => ia.attention === "high");
      return {
        groupId: group.id,
        relevance: hasHigh ? "high" : "medium",
        rationale: `Línea de trabajo "${group.title}".`,
      };
    });

    // Check if there are material open questions (e.g., case-06 webhook blocker)
    const openQuestions: OpenQuestion[] = [];
    const waitingItems = itemAssessments.filter((ia) => ia.signals.includes("waiting"));
    for (const wItem of waitingItems) {
      const origItem = input.items.find((i) => i.id === wItem.itemId);
      if (origItem && (origItem.rawText.includes("cliente") || origItem.rawText.includes("credenciales"))) {
        openQuestions.push({
          topic: "Bloqueo por tercero",
          question: "¿Se ha solicitado ya al cliente el envío de las credenciales de webhook?",
          relatedItemIds: [wItem.itemId],
          reason: "La integración técnica está detenida a la espera de este insumo externo.",
        });
      }
    }

    return {
      itemAssessments,
      groupAssessments,
      openQuestions,
    };
  }

  async buildWeek(input: BuildWeekInput): Promise<ProposedWeek> {
    const startTime = Date.now();
    if (this.buildWeekHandler) {
      const res = await this.buildWeekHandler(input);
      this.lastExecutionMeta = {
        provider: this.id,
        model: this.model,
        durationMs: Date.now() - startTime,
      };
      return res as ProposedWeek;
    }

    if (input.items.length === 0) {
      this.lastExecutionMeta = {
        provider: this.id,
        model: this.model,
        durationMs: Date.now() - startTime,
      };
      return createEmptyProposedWeek(input.currentDate, input.targetWeek);
    }

    const targetWeek = resolveTargetWeek(input.currentDate, input.targetWeek);
    const constraints = prepareWeekConstraints(input, targetWeek);

    const assignedItemIds = new Set<string>();
    const deferredItems: DeferredItem[] = [];
    const flexibleOptions: WeeklyFlexibleOption[] = [];
    const obligations: WeeklyObligation[] = [];
    const foci: WeeklyFocus[] = [];

    // 1. Archived items -> deferredItems
    for (const a of constraints.archivedItems) {
      deferredItems.push({
        itemId: a.itemId,
        title: a.title,
        reason: "archived",
        rationale: a.reason,
      });
      assignedItemIds.add(a.itemId);
    }

    // 2. External commitments and strict deadlines in week -> ALWAYS obligations
    // Even if blocked by dependencies, external commitments cannot be unilaterally deferred;
    // they must remain visible as obligations and surface the tension/impediment.
    const blockedMap = new Map(constraints.blockedItems.map((b) => [b.itemId, b.reasons]));
    const externalTradeoffs: string[] = [];

    for (const ec of constraints.externalCommitments) {
      if (!assignedItemIds.has(ec.itemId)) {
        const blockerReasons = blockedMap.get(ec.itemId);
        const rationale = blockerReasons && blockerReasons.length > 0
          ? `${ec.rationale}. ATENCIÓN: Bloqueado por dependencias: ${blockerReasons.join("; ")}.`
          : ec.rationale;

        if (blockerReasons && blockerReasons.length > 0) {
          externalTradeoffs.push(
            `El compromiso externo "${ec.title}" está bloqueado por dependencias no resueltas: ${blockerReasons.join("; ")}.`
          );
        }

        obligations.push({
          itemId: ec.itemId,
          title: ec.title,
          dueDate: ec.deadlineDate,
          commitmentType: "external",
          rationale,
          estimatedHours: ec.estimatedHours,
        });
        assignedItemIds.add(ec.itemId);
      }
    }

    for (const dl of constraints.strictDeadlinesInWeek) {
      if (!assignedItemIds.has(dl.itemId)) {
        const blockerReasons = blockedMap.get(dl.itemId);
        let rationale = `Plazo estricto (${dl.dueDate}) en la semana objetivo`;
        if (blockerReasons && blockerReasons.length > 0) {
          rationale += `. ATENCIÓN: Bloqueado por dependencias: ${blockerReasons.join("; ")}.`;
          externalTradeoffs.push(
            `La obligación con plazo estricto "${dl.title}" está bloqueada por dependencias no resueltas.`
          );
        }

        obligations.push({
          itemId: dl.itemId,
          title: dl.title,
          dueDate: dl.dueDate,
          commitmentType: "strict_deadline",
          rationale,
          estimatedHours: dl.estimatedHours,
        });
        assignedItemIds.add(dl.itemId);
      }
    }

    // 3. Blocked items strictly by depends_on (excluding external commitments already assigned) -> deferredItems
    for (const b of constraints.blockedItems) {
      if (!assignedItemIds.has(b.itemId)) {
        deferredItems.push({
          itemId: b.itemId,
          title: b.title,
          reason: "waiting_dependency",
          rationale: b.reasons.join("; "),
        });
        assignedItemIds.add(b.itemId);
      }
    }

    // 4. Optional ideas -> flexibleOptions
    for (const o of constraints.optionalItems) {
      if (!assignedItemIds.has(o.itemId)) {
        flexibleOptions.push({
          itemId: o.itemId,
          title: o.title,
          condition: "Oportunidad flexible o exploratoria",
          estimatedHours: o.estimatedHours,
        });
        assignedItemIds.add(o.itemId);
      }
    }

    // 5. Foci: from input work groups (up to 3)
    const availableGroups = input.groupedWork.groups.slice(0, 3);
    for (let i = 0; i < availableGroups.length; i++) {
      const g = availableGroups[i];
      const contributingItemIds = g.itemIds.filter((id) => !assignedItemIds.has(id));
      if (contributingItemIds.length > 0) {
        let focusHours: number | null = null;
        let sum = 0;
        let hasHours = false;
        for (const cid of contributingItemIds) {
          const itm = input.items.find((it) => it.id === cid);
          if (itm?.estimatedEffort?.value) {
            sum += itm.estimatedEffort.value;
            hasHours = true;
          }
          assignedItemIds.add(cid);
        }
        if (hasHours) focusHours = sum;

        foci.push({
          id: `focus-${i + 1}`,
          title: g.title,
          groupId: g.id,
          desiredOutcome: `Avanzar en la línea estructurante de "${g.title}"`,
          rationale: g.rationale || `Grupo de trabajo clave: ${g.title}`,
          contributingItemIds,
          estimatedHours: focusHours,
        });
      }
    }

    // 6. Remaining items -> deferredItems as not_scheduled
    for (const itm of input.items) {
      if (!assignedItemIds.has(itm.id)) {
        deferredItems.push({
          itemId: itm.id,
          title: itm.title,
          reason: "not_scheduled",
          rationale: "Elemento no programado en la propuesta; conservado para decisión de la persona.",
        });
        assignedItemIds.add(itm.id);
      }
    }

    // 7. Deterministic capacity computation
    const capacitySummary = calculateWeeklyCapacity({
      capacityConfig: input.capacity,
      foci,
      obligations,
    });

    const highImportanceDeferred = deferredItems.filter((d) => {
      const it = input.items.find((i) => i.id === d.itemId);
      return it?.importance === "high" && it.type === "task";
    });
    for (const hid of highImportanceDeferred) {
      externalTradeoffs.push(
        `La tarea de alta importancia "${hid.title}" no fue incluida en focos ni obligaciones y queda sin programar (not_scheduled).`
      );
    }

    const protectedHours = capacitySummary.protectedSpaceHours;

    const rawProposal: ProposedWeek = {
      weekSummary: {
        targetWeek,
        intent: input.userIntent,
        capacity: capacitySummary,
      },
      foci,
      obligations,
      flexibleOptions,
      deferredItems,
      unplannedSpace: {
        rationale: protectedHours != null
          ? `${protectedHours} horas protegidas para contingencias y descanso.`
          : "Espacio no planificado protegido para imprevistos.",
        recommendedHours: protectedHours,
      },
      confirmationPrompt: {
        question: "¿Te representa esta propuesta para estructurar la semana?",
        keyTradeoffs: [
          ...(obligations.length > 0 && capacitySummary.capacityStatus === "over_capacity"
            ? ["Las obligaciones externas superan la capacidad planificable de la semana."]
            : []),
          ...externalTradeoffs,
        ],
        pendingQuestions: input.context.openQuestions.slice(0, 2).map((q) => q.question),
      },
    };

    // 8. Normalize & conserve invariants
    const normalized = normalizeAndConserveProposedWeek(rawProposal, input);
    this.lastExecutionMeta = {
      provider: this.id,
      model: this.model,
      durationMs: Date.now() - startTime,
    };
    return normalized.proposal;
  }
}
