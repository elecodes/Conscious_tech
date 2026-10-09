import { describe, it, expect } from "vitest";
import { MockProvider } from "../src/providers/mock-provider";
import { evaluateContext } from "../src/skills/evaluate-context";
import { EvaluateContextInput } from "../src/domain/context";
import {
  validateContextInvariants,
  cleanAndValidateContextOutput,
} from "../src/skills/evaluate-context/deterministic";
import { ContextValidationError } from "../src/skills/evaluate-context/parser";

describe("Skill 05: evaluate_context behavioral & invariant tests", () => {
  const baseDate = "2026-10-09";

  // 1. Entrada sin elementos
  it("Scenario 1: returns empty assessments for empty input in 0ms (short-circuit)", async () => {
    const provider = new MockProvider();
    const input: EvaluateContextInput = {
      currentDate: baseDate,
      items: [],
      relationships: [],
      groupedWork: { groups: [], ungroupedItemIds: [] },
      deadlines: { deadlines: [] },
    };

    const result = await evaluateContext(provider, input);
    expect(result).toEqual({
      itemAssessments: [],
      groupAssessments: [],
      openQuestions: [],
    });
  });

  // 2. Un elemento independiente sin señales relevantes
  it("Scenario 2: evaluates independent element with no strong signals as medium/low attention", async () => {
    const provider = new MockProvider();
    const input: EvaluateContextInput = {
      currentDate: baseDate,
      items: [
        {
          id: "item-1",
          rawText: "Leer artículo de diseño",
          title: "Leer artículo de diseño",
          type: "task",
        },
      ],
      relationships: [],
      groupedWork: { groups: [], ungroupedItemIds: ["item-1"] },
      deadlines: { deadlines: [] },
    };

    const result = await evaluateContext(provider, input);
    expect(result.itemAssessments).toHaveLength(1);
    expect(result.itemAssessments[0].itemId).toBe("item-1");
    expect(["medium", "low"]).toContain(result.itemAssessments[0].attention);
    expect(validateContextInvariants(result, input).valid).toBe(true);
  });

  // 3. Compromiso externo
  it("Scenario 3: assigns external_commitment signal and high attention", async () => {
    const provider = new MockProvider();
    const input: EvaluateContextInput = {
      currentDate: baseDate,
      items: [
        {
          id: "item-1",
          rawText: "Reunión de revisión con cliente",
          title: "Reunión con cliente",
          type: "commitment",
          commitment: "external",
        },
      ],
      relationships: [],
      groupedWork: { groups: [], ungroupedItemIds: ["item-1"] },
      deadlines: { deadlines: [] },
    };

    const result = await evaluateContext(provider, input);
    const itemAssessment = result.itemAssessments.find((ia) => ia.itemId === "item-1");
    expect(itemAssessment).toBeDefined();
    expect(itemAssessment?.signals).toContain("external_commitment");
    expect(itemAssessment?.attention).toBe("high");
  });

  // 4. Plazo próximo (<= 7 días)
  it("Scenario 4: assigns approaching_deadline signal for deadline within 7 days", async () => {
    const provider = new MockProvider();
    const input: EvaluateContextInput = {
      currentDate: baseDate,
      items: [
        {
          id: "item-1",
          rawText: "Entregar informe el lunes",
          title: "Entregar informe",
          type: "task",
        },
      ],
      relationships: [],
      groupedWork: { groups: [], ungroupedItemIds: ["item-1"] },
      deadlines: {
        deadlines: [
          {
            itemId: "item-1",
            raw: "el lunes",
            kind: "relative_date",
            resolvedStart: "2026-10-12",
            resolvedEnd: null,
            confidence: "high",
          },
        ],
      },
    };

    const result = await evaluateContext(provider, input);
    const itemAssessment = result.itemAssessments.find((ia) => ia.itemId === "item-1");
    expect(itemAssessment?.signals).toContain("approaching_deadline");
    expect(itemAssessment?.attention).toBe("high");
  });

  // 5. Plazo vencido (< currentDate)
  it("Scenario 5: assigns overdue_deadline signal for past dates", async () => {
    const provider = new MockProvider();
    const input: EvaluateContextInput = {
      currentDate: baseDate,
      items: [
        {
          id: "item-1",
          rawText: "Pagar factura que venció el 5",
          title: "Pagar factura",
          type: "task",
        },
      ],
      relationships: [],
      groupedWork: { groups: [], ungroupedItemIds: ["item-1"] },
      deadlines: {
        deadlines: [
          {
            itemId: "item-1",
            raw: "el 5 de octubre",
            kind: "exact_date",
            resolvedStart: "2026-10-05",
            resolvedEnd: null,
            confidence: "high",
          },
        ],
      },
    };

    const result = await evaluateContext(provider, input);
    const itemAssessment = result.itemAssessments.find((ia) => ia.itemId === "item-1");
    expect(itemAssessment?.signals).toContain("overdue_deadline");
    expect(itemAssessment?.attention).toBe("high");
  });

  // 6. Importancia declarada explícitamente
  it("Scenario 6: assigns explicit_importance signal when importance is high", async () => {
    const provider = new MockProvider();
    const input: EvaluateContextInput = {
      currentDate: baseDate,
      items: [
        {
          id: "item-1",
          rawText: "Crucial resolver bug en producción",
          title: "Bug en producción",
          type: "task",
          importance: "high",
        },
      ],
      relationships: [],
      groupedWork: { groups: [], ungroupedItemIds: ["item-1"] },
      deadlines: { deadlines: [] },
    };

    const result = await evaluateContext(provider, input);
    const itemAssessment = result.itemAssessments.find((ia) => ia.itemId === "item-1");
    expect(itemAssessment?.signals).toContain("explicit_importance");
    expect(itemAssessment?.attention).toBe("high");
  });

  // 7. Elemento ya iniciado
  it("Scenario 7: assigns already_started signal when status is started", async () => {
    const provider = new MockProvider();
    const input: EvaluateContextInput = {
      currentDate: baseDate,
      items: [
        {
          id: "item-1",
          rawText: "Siguiendo con la redacción del capítulo 2",
          title: "Redactar capítulo 2",
          type: "task",
          status: "started",
        },
      ],
      relationships: [],
      groupedWork: { groups: [], ungroupedItemIds: ["item-1"] },
      deadlines: { deadlines: [] },
    };

    const result = await evaluateContext(provider, input);
    const itemAssessment = result.itemAssessments.find((ia) => ia.itemId === "item-1");
    expect(itemAssessment?.signals).toContain("already_started");
  });

  // 8. Dependencia entre elementos (sin herencia simétrica de atributos)
  it("Scenario 8: assigns dependency signal to prerequisite without cloning deadline", async () => {
    const provider = new MockProvider();
    const input: EvaluateContextInput = {
      currentDate: baseDate,
      items: [
        {
          id: "item-1",
          rawText: "Subir cambios a producción el lunes",
          title: "Subir a producción",
          type: "task",
        },
        {
          id: "item-2",
          rawText: "Ejecutar migraciones en staging",
          title: "Migraciones staging",
          type: "task",
        },
      ],
      relationships: [
        {
          sourceItemId: "item-1",
          targetItemId: "item-2",
          type: "depends_on",
          confidence: "high",
          reason: "Requiere migración previa",
        },
      ],
      groupedWork: { groups: [], ungroupedItemIds: ["item-1", "item-2"] },
      deadlines: {
        deadlines: [
          {
            itemId: "item-1",
            raw: "el lunes",
            kind: "relative_date",
            resolvedStart: "2026-10-12",
            resolvedEnd: null,
            confidence: "high",
          },
        ],
      },
    };

    const result = await evaluateContext(provider, input);
    const ia1 = result.itemAssessments.find((ia) => ia.itemId === "item-1");
    const ia2 = result.itemAssessments.find((ia) => ia.itemId === "item-2");

    expect(ia1?.signals).toContain("dependency");
    expect(ia2?.signals).toContain("dependency");
    // Item 2 has dependency signal but original deadline remains strictly on Item 1
    expect(input.deadlines.deadlines.some((d) => d.itemId === "item-2")).toBe(false);
  });

  // 9. Objetivo declarado relacionado con una tarea
  it("Scenario 9: assigns supports_declared_goal when related to user goals", async () => {
    const provider = new MockProvider();
    const input: EvaluateContextInput = {
      currentDate: baseDate,
      items: [
        {
          id: "item-1",
          rawText: "Completar simulacro de examen AWS",
          title: "Simulacro examen AWS",
          type: "task",
        },
      ],
      relationships: [],
      groupedWork: { groups: [], ungroupedItemIds: ["item-1"] },
      deadlines: { deadlines: [] },
      declaredGoals: [{ id: "goal-1", text: "Obtener certificación AWS" }],
    };

    const result = await evaluateContext(provider, input);
    const ia = result.itemAssessments.find((ia) => ia.itemId === "item-1");
    expect(ia?.signals).toContain("supports_declared_goal");
  });

  // 10. Ausencia de objetivos declarados (no se inventan)
  it("Scenario 10: does not infer or assign supports_declared_goal when goals are omitted", async () => {
    const provider = new MockProvider();
    const input: EvaluateContextInput = {
      currentDate: baseDate,
      items: [
        {
          id: "item-1",
          rawText: "Preparar presentación del proyecto",
          title: "Preparar presentación",
          type: "task",
        },
      ],
      relationships: [],
      groupedWork: { groups: [], ungroupedItemIds: ["item-1"] },
      deadlines: { deadlines: [] },
      // declaredGoals omitted
    };

    const result = await evaluateContext(provider, input);
    const ia = result.itemAssessments.find((ia) => ia.itemId === "item-1");
    expect(ia?.signals).not.toContain("supports_declared_goal");
  });

  // 11. Grupo con varias tareas relacionadas
  it("Scenario 11: evaluates group relevance based on constituent items", async () => {
    const provider = new MockProvider();
    const input: EvaluateContextInput = {
      currentDate: baseDate,
      items: [
        {
          id: "item-1",
          rawText: "Entregar propuesta comercial hoy",
          title: "Entregar propuesta",
          type: "task",
          commitment: "external",
        },
        {
          id: "item-2",
          rawText: "Revisar costes con finanzas",
          title: "Revisar costes",
          type: "task",
        },
      ],
      relationships: [
        {
          sourceItemId: "item-1",
          targetItemId: "item-2",
          type: "same_project",
          confidence: "high",
          reason: "Mismo cliente",
        },
      ],
      groupedWork: {
        groups: [
          {
            id: "group-1",
            title: "Propuesta comercial cliente",
            itemIds: ["item-1", "item-2"],
            rationale: "Propuesta y costes",
          },
        ],
        ungroupedItemIds: [],
      },
      deadlines: { deadlines: [] },
    };

    const result = await evaluateContext(provider, input);
    expect(result.groupAssessments).toHaveLength(1);
    expect(result.groupAssessments[0].groupId).toBe("group-1");
    expect(result.groupAssessments[0].relevance).toBe("high");
  });

  // 12. Elementos que no pertenecen a ningún grupo
  it("Scenario 12: evaluates ungrouped items individually without creating synthetic groups", async () => {
    const provider = new MockProvider();
    const input: EvaluateContextInput = {
      currentDate: baseDate,
      items: [
        {
          id: "item-1",
          rawText: "Comprar cable HDMI",
          title: "Comprar cable HDMI",
          type: "task",
        },
      ],
      relationships: [],
      groupedWork: {
        groups: [],
        ungroupedItemIds: ["item-1"],
      },
      deadlines: { deadlines: [] },
    };

    const result = await evaluateContext(provider, input);
    expect(result.itemAssessments).toHaveLength(1);
    expect(result.groupAssessments).toHaveLength(0);
  });

  // 13. Información insuficiente o ambigua (no se interpreta como atención baja)
  it("Scenario 13: supports unclear attention and insufficient_information signal", async () => {
    const provider = new MockProvider();
    provider.setContextHandler(() => ({
      itemAssessments: [
        {
          itemId: "item-1",
          attention: "unclear",
          signals: ["insufficient_information"],
          rationale: "No se especifica si es bloqueante o el alcance necesario.",
        },
      ],
      groupAssessments: [],
      openQuestions: [],
    }));

    const input: EvaluateContextInput = {
      currentDate: baseDate,
      items: [
        {
          id: "item-1",
          rawText: "Revisar algo de la base de datos",
          title: "Revisar base de datos",
          type: "task",
        },
      ],
      relationships: [],
      groupedWork: { groups: [], ungroupedItemIds: ["item-1"] },
      deadlines: { deadlines: [] },
    };

    const result = await evaluateContext(provider, input);
    expect(result.itemAssessments[0].attention).toBe("unclear");
    expect(result.itemAssessments[0].signals).toContain("insufficient_information");
  });

  // 14. Pregunta abierta relevante
  it("Scenario 14: preserves well-formed openQuestions with valid relatedItemIds", async () => {
    const provider = new MockProvider();
    provider.setContextHandler(() => ({
      itemAssessments: [
        {
          itemId: "item-1",
          attention: "high",
          signals: ["dependency", "insufficient_information"],
          rationale: "Falta saber fecha límite.",
        },
      ],
      groupAssessments: [],
      openQuestions: [
        {
          topic: "Fecha de entrega",
          question: "¿Cuándo vence el plazo con el cliente?",
          relatedItemIds: ["item-1"],
          reason: "Bloquea planificación posterior",
        },
      ],
    }));

    const input: EvaluateContextInput = {
      currentDate: baseDate,
      items: [
        {
          id: "item-1",
          rawText: "Entregar propuesta",
          title: "Entregar propuesta",
          type: "task",
        },
      ],
      relationships: [],
      groupedWork: { groups: [], ungroupedItemIds: ["item-1"] },
      deadlines: { deadlines: [] },
    };

    const result = await evaluateContext(provider, input);
    expect(result.openQuestions).toHaveLength(1);
    expect(result.openQuestions[0].relatedItemIds).toEqual(["item-1"]);
  });

  // 15. Referencias a IDs inexistentes (purga determinista de phantoms)
  it("Scenario 15: purges phantom item and group IDs deterministically", async () => {
    const provider = new MockProvider();
    provider.setContextHandler(() => ({
      itemAssessments: [
        {
          itemId: "phantom-item-99",
          attention: "high",
          signals: ["external_commitment"],
          rationale: "Item inventado",
        },
        {
          itemId: "item-1",
          attention: "medium",
          signals: [],
          rationale: "Item legítimo",
        },
      ],
      groupAssessments: [
        {
          groupId: "phantom-group-88",
          relevance: "high",
          rationale: "Grupo inventado",
        },
      ],
      openQuestions: [
        {
          topic: "Topic",
          question: "¿Pregunta?",
          relatedItemIds: ["phantom-item-99", "item-1"],
          reason: "Motivo",
        },
      ],
    }));

    const input: EvaluateContextInput = {
      currentDate: baseDate,
      items: [
        {
          id: "item-1",
          rawText: "Tarea real",
          title: "Tarea real",
          type: "task",
        },
      ],
      relationships: [],
      groupedWork: { groups: [], ungroupedItemIds: ["item-1"] },
      deadlines: { deadlines: [] },
    };

    const result = await evaluateContext(provider, input);
    expect(result.itemAssessments).toHaveLength(1);
    expect(result.itemAssessments[0].itemId).toBe("item-1");
    expect(result.groupAssessments).toHaveLength(0);
    expect(result.openQuestions[0].relatedItemIds).toEqual(["item-1"]);
  });

  // 16. Respuesta del modelo mal formada (reintento o error controlado)
  it("Scenario 16: catches malformed JSON and throws ContextValidationError after retries", async () => {
    const provider = new MockProvider();
    provider.setContextHandler(() => {
      throw new ContextValidationError("Invalid json");
    });

    const input: EvaluateContextInput = {
      currentDate: baseDate,
      items: [
        {
          id: "item-1",
          rawText: "Tarea",
          title: "Tarea",
          type: "task",
        },
      ],
      relationships: [],
      groupedWork: { groups: [], ungroupedItemIds: ["item-1"] },
      deadlines: { deadlines: [] },
    };

    await expect(evaluateContext(provider, input, { maxRetries: 1 })).rejects.toThrow(
      ContextValidationError
    );
  });

  // 17. Señales duplicadas (deduplicadas deterministamente)
  it("Scenario 17: deduplicates duplicate signals in item assessment", async () => {
    const provider = new MockProvider();
    provider.setContextHandler(() => ({
      itemAssessments: [
        {
          itemId: "item-1",
          attention: "high",
          signals: [
            "external_commitment",
            "external_commitment",
            "already_started",
          ],
          rationale: "Compromiso duplicado",
        },
      ],
      groupAssessments: [],
      openQuestions: [],
    }));

    const input: EvaluateContextInput = {
      currentDate: baseDate,
      items: [
        {
          id: "item-1",
          rawText: "Tarea",
          title: "Tarea",
          type: "task",
        },
      ],
      relationships: [],
      groupedWork: { groups: [], ungroupedItemIds: ["item-1"] },
      deadlines: { deadlines: [] },
    };

    const result = await evaluateContext(provider, input);
    expect(result.itemAssessments[0].signals).toEqual([
      "external_commitment",
      "already_started",
    ]);
  });

  // 18. Cobertura completa y sin duplicados de elementos y grupos
  it("Scenario 18: guarantees exact 1:1 item and group coverage even if LLM omits one", async () => {
    const provider = new MockProvider();
    // LLM only returns item-1, omits item-2 and group-1
    provider.setContextHandler(() => ({
      itemAssessments: [
        {
          itemId: "item-1",
          attention: "high",
          signals: ["external_commitment"],
          rationale: "Solo item 1 evaluado",
        },
      ],
      groupAssessments: [],
      openQuestions: [],
    }));

    const input: EvaluateContextInput = {
      currentDate: baseDate,
      items: [
        {
          id: "item-1",
          rawText: "Item 1",
          title: "Item 1",
          type: "task",
        },
        {
          id: "item-2",
          rawText: "Item 2",
          title: "Item 2",
          type: "task",
          status: "started",
        },
      ],
      relationships: [],
      groupedWork: {
        groups: [
          {
            id: "group-1",
            title: "Línea 1",
            itemIds: ["item-1", "item-2"],
            rationale: "Trabajo conjunto",
          },
        ],
        ungroupedItemIds: [],
      },
      deadlines: { deadlines: [] },
    };

    const result = await evaluateContext(provider, input);
    expect(result.itemAssessments).toHaveLength(2);
    expect(result.itemAssessments.map((i) => i.itemId)).toEqual(["item-1", "item-2"]);
    expect(result.groupAssessments).toHaveLength(1);
    expect(result.groupAssessments[0].groupId).toBe("group-1");

    const invariantCheck = validateContextInvariants(result, input);
    expect(invariantCheck.valid).toBe(true);
  });

  // 19. Garantía de que las valoraciones no se convierten en un plan semanal
  it("Scenario 19: does not emit schedule, capacity, or day allocations", async () => {
    const provider = new MockProvider();
    const input: EvaluateContextInput = {
      currentDate: baseDate,
      items: [
        {
          id: "item-1",
          rawText: "Terminar informe",
          title: "Terminar informe",
          type: "task",
        },
      ],
      relationships: [],
      groupedWork: { groups: [], ungroupedItemIds: ["item-1"] },
      deadlines: { deadlines: [] },
    };

    const result = await evaluateContext(provider, input);
    // Contractually, result has only itemAssessments, groupAssessments, openQuestions
    expect(Object.keys(result).sort()).toEqual(
      ["groupAssessments", "itemAssessments", "openQuestions"].sort()
    );
  });

  // 20. Garantía de que no se modifican los datos de entrada
  it("Scenario 20: preserves original input data immutably", async () => {
    const provider = new MockProvider();
    const input: EvaluateContextInput = {
      currentDate: baseDate,
      items: [
        {
          id: "item-1",
          rawText: "Idea de blog",
          title: "Idea de blog",
          type: "idea",
        },
      ],
      relationships: [],
      groupedWork: { groups: [], ungroupedItemIds: ["item-1"] },
      deadlines: { deadlines: [] },
    };

    const originalJson = JSON.stringify(input);
    await evaluateContext(provider, input);
    expect(JSON.stringify(input)).toBe(originalJson);
  });

  // 21. Regresión Caso 06: waiting en tarea bloqueada por tercero sin propagación ciega
  it("Scenario 21 (Calibration Case 06): assigns waiting to blocked item without propagating to parallel task", async () => {
    const provider = new MockProvider();
    const input: EvaluateContextInput = {
      currentDate: baseDate,
      items: [
        {
          id: "c06-1",
          rawText: "Seguir con la integración de Stripe en la tienda, pero estoy frenada porque falta que el cliente mande las credenciales",
          title: "Integración de Stripe en tienda",
          type: "project",
          status: "started",
        },
        {
          id: "c06-2",
          rawText: "falta que el cliente mande las credenciales de webhook",
          title: "Bloqueo por credenciales de webhook del cliente",
          type: "concern",
        },
        {
          id: "c06-3",
          rawText: "avanzar en la página de agradecimiento",
          title: "Avanzar página de agradecimiento",
          type: "task",
          status: "started",
        },
      ],
      relationships: [
        {
          sourceItemId: "c06-1",
          targetItemId: "c06-2",
          type: "depends_on",
          confidence: "high",
          reason: "Frenada por credenciales",
        },
        {
          sourceItemId: "c06-1",
          targetItemId: "c06-3",
          type: "same_project",
          confidence: "high",
          reason: "Mismo proyecto",
        },
      ],
      groupedWork: {
        groups: [
          {
            id: "group-tienda-online",
            title: "Desarrollo de la tienda online",
            itemIds: ["c06-1", "c06-3"],
            rationale: "Mismo proyecto",
          },
        ],
        ungroupedItemIds: ["c06-2"],
      },
      deadlines: { deadlines: [] },
    };

    const result = await evaluateContext(provider, input);
    const iaStripe = result.itemAssessments.find((ia) => ia.itemId === "c06-1");
    const iaThanks = result.itemAssessments.find((ia) => ia.itemId === "c06-3");
    const iaConcern = result.itemAssessments.find((ia) => ia.itemId === "c06-2");

    expect(iaStripe?.signals).toContain("waiting");
    expect(iaStripe?.signals).toContain("dependency");
    expect(iaThanks?.signals).not.toContain("waiting");
    expect(iaConcern?.signals).not.toContain("waiting");

    // Generates open question for external unblocking
    expect(result.openQuestions).toHaveLength(1);
    expect(result.openQuestions[0].relatedItemIds).toContain("c06-1");
  });

  // 22. Regresión Caso 12: part_of no debe generar señal de dependency causal
  it("Scenario 22 (Calibration Case 12): part_of expresses composition, not causal dependency signal", async () => {
    const provider = new MockProvider();
    const input: EvaluateContextInput = {
      currentDate: baseDate,
      items: [
        {
          id: "c12-1",
          rawText: "lanzar la beta cerrada de la app en noviembre",
          title: "Lanzamiento beta cerrada",
          type: "project",
          status: "started",
        },
        {
          id: "c12-2",
          rawText: "testing de usuarios",
          title: "Testing con usuarios",
          type: "task",
          status: "pending",
        },
      ],
      relationships: [
        {
          sourceItemId: "c12-2",
          targetItemId: "c12-1",
          type: "part_of",
          confidence: "high",
          reason: "Testing es parte del lanzamiento",
        },
      ],
      groupedWork: {
        groups: [
          {
            id: "group-lanzamiento-beta",
            title: "Lanzamiento beta cerrada",
            itemIds: ["c12-1", "c12-2"],
            rationale: "Constitutiva",
          },
        ],
        ungroupedItemIds: [],
      },
      deadlines: { deadlines: [] },
    };

    const result = await evaluateContext(provider, input);
    const ia1 = result.itemAssessments.find((ia) => ia.itemId === "c12-1");
    const ia2 = result.itemAssessments.find((ia) => ia.itemId === "c12-2");

    // None have dependency signal because part_of != depends_on
    expect(ia1?.signals).not.toContain("dependency");
    expect(ia2?.signals).not.toContain("dependency");
  });

  // 23. Regresión Caso 18: Conservación del estado archivado y rationale explícito
  it("Scenario 23 (Calibration Case 18): archived items retain low attention and non-actionable rationale", async () => {
    const provider = new MockProvider();
    const input: EvaluateContextInput = {
      currentDate: baseDate,
      items: [
        {
          id: "c18-1",
          rawText: "decidimos no hacer la integración con Discord por ahora. Queda archivada",
          title: "Integración con Discord archivada conscientemente",
          type: "idea",
          status: "archived",
        },
      ],
      relationships: [],
      groupedWork: { groups: [], ungroupedItemIds: ["c18-1"] },
      deadlines: { deadlines: [] },
    };

    const result = await evaluateContext(provider, input);
    const ia = result.itemAssessments[0];
    expect(ia.itemId).toBe("c18-1");
    expect(ia.attention).toBe("low");
    expect(ia.rationale.toLowerCase()).toContain("archivado");
  });

  // 24. Regresión Caso 22: Plazo próximo en actividad expresamente opcional no eleva a HIGH
  it("Scenario 24 (Calibration Case 22): approaching_deadline on optional idea preserves LOW attention", async () => {
    const provider = new MockProvider();
    const input: EvaluateContextInput = {
      currentDate: baseDate,
      items: [
        {
          id: "c22-1",
          rawText: "Cambiarle las cuerdas a la guitarra este finde si tengo un rato",
          title: "Cambiar cuerdas de la guitarra",
          type: "idea",
          status: "exploring",
        },
      ],
      relationships: [],
      groupedWork: { groups: [], ungroupedItemIds: ["c22-1"] },
      deadlines: {
        deadlines: [
          {
            itemId: "c22-1",
            raw: "este finde",
            kind: "date_range",
            resolvedStart: "2026-10-10",
            resolvedEnd: "2026-10-11",
            confidence: "high",
          },
        ],
      },
    };

    const result = await evaluateContext(provider, input);
    const ia = result.itemAssessments[0];
    expect(ia.itemId).toBe("c22-1");
    expect(ia.signals).toContain("approaching_deadline");
    expect(ia.attention).toBe("low");
  });

  // 25. Regresión: waiting no es una penalización automática; si hay plazo inminente o compromiso, conserva atención alta
  it("Scenario 25: waiting signal does not automatically downgrade attention if approaching deadline exists", async () => {
    const provider = new MockProvider();
    const input: EvaluateContextInput = {
      currentDate: baseDate,
      items: [
        {
          id: "item-blocked-urgent",
          rawText: "Despliegue crítico en producción frenado a la espera de credenciales del cliente",
          title: "Despliegue crítico producción",
          type: "task",
          status: "started",
          importance: "high",
        },
      ],
      relationships: [],
      groupedWork: { groups: [], ungroupedItemIds: ["item-blocked-urgent"] },
      deadlines: {
        deadlines: [
          {
            itemId: "item-blocked-urgent",
            raw: "mañana",
            kind: "relative_date",
            resolvedStart: "2026-10-10",
            resolvedEnd: null,
            confidence: "high",
          },
        ],
      },
    };

    const result = await evaluateContext(provider, input);
    const ia = result.itemAssessments[0];
    expect(ia.signals).toContain("waiting");
    expect(ia.signals).toContain("approaching_deadline");
    expect(ia.signals).toContain("explicit_importance");
    // Remains HIGH because urgency and gravity are acute, waiting is a context descriptor
    expect(ia.attention).toBe("high");
  });

  describe("Dependency signal guardrails (Code before AI)", () => {
    const defaultInput: EvaluateContextInput = {
      currentDate: baseDate,
      items: [
        { id: "i1", title: "Task 1", rawText: "Task 1", type: "task" },
        { id: "i2", title: "Task 2", rawText: "Task 2", type: "task" },
      ],
      relationships: [],
      groupedWork: { groups: [], ungroupedItemIds: ["i1", "i2"] },
      deadlines: { deadlines: [] },
    };

    it("strips dependency signal when relationship is only part_of without depends_on", () => {
      const input: EvaluateContextInput = {
        ...defaultInput,
        relationships: [
          { sourceItemId: "i1", targetItemId: "i2", type: "part_of", confidence: "high", reason: "i1 is part of i2" },
        ],
      };
      const rawOutput = {
        itemAssessments: [
          { itemId: "i1", attention: "medium" as const, signals: ["dependency" as const], rationale: "Part of i2" },
          { itemId: "i2", attention: "medium" as const, signals: [], rationale: "Parent task" },
        ],
        groupAssessments: [],
        openQuestions: [],
      };
      const cleaned = cleanAndValidateContextOutput(rawOutput, input);
      expect(cleaned.itemAssessments.find((ia) => ia.itemId === "i1")?.signals).not.toContain("dependency");
    });

    it("strips dependency signal when relationship is only related_to without depends_on", () => {
      const input: EvaluateContextInput = {
        ...defaultInput,
        relationships: [
          { sourceItemId: "i1", targetItemId: "i2", type: "related_to", confidence: "high", reason: "similar tasks" },
        ],
      };
      const rawOutput = {
        itemAssessments: [
          { itemId: "i1", attention: "medium" as const, signals: ["dependency" as const], rationale: "Related" },
          { itemId: "i2", attention: "medium" as const, signals: ["dependency" as const], rationale: "Related" },
        ],
        groupAssessments: [],
        openQuestions: [],
      };
      const cleaned = cleanAndValidateContextOutput(rawOutput, input);
      expect(cleaned.itemAssessments.find((ia) => ia.itemId === "i1")?.signals).not.toContain("dependency");
      expect(cleaned.itemAssessments.find((ia) => ia.itemId === "i2")?.signals).not.toContain("dependency");
    });

    it("strips dependency signal when relationship is only same_project without depends_on", () => {
      const input: EvaluateContextInput = {
        ...defaultInput,
        relationships: [
          { sourceItemId: "i1", targetItemId: "i2", type: "same_project", confidence: "high", reason: "same project" },
        ],
      };
      const rawOutput = {
        itemAssessments: [
          { itemId: "i1", attention: "medium" as const, signals: ["dependency" as const], rationale: "Same project" },
          { itemId: "i2", attention: "medium" as const, signals: [], rationale: "Same project" },
        ],
        groupAssessments: [],
        openQuestions: [],
      };
      const cleaned = cleanAndValidateContextOutput(rawOutput, input);
      expect(cleaned.itemAssessments.find((ia) => ia.itemId === "i1")?.signals).not.toContain("dependency");
    });

    it("preserves dependency signal when explicit depends_on relationship exists for backed items", () => {
      const input: EvaluateContextInput = {
        ...defaultInput,
        relationships: [
          { sourceItemId: "i1", targetItemId: "i2", type: "depends_on", confidence: "high", reason: "i1 depends on i2" },
        ],
      };
      const rawOutput = {
        itemAssessments: [
          { itemId: "i1", attention: "medium" as const, signals: ["dependency" as const], rationale: "Depends on i2" },
          { itemId: "i2", attention: "medium" as const, signals: ["dependency" as const], rationale: "Blocks i1" },
        ],
        groupAssessments: [],
        openQuestions: [],
      };
      const cleaned = cleanAndValidateContextOutput(rawOutput, input);
      expect(cleaned.itemAssessments.find((ia) => ia.itemId === "i1")?.signals).toContain("dependency");
      expect(cleaned.itemAssessments.find((ia) => ia.itemId === "i2")?.signals).toContain("dependency");
    });

    it("stripping dependency does not remove other valid signals or alter attention level", () => {
      const input: EvaluateContextInput = {
        ...defaultInput,
        relationships: [
          { sourceItemId: "i1", targetItemId: "i2", type: "part_of", confidence: "high", reason: "part of" },
        ],
      };
      const rawOutput = {
        itemAssessments: [
          {
            itemId: "i1",
            attention: "high" as const,
            signals: ["already_started" as const, "dependency" as const, "explicit_importance" as const],
            rationale: "Important and started",
          },
          { itemId: "i2", attention: "medium" as const, signals: [], rationale: "Parent" },
        ],
        groupAssessments: [],
        openQuestions: [],
      };
      const cleaned = cleanAndValidateContextOutput(rawOutput, input);
      const ia1 = cleaned.itemAssessments.find((ia) => ia.itemId === "i1");
      expect(ia1?.signals).not.toContain("dependency");
      expect(ia1?.signals).toContain("already_started");
      expect(ia1?.signals).toContain("explicit_importance");
      expect(ia1?.attention).toBe("high");
      expect(ia1?.rationale).toBe("Important and started");
    });

    it("relationships with invalid item IDs do not justify dependency signals", () => {
      const input: EvaluateContextInput = {
        ...defaultInput,
        relationships: [
          { sourceItemId: "i1", targetItemId: "non-existent-id", type: "depends_on", confidence: "high", reason: "invalid target" },
        ],
      };
      const rawOutput = {
        itemAssessments: [
          { itemId: "i1", attention: "medium" as const, signals: ["dependency" as const], rationale: "Depends on phantom" },
          { itemId: "i2", attention: "medium" as const, signals: [], rationale: "Task 2" },
        ],
        groupAssessments: [],
        openQuestions: [],
      };
      const cleaned = cleanAndValidateContextOutput(rawOutput, input);
      expect(cleaned.itemAssessments.find((ia) => ia.itemId === "i1")?.signals).not.toContain("dependency");
    });
  });
});
