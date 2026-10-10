import { describe, it, expect } from "vitest";
import {
  resolveTargetWeek,
  prepareWeekConstraints,
  calculateWeeklyCapacity,
  buildDeterministicPlanningContext,
  validateBuildWeekInput,
  assertValidBuildWeekInput,
  normalizeAndConserveProposedWeek,
  evaluateProposedWeekSemanticQuality,
  WeekValidationError,
} from "../src/skills/build-week/deterministic";
import { BuildWeekInput, ProposedWeek, TargetWeek } from "../src/domain/week";

describe("Skill 06: build_week - Deterministic Layer", () => {
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
    userIntent: "Cerrar compromisos",
    items: sampleItems,
    relationships: [
      {
        sourceItemId: "item-1",
        targetItemId: "item-2",
        type: "depends_on",
        confidence: "high",
        reason: "La demo depende del refactor",
      },
      {
        sourceItemId: "item-2",
        targetItemId: "item-3",
        type: "related_to", // Should NOT imply blocking!
        confidence: "medium",
        reason: "Relacionados temáticamente",
      },
      {
        sourceItemId: "item-1",
        targetItemId: "item-4",
        type: "part_of", // Should NOT imply blocking!
        confidence: "low",
        reason: "Mismo proyecto general",
      },
    ],
    groupedWork: {
      groups: [
        {
          id: "group-1",
          title: "Lanzamiento y Demo",
          itemIds: ["item-1", "item-2"],
          rationale: "Foco clave",
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

  // ==========================================================================
  // 1. Target Week Resolution & Date Boundaries
  // ==========================================================================
  describe("resolveTargetWeek", () => {
    it("respects explicit valid targetWeek", () => {
      const explicit = { startDate: "2026-10-19", endDate: "2026-10-25" };
      const resolved = resolveTargetWeek(baseDate, explicit);
      expect(resolved).toEqual(explicit);
    });

    it("resolves from Friday to following Monday-Sunday natural week", () => {
      // 2026-10-09 is Friday -> 2026-10-12 to 2026-10-18
      const resolved = resolveTargetWeek("2026-10-09");
      expect(resolved).toEqual({
        startDate: "2026-10-12",
        endDate: "2026-10-18",
      });
    });

    it("resolves from Sunday to following Monday-Sunday natural week", () => {
      // 2026-10-11 is Sunday -> 2026-10-12 to 2026-10-18
      const resolved = resolveTargetWeek("2026-10-11");
      expect(resolved).toEqual({
        startDate: "2026-10-12",
        endDate: "2026-10-18",
      });
    });

    it("resolves from Monday to next Monday-Sunday natural week", () => {
      // 2026-10-12 is Monday -> 2026-10-19 to 2026-10-25
      const resolved = resolveTargetWeek("2026-10-12");
      expect(resolved).toEqual({
        startDate: "2026-10-19",
        endDate: "2026-10-25",
      });
    });

    it("handles month transition accurately", () => {
      // 2026-10-29 is Thursday -> Monday 2026-11-02 to Sunday 2026-11-08
      const resolved = resolveTargetWeek("2026-10-29");
      expect(resolved).toEqual({
        startDate: "2026-11-02",
        endDate: "2026-11-08",
      });
    });

    it("handles year transition accurately", () => {
      // 2026-12-25 is Friday -> Monday 2026-12-28 to Sunday 2027-01-03
      const resolved = resolveTargetWeek("2026-12-25");
      expect(resolved).toEqual({
        startDate: "2026-12-28",
        endDate: "2027-01-03",
      });
    });

    it("handles leap year (2024-02-29)", () => {
      // 2024-02-23 is Friday -> Monday 2024-02-26 to Sunday 2024-03-03 (covers leap day 2024-02-29)
      const resolved = resolveTargetWeek("2024-02-23");
      expect(resolved).toEqual({
        startDate: "2024-02-26",
        endDate: "2024-03-03",
      });
    });

    it("throws WeekValidationError for invalid currentDate", () => {
      expect(() => resolveTargetWeek("not-a-date")).toThrow(WeekValidationError);
      expect(() => resolveTargetWeek("2026-02-30")).toThrow(WeekValidationError);
    });

    it("throws WeekValidationError for inverted targetWeek", () => {
      const inverted = { startDate: "2026-10-25", endDate: "2026-10-19" };
      expect(() => resolveTargetWeek(baseDate, inverted)).toThrow(WeekValidationError);
    });
  });

  // ==========================================================================
  // 2. Constraints Preparation & Explicit Dependencies
  // ==========================================================================
  describe("prepareWeekConstraints", () => {
    it("distinguishes external commitments, strict deadlines, and optional items", () => {
      const constraints = prepareWeekConstraints(sampleInput, sampleTargetWeek);

      // item-1 is external commitment
      expect(constraints.externalCommitments.some((c) => c.itemId === "item-1")).toBe(true);
      expect(constraints.externalCommitments.find((c) => c.itemId === "item-1")?.estimatedHours).toBe(6);

      // item-1 has deadline in week (2026-10-16 is Friday inside week 10-12..10-18)
      expect(constraints.strictDeadlinesInWeek.some((d) => d.itemId === "item-1")).toBe(true);

      // item-3 is an idea (optional item); MUST NOT be in strict deadlines even though it has a deadline
      expect(constraints.optionalItems.some((o) => o.itemId === "item-3")).toBe(true);
      expect(constraints.optionalItems.find((o) => o.itemId === "item-3")?.estimatedHours).toBe(1); // 60 minutes = 1 hour
      expect(constraints.strictDeadlinesInWeek.some((d) => d.itemId === "item-3")).toBe(false);

      // item-4 is archived; MUST NOT be in active constraints
      expect(constraints.archivedItems.some((a) => a.itemId === "item-4")).toBe(true);
      expect(constraints.externalCommitments.some((c) => c.itemId === "item-4")).toBe(false);
      expect(constraints.strictDeadlinesInWeek.some((d) => d.itemId === "item-4")).toBe(false);
    });

    it("identifies blocked items ONLY from explicit depends_on relationships", () => {
      const constraints = prepareWeekConstraints(sampleInput, sampleTargetWeek);

      // item-1 depends on item-2 -> item-1 is blocked!
      expect(constraints.blockedItems.some((b) => b.itemId === "item-1")).toBe(true);
      const blocked1 = constraints.blockedItems.find((b) => b.itemId === "item-1");
      expect(blocked1?.blockedByItemIds).toContain("item-2");

      // Direction check: item-2 is the dependency target, NOT blocked by item-1
      expect(constraints.blockedItems.some((b) => b.itemId === "item-2")).toBe(false);

      // item-2 has 'related_to' item-3 and item-1 has 'part_of' item-4:
      // must NOT create blocked items for item-2 or item-4
      expect(constraints.blockedItems.some((b) => b.itemId === "item-4")).toBe(false);
    });

    it("documents domain limitation for unblocking actions", () => {
      const constraints = prepareWeekConstraints(sampleInput, sampleTargetWeek);
      expect(constraints.unblockingActionLimitations.length).toBeGreaterThan(0);
      expect(
        constraints.unblockingActionLimitations.some((l) => l.includes("desbloqueo"))
      ).toBe(true);
    });
  });

  // ==========================================================================
  // 3. Deterministic Capacity Calculations
  // ==========================================================================
  describe("calculateWeeklyCapacity", () => {
    it("returns unknown capacity when totalAvailableHours is undefined", () => {
      const result = calculateWeeklyCapacity({
        capacityConfig: undefined,
      });

      expect(result.totalAvailableHours).toBeNull();
      expect(result.plannableHours).toBeNull();
      expect(result.plannedHours).toBeNull();
      expect(result.knownEstimatedHours).toBeNull();
      expect(result.estimationCompleteness).toBe("none");
      expect(result.capacityStatus).toBe("unknown");
      expect(result.protectedSpaceStatus).toBe("unknown");
    });

    it("computes plannable and protected space hours based on ratio", () => {
      const result = calculateWeeklyCapacity({
        capacityConfig: {
          totalAvailableHours: 40,
          minProtectedSpaceRatio: 0.3, // 30% protected
        },
      });

      expect(result.totalAvailableHours).toBe(40);
      expect(result.protectedSpaceHours).toBe(12); // 40 * 0.3
      expect(result.plannableHours).toBe(28); // 40 * 0.7
      expect(result.capacityStatus).toBe("unknown"); // No items estimated yet
    });

    it("declares within_capacity and respected when complete estimates fit", () => {
      const result = calculateWeeklyCapacity({
        capacityConfig: { totalAvailableHours: 25, minProtectedSpaceRatio: 0.25 }, // plannable = 18.75
        foci: [{ estimatedHours: 8 }],
        obligations: [{ estimatedHours: 6 }],
      });

      expect(result.plannableHours).toBe(18.75);
      expect(result.knownEstimatedHours).toBe(14); // 8 + 6
      expect(result.plannedHours).toBe(14);
      expect(result.estimationCompleteness).toBe("complete");
      expect(result.capacityStatus).toBe("within_capacity");
      expect(result.protectedSpaceStatus).toBe("respected");
    });

    it("declares over_capacity and compromised when complete estimates exceed plannable hours", () => {
      const result = calculateWeeklyCapacity({
        capacityConfig: { totalAvailableHours: 20, minProtectedSpaceRatio: 0.25 }, // plannable = 15
        foci: [{ estimatedHours: 10 }],
        obligations: [{ estimatedHours: 8 }], // total = 18 > 15
      });

      expect(result.plannableHours).toBe(15);
      expect(result.knownEstimatedHours).toBe(18);
      expect(result.plannedHours).toBe(18);
      expect(result.estimationCompleteness).toBe("complete");
      expect(result.capacityStatus).toBe("over_capacity");
      expect(result.protectedSpaceStatus).toBe("compromised");
    });

    it("handles partial estimates: preserves unknown status when known sum <= plannable", () => {
      const result = calculateWeeklyCapacity({
        capacityConfig: { totalAvailableHours: 25, minProtectedSpaceRatio: 0.25 }, // plannable = 18.75
        foci: [{ estimatedHours: 8 }],
        obligations: [{ estimatedHours: null }], // Missing estimate!
      });

      expect(result.knownEstimatedHours).toBe(8);
      expect(result.plannedHours).toBeNull(); // Must NOT present partial sum as plannedHours!
      expect(result.estimationCompleteness).toBe("partial");
      expect(result.capacityStatus).toBe("unknown");
      expect(result.protectedSpaceStatus).toBe("unknown");
    });

    it("handles partial estimates: triggers over_capacity when known sum ALONE exceeds plannable", () => {
      const result = calculateWeeklyCapacity({
        capacityConfig: { totalAvailableHours: 25, minProtectedSpaceRatio: 0.25 }, // plannable = 18.75
        foci: [{ estimatedHours: 20 }], // 20 > 18.75
        obligations: [{ estimatedHours: null }],
      });

      expect(result.knownEstimatedHours).toBe(20);
      expect(result.plannedHours).toBeNull();
      expect(result.estimationCompleteness).toBe("partial");
      expect(result.capacityStatus).toBe("over_capacity");
      expect(result.protectedSpaceStatus).toBe("compromised");
    });

    it("detects obligation overload: obligations alone exceed capacity", () => {
      const result = calculateWeeklyCapacity({
        capacityConfig: { totalAvailableHours: 20, minProtectedSpaceRatio: 0.25 }, // plannable = 15
        foci: [],
        obligations: [{ estimatedHours: 18 }], // 18 > 15
      });

      expect(result.capacityStatus).toBe("over_capacity");
      expect(result.protectedSpaceStatus).toBe("compromised");
    });
  });

  // ==========================================================================
  // 4. Input Validation & Reference Integrity
  // ==========================================================================
  describe("validateBuildWeekInput", () => {
    it("passes valid sample input", () => {
      const res = validateBuildWeekInput(sampleInput);
      expect(res.valid).toBe(true);
      expect(res.errors).toHaveLength(0);
      expect(() => assertValidBuildWeekInput(sampleInput)).not.toThrow();
    });

    it("catches duplicate item IDs in input.items", () => {
      const invalidInput: BuildWeekInput = {
        ...sampleInput,
        items: [...sampleItems, sampleItems[0]], // Duplicate item-1!
      };
      const res = validateBuildWeekInput(invalidInput);
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes("Duplicate item ID"))).toBe(true);
      expect(() => assertValidBuildWeekInput(invalidInput)).toThrow(WeekValidationError);
    });

    it("catches relationships referencing nonexistent item IDs", () => {
      const invalidInput: BuildWeekInput = {
        ...sampleInput,
        relationships: [
          {
            sourceItemId: "phantom-1",
            targetItemId: "item-2",
            type: "depends_on",
            confidence: "high",
            reason: "r",
          },
        ],
      };
      const res = validateBuildWeekInput(invalidInput);
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes("nonexistent sourceItemId"))).toBe(true);
    });

    it("catches groups referencing nonexistent item IDs", () => {
      const invalidInput: BuildWeekInput = {
        ...sampleInput,
        groupedWork: {
          groups: [
            { id: "g1", title: "g", itemIds: ["ghost-item"], rationale: "r" },
          ],
          ungroupedItemIds: [],
        },
      };
      const res = validateBuildWeekInput(invalidInput);
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes("references nonexistent itemId"))).toBe(true);
    });

    it("catches context referencing nonexistent item IDs", () => {
      const invalidInput: BuildWeekInput = {
        ...sampleInput,
        context: {
          ...sampleInput.context,
          itemAssessments: [
            { itemId: "nonexistent-item", attention: "high", signals: [], rationale: "r" },
          ],
        },
      };
      const res = validateBuildWeekInput(invalidInput);
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes("Context itemAssessment references nonexistent itemId"))).toBe(true);
    });

    it("catches negative or non-finite item estimates", () => {
      const invalidInput: BuildWeekInput = {
        ...sampleInput,
        items: [
          {
            ...sampleItems[0],
            estimatedEffort: { value: -5, unit: "hours", source: "user" },
          },
        ],
      };
      const res = validateBuildWeekInput(invalidInput);
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes("invalid estimatedEffort value"))).toBe(true);
    });
  });

  // ==========================================================================
  // 5. Deterministic Planning Context Construction
  // ==========================================================================
  describe("buildDeterministicPlanningContext", () => {
    it("builds normalized context for valid input without calling any AI model", () => {
      const ctx = buildDeterministicPlanningContext(sampleInput);

      expect(ctx.targetWeek).toEqual(sampleTargetWeek);
      expect(ctx.validItems).toHaveLength(4);
      expect(ctx.validItemIds).toEqual(["item-1", "item-2", "item-3", "item-4"]);
      expect(ctx.workGroups).toHaveLength(1);
      expect(ctx.constraints.externalCommitments).toHaveLength(1);
      expect(ctx.constraints.blockedItems).toHaveLength(1);
      expect(ctx.capacitySummary.totalAvailableHours).toBe(25);
    });

    it("tracks unresolved uncertainties transparently", () => {
      const inputWithoutCap = { ...sampleInput, capacity: undefined };
      const ctx = buildDeterministicPlanningContext(inputWithoutCap);

      expect(
        ctx.unresolvedUncertainties.some((u) => u.includes("Capacidad total no declarada"))
      ).toBe(true);
      expect(
        ctx.unresolvedUncertainties.some((u) => u.includes("desbloqueo"))
      ).toBe(true);
    });
  });

  // ==========================================================================
  // 6. Proposal Normalizer & Exact 100% Item Conservation (Audited)
  // ==========================================================================
  describe("normalizeAndConserveProposedWeek", () => {
    const validBaseProposal: ProposedWeek = {
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
          title: "Lanzamiento y Demo",
          groupId: "group-1",
          desiredOutcome: "Demo lista",
          rationale: "Foco principal",
          contributingItemIds: ["item-2"],
          estimatedHours: 8,
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
      flexibleOptions: [
        {
          itemId: "item-3",
          title: "Cambiar cuerdas",
          condition: "Opcional",
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

    it("passes and returns unmodified result when proposal is 100% compliant", () => {
      const result = normalizeAndConserveProposedWeek(validBaseProposal, sampleInput);
      expect(result.repaired).toBe(false);
      expect(result.repairs).toHaveLength(0);
      expect(result.proposal).toEqual(validBaseProposal);
    });

    it("REJECTS proposals with phantom item IDs without silently dropping them", () => {
      const proposalWithPhantom: ProposedWeek = {
        ...validBaseProposal,
        foci: [
          {
            ...validBaseProposal.foci[0],
            contributingItemIds: ["item-2", "phantom-task-99"],
          },
        ],
      };

      expect(() =>
        normalizeAndConserveProposedWeek(proposalWithPhantom, sampleInput)
      ).toThrow(WeekValidationError);

      try {
        normalizeAndConserveProposedWeek(proposalWithPhantom, sampleInput);
      } catch (err) {
        expect((err as Error).message).toContain("phantom item IDs detected");
      }
    });

    it("REJECTS proposals with nonexistent group IDs in foci", () => {
      const proposalWithBadGroup: ProposedWeek = {
        ...validBaseProposal,
        foci: [
          {
            ...validBaseProposal.foci[0],
            groupId: "nonexistent-group-99",
          },
        ],
      };

      expect(() =>
        normalizeAndConserveProposedWeek(proposalWithBadGroup, sampleInput)
      ).toThrow(WeekValidationError);

      try {
        normalizeAndConserveProposedWeek(proposalWithBadGroup, sampleInput);
      } catch (err) {
        expect((err as Error).message).toContain("nonexistent groupId");
      }
    });

    it("REJECTS proposals with contradictory assignments across multiple categories", () => {
      // item-1 assigned to both obligations AND deferredItems
      const proposalWithContradiction: ProposedWeek = {
        ...validBaseProposal,
        deferredItems: [
          ...validBaseProposal.deferredItems,
          {
            itemId: "item-1", // Contradiction!
            title: "Demo",
            reason: "out_of_capacity",
            rationale: "Conflict",
          },
        ],
      };

      expect(() =>
        normalizeAndConserveProposedWeek(proposalWithContradiction, sampleInput)
      ).toThrow(WeekValidationError);

      try {
        normalizeAndConserveProposedWeek(proposalWithContradiction, sampleInput);
      } catch (err) {
        expect((err as Error).message).toContain("contradictory category assignments");
      }
    });

    it("SAFELY RESOLVES conflict when an obligation item is also present in a focus", () => {
      // item-1 is an obligation, but also appears in focus contributingItemIds alongside item-2 (classic case-02 pattern)
      const proposalWithObligationInFocus: ProposedWeek = {
        ...validBaseProposal,
        foci: [
          {
            ...validBaseProposal.foci[0],
            contributingItemIds: ["item-1", "item-2"], // item-1 duplicated in focus!
            estimatedHours: 14, // 6h (item-1) + 8h (item-2)
          },
        ],
        obligations: [
          {
            itemId: "item-1",
            title: "Demo inversores",
            commitmentType: "external",
            dueDate: "2026-10-16",
            rationale: "Compromiso ineludible con clientes",
            estimatedHours: 6,
          },
        ],
      };

      const result = normalizeAndConserveProposedWeek(proposalWithObligationInFocus, sampleInput);
      expect(result.repaired).toBe(true);

      // 1. Obligation is preserved with its title, commitmentType, and dueDate
      expect(result.proposal.obligations).toHaveLength(1);
      expect(result.proposal.obligations[0].itemId).toBe("item-1");
      expect(result.proposal.obligations[0].dueDate).toBe("2026-10-16");

      // 2. Focus has obligation removed from contributingItemIds
      expect(result.proposal.foci).toHaveLength(1);
      expect(result.proposal.foci[0].contributingItemIds).toEqual(["item-2"]);
      expect(result.proposal.foci[0].estimatedHours).toBe(8); // Recomputed without item-1

      // 3. Category exclusivity holds: item-1 appears ONLY in obligations
      const allFocusItemIds = result.proposal.foci.flatMap((f) => f.contributingItemIds);
      expect(allFocusItemIds.includes("item-1")).toBe(false);

      // 4. Audit trail captures the resolution
      expect(
        result.repairs.some(
          (r) => r.type === "resolved_obligation_focus_conflict" && r.itemId === "item-1"
        )
      ).toBe(true);
    });

    it("removes empty focus when all its contributing items were assigned to obligations", () => {
      // Focus contains ONLY item-1, which is also an obligation
      const proposalWithSingleItemFocus: ProposedWeek = {
        ...validBaseProposal,
        foci: [
          {
            ...validBaseProposal.foci[0],
            contributingItemIds: ["item-1"], // Only item-1
            estimatedHours: 6,
          },
        ],
        obligations: [
          {
            itemId: "item-1",
            title: "Demo",
            commitmentType: "external",
            rationale: "r",
            estimatedHours: 6,
          },
        ],
      };

      const result = normalizeAndConserveProposedWeek(proposalWithSingleItemFocus, sampleInput);
      expect(result.repaired).toBe(true);

      // Focus was removed because it was left empty
      expect(result.proposal.foci).toHaveLength(0);

      // Obligation is preserved
      expect(result.proposal.obligations.some((o) => o.itemId === "item-1")).toBe(true);

      // Item-2 was omitted since focus was removed, so it gets rescued to not_scheduled
      expect(result.proposal.deferredItems.some((d) => d.itemId === "item-2" && d.reason === "not_scheduled")).toBe(true);

      expect(
        result.repairs.some(
          (r) => r.type === "resolved_obligation_focus_conflict" && r.description.includes("empty focus")
        )
      ).toBe(true);
    });

    it("SAFELY RESCUES omitted regular task to deferredItems as 'not_scheduled' with structured audit trail", () => {
      // item-2 (regular task) is omitted from proposal (e.g. foci is empty)
      const proposalOmittingTask: ProposedWeek = {
        ...validBaseProposal,
        foci: [], // item-2 missing
      };

      const result = normalizeAndConserveProposedWeek(proposalOmittingTask, sampleInput);
      expect(result.repaired).toBe(true);

      const deferredTask = result.proposal.deferredItems.find((d) => d.itemId === "item-2");
      expect(deferredTask).toBeDefined();
      expect(deferredTask?.reason).toBe("not_scheduled");
      expect(deferredTask?.rationale).toContain("no programado en la propuesta");

      // Structured repair recorded
      expect(
        result.repairs.some(
          (r) => r.type === "rescued_omitted_to_not_scheduled" && r.itemId === "item-2"
        )
      ).toBe(true);

      // Verify it is NOT assigned other unwarranted reasons
      expect(deferredTask?.reason).not.toBe("out_of_capacity");
      expect(deferredTask?.reason).not.toBe("low_attention");
      expect(deferredTask?.reason).not.toBe("intentional_postponement");
    });

    it("PRESERVES 'not_scheduled' under known capacity with sufficient plannable hours (never fabricates out_of_capacity or low_attention)", () => {
      const ampleCapacityInput: BuildWeekInput = {
        ...sampleInput,
        capacity: {
          totalAvailableHours: 40,
          minProtectedSpaceRatio: 0.25, // 30h plannable
        },
      };

      const proposalOmittingTask: ProposedWeek = {
        ...validBaseProposal,
        foci: [], // item-2 omitted; only item-1 (6h) planned in obligations
      };

      const result = normalizeAndConserveProposedWeek(proposalOmittingTask, ampleCapacityInput);
      const rescued = result.proposal.deferredItems.find((d) => d.itemId === "item-2");

      expect(rescued?.reason).toBe("not_scheduled");
      expect(rescued?.reason).not.toBe("out_of_capacity");
      expect(rescued?.reason).not.toBe("low_attention");
      expect(rescued?.reason).not.toBe("intentional_postponement");
    });

    it("PRESERVES 'not_scheduled' under known capacity with over-capacity condition (never conflates omission with out_of_capacity)", () => {
      const constrainedInput: BuildWeekInput = {
        ...sampleInput,
        items: sampleItems.map((it) =>
          it.id === "item-3"
            ? { ...it, type: "commitment", commitment: "external", estimatedEffort: { value: 4, unit: "hours", source: "user" } }
            : it
        ),
        capacity: {
          totalAvailableHours: 10,
          minProtectedSpaceRatio: 0.25, // 7.5h plannable
        },
      };

      // Obligations alone (item-1: 6h) + obligation 2 (4h) = 10h > 7.5h plannable
      const proposalOverCapacity: ProposedWeek = {
        ...validBaseProposal,
        foci: [], // item-2 omitted
        obligations: [
          ...validBaseProposal.obligations,
          {
            itemId: "item-3",
            title: "Cuerdas urgente",
            commitmentType: "external",
            rationale: "Compromiso externo",
            estimatedHours: 4,
          },
        ],
        flexibleOptions: [], // item-3 moved to obligations
      };

      const result = normalizeAndConserveProposedWeek(proposalOverCapacity, constrainedInput);
      const rescued = result.proposal.deferredItems.find((d) => d.itemId === "item-2");

      expect(result.proposal.weekSummary.capacity.capacityStatus).toBe("over_capacity");
      expect(rescued?.reason).toBe("not_scheduled");
      expect(rescued?.reason).not.toBe("out_of_capacity");
    });

    it("PRESERVES 'not_scheduled' under unknown capacity (totalAvailableHours: null)", () => {
      const inputWithoutCap: BuildWeekInput = {
        ...sampleInput,
        capacity: undefined,
      };

      const proposalOmittingTask: ProposedWeek = {
        ...validBaseProposal,
        foci: [], // item-2 omitted
      };

      const result = normalizeAndConserveProposedWeek(proposalOmittingTask, inputWithoutCap);
      const rescued = result.proposal.deferredItems.find((d) => d.itemId === "item-2");

      expect(result.proposal.weekSummary.capacity.capacityStatus).toBe("unknown");
      expect(rescued?.reason).toBe("not_scheduled");
      expect(rescued?.reason).not.toBe("out_of_capacity");
      expect(rescued?.reason).not.toBe("intentional_postponement");
    });

    it("PRESERVES 'not_scheduled' under partial estimates without fabricating intentional postponement", () => {
      const inputWithPartial: BuildWeekInput = {
        ...sampleInput,
        items: sampleInput.items.map((i) =>
          i.id === "item-2" ? { ...i, estimatedEffort: undefined } : i
        ),
      };

      const proposalOmittingTask: ProposedWeek = {
        ...validBaseProposal,
        foci: [], // item-2 omitted
      };

      const result = normalizeAndConserveProposedWeek(proposalOmittingTask, inputWithPartial);
      const rescued = result.proposal.deferredItems.find((d) => d.itemId === "item-2");

      expect(rescued?.reason).toBe("not_scheduled");
      expect(rescued?.reason).not.toBe("intentional_postponement");
      expect(rescued?.reason).not.toBe("out_of_capacity");
    });

    it("SAFELY RESCUES omitted archived and idea items with ground-truth reasons and structured audit", () => {
      // Proposal that omitted item-3 (idea) and item-4 (archived), but includes item-1 and item-2
      const proposalOmittingIdeaAndArchived: ProposedWeek = {
        ...validBaseProposal,
        flexibleOptions: [], // item-3 omitted
        deferredItems: [],   // item-4 omitted
      };

      const result = normalizeAndConserveProposedWeek(proposalOmittingIdeaAndArchived, sampleInput);
      expect(result.repaired).toBe(true);

      // item-4 rescued to deferredItems as "archived"
      expect(
        result.proposal.deferredItems.some((d) => d.itemId === "item-4" && d.reason === "archived")
      ).toBe(true);

      // item-3 rescued to flexibleOptions
      expect(
        result.proposal.flexibleOptions.some((o) => o.itemId === "item-3")
      ).toBe(true);

      // Audit trail must record both rescues
      expect(
        result.repairs.some((r) => r.type === "rescued_archived_to_deferred" && r.itemId === "item-4")
      ).toBe(true);
      expect(
        result.repairs.some((r) => r.type === "rescued_idea_to_flexible" && r.itemId === "item-3")
      ).toBe(true);
    });

    it("SAFELY DEDUPLICATES intra-category repeated IDs and records in audit trail", () => {
      // focus has duplicate item-2
      const proposalWithDuplicateInFocus: ProposedWeek = {
        ...validBaseProposal,
        foci: [
          {
            ...validBaseProposal.foci[0],
            contributingItemIds: ["item-2", "item-2"], // Repeated!
          },
        ],
      };

      const result = normalizeAndConserveProposedWeek(proposalWithDuplicateInFocus, sampleInput);
      expect(result.repaired).toBe(true);
      expect(result.proposal.foci[0].contributingItemIds).toEqual(["item-2"]);
      expect(
        result.repairs.some((r) => r.type === "deduplicated_intra_category" && r.itemId === "item-2")
      ).toBe(true);
    });

    it("RECALCULATES capacity summary when AI output contradicts mathematical truth", () => {
      // Proposal lying about capacity status (claims within_capacity when planned > plannable)
      const proposalWithLyingCapacity: ProposedWeek = {
        ...validBaseProposal,
        weekSummary: {
          ...validBaseProposal.weekSummary,
          capacity: {
            ...validBaseProposal.weekSummary.capacity,
            capacityStatus: "within_capacity",
            protectedSpaceStatus: "respected",
          },
        },
        foci: [
          {
            ...validBaseProposal.foci[0],
            estimatedHours: 15, // 15 + 6 = 21h > 18.75h plannable!
          },
        ],
      };

      const result = normalizeAndConserveProposedWeek(proposalWithLyingCapacity, sampleInput);
      expect(result.repaired).toBe(true);
      expect(result.proposal.weekSummary.capacity.capacityStatus).toBe("over_capacity");
      expect(result.proposal.weekSummary.capacity.protectedSpaceStatus).toBe("compromised");
      expect(
        result.repairs.some((r) => r.type === "recalculated_capacity_summary")
      ).toBe(true);
    });
  });

  // ==========================================================================
  // 7. Determinism: Same Input, Same Output
  // ==========================================================================
  describe("Determinism Guarantee", () => {
    it("produces identical planning context across multiple invocations", () => {
      const run1 = buildDeterministicPlanningContext(sampleInput);
      const run2 = buildDeterministicPlanningContext(sampleInput);
      const run3 = buildDeterministicPlanningContext(sampleInput);

      expect(run1).toEqual(run2);
      expect(run2).toEqual(run3);
    });

    it("produces identical capacity calculations across multiple invocations", () => {
      const params = {
        capacityConfig: { totalAvailableHours: 30, minProtectedSpaceRatio: 0.2 },
        foci: [{ estimatedHours: 12 }],
        obligations: [{ estimatedHours: 8 }],
      };

      const res1 = calculateWeeklyCapacity(params);
      const res2 = calculateWeeklyCapacity(params);

      expect(res1).toEqual(res2);
    });
  });

  // ==========================================================================
  // 8. Regression: False Obligations vs Genuine Commitments (Case-19 Audit)
  // ==========================================================================
  describe("Regression: False Obligations vs Genuine Commitments (Case-19 Audit)", () => {
    const inputWithUrgentTask: BuildWeekInput = {
      currentDate: "2026-10-09", // Friday
      targetWeek: {
        startDate: "2026-10-12",
        endDate: "2026-10-18",
      },
      items: [
        {
          id: "urgent-task",
          rawText: "subir el hotfix urgente del checkout que está tirando error 500",
          title: "Hotfix error 500 checkout",
          type: "task",
          importance: "high",
          status: "pending",
          // Notice: No external commitment, and overdue deadline (Friday 2026-10-09, outside target week)
        },
        {
          id: "deadline-task",
          rawText: "entregar reporte financiero el jueves",
          title: "Reporte financiero",
          type: "task",
          status: "pending",
          estimatedEffort: { value: 4, unit: "hours", source: "user" },
        },
        {
          id: "external-commitment",
          rawText: "reunión con cliente Acme el martes",
          title: "Reunión cliente Acme",
          type: "commitment",
          commitment: "external",
          status: "started",
          estimatedEffort: { value: 2, unit: "hours", source: "user" },
        },
        {
          id: "blocked-task",
          rawText: "urgente desplegar nueva API pero bloqueada por migracion de base de datos",
          title: "Desplegar nueva API",
          type: "task",
          importance: "high",
          status: "pending",
        },
        {
          id: "dependency-task",
          rawText: "migrar esquema de base de datos",
          title: "Migrar BD",
          type: "task",
          status: "pending",
        },
      ],
      relationships: [
        {
          sourceItemId: "blocked-task",
          targetItemId: "dependency-task",
          type: "depends_on",
          confidence: "high",
          reason: "El despliegue de la API depende de la migracion de la BD",
        },
      ],
      groupedWork: {
        groups: [],
        ungroupedItemIds: [
          "urgent-task",
          "deadline-task",
          "external-commitment",
          "blocked-task",
          "dependency-task",
        ],
      },
      deadlines: {
        deadlines: [
          {
            itemId: "urgent-task",
            raw: "para hoy",
            kind: "relative_date",
            resolvedStart: "2026-10-09", // Outside target week!
            resolvedEnd: null,
            confidence: "high",
          },
          {
            itemId: "deadline-task",
            raw: "el jueves",
            kind: "relative_date",
            resolvedStart: "2026-10-15", // Inside target week!
            resolvedEnd: null,
            confidence: "high",
          },
          {
            itemId: "external-commitment",
            raw: "el martes",
            kind: "relative_date",
            resolvedStart: "2026-10-13", // Inside target week!
            resolvedEnd: null,
            confidence: "high",
          },
        ],
      },
      context: {
        itemAssessments: [],
        groupAssessments: [],
        openQuestions: [],
      },
      capacity: {
        totalAvailableHours: 25,
        minProtectedSpaceRatio: 0.25,
      },
    };

    it("1. High importance and urgent wording without deadline or commitment is NEVER an obligation (reclassified & flagged)", () => {
      // Proposal mistakenly placing urgent-task as a strict_deadline obligation
      const badProposal: ProposedWeek = {
        weekSummary: {
          targetWeek: { startDate: "2026-10-12", endDate: "2026-10-18" },
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
        foci: [],
        obligations: [
          {
            itemId: "urgent-task",
            title: "Hotfix error 500 checkout",
            commitmentType: "strict_deadline",
            rationale: "Es urgente y crítico",
            estimatedHours: null,
          },
          {
            itemId: "deadline-task",
            title: "Reporte financiero",
            commitmentType: "strict_deadline",
            dueDate: "2026-10-15",
            rationale: "Fecha límite estricta en la semana",
            estimatedHours: 4,
          },
          {
            itemId: "external-commitment",
            title: "Reunión cliente Acme",
            commitmentType: "external",
            dueDate: "2026-10-13",
            rationale: "Compromiso externo con terceros",
            estimatedHours: 2,
          },
        ],
        flexibleOptions: [],
        deferredItems: [
          {
            itemId: "blocked-task",
            title: "Desplegar nueva API",
            reason: "waiting_dependency",
            rationale: "Bloqueada",
          },
          {
            itemId: "dependency-task",
            title: "Migrar BD",
            reason: "not_scheduled",
            rationale: "Sin programar",
          },
        ],
        unplannedSpace: { rationale: "Espacio protegido", recommendedHours: 6.25 },
        confirmationPrompt: { question: "¿Avanzamos?", keyTradeoffs: [], pendingQuestions: [] },
      };

      // Direct semantic evaluation fails if urgent-task is in obligations
      const semanticResult = evaluateProposedWeekSemanticQuality(badProposal, inputWithUrgentTask);
      expect(semanticResult.valid).toBe(false);
      expect(
        semanticResult.errors.some(
          (e) =>
            e.includes("urgent-task") &&
            e.includes("converted into an obligation without external commitment or strict deadline")
        )
      ).toBe(true);

      // Normalizer safely reclassifies false obligation to deferredItems as not_scheduled with audit record
      const normResult = normalizeAndConserveProposedWeek(badProposal, inputWithUrgentTask);
      expect(normResult.repaired).toBe(true);
      expect(normResult.proposal.obligations.some((o) => o.itemId === "urgent-task")).toBe(false);
      expect(
        normResult.proposal.deferredItems.some(
          (d) => d.itemId === "urgent-task" && d.reason === "not_scheduled"
        )
      ).toBe(true);
      expect(
        normResult.repairs.some(
          (r) => r.type === "reclassified_false_obligation" && r.itemId === "urgent-task"
        )
      ).toBe(true);

      // After normalization, semantic evaluation passes cleanly
      const normalizedSemantic = evaluateProposedWeekSemanticQuality(
        normResult.proposal,
        inputWithUrgentTask
      );
      expect(normalizedSemantic.valid).toBe(true);
    });

    it("2. Explicit deadline within the target week is preserved as a strict_deadline obligation", () => {
      const goodProposal: ProposedWeek = {
        weekSummary: {
          targetWeek: { startDate: "2026-10-12", endDate: "2026-10-18" },
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
            itemId: "deadline-task",
            title: "Reporte financiero",
            commitmentType: "strict_deadline",
            dueDate: "2026-10-15",
            rationale: "Fecha límite ineludible jueves de la semana",
            estimatedHours: 4,
          },
          {
            itemId: "external-commitment",
            title: "Reunión cliente Acme",
            commitmentType: "external",
            dueDate: "2026-10-13",
            rationale: "Compromiso con cliente",
            estimatedHours: 2,
          },
        ],
        flexibleOptions: [],
        deferredItems: [
          {
            itemId: "urgent-task",
            title: "Hotfix error 500 checkout",
            reason: "not_scheduled",
            rationale: "Sin fecha en la semana ni compromiso externo; pendiente de decisión",
          },
          {
            itemId: "blocked-task",
            title: "Desplegar nueva API",
            reason: "waiting_dependency",
            rationale: "Bloqueada por migración de BD",
          },
          {
            itemId: "dependency-task",
            title: "Migrar BD",
            reason: "not_scheduled",
            rationale: "Sin programar",
          },
        ],
        unplannedSpace: { rationale: "Espacio protegido", recommendedHours: 6.25 },
        confirmationPrompt: {
          question: "¿Avanzamos?",
          keyTradeoffs: ["Hotfix checkout no programado."],
          pendingQuestions: [],
        },
      };

      const semantic = evaluateProposedWeekSemanticQuality(goodProposal, inputWithUrgentTask);
      expect(semantic.valid).toBe(true);
      expect(semantic.checks.explicitCommitmentsPreserved).toBe(true);
      expect(semantic.checks.deadlinesPreservedWithoutShifting).toBe(true);
    });

    it("3. Genuine external commitment is preserved and cannot be unilaterally omitted", () => {
      // Proposal omitting external-commitment from obligations
      const proposalOmittingExternal: ProposedWeek = {
        weekSummary: {
          targetWeek: { startDate: "2026-10-12", endDate: "2026-10-18" },
          capacity: {
            totalAvailableHours: 25,
            plannableHours: 18.75,
            plannedHours: null,
            knownEstimatedHours: 4,
            estimationCompleteness: "partial",
            protectedSpaceHours: 6.25,
            capacityStatus: "unknown",
            protectedSpaceStatus: "unknown",
          },
        },
        foci: [],
        obligations: [
          {
            itemId: "deadline-task",
            title: "Reporte financiero",
            commitmentType: "strict_deadline",
            dueDate: "2026-10-15",
            rationale: "Fecha límite",
            estimatedHours: 4,
          },
        ],
        flexibleOptions: [],
        deferredItems: [
          {
            itemId: "external-commitment", // Mistakenly deferred!
            title: "Reunión cliente Acme",
            reason: "not_scheduled",
            rationale: "Omitido por capacidad",
          },
          { itemId: "urgent-task", title: "Hotfix", reason: "not_scheduled", rationale: "No planificado" },
          { itemId: "blocked-task", title: "API", reason: "waiting_dependency", rationale: "Bloqueada" },
          { itemId: "dependency-task", title: "BD", reason: "not_scheduled", rationale: "No planificado" },
        ],
        unplannedSpace: { rationale: "Protegido", recommendedHours: 6.25 },
        confirmationPrompt: { question: "¿Avanzamos?", keyTradeoffs: [], pendingQuestions: [] },
      };

      const semantic = evaluateProposedWeekSemanticQuality(proposalOmittingExternal, inputWithUrgentTask);
      expect(semantic.valid).toBe(false);
      expect(
        semantic.errors.some(
          (e) =>
            e.includes("external-commitment") &&
            e.includes("External commitments must remain visible as obligations")
        )
      ).toBe(true);
    });

    it("4. Important task exceeding proposal or not scheduled can structure a focus or be deferred, but NEVER forced into flexibleOptions", () => {
      // Degrading high-importance task to flexibleOptions is illegal
      const proposalWithFlexibleHighImp: ProposedWeek = {
        weekSummary: {
          targetWeek: { startDate: "2026-10-12", endDate: "2026-10-18" },
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
        foci: [],
        obligations: [
          {
            itemId: "deadline-task",
            title: "Reporte financiero",
            commitmentType: "strict_deadline",
            dueDate: "2026-10-15",
            rationale: "Fecha límite",
            estimatedHours: 4,
          },
          {
            itemId: "external-commitment",
            title: "Reunión cliente Acme",
            commitmentType: "external",
            dueDate: "2026-10-13",
            rationale: "Cliente",
            estimatedHours: 2,
          },
        ],
        flexibleOptions: [
          {
            itemId: "urgent-task", // ILLEGAL: high importance task degraded to flexibleOption!
            title: "Hotfix error 500 checkout",
            condition: "Si da tiempo",
            estimatedHours: null,
          },
        ],
        deferredItems: [
          { itemId: "blocked-task", title: "API", reason: "waiting_dependency", rationale: "Bloqueada" },
          { itemId: "dependency-task", title: "BD", reason: "not_scheduled", rationale: "No planificado" },
        ],
        unplannedSpace: { rationale: "Protegido", recommendedHours: 6.25 },
        confirmationPrompt: { question: "¿Avanzamos?", keyTradeoffs: [], pendingQuestions: [] },
      };

      const semantic = evaluateProposedWeekSemanticQuality(proposalWithFlexibleHighImp, inputWithUrgentTask);
      expect(semantic.valid).toBe(false);
      expect(
        semantic.errors.some(
          (e) =>
            e.includes("urgent-task") &&
            e.includes("cannot be classified as a flexible option")
        )
      ).toBe(true);

      // Structuring it as a focus is valid
      const proposalWithFocusHighImp: ProposedWeek = {
        ...proposalWithFlexibleHighImp,
        foci: [
          {
            id: "focus-hotfix",
            title: "Estabilidad del Checkout",
            desiredOutcome: "Resolver error 500 en producción",
            rationale: "Foco técnico prioritario",
            contributingItemIds: ["urgent-task"],
            estimatedHours: null,
          },
        ],
        flexibleOptions: [],
      };

      const semanticFocus = evaluateProposedWeekSemanticQuality(proposalWithFocusHighImp, inputWithUrgentTask);
      expect(semanticFocus.valid).toBe(true);
    });

    it("5. Urgent task blocked by a dependency does NOT become a contractual obligation", () => {
      // Proposal attempting to turn blocked-task into an obligation because of its urgency
      const proposalWithBlockedAsObligation: ProposedWeek = {
        weekSummary: {
          targetWeek: { startDate: "2026-10-12", endDate: "2026-10-18" },
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
        foci: [],
        obligations: [
          {
            itemId: "blocked-task", // ILLEGAL: blocked, no external commitment, no in-week deadline!
            title: "Desplegar nueva API",
            commitmentType: "strict_deadline",
            rationale: "Muy urgente para el equipo",
            estimatedHours: null,
          },
          {
            itemId: "deadline-task",
            title: "Reporte financiero",
            commitmentType: "strict_deadline",
            dueDate: "2026-10-15",
            rationale: "Fecha límite",
            estimatedHours: 4,
          },
          {
            itemId: "external-commitment",
            title: "Reunión cliente Acme",
            commitmentType: "external",
            dueDate: "2026-10-13",
            rationale: "Cliente",
            estimatedHours: 2,
          },
        ],
        flexibleOptions: [],
        deferredItems: [
          { itemId: "urgent-task", title: "Hotfix", reason: "not_scheduled", rationale: "No planificado" },
          { itemId: "dependency-task", title: "BD", reason: "not_scheduled", rationale: "No planificado" },
        ],
        unplannedSpace: { rationale: "Protegido", recommendedHours: 6.25 },
        confirmationPrompt: { question: "¿Avanzamos?", keyTradeoffs: [], pendingQuestions: [] },
      };

      // Semantic evaluator rejects it
      const semantic = evaluateProposedWeekSemanticQuality(
        proposalWithBlockedAsObligation,
        inputWithUrgentTask
      );
      expect(semantic.valid).toBe(false);
      expect(
        semantic.errors.some(
          (e) =>
            e.includes("blocked-task") &&
            e.includes("converted into an obligation without external commitment or strict deadline")
        )
      ).toBe(true);

      // Normalizer rescues and preserves blocked item in deferredItems
      const normResult = normalizeAndConserveProposedWeek(
        proposalWithBlockedAsObligation,
        inputWithUrgentTask
      );
      expect(normResult.repaired).toBe(true);
      expect(normResult.proposal.obligations.some((o) => o.itemId === "blocked-task")).toBe(false);
      expect(
        normResult.proposal.deferredItems.some((d) => d.itemId === "blocked-task")
      ).toBe(true);
    });

    it("preserves external commitments with due dates prior to target week without silent omission and maintains discrepancy visible for user reconciliation (case-08 regression)", () => {
      // Setup: evaluation anchor is Friday 2026-10-09, target week starts Monday 2026-10-12.
      // External commitment is anchored to 2026-10-09 (prior to target week).
      const priorDateInput: BuildWeekInput = {
        currentDate: "2026-10-09",
        targetWeek: {
          startDate: "2026-10-12",
          endDate: "2026-10-18",
        },
        userIntent: "Compromiso externo con fecha anterior a la semana objetivo",
        items: [
          {
            id: "meeting-prior",
            rawText: "Reunión con equipo de diseño por Figma el viernes a las 11",
            title: "Reunión equipo diseño",
            type: "commitment",
            commitment: "external",
            status: "pending",
          },
          {
            id: "doc-task",
            rawText: "Cerrar documentación de la API",
            title: "Cerrar doc API",
            type: "task",
            status: "pending",
          },
        ],
        relationships: [],
        groupedWork: {
          groups: [],
          ungroupedItemIds: ["meeting-prior", "doc-task"],
        },
        deadlines: {
          deadlines: [
            {
              itemId: "meeting-prior",
              raw: "el viernes a las 11",
              kind: "relative_date",
              resolvedStart: "2026-10-09",
              resolvedEnd: null,
              confidence: "high",
            },
          ],
        },
        context: {
          itemAssessments: [
            {
              itemId: "meeting-prior",
              attention: "high",
              signals: ["external_commitment", "approaching_deadline"],
              rationale: "Compromiso externo previo a la semana",
            },
            {
              itemId: "doc-task",
              attention: "medium",
              signals: [],
              rationale: "Tarea interna sin fecha estricta",
            },
          ],
          groupAssessments: [],
          openQuestions: [],
        },
        capacity: {
          totalAvailableHours: 25,
          minProtectedSpaceRatio: 0.25,
        },
      };

      // Invariant check on constraints preparation:
      // Constraints MUST register meeting-prior in externalCommitments so it is not dropped
      const constraints = prepareWeekConstraints(priorDateInput, priorDateInput.targetWeek!);
      expect(constraints.externalCommitments.some((ec) => ec.itemId === "meeting-prior")).toBe(true);

      // Proposal from model: includes the external commitment, retains its real prior date,
      // and explicitly questions the temporal discrepancy in confirmationPrompt
      const proposalWithPriorCommitment: ProposedWeek = {
        weekSummary: {
          targetWeek: priorDateInput.targetWeek!,
          intent: priorDateInput.userIntent!,
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
            itemId: "meeting-prior",
            title: "Reunión equipo diseño",
            dueDate: "2026-10-09",
            commitmentType: "external",
            rationale: "Compromiso externo con fecha anterior al inicio de la semana objetivo.",
            estimatedHours: null,
          },
        ],
        flexibleOptions: [],
        deferredItems: [
          {
            itemId: "doc-task",
            title: "Cerrar doc API",
            reason: "not_scheduled",
            rationale: "Conservado sin programar.",
          },
        ],
        unplannedSpace: {
          rationale: "Espacio protegido preservado.",
          recommendedHours: 6.25,
        },
        confirmationPrompt: {
          question: "¿Deseas mantener la reunión previa en el plan o ya fue realizada?",
          keyTradeoffs: [
            "La reunión tiene fecha 2026-10-09 previa al inicio de la semana (2026-10-12).",
          ],
          pendingQuestions: [
            "¿La fecha de la reunión es correcta o corresponde a la semana objetivo?",
          ],
        },
      };

      // 1. Semantic evaluation passes without rejection
      const semanticQuality = evaluateProposedWeekSemanticQuality(
        proposalWithPriorCommitment,
        priorDateInput
      );
      expect(semanticQuality.valid).toBe(true);
      expect(semanticQuality.checks.explicitCommitmentsPreserved).toBe(true);

      // 2. Normalizer preserves the item 1:1 without discarding or mutating it into a phantom
      const normResult = normalizeAndConserveProposedWeek(
        proposalWithPriorCommitment,
        priorDateInput
      );
      expect(normResult.repaired).toBe(false);
      expect(normResult.proposal.obligations).toHaveLength(1);
      expect(normResult.proposal.obligations[0].itemId).toBe("meeting-prior");
      expect(normResult.proposal.obligations[0].dueDate).toBe("2026-10-09");
      expect(normResult.proposal.deferredItems).toHaveLength(1);
      expect(normResult.proposal.deferredItems[0].itemId).toBe("doc-task");

      // 3. Trade-offs and pendingQuestions remain visible for human reconciliation
      expect(normResult.proposal.confirmationPrompt.keyTradeoffs.length).toBeGreaterThan(0);
      expect(normResult.proposal.confirmationPrompt.pendingQuestions?.length).toBeGreaterThan(0);
    });
  });
});

