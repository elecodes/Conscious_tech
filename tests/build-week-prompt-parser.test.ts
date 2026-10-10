import { describe, it, expect } from "vitest";
import {
  BUILD_WEEK_SYSTEM_PROMPT,
  buildWeekUserPrompt,
  buildWeekPrompt,
} from "../src/skills/build-week/prompt";
import {
  parseProposedWeek,
  parseAndValidateProposedWeek,
  extractJsonFromMarkdown,
  sanitizeOptionalNullFields,
} from "../src/skills/build-week/parser";
import {
  buildDeterministicPlanningContext,
  WeekValidationError,
} from "../src/skills/build-week/deterministic";
import { BuildWeekInput, ProposedWeek, TargetWeek } from "../src/domain/week";

describe("Skill 06: build_week - Prompt and Parser", () => {
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

  const sampleContext = buildDeterministicPlanningContext(sampleInput);

  const sampleValidProposal: ProposedWeek = {
    weekSummary: {
      targetWeek: sampleTargetWeek,
      intent: "Cerrar compromisos",
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
        desiredOutcome: "Demo lista y probada",
        rationale: "Línea estructurante de la semana",
        contributingItemIds: ["item-2"],
        estimatedHours: 8,
      },
    ],
    obligations: [
      {
        itemId: "item-1",
        title: "Demo inversores",
        commitmentType: "external",
        rationale: "Compromiso externo con inversores",
        estimatedHours: 6,
      },
    ],
    flexibleOptions: [
      {
        itemId: "item-3",
        title: "Cambiar cuerdas",
        condition: "Si queda tiempo el fin de semana",
        estimatedHours: 1,
      },
    ],
    deferredItems: [
      {
        itemId: "item-4",
        title: "Discord bot",
        reason: "archived",
        rationale: "Item archivado conscientemente",
      },
    ],
    unplannedSpace: {
      rationale: "6.25 horas reservadas para imprevistos y descanso",
      recommendedHours: 6.25,
    },
    confirmationPrompt: {
      question: "¿Te representa esta propuesta para estructurar la semana?",
      keyTradeoffs: ["El bot de Discord permanece archivado sin avances"],
      pendingQuestions: [],
    },
  };

  // ==========================================================================
  // 1. Prompt Construction & Semantic Invariants
  // ==========================================================================
  describe("Prompt Construction (prompt.ts)", () => {
    it("builds deterministic and stable prompts across multiple invocations", () => {
      const p1 = buildWeekPrompt(sampleContext);
      const p2 = buildWeekPrompt(sampleContext);

      expect(p1.systemPrompt).toBe(p2.systemPrompt);
      expect(p1.userPrompt).toBe(p2.userPrompt);
      expect(typeof p1.systemPrompt).toBe("string");
      expect(typeof p1.userPrompt).toBe("string");
    });

    it("enforces core semantic principles in system prompt", () => {
      const prompt = BUILD_WEEK_SYSTEM_PROMPT;

      // 1. Propose between 0 and 3 foci; 0 is valid
      expect(prompt).toContain("entre 0 y 3");
      expect(prompt).toContain("0 focos es totalmente VÁLIDO");

      // 2. Categories
      expect(prompt).toContain("FOCOS SEMANALES");
      expect(prompt).toContain("OBLIGACIONES");
      expect(prompt).toContain("OPCIONES FLEXIBLES");
      expect(prompt).toContain("ELEMENTOS APLAZADOS O CONSERVADOS");
      expect(prompt).toContain("ESPACIO PROTEGIDO");

      // 3. Ideas never become obligations because of approaching deadline
      expect(prompt).toContain("Las ideas exploratorias NUNCA se convierten en obligaciones por tener una fecha límite");

      // 4. Do not invent availability, estimates, dependencies
      expect(prompt).toContain("NO inventes horas disponibles, estimaciones de esfuerzo, dependencias");

      // 5. Do not present not_scheduled as user decision
      expect(prompt).toContain("NUNCA presentes \"not_scheduled\" ni una omisión como una decisión deliberada de la persona");

      // 6. Thematic relationships are not blockers
      expect(prompt).toContain("Una relación temática (\"related_to\", \"part_of\", \"same_project\") NUNCA es un bloqueo");

      // 7. Do not discard commitments due to capacity overload
      expect(prompt).toContain("NUNCA descartes ni omitas un compromiso externo porque la capacidad sea insuficiente");

      // 8. No daily agenda or calendar hours
      expect(prompt).toContain("NO asignes días concretos (lunes, martes, etc.) ni bloques horarios");

      // 9. Capacity calculation is deterministic code responsibility
      expect(prompt).toContain("los cómputos de capacidad corresponden al código determinista");

      // 10. Strictly use received IDs
      expect(prompt).toContain("Usa ÚNICAMENTE IDs de items y grupos presentes en los datos estructurados");

      // 11. Maximum 2 open questions
      expect(prompt).toContain("como MÁXIMO 2 preguntas abiertas");

      // 12. Maintain protected unplanned space
      expect(prompt).toContain("No llenes la semana por defecto");
    });

    it("serializes structured context into user prompt without raw text redundancy", () => {
      const userPrompt = buildWeekUserPrompt(sampleContext);

      expect(userPrompt).toContain("2026-10-12");
      expect(userPrompt).toContain("2026-10-18");
      expect(userPrompt).toContain("item-1");
      expect(userPrompt).toContain("item-2");
      expect(userPrompt).toContain("group-1");
      expect(userPrompt).toContain("Demo inversores");
      expect(userPrompt).toContain("externalCommitments");
      expect(userPrompt).toContain("strictDeadlinesInWeek");
    });
  });

  // ==========================================================================
  // 2. Parser & Typed Results (parser.ts)
  // ==========================================================================
  describe("Parser (parser.ts)", () => {
    it("cleans markdown fences around JSON", () => {
      const raw = "```json\n" + JSON.stringify(sampleValidProposal) + "\n```";
      const cleaned = extractJsonFromMarkdown(raw);
      expect(cleaned.startsWith("{")).toBe(true);
      expect(cleaned.endsWith("}")).toBe(true);
    });

    it("parses valid JSON response successfully", () => {
      const raw = JSON.stringify(sampleValidProposal);
      const result = parseProposedWeek(raw, sampleInput);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.foci).toHaveLength(1);
        expect(result.data.obligations).toHaveLength(1);
        expect(result.data.flexibleOptions).toHaveLength(1);
        expect(result.data.deferredItems).toHaveLength(1);
        expect(result.repaired).toBe(false);
      }
    });

    it("unwraps root wrapper keys (proposedWeek, week, result)", () => {
      const wrapped = JSON.stringify({ proposedWeek: sampleValidProposal });
      const result = parseProposedWeek(wrapped, sampleInput);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.foci[0]?.id).toBe("focus-1");
      }
    });

    it("returns invalid_json on malformed JSON string", () => {
      const malformed = '{"weekSummary": { incomplete';
      const result = parseProposedWeek(malformed, sampleInput);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errorType).toBe("invalid_json");
        expect(result.error).toContain("Failed to parse JSON");
      }
    });

    it("returns schema_validation_error on unknown enums or bad types", () => {
      const badEnumProposal = {
        ...sampleValidProposal,
        obligations: [
          {
            ...sampleValidProposal.obligations[0],
            commitmentType: "soft_deadline", // Invalid enum!
          },
        ],
      };

      const result = parseProposedWeek(JSON.stringify(badEnumProposal), sampleInput);
      expect(result.success).toBe(false);
      if (!result.success && result.errorType === "schema_validation_error") {
        expect(result.issues.length).toBeGreaterThan(0);
      }
    });

    it("returns schema_validation_error when foci exceed 3", () => {
      const tooManyFociProposal = {
        ...sampleValidProposal,
        foci: [
          sampleValidProposal.foci[0],
          { ...sampleValidProposal.foci[0], id: "focus-2" },
          { ...sampleValidProposal.foci[0], id: "focus-3" },
          { ...sampleValidProposal.foci[0], id: "focus-4" }, // 4 foci!
        ],
      };

      const result = parseProposedWeek(JSON.stringify(tooManyFociProposal), sampleInput);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errorType).toBe("schema_validation_error");
      }
    });

    it("returns schema_validation_error when open questions exceed 2", () => {
      const tooManyQuestionsProposal = {
        ...sampleValidProposal,
        confirmationPrompt: {
          ...sampleValidProposal.confirmationPrompt,
          pendingQuestions: ["Pregunta 1?", "Pregunta 2?", "Pregunta 3?"], // 3 questions!
        },
      };

      const result = parseProposedWeek(JSON.stringify(tooManyQuestionsProposal), sampleInput);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errorType).toBe("schema_validation_error");
      }
    });

    it("returns invariant_violation on phantom item IDs without silently dropping them", () => {
      const phantomProposal = {
        ...sampleValidProposal,
        foci: [
          {
            ...sampleValidProposal.foci[0],
            contributingItemIds: ["item-2", "ghost-item-999"], // Phantom!
          },
        ],
      };

      const result = parseProposedWeek(JSON.stringify(phantomProposal), sampleInput);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errorType).toBe("invariant_violation");
        expect(result.error).toContain("phantom item IDs detected");
      }
    });

    it("returns invariant_violation on nonexistent group IDs in foci", () => {
      const badGroupProposal = {
        ...sampleValidProposal,
        foci: [
          {
            ...sampleValidProposal.foci[0],
            groupId: "nonexistent-group-xyz", // Bad group!
          },
        ],
      };

      const result = parseProposedWeek(JSON.stringify(badGroupProposal), sampleInput);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errorType).toBe("invariant_violation");
        expect(result.error).toContain("nonexistent groupId");
      }
    });

    it("returns invariant_violation on contradictory category assignments", () => {
      const contradictoryProposal = {
        ...sampleValidProposal,
        deferredItems: [
          ...sampleValidProposal.deferredItems,
          {
            itemId: "item-1", // Assigned to obligations AND deferredItems!
            title: "Demo",
            reason: "out_of_capacity",
            rationale: "Conflicto",
          },
        ],
      };

      const result = parseProposedWeek(JSON.stringify(contradictoryProposal), sampleInput);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errorType).toBe("invariant_violation");
        expect(result.error).toContain("contradictory category assignments");
      }
    });

    it("safely rescues omitted regular task to deferredItems with reason 'not_scheduled'", () => {
      // Planner omitted item-2 (regular task)
      const proposalWithoutTask = {
        ...sampleValidProposal,
        foci: [], // item-2 omitted
      };

      const result = parseProposedWeek(JSON.stringify(proposalWithoutTask), sampleInput);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.repaired).toBe(true);
        const rescued = result.data.deferredItems.find((d) => d.itemId === "item-2");
        expect(rescued).toBeDefined();
        expect(rescued?.reason).toBe("not_scheduled");
        expect(
          result.repairs.some((r) => r.type === "rescued_omitted_to_not_scheduled")
        ).toBe(true);
      }
    });

    it("preserves external commitments even under severe capacity overload", () => {
      const constrainedInput: BuildWeekInput = {
        ...sampleInput,
        capacity: {
          totalAvailableHours: 8,
          minProtectedSpaceRatio: 0.25, // 6h plannable
        },
      };

      // item-1 has 6h, plus another task 4h = 10h > 6h plannable
      const overloadProposal = {
        ...sampleValidProposal,
        weekSummary: {
          ...sampleValidProposal.weekSummary,
          capacity: {
            ...sampleValidProposal.weekSummary.capacity,
            totalAvailableHours: 8,
            plannableHours: 6,
            plannedHours: 14,
            knownEstimatedHours: 14,
            capacityStatus: "over_capacity" as const,
            protectedSpaceStatus: "compromised" as const,
          },
        },
      };

      const result = parseProposedWeek(JSON.stringify(overloadProposal), constrainedInput);
      expect(result.success).toBe(true);
      if (result.success) {
        // Commitment must not be dropped
        expect(result.data.obligations.some((o) => o.itemId === "item-1")).toBe(true);
        expect(result.data.weekSummary.capacity.capacityStatus).toBe("over_capacity");
      }
    });

    it("handles unknown capacity and partial estimates honestly", () => {
      const inputWithoutCap: BuildWeekInput = {
        ...sampleInput,
        capacity: undefined,
      };

      const partialProposal = {
        ...sampleValidProposal,
        foci: [
          {
            ...sampleValidProposal.foci[0],
            estimatedHours: null, // Unestimated focus -> partial completeness
          },
        ],
        weekSummary: {
          targetWeek: sampleTargetWeek,
          intent: "Enfoque sin horas",
          capacity: {
            totalAvailableHours: null,
            plannableHours: null,
            plannedHours: null,
            knownEstimatedHours: 6,
            estimationCompleteness: "partial" as const,
            protectedSpaceHours: null,
            capacityStatus: "unknown" as const,
            protectedSpaceStatus: "unknown" as const,
          },
        },
      };

      const result = parseProposedWeek(JSON.stringify(partialProposal), inputWithoutCap);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.weekSummary.capacity.capacityStatus).toBe("unknown");
        expect(result.data.weekSummary.capacity.estimationCompleteness).toBe("partial");
        expect(result.data.weekSummary.capacity.plannedHours).toBeNull();
        expect(result.data.weekSummary.capacity.knownEstimatedHours).toBe(6);
      }
    });

    it("supports valid proposal with zero foci", () => {
      // Week of purely reactive obligations and maintenance, 0 foci
      const zeroFociProposal = {
        ...sampleValidProposal,
        foci: [],
        flexibleOptions: [
          ...sampleValidProposal.flexibleOptions,
          { itemId: "item-2", title: "Refactor", estimatedHours: 8 },
        ],
      };

      const result = parseProposedWeek(JSON.stringify(zeroFociProposal), sampleInput);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.foci).toHaveLength(0);
      }
    });

    it("handles empty input fast-path with zero tokens and zero model calls", () => {
      const emptyInput: BuildWeekInput = {
        currentDate: baseDate,
        items: [],
        relationships: [],
        groupedWork: { groups: [], ungroupedItemIds: [] },
        deadlines: { deadlines: [] },
        context: { itemAssessments: [], groupAssessments: [], openQuestions: [] },
      };

      const result = parseProposedWeek("", emptyInput);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.foci).toHaveLength(0);
        expect(result.data.obligations).toHaveLength(0);
        expect(result.data.flexibleOptions).toHaveLength(0);
        expect(result.data.deferredItems).toHaveLength(0);
      }
    });

    it("rejects non-empty proposal when input is empty", () => {
      const emptyInput: BuildWeekInput = {
        currentDate: baseDate,
        items: [],
        relationships: [],
        groupedWork: { groups: [], ungroupedItemIds: [] },
        deadlines: { deadlines: [] },
        context: { itemAssessments: [], groupAssessments: [], openQuestions: [] },
      };

      const result = parseProposedWeek(JSON.stringify(sampleValidProposal), emptyInput);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errorType).toBe("invariant_violation");
      }
    });

    describe("parseAndValidateProposedWeek (throwing unwrapper)", () => {
      it("returns ProposedWeek directly on success", () => {
        const parsed = parseAndValidateProposedWeek(
          JSON.stringify(sampleValidProposal),
          sampleInput
        );
        expect(parsed.foci).toHaveLength(1);
        expect(parsed.obligations).toHaveLength(1);
      });

      it("throws WeekValidationError on invalid JSON or invariant violation", () => {
        expect(() =>
          parseAndValidateProposedWeek("invalid json", sampleInput)
        ).toThrow(WeekValidationError);

        const phantom = {
          ...sampleValidProposal,
          foci: [{ ...sampleValidProposal.foci[0], contributingItemIds: ["phantom-123"] }],
        };
        expect(() =>
          parseAndValidateProposedWeek(JSON.stringify(phantom), sampleInput)
        ).toThrow(WeekValidationError);
      });
    });

    describe("Regresiones: Normalización de campos opcionales nulos en la frontera de parsing", () => {
      it("accepts focus with groupId: null and normalizes it to undefined (focus without group)", () => {
        const proposalWithNullGroupId = {
          ...sampleValidProposal,
          foci: [
            {
              ...sampleValidProposal.foci[0],
              groupId: null, // As returned by Groq/Llama when unassociated with a group
            },
          ],
        };

        const result = parseProposedWeek(JSON.stringify(proposalWithNullGroupId), sampleInput);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.foci[0].groupId).toBeUndefined();
          expect("groupId" in result.data.foci[0]).toBe(false);
        }
      });

      it("preserves valid groupId when referencing an existing group", () => {
        const proposalWithValidGroupId = {
          ...sampleValidProposal,
          foci: [
            {
              ...sampleValidProposal.foci[0],
              groupId: "group-1", // Valid group in sampleInput
            },
          ],
        };

        const result = parseProposedWeek(JSON.stringify(proposalWithValidGroupId), sampleInput);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.foci[0].groupId).toBe("group-1");
        }
      });

      it("rejects focus referencing a nonexistent groupId as invariant_violation", () => {
        const proposalWithNonexistentGroupId = {
          ...sampleValidProposal,
          foci: [
            {
              ...sampleValidProposal.foci[0],
              groupId: "group-ghost-404", // Nonexistent group
            },
          ],
        };

        const result = parseProposedWeek(JSON.stringify(proposalWithNonexistentGroupId), sampleInput);
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.errorType).toBe("invariant_violation");
          expect(result.error).toContain("nonexistent groupId");
        }
      });

      it("normalizes other optional null fields (intent, dueDate, condition) to undefined without schema error", () => {
        const proposalWithVariousOptionalNulls = {
          ...sampleValidProposal,
          weekSummary: {
            ...sampleValidProposal.weekSummary,
            intent: null, // Optional intent as null
          },
          obligations: [
            {
              ...sampleValidProposal.obligations[0],
              dueDate: null, // Optional dueDate as null
            },
          ],
          flexibleOptions: [
            {
              ...sampleValidProposal.flexibleOptions[0],
              condition: null, // Optional condition as null
            },
          ],
        };

        const result = parseProposedWeek(JSON.stringify(proposalWithVariousOptionalNulls), sampleInput);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.weekSummary.intent).toBeUndefined();
          expect(result.data.obligations[0].dueDate).toBeUndefined();
          expect(result.data.flexibleOptions[0].condition).toBeUndefined();
        }
      });

      it("fails schema validation when mandatory fields are null", () => {
        // Mandatory title in focus is null
        const nullFocusTitle = {
          ...sampleValidProposal,
          foci: [
            {
              ...sampleValidProposal.foci[0],
              title: null, // Mandatory!
            },
          ],
        };
        const res1 = parseProposedWeek(JSON.stringify(nullFocusTitle), sampleInput);
        expect(res1.success).toBe(false);
        if (!res1.success) {
          expect(res1.errorType).toBe("schema_validation_error");
        }

        // Mandatory rationale in obligation is null
        const nullObligationRationale = {
          ...sampleValidProposal,
          obligations: [
            {
              ...sampleValidProposal.obligations[0],
              rationale: null, // Mandatory!
            },
          ],
        };
        const res2 = parseProposedWeek(JSON.stringify(nullObligationRationale), sampleInput);
        expect(res2.success).toBe(false);
        if (!res2.success) {
          expect(res2.errorType).toBe("schema_validation_error");
        }

        // Mandatory reason in deferredItem is null
        const nullDeferredReason = {
          ...sampleValidProposal,
          deferredItems: [
            {
              ...sampleValidProposal.deferredItems[0],
              reason: null, // Mandatory!
            },
          ],
        };
        const res3 = parseProposedWeek(JSON.stringify(nullDeferredReason), sampleInput);
        expect(res3.success).toBe(false);
        if (!res3.success) {
          expect(res3.errorType).toBe("schema_validation_error");
        }
      });

      it("preserves safe repairs and audit trail alongside optional null normalization", () => {
        // Proposal has groupId: null in focus AND omitted item-2 (regular task)
        const proposalWithNullGroupAndOmittedTask = {
          ...sampleValidProposal,
          foci: [
            {
              ...sampleValidProposal.foci[0],
              groupId: null,
              contributingItemIds: ["item-1"], // item-2 omitted from focus
            },
          ],
          obligations: [], // item-1 in focus
          flexibleOptions: [sampleValidProposal.flexibleOptions[0]], // item-3
          deferredItems: [sampleValidProposal.deferredItems[0]], // item-4
        };

        const result = parseProposedWeek(JSON.stringify(proposalWithNullGroupAndOmittedTask), sampleInput);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.foci[0].groupId).toBeUndefined();
          expect(result.repaired).toBe(true);
          const rescued = result.data.deferredItems.find((d) => d.itemId === "item-2");
          expect(rescued).toBeDefined();
          expect(rescued?.reason).toBe("not_scheduled");
          expect(result.repairs.some((r) => r.type === "rescued_omitted_to_not_scheduled")).toBe(true);
        }
      });

      it("pure sanitizeOptionalNullFields directly mutates and deletes only optional null keys", () => {
        const raw = {
          weekSummary: { intent: null, targetWeek: { startDate: "2026-10-12", endDate: "2026-10-18" } },
          foci: [{ id: "f1", title: "F1", groupId: null, estimatedHours: null }],
          obligations: [{ itemId: "i1", title: "O1", dueDate: null, rationale: "r" }],
          flexibleOptions: [{ itemId: "i2", title: "F2", condition: null }],
        };

        const sanitized = sanitizeOptionalNullFields(raw) as any;
        expect("intent" in sanitized.weekSummary).toBe(false);
        expect("groupId" in sanitized.foci[0]).toBe(false);
        expect(sanitized.foci[0].estimatedHours).toBeNull(); // Legit null preserved!
        expect("dueDate" in sanitized.obligations[0]).toBe(false);
        expect("condition" in sanitized.flexibleOptions[0]).toBe(false);
      });
    });
  });
});
