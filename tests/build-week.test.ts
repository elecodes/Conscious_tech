import { describe, it, expect, beforeEach } from "vitest";
import { MockProvider } from "../src/providers/mock-provider";
import { GroqProvider } from "../src/providers/groq-provider";
import {
  buildWeek,
  buildWeekWithAudit,
  evaluateProposedWeekSemanticQuality,
} from "../src/skills/build-week";
import {
  WeekValidationError,
} from "../src/skills/build-week/deterministic";
import { BuildWeekInput, TargetWeek, ProposedWeek } from "../src/domain/week";

describe("Skill 06: build_week - End-to-End Integration", () => {
  let mockProvider: MockProvider;
  const baseDate = "2026-10-09"; // Friday
  const sampleTargetWeek: TargetWeek = {
    startDate: "2026-10-12",
    endDate: "2026-10-18",
  };

  const sampleItems = [
    {
      id: "item-1",
      rawText: "Demo para inversores el viernes",
      title: "Demo inversores",
      type: "commitment" as const,
      commitment: "external" as const,
      status: "started" as const,
      estimatedEffort: { value: 6, unit: "hours" as const, source: "user" as const },
    },
    {
      id: "item-2",
      rawText: "Refactor backend",
      title: "Refactor backend",
      type: "task" as const,
      status: "started" as const,
      estimatedEffort: { value: 8, unit: "hours" as const, source: "user" as const },
    },
    {
      id: "item-3",
      rawText: "Cambiar cuerdas si hay tiempo",
      title: "Cambiar cuerdas",
      type: "idea" as const,
      status: "exploring" as const,
      estimatedEffort: { value: 60, unit: "minutes" as const, source: "user" as const },
    },
    {
      id: "item-4",
      rawText: "Discord bot archivado",
      title: "Discord bot",
      type: "idea" as const,
      status: "archived" as const,
    },
  ];

  const sampleInput: BuildWeekInput = {
    currentDate: baseDate,
    targetWeek: sampleTargetWeek,
    userIntent: "Cerrar compromisos sin quemarse",
    items: sampleItems,
    relationships: [
      {
        sourceItemId: "item-2",
        targetItemId: "item-3",
        type: "related_to",
        confidence: "medium",
        reason: "Temático",
      },
    ],
    groupedWork: {
      groups: [
        {
          id: "group-1",
          title: "Lanzamiento y Demo",
          itemIds: ["item-1", "item-2"],
          rationale: "Foco estructurante",
        },
      ],
      ungroupedItemIds: ["item-3", "item-4"],
    },
    deadlines: {
      deadlines: [
        {
          itemId: "item-1",
          raw: "el viernes",
          kind: "relative_date",
          resolvedStart: "2026-10-16",
          resolvedEnd: null,
          confidence: "high",
        },
        {
          itemId: "item-3",
          raw: "el jueves",
          kind: "relative_date",
          resolvedStart: "2026-10-15",
          resolvedEnd: null,
          confidence: "medium",
        },
      ],
    },
    context: {
      itemAssessments: [
        {
          itemId: "item-1",
          attention: "high",
          signals: ["external_commitment", "approaching_deadline", "dependency"],
          rationale: "Demo clave con inversores",
        },
        {
          itemId: "item-2",
          attention: "medium",
          signals: ["already_started"],
          rationale: "Desbloquea la demo",
        },
        {
          itemId: "item-3",
          attention: "low",
          signals: [],
          rationale: "Opcional",
        },
        {
          itemId: "item-4",
          attention: "low",
          signals: [],
          rationale: "Archivado",
        },
      ],
      groupAssessments: [
        {
          groupId: "group-1",
          relevance: "high",
          rationale: "Línea prioritaria",
        },
      ],
      openQuestions: [],
    },
    capacity: {
      totalAvailableHours: 25,
      minProtectedSpaceRatio: 0.25,
      daysWithConstraints: [{ day: "martes", availableHours: 3 }],
    },
  };

  beforeEach(() => {
    mockProvider = new MockProvider();
  });

  // ==========================================================================
  // 1. Full E2E Execution Flows
  // ==========================================================================

  it("Scenario 1: empty week input returns canonical empty proposal in 0ms without AI calls", async () => {
    const emptyInput: BuildWeekInput = {
      currentDate: baseDate,
      items: [],
      relationships: [],
      groupedWork: { groups: [], ungroupedItemIds: [] },
      deadlines: { deadlines: [] },
      context: { itemAssessments: [], groupAssessments: [], openQuestions: [] },
    };

    const result = await buildWeekWithAudit(mockProvider, emptyInput);

    expect(result.proposal.foci).toHaveLength(0);
    expect(result.proposal.obligations).toHaveLength(0);
    expect(result.proposal.flexibleOptions).toHaveLength(0);
    expect(result.proposal.deferredItems).toHaveLength(0);
    expect(result.repaired).toBe(false);
    expect(result.repairs).toHaveLength(0);
    expect(result.proposal.unplannedSpace.rationale).toContain("todo el espacio está disponible");
  });

  it("Scenario 2: standard week with foci, obligations, flexible options and archived items", async () => {
    const proposal = await buildWeek(mockProvider, sampleInput);

    // 1:1 item conservation check
    const allAssignedIds = [
      ...proposal.foci.flatMap((f) => f.contributingItemIds),
      ...proposal.obligations.map((o) => o.itemId),
      ...proposal.flexibleOptions.map((fo) => fo.itemId),
      ...proposal.deferredItems.map((d) => d.itemId),
    ];
    expect(allAssignedIds.sort()).toEqual(["item-1", "item-2", "item-3", "item-4"].sort());

    // Foci validation
    expect(proposal.foci.length).toBeGreaterThanOrEqual(1);
    expect(proposal.foci.length).toBeLessThanOrEqual(3);
    expect(proposal.foci[0].contributingItemIds).toContain("item-2");

    // Obligation validation
    expect(proposal.obligations.some((o) => o.itemId === "item-1")).toBe(true);

    // Flexible option validation (idea)
    expect(proposal.flexibleOptions.some((fo) => fo.itemId === "item-3")).toBe(true);

    // Archived item validation
    const archived = proposal.deferredItems.find((d) => d.itemId === "item-4");
    expect(archived).toBeDefined();
    expect(archived?.reason).toBe("archived");

    // Capacity validation
    expect(proposal.weekSummary.capacity.capacityStatus).toBe("within_capacity");
    expect(proposal.weekSummary.capacity.protectedSpaceStatus).toBe("respected");
  });

  it("Scenario 3: obligations exceed plannable capacity without silent drops", async () => {
    const overloadedInput: BuildWeekInput = {
      ...sampleInput,
      capacity: {
        totalAvailableHours: 8,
        minProtectedSpaceRatio: 0.25, // 6h plannable
      },
    };

    const auditResult = await buildWeekWithAudit(mockProvider, overloadedInput);

    // Obligations are NOT silently discarded
    expect(auditResult.proposal.obligations.some((o) => o.itemId === "item-1")).toBe(true);
    // Overload is honestly reflected
    expect(auditResult.proposal.weekSummary.capacity.capacityStatus).toBe("over_capacity");
    expect(auditResult.proposal.weekSummary.capacity.protectedSpaceStatus).toBe("compromised");
    // Tradeoffs explicitly alert the user
    expect(
      auditResult.proposal.confirmationPrompt.keyTradeoffs.some((t) => t.includes("superan la capacidad"))
    ).toBe(true);
  });

  it("Scenario 4: unknown capacity and partial estimates preserve uncertainty honestly", async () => {
    const unknownCapInput: BuildWeekInput = {
      ...sampleInput,
      capacity: undefined,
      items: sampleInput.items.map((i) =>
        i.id === "item-2" ? { ...i, estimatedEffort: undefined } : i
      ),
    };

    const proposal = await buildWeek(mockProvider, unknownCapInput);

    expect(proposal.weekSummary.capacity.totalAvailableHours).toBeNull();
    expect(proposal.weekSummary.capacity.plannableHours).toBeNull();
    expect(proposal.weekSummary.capacity.plannedHours).toBeNull();
    expect(proposal.weekSummary.capacity.capacityStatus).toBe("unknown");
    expect(proposal.weekSummary.capacity.protectedSpaceStatus).toBe("unknown");
    expect(proposal.weekSummary.capacity.estimationCompleteness).toBe("partial");
  });

  it("Scenario 5: ideas with approaching deadlines do NOT convert to obligations", async () => {
    // item-3 has a deadline on 2026-10-15 (in the week) and is type: "idea"
    const proposal = await buildWeek(mockProvider, sampleInput);

    // Must be in flexibleOptions, NEVER in obligations
    expect(proposal.flexibleOptions.some((fo) => fo.itemId === "item-3")).toBe(true);
    expect(proposal.obligations.some((o) => o.itemId === "item-3")).toBe(false);
  });

  it("Scenario 6: blocked items by depends_on are placed in deferredItems as waiting_dependency", async () => {
    // Modify input so item-2 is blocked by an external item
    const blockedInput: BuildWeekInput = {
      ...sampleInput,
      relationships: [
        {
          sourceItemId: "item-2", // item-2 depends on item-1
          targetItemId: "item-1",
          type: "depends_on",
          confidence: "high",
          reason: "Esperando API",
        },
      ],
    };

    const proposal = await buildWeek(mockProvider, blockedInput);
    const blocked = proposal.deferredItems.find((d) => d.itemId === "item-2");

    expect(blocked).toBeDefined();
    expect(blocked?.reason).toBe("waiting_dependency");
  });

  it("Scenario 7: omitted tasks are rescued to deferredItems with reason 'not_scheduled' with audit trail", async () => {
    // Custom mock handler emitting proposal that completely omits item-2
    mockProvider.setBuildWeekHandler(() => {
      return {
        weekSummary: {
          targetWeek: sampleTargetWeek,
          capacity: {
            totalAvailableHours: 25,
            plannableHours: 18.75,
            plannedHours: 6,
            knownEstimatedHours: 6,
            estimationCompleteness: "complete",
            protectedSpaceHours: 6.25,
            capacityStatus: "within_capacity",
            protectedSpaceStatus: "respected",
          },
        },
        foci: [],
        obligations: [
          {
            itemId: "item-1",
            title: "Demo inversores",
            commitmentType: "external",
            rationale: "Compromiso",
            estimatedHours: 6,
          },
        ],
        flexibleOptions: [
          {
            itemId: "item-3",
            title: "Cambiar cuerdas",
            estimatedHours: 1,
          },
        ],
        deferredItems: [
          {
            itemId: "item-4",
            title: "Discord bot",
            reason: "archived",
            rationale: "Archivado",
          },
        ],
        unplannedSpace: { rationale: "Espacio", recommendedHours: 6.25 },
        confirmationPrompt: { question: "Ok?", keyTradeoffs: [], pendingQuestions: [] },
      };
    });

    const auditResult = await buildWeekWithAudit(mockProvider, sampleInput);

    expect(auditResult.repaired).toBe(true);
    const rescued = auditResult.proposal.deferredItems.find((d) => d.itemId === "item-2");
    expect(rescued).toBeDefined();
    expect(rescued?.reason).toBe("not_scheduled");
    expect(rescued?.reason).not.toBe("out_of_capacity");
    expect(rescued?.reason).not.toBe("low_attention");

    expect(
      auditResult.repairs.some((r) => r.type === "rescued_omitted_to_not_scheduled" && r.itemId === "item-2")
    ).toBe(true);
  });

  it("Scenario 8: proposal with zero foci is fully supported for maintenance/recovery weeks", async () => {
    mockProvider.setBuildWeekHandler(() => {
      return {
        weekSummary: {
          targetWeek: sampleTargetWeek,
          capacity: {
            totalAvailableHours: 25,
            plannableHours: 18.75,
            plannedHours: 6,
            knownEstimatedHours: 6,
            estimationCompleteness: "complete",
            protectedSpaceHours: 6.25,
            capacityStatus: "within_capacity",
            protectedSpaceStatus: "respected",
          },
        },
        foci: [], // Zero foci!
        obligations: [
          {
            itemId: "item-1",
            title: "Demo",
            commitmentType: "external",
            rationale: "Compromiso",
            estimatedHours: 6,
          },
        ],
        flexibleOptions: [
          { itemId: "item-2", title: "Refactor", estimatedHours: 8 },
          { itemId: "item-3", title: "Cuerdas", estimatedHours: 1 },
        ],
        deferredItems: [
          { itemId: "item-4", title: "Discord", reason: "archived", rationale: "Archivado" },
        ],
        unplannedSpace: { rationale: "Espacio libre", recommendedHours: 6.25 },
        confirmationPrompt: { question: "¿Semana de contención?", keyTradeoffs: [], pendingQuestions: [] },
      };
    });

    const proposal = await buildWeek(mockProvider, sampleInput);
    expect(proposal.foci).toHaveLength(0);
    expect(proposal.obligations).toHaveLength(1);
    expect(proposal.flexibleOptions).toHaveLength(2);
  });

  // ==========================================================================
  // 2. Strict Boundary Audits & Rejections
  // ==========================================================================

  it("Scenario 9: rejects proposals with phantom IDs", async () => {
    mockProvider.setBuildWeekHandler(() => {
      return {
        weekSummary: {
          targetWeek: sampleTargetWeek,
          capacity: {
            totalAvailableHours: null,
            plannableHours: null,
            plannedHours: null,
            knownEstimatedHours: null,
            estimationCompleteness: "none",
            protectedSpaceHours: null,
            capacityStatus: "unknown",
            protectedSpaceStatus: "unknown",
          },
        },
        foci: [],
        obligations: [
          {
            itemId: "phantom-id-99", // Phantom!
            title: "Fantasma",
            commitmentType: "external",
            rationale: "r",
            estimatedHours: null,
          },
        ],
        flexibleOptions: [],
        deferredItems: [],
        unplannedSpace: { rationale: "r", recommendedHours: null },
        confirmationPrompt: { question: "q", keyTradeoffs: [], pendingQuestions: [] },
      };
    });

    await expect(buildWeek(mockProvider, sampleInput)).rejects.toThrow(WeekValidationError);
  });

  it("Scenario 10: rejects proposals with contradictory multi-category assignments", async () => {
    mockProvider.setBuildWeekHandler(() => {
      return {
        weekSummary: {
          targetWeek: sampleTargetWeek,
          capacity: {
            totalAvailableHours: null,
            plannableHours: null,
            plannedHours: null,
            knownEstimatedHours: null,
            estimationCompleteness: "none",
            protectedSpaceHours: null,
            capacityStatus: "unknown",
            protectedSpaceStatus: "unknown",
          },
        },
        foci: [],
        obligations: [
          {
            itemId: "item-1", // item-1 in obligations
            title: "Demo",
            commitmentType: "external",
            rationale: "r",
            estimatedHours: null,
          },
        ],
        flexibleOptions: [],
        deferredItems: [
          {
            itemId: "item-1", // item-1 ALSO in deferredItems!
            title: "Demo",
            reason: "out_of_capacity",
            rationale: "Conflicto",
          },
        ],
        unplannedSpace: { rationale: "r", recommendedHours: null },
        confirmationPrompt: { question: "q", keyTradeoffs: [], pendingQuestions: [] },
      };
    });

    await expect(buildWeek(mockProvider, sampleInput)).rejects.toThrow(WeekValidationError);
  });

  it("Scenario 11: rejects provider response with invalid JSON string", async () => {
    mockProvider.setBuildWeekHandler(() => {
      return "{ invalid json structure here";
    });

    await expect(buildWeek(mockProvider, sampleInput)).rejects.toThrow(WeekValidationError);
  });

  it("Scenario 12: rejects ambiguous responses with multiple code blocks", async () => {
    mockProvider.setBuildWeekHandler(() => {
      return "```json\n{\"foci\": []}\n```\n\n```json\n{\"foci\": []}\n```";
    });

    await expect(buildWeek(mockProvider, sampleInput)).rejects.toThrow(WeekValidationError);
  });

  it("Scenario 13: rejects ambiguous responses with multiple wrapper roots", async () => {
    mockProvider.setBuildWeekHandler(() => {
      return JSON.stringify({
        proposedWeek: { foci: [] },
        week: { foci: [] },
      });
    });

    await expect(buildWeek(mockProvider, sampleInput)).rejects.toThrow(WeekValidationError);
  });

  it("Scenario 14: rejects unknown / invented fields due to strict domain schema", async () => {
    mockProvider.setBuildWeekHandler(() => {
      return JSON.stringify({
        weekSummary: {
          targetWeek: sampleTargetWeek,
          capacity: {
            totalAvailableHours: 25,
            plannableHours: 18.75,
            plannedHours: 14,
            knownEstimatedHours: 14,
            estimationCompleteness: "complete",
            protectedSpaceHours: 6.25,
            capacityStatus: "within_capacity",
            protectedSpaceStatus: "respected",
          },
        },
        foci: [
          {
            id: "focus-1",
            title: "Lanzamiento",
            desiredOutcome: "Listo",
            rationale: "Clave",
            contributingItemIds: ["item-2"],
            estimatedHours: 8,
            priorityScore: 99, // Unrecognized unknown field!
          },
        ],
        obligations: [
          {
            itemId: "item-1",
            title: "Demo",
            commitmentType: "external",
            rationale: "Compromiso",
            estimatedHours: 6,
          },
        ],
        flexibleOptions: [{ itemId: "item-3", title: "Cuerdas", estimatedHours: 1 }],
        deferredItems: [{ itemId: "item-4", title: "Discord", reason: "archived", rationale: "r" }],
        unplannedSpace: { rationale: "r", recommendedHours: 6.25 },
        confirmationPrompt: { question: "q", keyTradeoffs: [], pendingQuestions: [] },
      });
    });

    await expect(buildWeek(mockProvider, sampleInput)).rejects.toThrow(WeekValidationError);
  });

  it("Scenario 15: safely resolves Groq case-02 pattern where an obligation item is also included in a focus contributingItemIds", async () => {
    mockProvider.setBuildWeekHandler(() => {
      return JSON.stringify({
        weekSummary: {
          targetWeek: sampleTargetWeek,
          intent: "Cierre fiscal y entregas",
        },
        foci: [
          {
            id: "focus-1",
            title: "Cierre fiscal",
            desiredOutcome: "Presentación y cierre listos",
            rationale: "Foco principal",
            contributingItemIds: ["item-1", "item-2"], // item-1 is also in obligations!
            estimatedHours: 14,
          },
        ],
        obligations: [
          {
            itemId: "item-1",
            title: "Demo inversores",
            commitmentType: "external",
            dueDate: "2026-10-16",
            rationale: "Compromiso ineludible con inversores",
            estimatedHours: 6,
          },
        ],
        flexibleOptions: [
          {
            itemId: "item-3",
            title: "Cambiar cuerdas",
            estimatedHours: 1,
          },
        ],
        deferredItems: [
          {
            itemId: "item-4",
            title: "Discord bot",
            reason: "archived",
            rationale: "Archivado",
          },
        ],
        unplannedSpace: {
          rationale: "Espacio protegido",
          recommendedHours: 6.25,
        },
        confirmationPrompt: {
          question: "¿Procedemos con la semana?",
          keyTradeoffs: [],
          pendingQuestions: [],
        },
      });
    });

    const auditResult = await buildWeekWithAudit(mockProvider, sampleInput);

    // Repaired flag must be true with the explicit repair logged
    expect(auditResult.repaired).toBe(true);
    expect(
      auditResult.repairs.some(
        (r) => r.type === "resolved_obligation_focus_conflict" && r.itemId === "item-1"
      )
    ).toBe(true);

    // Obligation must be preserved with its original fields and date
    const ob = auditResult.proposal.obligations.find((o) => o.itemId === "item-1");
    expect(ob).toBeDefined();
    expect(ob?.commitmentType).toBe("external");
    expect(ob?.dueDate).toBe("2026-10-16");

    // item-1 must be removed from the focus contributingItemIds
    const focus = auditResult.proposal.foci.find((f) => f.id === "focus-1");
    expect(focus).toBeDefined();
    expect(focus?.contributingItemIds).toEqual(["item-2"]);
    expect(focus?.estimatedHours).toBe(8); // Recalculated for item-2 only

    // Every item appears exactly once in the entire proposal
    const allAssigned = [
      ...auditResult.proposal.foci.flatMap((f) => f.contributingItemIds),
      ...auditResult.proposal.obligations.map((o) => o.itemId),
      ...auditResult.proposal.flexibleOptions.map((fo) => fo.itemId),
      ...auditResult.proposal.deferredItems.map((d) => d.itemId),
    ];
    expect(allAssigned.sort()).toEqual(["item-1", "item-2", "item-3", "item-4"].sort());
  });

  describe("Semantic Quality Verification", () => {
    it("flags an idea erroneously converted into an obligation", () => {
      const proposal: ProposedWeek = {
        weekSummary: {
          targetWeek: sampleTargetWeek,
          capacity: {
            totalAvailableHours: 25,
            plannableHours: 18.75,
            plannedHours: null,
            knownEstimatedHours: null,
            estimationCompleteness: "none",
            protectedSpaceHours: 6.25,
            capacityStatus: "unknown",
            protectedSpaceStatus: "unknown",
          },
        },
        foci: [],
        obligations: [
          {
            itemId: "item-3", // item-3 is an idea!
            title: "Cambiar cuerdas de la guitarra",
            commitmentType: "external",
            rationale: "Falsely scheduled as obligation",
            estimatedHours: null,
          },
        ],
        flexibleOptions: [
          { itemId: "item-1", title: "Demo inversores", estimatedHours: null },
          { itemId: "item-2", title: "Refactor core", estimatedHours: null },
        ],
        deferredItems: [
          { itemId: "item-4", title: "Discord bot", reason: "archived", rationale: "r" },
        ],
        unplannedSpace: { rationale: "r", recommendedHours: 6.25 },
        confirmationPrompt: { question: "q", keyTradeoffs: [], pendingQuestions: [] },
      };

      const result = evaluateProposedWeekSemanticQuality(proposal, sampleInput);
      expect(result.valid).toBe(false);
      expect(result.status).toBe("semantic_failure");
      expect(result.checks.ideasNotObligations).toBe(false);
      expect(result.errors.some((e) => e.includes("Idea item"))).toBe(true);
    });

    it("flags a dependency deferred without explicit depends_on relation", () => {
      const proposal: ProposedWeek = {
        weekSummary: {
          targetWeek: sampleTargetWeek,
          capacity: {
            totalAvailableHours: 25,
            plannableHours: 18.75,
            plannedHours: null,
            knownEstimatedHours: null,
            estimationCompleteness: "none",
            protectedSpaceHours: 6.25,
            capacityStatus: "unknown",
            protectedSpaceStatus: "unknown",
          },
        },
        foci: [],
        obligations: [
          { itemId: "item-1", title: "Demo", commitmentType: "external", rationale: "r", estimatedHours: null },
        ],
        flexibleOptions: [
          { itemId: "item-3", title: "Cuerdas", estimatedHours: null },
        ],
        deferredItems: [
          {
            itemId: "item-2", // has NO depends_on in sampleInput
            title: "Refactor",
            reason: "waiting_dependency",
            rationale: "Falsely claiming dependency blocker",
          },
          { itemId: "item-4", title: "Discord", reason: "archived", rationale: "r" },
        ],
        unplannedSpace: { rationale: "r", recommendedHours: 6.25 },
        confirmationPrompt: { question: "q", keyTradeoffs: [], pendingQuestions: [] },
      };

      const result = evaluateProposedWeekSemanticQuality(proposal, sampleInput);
      expect(result.valid).toBe(false);
      expect(result.checks.dependenciesBackedByExplicitDependsOn).toBe(false);
      expect(result.errors.some((e) => e.includes("waiting_dependency"))).toBe(true);
    });

    it("flags archived items assigned to active schedule categories", () => {
      const proposal: ProposedWeek = {
        weekSummary: {
          targetWeek: sampleTargetWeek,
          capacity: {
            totalAvailableHours: 25,
            plannableHours: 18.75,
            plannedHours: null,
            knownEstimatedHours: null,
            estimationCompleteness: "none",
            protectedSpaceHours: 6.25,
            capacityStatus: "unknown",
            protectedSpaceStatus: "unknown",
          },
        },
        foci: [],
        obligations: [
          { itemId: "item-1", title: "Demo", commitmentType: "external", rationale: "r", estimatedHours: null },
        ],
        flexibleOptions: [
          { itemId: "item-4", title: "Discord bot", estimatedHours: null }, // item-4 has archived status!
        ],
        deferredItems: [
          { itemId: "item-2", title: "Refactor", reason: "not_scheduled", rationale: "r" },
          { itemId: "item-3", title: "Cuerdas", reason: "not_scheduled", rationale: "r" },
        ],
        unplannedSpace: { rationale: "r", recommendedHours: 6.25 },
        confirmationPrompt: { question: "q", keyTradeoffs: [], pendingQuestions: [] },
      };

      const result = evaluateProposedWeekSemanticQuality(proposal, sampleInput);
      expect(result.valid).toBe(false);
      expect(result.checks.archivedItemsPreserved).toBe(false);
      expect(result.errors.some((e) => e.includes("Archived item"))).toBe(true);
    });

    it("flags dishonest capacity when estimates are incomplete but capacity is marked within_capacity", () => {
      const proposal: ProposedWeek = {
        weekSummary: {
          targetWeek: sampleTargetWeek,
          capacity: {
            totalAvailableHours: 25,
            plannableHours: 18.75,
            plannedHours: null,
            knownEstimatedHours: 6,
            estimationCompleteness: "partial",
            protectedSpaceHours: 6.25,
            capacityStatus: "within_capacity", // Dishonest!
            protectedSpaceStatus: "respected",
          },
        },
        foci: [],
        obligations: [
          { itemId: "item-1", title: "Demo", commitmentType: "external", rationale: "r", estimatedHours: 6 },
        ],
        flexibleOptions: [{ itemId: "item-3", title: "Cuerdas", estimatedHours: 1 }],
        deferredItems: [
          { itemId: "item-2", title: "Refactor", reason: "not_scheduled", rationale: "r" },
          { itemId: "item-4", title: "Discord", reason: "archived", rationale: "r" },
        ],
        unplannedSpace: { rationale: "r", recommendedHours: 6.25 },
        confirmationPrompt: { question: "q", keyTradeoffs: [], pendingQuestions: [] },
      };

      const result = evaluateProposedWeekSemanticQuality(proposal, sampleInput);
      expect(result.valid).toBe(false);
      expect(result.checks.honestCapacityStatus).toBe(false);
    });
  });

  describe("GroqProvider Controlled Integration", () => {
    it("requires GROQ_API_KEY when instantiated without apiKey or client", () => {
      const origKey = process.env.GROQ_API_KEY;
      delete process.env.GROQ_API_KEY;
      try {
        expect(() => new GroqProvider()).toThrow("GROQ_API_KEY is required for GroqProvider");
      } finally {
        if (origKey) process.env.GROQ_API_KEY = origKey;
      }
    });

    it("returns empty proposal without calling API when input has 0 items", async () => {
      let clientCalled = false;
      const fakeClient = {
        chat: {
          completions: {
            create: async () => {
              clientCalled = true;
              return {};
            },
          },
        },
      } as any;

      const groqProvider = new GroqProvider({ client: fakeClient });
      const emptyInput: BuildWeekInput = {
        ...sampleInput,
        items: [],
      };

      const result = await groqProvider.buildWeek(emptyInput);
      expect(clientCalled).toBe(false);
      expect(result.obligations).toEqual([]);
      expect(result.foci).toEqual([]);
      expect(groqProvider.getLastExecutionMeta()?.provider).toBe("groq");
    });

    it("parses valid LLM response and populates execution metadata and token metrics", async () => {
      const validLlmResponse = JSON.stringify({
        weekSummary: {
          targetWeek: sampleTargetWeek,
          intent: "Enfoque en demo",
        },
        foci: [],
        obligations: [
          {
            itemId: "item-1",
            title: "Demo inversores",
            commitmentType: "external",
            rationale: "Compromiso de entrega",
            estimatedHours: 6,
          },
        ],
        flexibleOptions: [
          {
            itemId: "item-3",
            title: "Cambiar cuerdas",
            condition: "Si queda tiempo",
            estimatedHours: 1,
          },
        ],
        deferredItems: [
          {
            itemId: "item-2",
            title: "Refactor core",
            reason: "not_scheduled",
            rationale: "Para sprint posterior",
          },
          {
            itemId: "item-4",
            title: "Discord bot",
            reason: "archived",
            rationale: "Idea descartada",
          },
        ],
        unplannedSpace: {
          rationale: "Espacio protegido",
          recommendedHours: 6.25,
        },
        confirmationPrompt: {
          question: "¿Avanzamos con esta estructura?",
          keyTradeoffs: [],
          pendingQuestions: [],
        },
      });

      const fakeClient = {
        chat: {
          completions: {
            create: async () => {
              return {
                choices: [{ message: { content: validLlmResponse } }],
                usage: {
                  prompt_tokens: 450,
                  completion_tokens: 210,
                  total_tokens: 660,
                },
              };
            },
          },
        },
      } as any;

      const groqProvider = new GroqProvider({ client: fakeClient });
      const proposal = await groqProvider.buildWeek(sampleInput);

      expect(proposal.obligations.length).toBe(1);
      expect(proposal.obligations[0].itemId).toBe("item-1");
      expect(proposal.deferredItems.length).toBe(2);

      const meta = groqProvider.getLastExecutionMeta();
      expect(meta).toBeDefined();
      expect(meta?.provider).toBe("groq");
      expect(meta?.tokensUsed?.prompt).toBe(450);
      expect(meta?.tokensUsed?.completion).toBe(210);
      expect(meta?.tokensUsed?.total).toBe(660);

      const parseResult = groqProvider.getLastParseResult();
      expect(parseResult?.success).toBe(true);
    });

    it("parses real-world Groq LLM response containing groupId: null in focus", async () => {
      const groqResponseWithNullGroupId = JSON.stringify({
        weekSummary: {
          targetWeek: sampleTargetWeek,
          intent: "Cerrar compromisos",
        },
        foci: [
          {
            id: "focus-1",
            title: "Lanzamiento y Demo",
            groupId: null, // Exact payload pattern from Groq case-01
            desiredOutcome: "Presentar demo a inversores",
            rationale: "Compromiso de entrega de la semana",
            contributingItemIds: ["item-1", "item-2"],
            estimatedHours: 14,
          },
        ],
        obligations: [],
        flexibleOptions: [
          {
            itemId: "item-3",
            title: "Cambiar cuerdas",
            condition: null, // Null condition
            estimatedHours: 1,
          },
        ],
        deferredItems: [
          {
            itemId: "item-4",
            title: "Discord bot",
            reason: "archived",
            rationale: "Idea descartada",
          },
        ],
        unplannedSpace: {
          rationale: "Espacio protegido",
          recommendedHours: 6.25,
        },
        confirmationPrompt: {
          question: "¿Avanzamos con esta propuesta?",
          keyTradeoffs: [],
          pendingQuestions: [],
        },
      });

      const fakeClient = {
        chat: {
          completions: {
            create: async () => {
              return {
                choices: [{ message: { content: groqResponseWithNullGroupId } }],
                usage: { prompt_tokens: 500, completion_tokens: 220, total_tokens: 720 },
              };
            },
          },
        },
      } as any;

      const groqProvider = new GroqProvider({ client: fakeClient });
      const proposal = await groqProvider.buildWeek(sampleInput);

      expect(proposal.foci).toHaveLength(1);
      expect(proposal.foci[0].id).toBe("focus-1");
      expect(proposal.foci[0].groupId).toBeUndefined();
      expect("groupId" in proposal.foci[0]).toBe(false);
      expect(proposal.flexibleOptions[0].condition).toBeUndefined();
    });
  });

  describe("Auditoría semántica de build_week y regresiones", () => {
    it("fails semantic evaluation when an external commitment is deferred due to depends_on blocker", () => {
      const inputWithBlockedCommitment: BuildWeekInput = {
        ...sampleInput,
        items: [
          ...sampleItems,
          {
            id: "item-ext-blocked",
            rawText: "Entregar reporte a cliente (bloqueado por data)",
            title: "Reporte a cliente",
            type: "commitment",
            commitment: "external",
            status: "started",
          },
        ],
        relationships: [
          {
            sourceItemId: "item-ext-blocked",
            targetItemId: "item-2",
            type: "depends_on",
            confidence: "high",
            reason: "Necesita datos del backend",
          },
        ],
      };

      // Invalid proposal: sends item-ext-blocked to deferredItems because of depends_on
      const proposalWithUnilateralDeferred: ProposedWeek = {
        weekSummary: {
          targetWeek: sampleTargetWeek,
          intent: "Prueba",
          capacity: {
            totalAvailableHours: 40,
            plannableHours: 30,
            plannedHours: null,
            knownEstimatedHours: 6,
            estimationCompleteness: "partial",
            protectedSpaceHours: 10,
            capacityStatus: "within_capacity",
            protectedSpaceStatus: "respected",
          },
        },
        foci: [],
        obligations: [
          {
            itemId: "item-1",
            title: "Demo inversores",
            commitmentType: "external",
            rationale: "Demo",
            estimatedHours: 6,
          },
        ],
        flexibleOptions: [],
        deferredItems: [
          {
            itemId: "item-ext-blocked",
            title: "Reporte a cliente",
            reason: "waiting_dependency",
            rationale: "Bloqueado por backend",
          },
          { itemId: "item-2", title: "Refactor backend", reason: "not_scheduled", rationale: "No planificado" },
          { itemId: "item-3", title: "Cambiar cuerdas", reason: "not_scheduled", rationale: "No planificado" },
          { itemId: "item-4", title: "Discord bot", reason: "archived", rationale: "Archivado" },
        ],
        unplannedSpace: { rationale: "Protegido", recommendedHours: 10 },
        confirmationPrompt: {
          question: "¿Avanzamos?",
          keyTradeoffs: [],
          pendingQuestions: [],
        },
      };

      const audit = evaluateProposedWeekSemanticQuality(proposalWithUnilateralDeferred, inputWithBlockedCommitment);
      expect(audit.valid).toBe(false);
      expect(audit.checks.explicitCommitmentsPreserved).toBe(false);
      expect(audit.errors.some((e) => e.includes("item-ext-blocked"))).toBe(true);
    });

    it("verifies MockProvider keeps blocked external commitments in obligations and notes tension in keyTradeoffs", async () => {
      const inputWithBlockedCommitment: BuildWeekInput = {
        ...sampleInput,
        items: [
          ...sampleItems,
          {
            id: "item-ext-blocked",
            rawText: "Entregar reporte a cliente",
            title: "Reporte a cliente",
            type: "commitment",
            commitment: "external",
            status: "started",
          },
        ],
        relationships: [
          {
            sourceItemId: "item-ext-blocked",
            targetItemId: "item-2",
            type: "depends_on",
            confidence: "high",
            reason: "Falta data de migración",
          },
        ],
      };

      const result = await mockProvider.buildWeek(inputWithBlockedCommitment);
      // The external commitment MUST remain in obligations
      const ob = result.obligations.find((o) => o.itemId === "item-ext-blocked");
      expect(ob).toBeDefined();
      expect(ob?.commitmentType).toBe("external");
      expect(ob?.rationale).toContain("ATENCIÓN: Bloqueado por dependencias");

      // keyTradeoffs must alert about the blocked external commitment
      expect(
        result.confirmationPrompt.keyTradeoffs.some((t) =>
          t.includes("Reporte a cliente") && t.includes("bloqueado por dependencias")
        )
      ).toBe(true);

      // And semantic audit must pass!
      const audit = evaluateProposedWeekSemanticQuality(result, inputWithBlockedCommitment);
      expect(audit.valid).toBe(true);
      expect(audit.checks.explicitCommitmentsPreserved).toBe(true);
    });

    it("fails semantic evaluation when proposal invents estimatedHours without structured backing", () => {
      // item-4 is an archived idea with NO estimatedEffort
      const proposalWithInventedHours: ProposedWeek = {
        weekSummary: {
          targetWeek: sampleTargetWeek,
          intent: "Prueba",
          capacity: {
            totalAvailableHours: 40,
            plannableHours: 30,
            plannedHours: null,
            knownEstimatedHours: 11,
            estimationCompleteness: "partial",
            protectedSpaceHours: 10,
            capacityStatus: "within_capacity",
            protectedSpaceStatus: "respected",
          },
        },
        foci: [],
        obligations: [
          {
            itemId: "item-1",
            title: "Demo inversores",
            commitmentType: "external",
            rationale: "Demo",
            estimatedHours: 6,
          },
        ],
        flexibleOptions: [
          {
            itemId: "item-3",
            title: "Cambiar cuerdas",
            condition: "Si hay tiempo",
            estimatedHours: 5, // Input had 60 minutes (1h), but proposal says 5h without backing
          },
        ],
        deferredItems: [
          { itemId: "item-2", title: "Refactor backend", reason: "not_scheduled", rationale: "No planificado" },
          { itemId: "item-4", title: "Discord bot", reason: "archived", rationale: "Archivado" },
        ],
        unplannedSpace: { rationale: "Protegido", recommendedHours: 10 },
        confirmationPrompt: {
          question: "¿Avanzamos?",
          keyTradeoffs: [],
          pendingQuestions: [],
        },
      };

      const audit = evaluateProposedWeekSemanticQuality(proposalWithInventedHours, sampleInput);
      expect(audit.valid).toBe(false);
      expect(audit.checks.noInventedEstimates).toBe(false);
      expect(audit.errors.some((e) => e.includes("item-3") && e.includes("contradicts"))).toBe(true);
    });

    it("fails semantic evaluation when proposal claims complete plannedHours despite partial estimations", () => {
      // item-2 is part of focus-1, has hours (8h), but an obligation item without hours claims plannedHours
      const inputMissingSomeHours: BuildWeekInput = {
        ...sampleInput,
        items: [
          {
            ...sampleItems[0],
            estimatedEffort: undefined, // no effort known for this obligation
          },
          sampleItems[1],
          sampleItems[2],
          sampleItems[3],
        ],
      };

      const proposalDishonestCapacity: ProposedWeek = {
        weekSummary: {
          targetWeek: sampleTargetWeek,
          intent: "Prueba",
          capacity: {
            totalAvailableHours: 40,
            plannableHours: 30,
            plannedHours: 20, // Dishonestly claims total planned hours even though item-1 has no estimate!
            knownEstimatedHours: 8,
            estimationCompleteness: "partial",
            protectedSpaceHours: 10,
            capacityStatus: "within_capacity",
            protectedSpaceStatus: "respected",
          },
        },
        foci: [],
        obligations: [
          {
            itemId: "item-1",
            title: "Demo inversores",
            commitmentType: "external",
            rationale: "Demo",
            estimatedHours: null,
          },
        ],
        flexibleOptions: [],
        deferredItems: [
          { itemId: "item-2", title: "Refactor backend", reason: "not_scheduled", rationale: "No planificado" },
          { itemId: "item-3", title: "Cambiar cuerdas", reason: "not_scheduled", rationale: "No planificado" },
          { itemId: "item-4", title: "Discord bot", reason: "archived", rationale: "Archivado" },
        ],
        unplannedSpace: { rationale: "Protegido", recommendedHours: 10 },
        confirmationPrompt: {
          question: "¿Avanzamos?",
          keyTradeoffs: [],
          pendingQuestions: [],
        },
      };

      const audit = evaluateProposedWeekSemanticQuality(proposalDishonestCapacity, inputMissingSomeHours);
      expect(audit.valid).toBe(false);
      expect(audit.checks.honestCapacityStatus).toBe(false);
      expect(audit.errors.some((e) => e.includes("plannedHours must be null"))).toBe(true);
    });

    it("regression case-18: flags task with high importance placed into flexibleOptions or converted into fake obligation", () => {
      const inputWithHighImportanceTask: BuildWeekInput = {
        ...sampleInput,
        items: [
          ...sampleItems,
          {
            id: "c18-2",
            rawText: "Bug crítico en login con Google",
            title: "Bug login Google",
            type: "task",
            importance: "high",
            status: "started",
          },
        ],
      };

      // 1. Erroneously placing high importance task as a flexible option
      const proposalWithFlexibleHighImportance: ProposedWeek = {
        weekSummary: {
          targetWeek: sampleTargetWeek,
          intent: "Atención a login",
          capacity: {
            totalAvailableHours: 40,
            plannableHours: 30,
            plannedHours: null,
            knownEstimatedHours: 6,
            estimationCompleteness: "partial",
            protectedSpaceHours: 10,
            capacityStatus: "within_capacity",
            protectedSpaceStatus: "respected",
          },
        },
        foci: [],
        obligations: [
          {
            itemId: "item-1",
            title: "Demo inversores",
            commitmentType: "external",
            rationale: "Demo",
            estimatedHours: 6,
          },
        ],
        flexibleOptions: [
          {
            itemId: "c18-2", // High importance task degraded to flexible option!
            title: "Bug login Google",
            estimatedHours: null,
          },
        ],
        deferredItems: [
          { itemId: "item-2", title: "Refactor backend", reason: "not_scheduled", rationale: "No planificado" },
          { itemId: "item-3", title: "Cambiar cuerdas", reason: "not_scheduled", rationale: "No planificado" },
          { itemId: "item-4", title: "Discord bot", reason: "archived", rationale: "Archivado" },
        ],
        unplannedSpace: { rationale: "Protegido", recommendedHours: 10 },
        confirmationPrompt: { question: "¿Avanzamos?", keyTradeoffs: [], pendingQuestions: [] },
      };

      const auditFlex = evaluateProposedWeekSemanticQuality(
        proposalWithFlexibleHighImportance,
        inputWithHighImportanceTask
      );
      expect(auditFlex.valid).toBe(false);
      expect(auditFlex.checks.highImportanceNotFlexible).toBe(false);
      expect(auditFlex.errors.some((e) => e.includes("c18-2") && e.includes("flexible option"))).toBe(true);

      // 2. Erroneously placing high importance task as an obligation without deadline or external commitment
      const proposalWithFakeObligation: ProposedWeek = {
        ...proposalWithFlexibleHighImportance,
        flexibleOptions: [],
        obligations: [
          {
            itemId: "item-1",
            title: "Demo inversores",
            commitmentType: "external",
            rationale: "Demo",
            estimatedHours: 6,
          },
          {
            itemId: "c18-2", // Fake obligation without deadline or external commitment!
            title: "Bug login Google",
            commitmentType: "external",
            rationale: "Es importante",
            estimatedHours: null,
          },
        ],
      };

      const auditOb = evaluateProposedWeekSemanticQuality(
        proposalWithFakeObligation,
        inputWithHighImportanceTask
      );
      expect(auditOb.valid).toBe(false);
      expect(auditOb.checks.highImportanceNotFlexible).toBe(false);
      expect(
        auditOb.errors.some(
          (e) => e.includes("c18-2") && e.includes("converted into an obligation without external commitment")
        )
      ).toBe(true);
    });

    it("regression case-18: passes semantic evaluation when high importance task is placed in focus or deferred", () => {
      const inputWithHighImportanceTask: BuildWeekInput = {
        ...sampleInput,
        items: [
          ...sampleItems,
          {
            id: "c18-2",
            rawText: "Bug crítico en login con Google",
            title: "Bug login Google",
            type: "task",
            importance: "high",
            status: "started",
          },
        ],
      };

      // Valid case A: High importance task placed as a Focus
      const proposalAsFocus: ProposedWeek = {
        weekSummary: {
          targetWeek: sampleTargetWeek,
          intent: "Foco en bug crítico",
          capacity: {
            totalAvailableHours: 25,
            plannableHours: 18.75,
            plannedHours: null,
            knownEstimatedHours: 6,
            estimationCompleteness: "partial",
            protectedSpaceHours: 6.25,
            capacityStatus: "unknown",
            protectedSpaceStatus: "unknown",
          },
        },
        foci: [
          {
            id: "focus-login",
            title: "Corregir bug login Google",
            desiredOutcome: "Login operativo",
            rationale: "Impacta a todos los usuarios",
            contributingItemIds: ["c18-2"],
            estimatedHours: null,
          },
        ],
        obligations: [
          {
            itemId: "item-1",
            title: "Demo inversores",
            commitmentType: "external",
            rationale: "Demo",
            estimatedHours: 6,
          },
        ],
        flexibleOptions: [
          { itemId: "item-3", title: "Cambiar cuerdas", estimatedHours: 1 },
        ],
        deferredItems: [
          { itemId: "item-2", title: "Refactor backend", reason: "not_scheduled", rationale: "No planificado" },
          { itemId: "item-4", title: "Discord bot", reason: "archived", rationale: "Archivado" },
        ],
        unplannedSpace: { rationale: "Protegido", recommendedHours: 6.25 },
        confirmationPrompt: { question: "¿Avanzamos?", keyTradeoffs: [], pendingQuestions: [] },
      };

      const auditFocus = evaluateProposedWeekSemanticQuality(
        proposalAsFocus,
        inputWithHighImportanceTask
      );
      expect(auditFocus.errors).toEqual([]);
      expect(auditFocus.valid).toBe(true);
      expect(auditFocus.checks.highImportanceNotFlexible).toBe(true);

      // Valid case B: High importance task deferred honestly (e.g. lack of time)
      const proposalAsDeferred: ProposedWeek = {
        ...proposalAsFocus,
        weekSummary: {
          ...proposalAsFocus.weekSummary,
          capacity: {
            totalAvailableHours: 25,
            plannableHours: 18.75,
            plannedHours: 6,
            knownEstimatedHours: 6,
            estimationCompleteness: "complete",
            protectedSpaceHours: 6.25,
            capacityStatus: "within_capacity",
            protectedSpaceStatus: "respected",
          },
        },
        foci: [],
        deferredItems: [
          { itemId: "c18-2", title: "Bug login Google", reason: "not_scheduled", rationale: "Pospuesto por capacidad" },
          { itemId: "item-2", title: "Refactor backend", reason: "not_scheduled", rationale: "No planificado" },
          { itemId: "item-4", title: "Discord bot", reason: "archived", rationale: "Archivado" },
        ],
      };

      const auditDeferred = evaluateProposedWeekSemanticQuality(
        proposalAsDeferred,
        inputWithHighImportanceTask
      );
      expect(auditDeferred.errors).toEqual([]);
      expect(auditDeferred.valid).toBe(true);
      expect(auditDeferred.checks.highImportanceNotFlexible).toBe(true);
    });

    it("regression dates & deadlines: flags obligations with invented dueDates or shifted deadlines", () => {
      // item-1 has deadline 2026-10-16, item-2 has NO deadline
      const proposalWithShiftedAndInventedDates: ProposedWeek = {
        weekSummary: {
          targetWeek: sampleTargetWeek,
          intent: "Prueba fechas",
          capacity: {
            totalAvailableHours: 25,
            plannableHours: 18.75,
            plannedHours: 6,
            knownEstimatedHours: 6,
            estimationCompleteness: "complete",
            protectedSpaceHours: 6.25,
            capacityStatus: "within_capacity",
            protectedSpaceStatus: "respected",
          },
        },
        foci: [],
        obligations: [
          {
            itemId: "item-1",
            title: "Demo inversores",
            commitmentType: "external",
            dueDate: "2026-10-18", // Shifted! Input deadline is 2026-10-16
            rationale: "Demo",
            estimatedHours: 6,
          },
        ],
        flexibleOptions: [
          { itemId: "item-3", title: "Cambiar cuerdas", estimatedHours: 1 },
        ],
        deferredItems: [
          { itemId: "item-2", title: "Refactor backend", reason: "not_scheduled", rationale: "No planificado" },
          { itemId: "item-4", title: "Discord bot", reason: "archived", rationale: "Archivado" },
        ],
        unplannedSpace: { rationale: "Protegido", recommendedHours: 6.25 },
        confirmationPrompt: { question: "¿Avanzamos?", keyTradeoffs: [], pendingQuestions: [] },
      };

      const auditShifted = evaluateProposedWeekSemanticQuality(
        proposalWithShiftedAndInventedDates,
        sampleInput
      );
      expect(auditShifted.valid).toBe(false);
      expect(auditShifted.checks.deadlinesPreservedWithoutShifting).toBe(false);
      expect(
        auditShifted.errors.some(
          (e) => e.includes("item-1") && e.includes("contradicts or shifts the detected deadline")
        )
      ).toBe(true);

      // Also test invented date on item with no deadline
      const proposalWithInventedDate: ProposedWeek = {
        ...proposalWithShiftedAndInventedDates,
        obligations: [
          {
            itemId: "item-1",
            title: "Demo inversores",
            commitmentType: "external",
            dueDate: "2026-10-16", // Correct date for item-1
            rationale: "Demo",
            estimatedHours: 6,
          },
          {
            itemId: "item-2", // item-2 has NO deadline in input
            title: "Refactor backend",
            commitmentType: "external",
            dueDate: "2026-10-15", // Invented date!
            rationale: "Refactor",
            estimatedHours: 8,
          },
        ],
        deferredItems: [
          { itemId: "item-4", title: "Discord bot", reason: "archived", rationale: "Archivado" },
        ],
      };

      const auditInvented = evaluateProposedWeekSemanticQuality(
        proposalWithInventedDate,
        sampleInput
      );
      expect(auditInvented.valid).toBe(false);
      expect(auditInvented.checks.deadlinesPreservedWithoutShifting).toBe(false);
      expect(
        auditInvented.errors.some(
          (e) => e.includes("item-2") && e.includes("has no detected deadline")
        )
      ).toBe(true);
    });

    it("regression not_scheduled: flags rationales falsely claiming user decision and warns on unannounced high-importance omissions", () => {
      const inputWithHighImp: BuildWeekInput = {
        ...sampleInput,
        items: [
          ...sampleItems,
          {
            id: "c18-2",
            rawText: "Bug crítico en login",
            title: "Bug login",
            type: "task",
            importance: "high",
            status: "started",
          },
        ],
      };

      // 1. Rationale falsely claiming the user decided to postpone
      const proposalWithDishonestRationale: ProposedWeek = {
        weekSummary: {
          targetWeek: sampleTargetWeek,
          intent: "Prueba",
          capacity: {
            totalAvailableHours: 25,
            plannableHours: 18.75,
            plannedHours: 6,
            knownEstimatedHours: 6,
            estimationCompleteness: "complete",
            protectedSpaceHours: 6.25,
            capacityStatus: "within_capacity",
            protectedSpaceStatus: "respected",
          },
        },
        foci: [],
        obligations: [
          {
            itemId: "item-1",
            title: "Demo inversores",
            commitmentType: "external",
            dueDate: "2026-10-16",
            rationale: "Demo",
            estimatedHours: 6,
          },
        ],
        flexibleOptions: [{ itemId: "item-3", title: "Cuerdas", estimatedHours: 1 }],
        deferredItems: [
          {
            itemId: "c18-2",
            title: "Bug login",
            reason: "not_scheduled",
            rationale: "El usuario decidió posponerlo para la próxima semana.", // Dishonest claim!
          },
          { itemId: "item-2", title: "Refactor backend", reason: "not_scheduled", rationale: "No planificado" },
          { itemId: "item-4", title: "Discord bot", reason: "archived", rationale: "Archivado" },
        ],
        unplannedSpace: { rationale: "Protegido", recommendedHours: 6.25 },
        confirmationPrompt: { question: "¿Avanzamos?", keyTradeoffs: [], pendingQuestions: [] },
      };

      const auditDishonest = evaluateProposedWeekSemanticQuality(
        proposalWithDishonestRationale,
        inputWithHighImp
      );
      expect(auditDishonest.valid).toBe(false);
      expect(
        auditDishonest.errors.some(
          (e) => e.includes("c18-2") && e.includes("falsely asserts a deliberate user decision")
        )
      ).toBe(true);

      // 2. High-importance task deferred as not_scheduled without alerting user in tradeoffs emits warning
      const proposalWithoutTradeoffNotice: ProposedWeek = {
        ...proposalWithDishonestRationale,
        deferredItems: [
          {
            itemId: "c18-2",
            title: "Bug login",
            reason: "not_scheduled",
            rationale: "Elemento sin programar por capacidad.",
          },
          { itemId: "item-2", title: "Refactor backend", reason: "not_scheduled", rationale: "No planificado" },
          { itemId: "item-4", title: "Discord bot", reason: "archived", rationale: "Archivado" },
        ],
        confirmationPrompt: {
          question: "¿Avanzamos con la propuesta?",
          keyTradeoffs: ["Semana enfocada en la demo."], // Does NOT mention c18-2 or Bug login!
          pendingQuestions: [],
        },
      };

      const auditWarn = evaluateProposedWeekSemanticQuality(
        proposalWithoutTradeoffNotice,
        inputWithHighImp
      );
      expect(auditWarn.valid).toBe(true); // Warnings do not fail valid
      expect(
        auditWarn.warnings.some(
          (w) => w.includes("c18-2") && w.includes("neither confirmationPrompt.keyTradeoffs nor question alert")
        )
      ).toBe(true);
    });
  });
});

