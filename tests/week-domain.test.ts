import { describe, it, expect } from "vitest";
import {
  isValidCalendarDate,
  resolveDefaultTargetWeek,
  CalendarDateSchema,
  TargetWeekSchema,
  DayConstraintSchema,
  WeeklyCapacityConfigSchema,
  BuildWeekInputSchema,
  ProposedWeekSchema,
  WeeklyFocusSchema,
  WeeklyObligationSchema,
  WeeklyFlexibleOptionSchema,
  DeferredItemSchema,
  UnplannedSpaceSchema,
  ConfirmationPromptSchema,
  validateProposedWeekInvariants,
  createEmptyProposedWeek,
  BuildWeekInput,
  ProposedWeek,
} from "../src/domain/week";

describe("Domain Schema & Invariants: Skill 06 build_week", () => {
  const validBaseDate = "2026-10-09";
  const validTargetWeek = {
    startDate: "2026-10-12",
    endDate: "2026-10-18",
  };

  const sampleItems = [
    {
      id: "item-1",
      rawText: "Preparar demo para inversores el viernes",
      title: "Preparar demo para inversores",
      type: "commitment" as const,
      commitment: "external" as const,
      status: "started" as const,
    },
    {
      id: "item-2",
      rawText: "Terminar refactor de providers de IA",
      title: "Refactor providers",
      type: "task" as const,
      status: "started" as const,
    },
    {
      id: "item-3",
      rawText: "Cambiar cuerdas de guitarra si tengo un rato",
      title: "Cambiar cuerdas",
      type: "idea" as const,
      status: "exploring" as const,
    },
    {
      id: "item-4",
      rawText: "Integración con Discord archivada conscientemente",
      title: "Discord bot",
      type: "idea" as const,
      status: "archived" as const,
    },
  ];

  const sampleInput: BuildWeekInput = {
    currentDate: validBaseDate,
    targetWeek: validTargetWeek,
    userIntent: "Cerrar lo empezado sin abrir frentes",
    items: sampleItems,
    relationships: [
      {
        sourceItemId: "item-1",
        targetItemId: "item-2",
        type: "depends_on",
        confidence: "high",
        reason: "La demo depende del refactor",
      },
    ],
    groupedWork: {
      groups: [
        {
          id: "group-1",
          title: "Lanzamiento y Demo",
          itemIds: ["item-1", "item-2"],
          rationale: "Línea clave de inversores",
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
      ],
    },
    context: {
      itemAssessments: [
        {
          itemId: "item-1",
          attention: "high",
          signals: ["external_commitment", "approaching_deadline"],
          rationale: "Compromiso externo con inversores",
        },
        {
          itemId: "item-2",
          attention: "medium",
          signals: ["already_started", "dependency"],
          rationale: "Refactor en curso que desbloquea la demo",
        },
        {
          itemId: "item-3",
          attention: "low",
          signals: [],
          rationale: "Idea opcional",
        },
        {
          itemId: "item-4",
          attention: "low",
          signals: [],
          rationale: "Archivada conscientemente",
        },
      ],
      groupAssessments: [
        {
          groupId: "group-1",
          relevance: "high",
          rationale: "Línea estructurante con compromiso externo",
        },
      ],
      openQuestions: [],
    },
    capacity: {
      totalAvailableHours: 25,
      minProtectedSpaceRatio: 0.25,
      daysWithConstraints: [
        { day: "martes", availableHours: 3, note: "Clase presencial" },
      ],
    },
  };

  // ==========================================================================
  // 1. Date and Calendar Validation Tests
  // ==========================================================================
  describe("Calendar date validation", () => {
    it("accepts real calendar dates", () => {
      expect(isValidCalendarDate("2026-10-09")).toBe(true);
      expect(isValidCalendarDate("2024-02-29")).toBe(true); // Leap year
      expect(CalendarDateSchema.parse("2026-10-09")).toBe("2026-10-09");
    });

    it("rejects non-existent calendar dates", () => {
      expect(isValidCalendarDate("2026-02-29")).toBe(false); // 2026 is not leap
      expect(isValidCalendarDate("2026-02-30")).toBe(false);
      expect(isValidCalendarDate("2026-13-01")).toBe(false);
      expect(isValidCalendarDate("2026-00-10")).toBe(false);
      expect(isValidCalendarDate("invalid")).toBe(false);

      expect(() => CalendarDateSchema.parse("2026-02-30")).toThrow();
    });

    it("validates TargetWeekSchema ordering (startDate <= endDate)", () => {
      const valid = { startDate: "2026-10-12", endDate: "2026-10-18" };
      expect(TargetWeekSchema.parse(valid)).toEqual(valid);

      const sameDay = { startDate: "2026-10-12", endDate: "2026-10-12" };
      expect(TargetWeekSchema.parse(sameDay)).toEqual(sameDay);

      const inverted = { startDate: "2026-10-19", endDate: "2026-10-12" };
      expect(() => TargetWeekSchema.parse(inverted)).toThrow();
    });

    describe("resolveDefaultTargetWeek", () => {
      it("resolves from Friday to next natural Monday-Sunday week", () => {
        // 2026-10-09 is Friday -> next Monday is 2026-10-12, Sunday is 2026-10-18
        const week = resolveDefaultTargetWeek("2026-10-09");
        expect(week).toEqual({
          startDate: "2026-10-12",
          endDate: "2026-10-18",
        });
      });

      it("resolves from Sunday to next natural Monday-Sunday week", () => {
        // 2026-10-11 is Sunday -> next Monday is 2026-10-12, Sunday is 2026-10-18
        const week = resolveDefaultTargetWeek("2026-10-11");
        expect(week).toEqual({
          startDate: "2026-10-12",
          endDate: "2026-10-18",
        });
      });

      it("resolves from Monday to following natural Monday-Sunday week", () => {
        // 2026-10-12 is Monday -> next Monday is 2026-10-19, Sunday is 2026-10-25
        const week = resolveDefaultTargetWeek("2026-10-12");
        expect(week).toEqual({
          startDate: "2026-10-19",
          endDate: "2026-10-25",
        });
      });

      it("handles month transition accurately", () => {
        // 2026-10-29 is Thursday -> next Monday is 2026-11-02, Sunday is 2026-11-08
        const week = resolveDefaultTargetWeek("2026-10-29");
        expect(week).toEqual({
          startDate: "2026-11-02",
          endDate: "2026-11-08",
        });
      });

      it("handles year transition accurately (December into January)", () => {
        // 2026-12-25 is Friday -> next Monday is 2026-12-28, Sunday is 2027-01-03
        const week1 = resolveDefaultTargetWeek("2026-12-25");
        expect(week1).toEqual({
          startDate: "2026-12-28",
          endDate: "2027-01-03",
        });

        // 2026-12-30 is Wednesday -> next Monday is 2027-01-04, Sunday is 2027-01-10
        const week2 = resolveDefaultTargetWeek("2026-12-30");
        expect(week2).toEqual({
          startDate: "2027-01-04",
          endDate: "2027-01-10",
        });
      });

      it("throws for invalid currentDate string", () => {
        expect(() => resolveDefaultTargetWeek("invalid-date")).toThrow();
        expect(() => resolveDefaultTargetWeek("2026-02-30")).toThrow();
      });
    });
  });

  // ==========================================================================
  // 2. Capacity Config Schema Tests
  // ==========================================================================
  describe("WeeklyCapacityConfig schema", () => {
    it("accepts valid capacity configuration", () => {
      const valid = {
        totalAvailableHours: 30,
        minProtectedSpaceRatio: 0.3,
        daysWithConstraints: [{ day: "jueves", availableHours: 2, note: "Médico" }],
      };
      expect(WeeklyCapacityConfigSchema.parse(valid)).toEqual(valid);
    });

    it("rejects negative, non-finite or out-of-range numbers", () => {
      expect(() =>
        WeeklyCapacityConfigSchema.parse({ totalAvailableHours: -5 })
      ).toThrow();

      expect(() =>
        WeeklyCapacityConfigSchema.parse({ minProtectedSpaceRatio: 1.5 })
      ).toThrow();

      expect(() =>
        WeeklyCapacityConfigSchema.parse({ minProtectedSpaceRatio: -0.1 })
      ).toThrow();

      expect(() =>
        DayConstraintSchema.parse({ day: "lunes", availableHours: -1 })
      ).toThrow();
    });
  });

  // ==========================================================================
  // 3. ProposedWeek Structural Schema Tests
  // ==========================================================================
  describe("ProposedWeek schema", () => {
    const validProposal: ProposedWeek = {
      weekSummary: {
        targetWeek: validTargetWeek,
        intent: "Cerrar lo empezado",
        capacity: {
          totalAvailableHours: 25,
          plannableHours: 18.75, // 25 * 0.75
          plannedHours: 14,
          knownEstimatedHours: 14,
          estimationCompleteness: "complete",
          protectedSpaceHours: 6.25, // 25 * 0.25
          capacityStatus: "within_capacity",
          protectedSpaceStatus: "respected",
        },
      },
      foci: [
        {
          id: "focus-1",
          title: "Lanzamiento y Demo",
          groupId: "group-1",
          desiredOutcome: "Tener la demo validada y el refactor listo",
          rationale: "Es la línea estructurante de la semana",
          contributingItemIds: ["item-2"],
          estimatedHours: 8,
        },
      ],
      obligations: [
        {
          itemId: "item-1",
          title: "Preparar demo para inversores",
          dueDate: "2026-10-16",
          commitmentType: "external",
          rationale: "Compromiso asumido con inversores",
          estimatedHours: 6,
        },
      ],
      flexibleOptions: [
        {
          itemId: "item-3",
          title: "Cambiar cuerdas de guitarra",
          condition: "Si queda tiempo el fin de semana",
          estimatedHours: 1,
        },
      ],
      deferredItems: [
        {
          itemId: "item-4",
          title: "Discord bot",
          reason: "archived",
          rationale: "Archivada conscientemente por el usuario",
        },
      ],
      unplannedSpace: {
        rationale: "6.25 horas protegidas para imprevistos y descanso",
        recommendedHours: 6.25,
      },
      confirmationPrompt: {
        question: "¿Te representa esta propuesta para tu semana?",
        keyTradeoffs: ["La integración con Discord queda archivada sin tocar"],
        pendingQuestions: [],
      },
    };

    it("parses valid ProposedWeek successfully", () => {
      expect(ProposedWeekSchema.parse(validProposal)).toEqual(validProposal);
      expect(BuildWeekInputSchema.parse(sampleInput)).toEqual(sampleInput);
      expect(WeeklyFocusSchema.parse(validProposal.foci[0])).toEqual(validProposal.foci[0]);
      expect(WeeklyObligationSchema.parse(validProposal.obligations[0])).toEqual(validProposal.obligations[0]);
      expect(WeeklyFlexibleOptionSchema.parse(validProposal.flexibleOptions[0])).toEqual(validProposal.flexibleOptions[0]);
      expect(UnplannedSpaceSchema.parse(validProposal.unplannedSpace)).toEqual(validProposal.unplannedSpace);
      expect(ConfirmationPromptSchema.parse(validProposal.confirmationPrompt)).toEqual(validProposal.confirmationPrompt);
    });

    it("enforces maximum 3 foci constraint in schema", () => {
      const tooManyFoci = {
        ...validProposal,
        foci: [
          validProposal.foci[0],
          { ...validProposal.foci[0], id: "focus-2" },
          { ...validProposal.foci[0], id: "focus-3" },
          { ...validProposal.foci[0], id: "focus-4" },
        ],
      };
      expect(() => ProposedWeekSchema.parse(tooManyFoci)).toThrow();
    });

    it("enforces maximum 2 pending questions in confirmation prompt", () => {
      const tooManyQuestions = {
        ...validProposal,
        confirmationPrompt: {
          question: "¿Aceptas?",
          keyTradeoffs: [],
          pendingQuestions: ["Pregunta 1?", "Pregunta 2?", "Pregunta 3?"],
        },
      };
      expect(() => ProposedWeekSchema.parse(tooManyQuestions)).toThrow();
    });

    it("rejects invalid enum values for deferredReason and capacityStatus", () => {
      expect(() =>
        DeferredItemSchema.parse({
          itemId: "i1",
          title: "Title",
          reason: "not_a_valid_reason",
          rationale: "Rationale",
        })
      ).toThrow();

      expect(() =>
        ProposedWeekSchema.parse({
          ...validProposal,
          weekSummary: {
            ...validProposal.weekSummary,
            capacity: {
              ...validProposal.weekSummary.capacity,
              capacityStatus: "invalid_status",
            },
          },
        })
      ).toThrow();
    });
  });

  // ==========================================================================
  // 4. Invariant Cross-Validation Engine Tests
  // ==========================================================================
  describe("Invariant Cross-Validation (validateProposedWeekInvariants)", () => {
    it("Scenario A: valid proposal passes with 100% item conservation", () => {
      const proposal: ProposedWeek = {
        weekSummary: {
          targetWeek: validTargetWeek,
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
            desiredOutcome: "Tener la demo validada",
            rationale: "Línea clave",
            contributingItemIds: ["item-2"],
            estimatedHours: 8,
          },
        ],
        obligations: [
          {
            itemId: "item-1",
            title: "Preparar demo para inversores",
            commitmentType: "external",
            rationale: "Compromiso externo",
            estimatedHours: 6,
          },
        ],
        flexibleOptions: [
          {
            itemId: "item-3",
            title: "Cambiar cuerdas",
            condition: "Si hay tiempo",
            estimatedHours: 1,
          },
        ],
        deferredItems: [
          {
            itemId: "item-4",
            title: "Discord bot",
            reason: "archived",
            rationale: "Archivado conscientemente",
          },
        ],
        unplannedSpace: {
          rationale: "Espacio protegido",
          recommendedHours: 6.25,
        },
        confirmationPrompt: {
          question: "¿Tiene sentido?",
          keyTradeoffs: [],
          pendingQuestions: [],
        },
      };

      const result = validateProposedWeekInvariants(proposal, sampleInput);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("Scenario B: detects lost item (not assigned to any category)", () => {
      const proposalWithoutItem3: ProposedWeek = {
        weekSummary: {
          targetWeek: validTargetWeek,
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
        foci: [
          {
            id: "focus-1",
            title: "Demo",
            desiredOutcome: "Done",
            rationale: "Important",
            contributingItemIds: ["item-2"],
            estimatedHours: null,
          },
        ],
        obligations: [
          {
            itemId: "item-1",
            title: "Demo",
            commitmentType: "external",
            rationale: "Client",
            estimatedHours: null,
          },
        ],
        flexibleOptions: [], // item-3 is missing!
        deferredItems: [
          {
            itemId: "item-4",
            title: "Discord",
            reason: "archived",
            rationale: "Archived",
          },
        ],
        unplannedSpace: { rationale: "Protected", recommendedHours: null },
        confirmationPrompt: { question: "Ok?", keyTradeoffs: [], pendingQuestions: [] },
      };

      const inputWithoutCap = { ...sampleInput, capacity: undefined };
      const result = validateProposedWeekInvariants(proposalWithoutItem3, inputWithoutCap);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("item-3"))).toBe(true);
    });

    it("Scenario C: detects phantom item in proposal not present in input", () => {
      const proposalWithPhantom: ProposedWeek = {
        weekSummary: {
          targetWeek: validTargetWeek,
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
          { itemId: "item-1", title: "1", commitmentType: "external", rationale: "r", estimatedHours: null },
        ],
        flexibleOptions: [
          { itemId: "item-2", title: "2", estimatedHours: null },
          { itemId: "item-3", title: "3", estimatedHours: null },
          { itemId: "phantom-999", title: "Phantom task", estimatedHours: null }, // Phantom!
        ],
        deferredItems: [
          { itemId: "item-4", title: "4", reason: "archived", rationale: "r" },
        ],
        unplannedSpace: { rationale: "p", recommendedHours: null },
        confirmationPrompt: { question: "q", keyTradeoffs: [], pendingQuestions: [] },
      };

      const inputWithoutCap = { ...sampleInput, capacity: undefined };
      const result = validateProposedWeekInvariants(proposalWithPhantom, inputWithoutCap);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("Phantom itemId \"phantom-999\""))).toBe(true);
    });

    it("Scenario D: detects item assigned to multiple categories", () => {
      const proposalWithDuplicate: ProposedWeek = {
        weekSummary: {
          targetWeek: validTargetWeek,
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
        foci: [
          {
            id: "focus-1",
            title: "F",
            desiredOutcome: "O",
            rationale: "R",
            contributingItemIds: ["item-2"],
            estimatedHours: null,
          },
        ],
        obligations: [
          { itemId: "item-1", title: "1", commitmentType: "external", rationale: "r", estimatedHours: null },
        ],
        flexibleOptions: [
          { itemId: "item-3", title: "3", estimatedHours: null },
          { itemId: "item-2", title: "2", estimatedHours: null }, // item-2 is already in focus-1!
        ],
        deferredItems: [
          { itemId: "item-4", title: "4", reason: "archived", rationale: "r" },
        ],
        unplannedSpace: { rationale: "p", recommendedHours: null },
        confirmationPrompt: { question: "q", keyTradeoffs: [], pendingQuestions: [] },
      };

      const inputWithoutCap = { ...sampleInput, capacity: undefined };
      const result = validateProposedWeekInvariants(proposalWithDuplicate, inputWithoutCap);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("Item \"item-2\" is assigned to multiple categories"))).toBe(true);
    });

    it("Scenario E: detects nonexistent groupId reference in focus", () => {
      const proposalWithBadGroup: ProposedWeek = {
        weekSummary: {
          targetWeek: validTargetWeek,
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
        foci: [
          {
            id: "focus-1",
            title: "F",
            groupId: "nonexistent-group-99", // Invalid groupId!
            desiredOutcome: "O",
            rationale: "R",
            contributingItemIds: ["item-1", "item-2", "item-3", "item-4"],
            estimatedHours: null,
          },
        ],
        obligations: [],
        flexibleOptions: [],
        deferredItems: [],
        unplannedSpace: { rationale: "p", recommendedHours: null },
        confirmationPrompt: { question: "q", keyTradeoffs: [], pendingQuestions: [] },
      };

      const inputWithoutCap = { ...sampleInput, capacity: undefined };
      const result = validateProposedWeekInvariants(proposalWithBadGroup, inputWithoutCap);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("nonexistent groupId"))).toBe(true);
    });

    it("Scenario F: detects capacityStatus 'within_capacity' when plannedHours > plannableHours", () => {
      const proposalOverCapacityLie: ProposedWeek = {
        weekSummary: {
          targetWeek: validTargetWeek,
          capacity: {
            totalAvailableHours: 20,
            plannableHours: 15,
            plannedHours: 19, // 19 > 15!
            knownEstimatedHours: 19,
            estimationCompleteness: "complete",
            protectedSpaceHours: 5,
            capacityStatus: "within_capacity", // Contradiction!
            protectedSpaceStatus: "respected",  // Contradiction!
          },
        },
        foci: [
          { id: "f1", title: "F", desiredOutcome: "O", rationale: "R", contributingItemIds: ["item-2"], estimatedHours: 10 },
        ],
        obligations: [
          { itemId: "item-1", title: "1", commitmentType: "external", rationale: "r", estimatedHours: 9 },
        ],
        flexibleOptions: [{ itemId: "item-3", title: "3", estimatedHours: null }],
        deferredItems: [{ itemId: "item-4", title: "4", reason: "archived", rationale: "r" }],
        unplannedSpace: { rationale: "p", recommendedHours: 5 },
        confirmationPrompt: { question: "q", keyTradeoffs: [], pendingQuestions: [] },
      };

      const inputWith20h = {
        ...sampleInput,
        capacity: { totalAvailableHours: 20, minProtectedSpaceRatio: 0.25 },
      };
      const result = validateProposedWeekInvariants(proposalOverCapacityLie, inputWith20h);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.includes('capacityStatus must be "over_capacity"'))
      ).toBe(true);
      expect(
        result.errors.some((e) => e.includes('protectedSpaceStatus must be "compromised"'))
      ).toBe(true);
    });

    it("Scenario G: detects invented totalAvailableHours when input provided none", () => {
      const proposalWithInventedHours: ProposedWeek = {
        weekSummary: {
          targetWeek: validTargetWeek,
          capacity: {
            totalAvailableHours: 40, // Input had undefined!
            plannableHours: 30,
            plannedHours: 20,
            knownEstimatedHours: 20,
            estimationCompleteness: "complete",
            protectedSpaceHours: 10,
            capacityStatus: "within_capacity",
            protectedSpaceStatus: "respected",
          },
        },
        foci: [
          { id: "f1", title: "F", desiredOutcome: "O", rationale: "R", contributingItemIds: ["item-2"], estimatedHours: null },
        ],
        obligations: [{ itemId: "item-1", title: "1", commitmentType: "external", rationale: "r", estimatedHours: null }],
        flexibleOptions: [{ itemId: "item-3", title: "3", estimatedHours: null }],
        deferredItems: [{ itemId: "item-4", title: "4", reason: "archived", rationale: "r" }],
        unplannedSpace: { rationale: "p", recommendedHours: null },
        confirmationPrompt: { question: "q", keyTradeoffs: [], pendingQuestions: [] },
      };

      const inputWithoutCap = { ...sampleInput, capacity: undefined };
      const result = validateProposedWeekInvariants(proposalWithInventedHours, inputWithoutCap);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("Invented totalAvailableHours"))).toBe(true);
    });

    it("Scenario H: empty input produces canonical empty proposal", () => {
      const emptyInput: BuildWeekInput = {
        currentDate: validBaseDate,
        items: [],
        relationships: [],
        groupedWork: { groups: [], ungroupedItemIds: [] },
        deadlines: { deadlines: [] },
        context: { itemAssessments: [], groupAssessments: [], openQuestions: [] },
      };

      const emptyProposal = createEmptyProposedWeek(validBaseDate, validTargetWeek);

      // Must be valid Zod schema
      expect(ProposedWeekSchema.parse(emptyProposal)).toEqual(emptyProposal);

      // Must satisfy all cross-validation invariants
      const result = validateProposedWeekInvariants(emptyProposal, emptyInput);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("Scenario I: partial estimations require plannedHours null and status unknown", () => {
      const partialProposal: ProposedWeek = {
        weekSummary: {
          targetWeek: validTargetWeek,
          capacity: {
            totalAvailableHours: 25,
            plannableHours: 18.75,
            plannedHours: null,
            knownEstimatedHours: 10,
            estimationCompleteness: "partial",
            protectedSpaceHours: 6.25,
            capacityStatus: "unknown",
            protectedSpaceStatus: "unknown",
          },
        },
        foci: [
          {
            id: "focus-1",
            title: "Lanzamiento y Demo",
            groupId: "group-1",
            desiredOutcome: "Tener la demo validada",
            rationale: "Línea clave",
            contributingItemIds: ["item-2"],
            estimatedHours: 6,
          },
        ],
        obligations: [
          {
            itemId: "item-1",
            title: "Preparar demo para inversores",
            commitmentType: "external",
            rationale: "Compromiso externo",
            estimatedHours: 4,
          },
        ],
        flexibleOptions: [
          {
            itemId: "item-3",
            title: "Cambiar cuerdas",
            condition: "Si hay tiempo",
            estimatedHours: null, // Unknown estimate makes it partial!
          },
        ],
        deferredItems: [
          {
            itemId: "item-4",
            title: "Discord bot",
            reason: "archived",
            rationale: "Archivado conscientemente",
          },
        ],
        unplannedSpace: {
          rationale: "Espacio protegido",
          recommendedHours: 6.25,
        },
        confirmationPrompt: {
          question: "¿Tiene sentido?",
          keyTradeoffs: [],
          pendingQuestions: [],
        },
      };

      // Honest partial proposal passes
      const validRes = validateProposedWeekInvariants(partialProposal, sampleInput);
      expect(validRes.valid).toBe(true);

      // But pretending within_capacity with partial estimates is rejected
      const lieStatus: ProposedWeek = {
        ...partialProposal,
        weekSummary: {
          ...partialProposal.weekSummary,
          capacity: {
            ...partialProposal.weekSummary.capacity,
            capacityStatus: "within_capacity",
          },
        },
      };
      const lieStatusRes = validateProposedWeekInvariants(lieStatus, sampleInput);
      expect(lieStatusRes.valid).toBe(false);
      expect(lieStatusRes.errors.some((e) => e.includes("Cannot declare capacityStatus \"within_capacity\""))).toBe(true);

      // Pretending plannedHours is known with partial estimates is rejected
      const liePlannedHours: ProposedWeek = {
        ...partialProposal,
        weekSummary: {
          ...partialProposal.weekSummary,
          capacity: {
            ...partialProposal.weekSummary.capacity,
            plannedHours: 10,
          },
        },
      };
      const lieHoursRes = validateProposedWeekInvariants(liePlannedHours, sampleInput);
      expect(lieHoursRes.valid).toBe(false);
      expect(lieHoursRes.errors.some((e) => e.includes("plannedHours must be null"))).toBe(true);

      // Pretending protected space is respected with partial estimates is rejected
      const lieSpace: ProposedWeek = {
        ...partialProposal,
        weekSummary: {
          ...partialProposal.weekSummary,
          capacity: {
            ...partialProposal.weekSummary.capacity,
            protectedSpaceStatus: "respected",
          },
        },
      };
      const lieSpaceRes = validateProposedWeekInvariants(lieSpace, sampleInput);
      expect(lieSpaceRes.valid).toBe(false);
      expect(lieSpaceRes.errors.some((e) => e.includes("Cannot declare protectedSpaceStatus \"respected\""))).toBe(true);
    });

    it("Scenario J: partial estimations where known hours exceed plannable capacity must be over_capacity", () => {
      const overPartialProposal: ProposedWeek = {
        weekSummary: {
          targetWeek: validTargetWeek,
          capacity: {
            totalAvailableHours: 25,
            plannableHours: 18.75,
            plannedHours: null,
            knownEstimatedHours: 22, // 22 > 18.75 even though partial!
            estimationCompleteness: "partial",
            protectedSpaceHours: 6.25,
            capacityStatus: "over_capacity",
            protectedSpaceStatus: "compromised",
          },
        },
        foci: [
          {
            id: "focus-1",
            title: "Lanzamiento y Demo",
            groupId: "group-1",
            desiredOutcome: "Tener la demo validada",
            rationale: "Línea clave",
            contributingItemIds: ["item-2"],
            estimatedHours: 12,
          },
        ],
        obligations: [
          {
            itemId: "item-1",
            title: "Preparar demo para inversores",
            commitmentType: "external",
            rationale: "Compromiso externo",
            estimatedHours: 10,
          },
        ],
        flexibleOptions: [
          {
            itemId: "item-3",
            title: "Cambiar cuerdas",
            condition: "Si hay tiempo",
            estimatedHours: null,
          },
        ],
        deferredItems: [
          {
            itemId: "item-4",
            title: "Discord bot",
            reason: "archived",
            rationale: "Archivado conscientemente",
          },
        ],
        unplannedSpace: {
          rationale: "Espacio protegido",
          recommendedHours: 6.25,
        },
        confirmationPrompt: {
          question: "¿Tiene sentido?",
          keyTradeoffs: ["Las estimaciones conocidas ya superan las horas planificables"],
          pendingQuestions: [],
        },
      };

      const res = validateProposedWeekInvariants(overPartialProposal, sampleInput);
      expect(res.valid).toBe(true);

      // If it claims unknown despite known sum > plannable, it fails
      const claimUnknown: ProposedWeek = {
        ...overPartialProposal,
        weekSummary: {
          ...overPartialProposal.weekSummary,
          capacity: {
            ...overPartialProposal.weekSummary.capacity,
            capacityStatus: "unknown",
            protectedSpaceStatus: "unknown",
          },
        },
      };
      const failRes = validateProposedWeekInvariants(claimUnknown, sampleInput);
      expect(failRes.valid).toBe(false);
      expect(failRes.errors.some((e) => e.includes("capacityStatus must be \"over_capacity\""))).toBe(true);
      expect(failRes.errors.some((e) => e.includes("protectedSpaceStatus must be \"compromised\""))).toBe(true);
    });

    it("Scenario K: obligation overload forces over_capacity status", () => {
      const obligationOverloadProposal: ProposedWeek = {
        weekSummary: {
          targetWeek: validTargetWeek,
          capacity: {
            totalAvailableHours: 25,
            plannableHours: 18.75,
            plannedHours: 20,
            knownEstimatedHours: 20,
            estimationCompleteness: "complete",
            protectedSpaceHours: 6.25,
            capacityStatus: "over_capacity",
            protectedSpaceStatus: "compromised",
          },
        },
        foci: [],
        obligations: [
          {
            itemId: "item-1",
            title: "Preparar demo para inversores",
            commitmentType: "external",
            rationale: "Compromiso externo masivo",
            estimatedHours: 20, // 20h > 18.75h plannable
          },
        ],
        flexibleOptions: [
          { itemId: "item-2", title: "Task 2", estimatedHours: 0 },
          { itemId: "item-3", title: "Task 3", estimatedHours: 0 },
        ],
        deferredItems: [
          { itemId: "item-4", title: "Task 4", reason: "archived", rationale: "r" },
        ],
        unplannedSpace: {
          rationale: "Espacio comprometido por obligaciones",
          recommendedHours: 6.25,
        },
        confirmationPrompt: {
          question: "¿Deseas renegociar plazos externos?",
          keyTradeoffs: ["Las obligaciones externas exceden la capacidad planificable"],
          pendingQuestions: [],
        },
      };

      const res = validateProposedWeekInvariants(obligationOverloadProposal, sampleInput);
      expect(res.valid).toBe(true);
    });

    it("Scenario L: complete estimation requires plannedHours to match knownEstimatedHours", () => {
      const mismatchProposal: ProposedWeek = {
        weekSummary: {
          targetWeek: validTargetWeek,
          capacity: {
            totalAvailableHours: 25,
            plannableHours: 18.75,
            plannedHours: 14,
            knownEstimatedHours: 12, // Mismatch!
            estimationCompleteness: "complete",
            protectedSpaceHours: 6.25,
            capacityStatus: "within_capacity",
            protectedSpaceStatus: "respected",
          },
        },
        foci: [
          {
            id: "focus-1",
            title: "Demo",
            groupId: "group-1",
            desiredOutcome: "Done",
            rationale: "r",
            contributingItemIds: ["item-2"],
            estimatedHours: 8,
          },
        ],
        obligations: [
          {
            itemId: "item-1",
            title: "Obligation",
            commitmentType: "external",
            rationale: "r",
            estimatedHours: 6,
          },
        ],
        flexibleOptions: [
          { itemId: "item-3", title: "Flex", estimatedHours: 0 },
        ],
        deferredItems: [
          { itemId: "item-4", title: "Def", reason: "archived", rationale: "r" },
        ],
        unplannedSpace: { rationale: "r", recommendedHours: 6.25 },
        confirmationPrompt: { question: "q", keyTradeoffs: [], pendingQuestions: [] },
      };

      const res = validateProposedWeekInvariants(mismatchProposal, sampleInput);
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes("plannedHours (14) must match knownEstimatedHours (12)"))).toBe(true);
    });

    it("Scenario M: createEmptyProposedWeek resolves default natural week when omitted", () => {
      // 2026-10-09 is Friday -> next natural week is Monday 2026-10-12 to Sunday 2026-10-18
      const emptyAuto = createEmptyProposedWeek("2026-10-09");
      expect(emptyAuto.weekSummary.targetWeek).toEqual({
        startDate: "2026-10-12",
        endDate: "2026-10-18",
      });
      expect(emptyAuto.weekSummary.capacity.estimationCompleteness).toBe("none");
      expect(emptyAuto.weekSummary.capacity.knownEstimatedHours).toBeNull();
    });
  });
});
