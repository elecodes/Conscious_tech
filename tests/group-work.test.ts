import { describe, it, expect } from "vitest";
import { MockProvider } from "../src/providers/mock-provider";
import { groupWork, GroupWorkService } from "../src/skills/group-work";
import { ExtractedItem } from "../src/domain/items";
import { Relationship } from "../src/domain/relationships";
import { validateGroupWorkInvariants } from "../src/skills/group-work/deterministic";
import mockCasesData from "../cases/mock-extractions.json";
import mockRelationshipsData from "../cases/mock-relationships.json";

describe("Skill 03: group_work - Unit & Behavioral Test Suite", () => {
  // 1. Dos items same_project → un grupo
  it("1. Dos items same_project → un grupo", async () => {
    const items: ExtractedItem[] = [
      { id: "arch-1", rawText: "Revisar auth", title: "Revisar autenticación", type: "task", project: "ArchitectAI" },
      { id: "arch-2", rawText: "Docs", title: "Preparar documentación", type: "task", project: "ArchitectAI" },
    ];
    const relationships: Relationship[] = [
      {
        sourceItemId: "arch-1",
        targetItemId: "arch-2",
        type: "same_project",
        confidence: "high",
        reason: "Ambos elementos pertenecen al proyecto ArchitectAI",
      },
    ];

    const provider = new MockProvider();
    provider.setGroupWorkHandler(async () => ({
      groups: [
        {
          id: "g-arch",
          title: "Desarrollo de ArchitectAI",
          itemIds: ["arch-1", "arch-2"],
          rationale: "Ambas tareas avanzan en el proyecto ArchitectAI",
        },
      ],
      ungroupedItemIds: [],
    }));

    const result = await groupWork(provider, { items, relationships });
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]?.itemIds).toEqual(["arch-1", "arch-2"]);
    expect(result.ungroupedItemIds).toEqual([]);
    expect(validateGroupWorkInvariants(result, items).valid).toBe(true);
  });

  // 2. Dos items same_objective → un grupo
  it("2. Dos items same_objective → un grupo", async () => {
    const items: ExtractedItem[] = [
      { id: "tax-1", rawText: "Facturas", title: "Juntar facturas del trimestre", type: "task" },
      { id: "tax-2", rawText: "Modelo 303", title: "Presentar modelo 303", type: "task" },
    ];
    const relationships: Relationship[] = [
      {
        sourceItemId: "tax-1",
        targetItemId: "tax-2",
        type: "same_objective",
        confidence: "high",
        reason: "Ambas tareas persiguen el cierre fiscal del trimestre",
      },
    ];

    const provider = new MockProvider();
    provider.setGroupWorkHandler(async () => ({
      groups: [
        {
          id: "g-fiscal",
          title: "Cierre fiscal del trimestre",
          itemIds: ["tax-1", "tax-2"],
          rationale: "Ambas tareas apuntan directamente al objetivo de presentación tributaria",
        },
      ],
      ungroupedItemIds: [],
    }));

    const result = await groupWork(provider, { items, relationships });
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]?.itemIds).toEqual(["tax-1", "tax-2"]);
    expect(validateGroupWorkInvariants(result, items).valid).toBe(true);
  });

  // 3. part_of → grupo coherente
  it("3. part_of → grupo coherente", async () => {
    const items: ExtractedItem[] = [
      { id: "beta-main", rawText: "Lanzar beta", title: "Lanzar beta cerrada", type: "project" },
      { id: "beta-sub1", rawText: "Testing", title: "Testing de usuarios", type: "task" },
      { id: "beta-sub2", rawText: "Onboarding", title: "Pulir onboarding", type: "task" },
    ];
    const relationships: Relationship[] = [
      {
        sourceItemId: "beta-sub1",
        targetItemId: "beta-main",
        type: "part_of",
        confidence: "high",
        reason: "Subtarea constitutiva de la beta",
      },
      {
        sourceItemId: "beta-sub2",
        targetItemId: "beta-main",
        type: "part_of",
        confidence: "high",
        reason: "Subtarea preparatoria de la beta",
      },
    ];

    const provider = new MockProvider();
    provider.setGroupWorkHandler(async () => ({
      groups: [
        {
          id: "g-beta",
          title: "Lanzamiento beta cerrada",
          itemIds: ["beta-main", "beta-sub1", "beta-sub2"],
          rationale: "Las subtareas forman parte constitutiva del hito de lanzamiento de la beta",
        },
      ],
      ungroupedItemIds: [],
    }));

    const result = await groupWork(provider, { items, relationships });
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]?.itemIds).toHaveLength(3);
    expect(validateGroupWorkInvariants(result, items).valid).toBe(true);
  });

  // 4. depends_on por sí sola no obliga a agrupar
  it("4. depends_on por sí sola no obliga a agrupar", async () => {
    const items: ExtractedItem[] = [
      { id: "budget-1", rawText: "Enviar presupuesto", title: "Enviar presupuesto a Lucía", type: "task" },
      { id: "call-1", rawText: "Hablar con Pablo", title: "Hablar con Pablo sobre estrategia", type: "task" },
    ];
    const relationships: Relationship[] = [
      {
        sourceItemId: "budget-1",
        targetItemId: "call-1",
        type: "depends_on",
        confidence: "high",
        reason: "Mandar el presupuesto se hará después de hablar con Pablo",
      },
    ];

    const provider = new MockProvider();
    // The provider evaluates that talking to Pablo is a general chat while budget is an operational quote,
    // so they do not form a single forced line of work
    provider.setGroupWorkHandler(async () => ({
      groups: [],
      ungroupedItemIds: ["budget-1", "call-1"],
    }));

    const result = await groupWork(provider, { items, relationships });
    expect(result.groups).toHaveLength(0);
    expect(result.ungroupedItemIds).toEqual(["budget-1", "call-1"]);
    expect(validateGroupWorkInvariants(result, items).valid).toBe(true);
  });

  // 5. related_to fuerte → puede agrupar
  it("5. related_to fuerte → puede agrupar", async () => {
    const items: ExtractedItem[] = [
      { id: "ai-1", rawText: "GGUF", title: "Lectura modelos GGUF", type: "idea" },
      { id: "ai-2", rawText: "WebGPU", title: "Evaluación WebGPU en cliente", type: "idea" },
      { id: "ai-3", rawText: "Prototipo", title: "Probar prototipo en local", type: "idea" },
    ];
    const relationships: Relationship[] = [
      { sourceItemId: "ai-1", targetItemId: "ai-2", type: "related_to", confidence: "high", reason: "Exploraciones técnicas conectadas" },
      { sourceItemId: "ai-2", targetItemId: "ai-3", type: "related_to", confidence: "high", reason: "El prototipo surge de la evaluación" },
    ];

    const provider = new MockProvider();
    provider.setGroupWorkHandler(async () => ({
      groups: [
        {
          id: "g-ai",
          title: "Exploración de IA local",
          itemIds: ["ai-1", "ai-2", "ai-3"],
          rationale: "Constituyen un hilo coherente de exploración de modelos locales en el cliente",
        },
      ],
      ungroupedItemIds: [],
    }));

    const result = await groupWork(provider, { items, relationships });
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]?.title).toBe("Exploración de IA local");
    expect(validateGroupWorkInvariants(result, items).valid).toBe(true);
  });

  // 6. related_to débil → puede permanecer separado
  it("6. related_to débil → puede permanecer separado", async () => {
    const items: ExtractedItem[] = [
      { id: "task-a", rawText: "Revisar diseño de pantalla", title: "Diseño pantalla registro", type: "task" },
      { id: "task-b", rawText: "Actualizar tipografías del blog", title: "Tipografías del blog", type: "task" },
    ];
    const relationships: Relationship[] = [
      {
        sourceItemId: "task-a",
        targetItemId: "task-b",
        type: "related_to",
        confidence: "low",
        reason: "Ambos tocan aspecto visual general pero en áreas desacopladas",
      },
    ];

    const provider = new MockProvider();
    provider.setGroupWorkHandler(async () => ({
      groups: [],
      ungroupedItemIds: ["task-a", "task-b"],
    }));

    const result = await groupWork(provider, { items, relationships });
    expect(result.groups).toHaveLength(0);
    expect(result.ungroupedItemIds).toContain("task-a");
    expect(result.ungroupedItemIds).toContain("task-b");
    expect(validateGroupWorkInvariants(result, items).valid).toBe(true);
  });

  // 7. Items independientes → ungroupedItemIds
  it("7. Items independientes → ungroupedItemIds (deterministic short-circuit)", async () => {
    const items: ExtractedItem[] = [
      { id: "item-1", rawText: "Cambiar cuerdas guitarra", title: "Cambiar cuerdas guitarra", type: "task" },
      { id: "item-2", rawText: "Renovar dominio", title: "Renovar dominio web", type: "task" },
    ];
    const relationships: Relationship[] = [];

    const provider = new MockProvider();
    // When relationships are empty, service short-circuits deterministically without invoking provider
    const result = await groupWork(provider, { items, relationships });
    expect(result.groups).toHaveLength(0);
    expect(result.ungroupedItemIds).toEqual(["item-1", "item-2"]);
    expect(validateGroupWorkInvariants(result, items).valid).toBe(true);
  });

  // 8. Cadena de relaciones coherente → un único grupo cuando corresponda
  it("8. Cadena de relaciones coherente → un único grupo cuando corresponda", async () => {
    const items: ExtractedItem[] = [
      { id: "c-1", rawText: "Paso 1", title: "Revisar arquitectura base", type: "task" },
      { id: "c-2", rawText: "Paso 2", title: "Implementar adapters", type: "task" },
      { id: "c-3", rawText: "Paso 3", title: "Escribir tests de integración", type: "task" },
    ];
    const relationships: Relationship[] = [
      { sourceItemId: "c-1", targetItemId: "c-2", type: "same_project", confidence: "high", reason: "Mismo proyecto" },
      { sourceItemId: "c-2", targetItemId: "c-3", type: "same_project", confidence: "high", reason: "Mismo proyecto" },
    ];

    const provider = new MockProvider();
    provider.setGroupWorkHandler(async () => ({
      groups: [
        {
          id: "g-arch",
          title: "Refactor de arquitectura hexagonal",
          itemIds: ["c-1", "c-2", "c-3"],
          rationale: "Encadenamiento coherente de pasos hacia la refactorización arquitectónica",
        },
      ],
      ungroupedItemIds: [],
    }));

    const result = await groupWork(provider, { items, relationships });
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]?.itemIds).toEqual(["c-1", "c-2", "c-3"]);
    expect(validateGroupWorkInvariants(result, items).valid).toBe(true);
  });

  // 9. Dos líneas independientes → dos grupos
  it("9. Dos líneas independientes → dos grupos", async () => {
    const items: ExtractedItem[] = [
      { id: "p1-a", rawText: "a", title: "Testing beta", type: "task" },
      { id: "p1-b", rawText: "b", title: "Deploy beta", type: "task" },
      { id: "p2-a", rawText: "c", title: "Facturas trimestre", type: "task" },
      { id: "p2-b", rawText: "d", title: "Declaración impuestos", type: "task" },
    ];
    const relationships: Relationship[] = [
      { sourceItemId: "p1-a", targetItemId: "p1-b", type: "same_project", confidence: "high", reason: "Beta" },
      { sourceItemId: "p2-a", targetItemId: "p2-b", type: "same_objective", confidence: "high", reason: "Fiscal" },
    ];

    const provider = new MockProvider();
    provider.setGroupWorkHandler(async () => ({
      groups: [
        { id: "g-1", title: "Lanzamiento beta", itemIds: ["p1-a", "p1-b"], rationale: "Tareas de la beta" },
        { id: "g-2", title: "Cierre fiscal", itemIds: ["p2-a", "p2-b"], rationale: "Tareas fiscales" },
      ],
      ungroupedItemIds: [],
    }));

    const result = await groupWork(provider, { items, relationships });
    expect(result.groups).toHaveLength(2);
    expect(result.groups[0]?.title).toBe("Lanzamiento beta");
    expect(result.groups[1]?.title).toBe("Cierre fiscal");
    expect(validateGroupWorkInvariants(result, items).valid).toBe(true);
  });

  // 10. Proyecto con varias tareas → un grupo
  it("10. Proyecto con varias tareas → un grupo", async () => {
    const items: ExtractedItem[] = [
      { id: "t-1", rawText: "t1", title: "Diseñar schema", type: "task", project: "Tienda" },
      { id: "t-2", rawText: "t2", title: "Configurar Stripe", type: "task", project: "Tienda" },
      { id: "t-3", rawText: "t3", title: "Checkout UI", type: "task", project: "Tienda" },
    ];
    const relationships: Relationship[] = [
      { sourceItemId: "t-1", targetItemId: "t-2", type: "same_project", confidence: "high", reason: "Tienda" },
      { sourceItemId: "t-2", targetItemId: "t-3", type: "same_project", confidence: "high", reason: "Tienda" },
    ];

    const provider = new MockProvider();
    provider.setGroupWorkHandler(async () => ({
      groups: [
        {
          id: "g-tienda",
          title: "Desarrollo de checkout en Tienda",
          itemIds: ["t-1", "t-2", "t-3"],
          rationale: "Múltiples tareas operativas del mismo proyecto",
        },
      ],
      ungroupedItemIds: [],
    }));

    const result = await groupWork(provider, { items, relationships });
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]?.itemIds).toEqual(["t-1", "t-2", "t-3"]);
    expect(validateGroupWorkInvariants(result, items).valid).toBe(true);
  });

  // 11. concern aislado → no contamina otros grupos
  it("11. concern aislado → no contamina otros grupos", async () => {
    const items: ExtractedItem[] = [
      { id: "c-concern", rawText: "Agobio por plazos", title: "Sensación de agobio", type: "concern" },
      { id: "t-1", rawText: "Hacer informe", title: "Informe trimestral", type: "task" },
      { id: "t-2", rawText: "Enviar informe", title: "Enviar informe", type: "task" },
    ];
    const relationships: Relationship[] = [
      { sourceItemId: "t-1", targetItemId: "t-2", type: "same_objective", confidence: "high", reason: "Informe" },
    ];

    const provider = new MockProvider();
    provider.setGroupWorkHandler(async () => ({
      groups: [
        {
          id: "g-informe",
          title: "Preparación y entrega de informe",
          itemIds: ["t-1", "t-2"],
          rationale: "Tareas operativas del informe",
        },
      ],
      ungroupedItemIds: ["c-concern"],
    }));

    const result = await groupWork(provider, { items, relationships });
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]?.itemIds).not.toContain("c-concern");
    expect(result.ungroupedItemIds).toContain("c-concern");
    expect(validateGroupWorkInvariants(result, items).valid).toBe(true);
  });

  // 12. Ideas exploratorias → no agrupar salvo coherencia clara
  it("12. Ideas exploratorias → no agrupar salvo coherencia clara", async () => {
    const items: ExtractedItem[] = [
      { id: "idea-1", rawText: "Aprender Rust", title: "Mirar tutoriales de Rust", type: "idea" },
      { id: "idea-2", rawText: "Comprar sintetizador", title: "Evaluar sintetizadores analógicos", type: "idea" },
    ];
    const relationships: Relationship[] = [];

    const provider = new MockProvider();
    const result = await groupWork(provider, { items, relationships });
    expect(result.groups).toHaveLength(0);
    expect(result.ungroupedItemIds).toEqual(["idea-1", "idea-2"]);
    expect(validateGroupWorkInvariants(result, items).valid).toBe(true);
  });

  // 13. No se pueden inventar IDs
  it("13. No se pueden inventar IDs (deterministic engine strips phantoms)", async () => {
    const items: ExtractedItem[] = [
      { id: "valid-1", rawText: "v1", title: "Tarea 1", type: "task" },
      { id: "valid-2", rawText: "v2", title: "Tarea 2", type: "task" },
    ];
    const relationships: Relationship[] = [
      { sourceItemId: "valid-1", targetItemId: "valid-2", type: "same_project", confidence: "high", reason: "test" },
    ];

    const provider = new MockProvider();
    provider.setGroupWorkHandler(async () => ({
      groups: [
        {
          id: "g-1",
          title: "Línea con ID inventado",
          itemIds: ["valid-1", "valid-2", "phantom-invented-99"],
          rationale: "Vínculo",
        },
      ],
      ungroupedItemIds: ["phantom-ungrouped-100"],
    }));

    const result = await groupWork(provider, { items, relationships });
    expect(result.groups[0]?.itemIds).toEqual(["valid-1", "valid-2"]);
    expect(result.ungroupedItemIds).toEqual([]);
    expect(validateGroupWorkInvariants(result, items).valid).toBe(true);
  });

  // 14. No se pueden perder items
  it("14. No se pueden perder items (conservation guarantees missing items become ungrouped)", async () => {
    const items: ExtractedItem[] = [
      { id: "i-1", rawText: "1", title: "T1", type: "task" },
      { id: "i-2", rawText: "2", title: "T2", type: "task" },
      { id: "i-3", rawText: "3", title: "T3", type: "task" },
      { id: "i-4", rawText: "4", title: "T4", type: "task" },
    ];
    const relationships: Relationship[] = [
      { sourceItemId: "i-1", targetItemId: "i-2", type: "same_project", confidence: "high", reason: "test" },
    ];

    const provider = new MockProvider();
    // LLM forgot i-3 and i-4 completely
    provider.setGroupWorkHandler(async () => ({
      groups: [
        { id: "g-1", title: "Grupo 1", itemIds: ["i-1", "i-2"], rationale: "Motivo" },
      ],
      ungroupedItemIds: [],
    }));

    const result = await groupWork(provider, { items, relationships });
    expect(result.groups).toHaveLength(1);
    expect(result.ungroupedItemIds).toEqual(["i-3", "i-4"]);
    expect(validateGroupWorkInvariants(result, items).valid).toBe(true);
  });

  // 15. Ningún item puede aparecer en dos grupos
  it("15. Ningún item puede aparecer en dos grupos (first group claims it, subsequent group keeps only non-duplicates)", async () => {
    const items: ExtractedItem[] = [
      { id: "item-1", rawText: "1", title: "T1", type: "task" },
      { id: "item-2", rawText: "2", title: "T2", type: "task" },
      { id: "item-3", rawText: "3", title: "T3", type: "task" },
      { id: "item-4", rawText: "4", title: "T4", type: "task" },
    ];
    const relationships: Relationship[] = [
      { sourceItemId: "item-1", targetItemId: "item-2", type: "same_project", confidence: "high", reason: "r1" },
      { sourceItemId: "item-3", targetItemId: "item-4", type: "same_project", confidence: "high", reason: "r2" },
    ];

    const provider = new MockProvider();
    // LLM mistakenly placed item-2 in both groups
    provider.setGroupWorkHandler(async () => ({
      groups: [
        { id: "g-1", title: "Grupo A", itemIds: ["item-1", "item-2"], rationale: "Motivo A" },
        { id: "g-2", title: "Grupo B", itemIds: ["item-2", "item-3", "item-4"], rationale: "Motivo B" },
      ],
      ungroupedItemIds: [],
    }));

    const result = await groupWork(provider, { items, relationships });
    expect(result.groups).toHaveLength(2);
    expect(result.groups[0]?.itemIds).toEqual(["item-1", "item-2"]);
    // item-2 stripped from g-2, leaving item-3 and item-4
    expect(result.groups[1]?.itemIds).toEqual(["item-3", "item-4"]);
    expect(validateGroupWorkInvariants(result, items).valid).toBe(true);
  });

  // Service Retry Recovery
  it("Service retries when initial call fails schema validation", async () => {
    const items: ExtractedItem[] = [
      { id: "t-1", rawText: "t1", title: "T1", type: "task" },
      { id: "t-2", rawText: "t2", title: "T2", type: "task" },
    ];
    const relationships: Relationship[] = [
      { sourceItemId: "t-1", targetItemId: "t-2", type: "same_project", confidence: "high", reason: "test" },
    ];

    let callCount = 0;
    const provider = new MockProvider();
    provider.setGroupWorkHandler(async () => {
      callCount++;
      if (callCount === 1) {
        // Violates schema (empty title)
        return {
          groups: [
            { id: "g-1", title: "", itemIds: ["t-1", "t-2"], rationale: "r" },
          ],
          ungroupedItemIds: [],
        };
      }
      return {
        groups: [
          { id: "g-1", title: "Línea válida tras retry", itemIds: ["t-1", "t-2"], rationale: "r" },
        ],
        ungroupedItemIds: [],
      };
    });

    const service = new GroupWorkService(provider, { maxRetries: 1 });
    const result = await service.execute({ items, relationships });
    expect(callCount).toBe(2);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]?.title).toBe("Línea válida tras retry");
  });

  // Real Case: Caso 12 (Beta) with mock data
  it("Real Case: Caso 12 groups 5 constituent items into one 'Lanzamiento beta cerrada' group", async () => {
    const case12Items = mockCasesData["case-12"]!.items as ExtractedItem[];
    const case12Rels = mockRelationshipsData["case-12"]!.relationships as Relationship[];

    const provider = new MockProvider();
    const result = await groupWork(provider, { items: case12Items, relationships: case12Rels });

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]?.title).toBe("Lanzamiento beta cerrada");
    expect(result.groups[0]?.itemIds).toHaveLength(5);
    expect(result.ungroupedItemIds).toHaveLength(0);
    expect(validateGroupWorkInvariants(result, case12Items).valid).toBe(true);
  });

  // Real Case: Caso 20 (Conscious Tech) with concern isolation
  it("Real Case: Caso 20 isolates concern into ungroupedItemIds and groups motor tasks", async () => {
    const case20Items = mockCasesData["case-20"]!.items as ExtractedItem[];
    const case20Rels = mockRelationshipsData["case-20"]!.relationships as Relationship[];

    const provider = new MockProvider();
    const result = await groupWork(provider, { items: case20Items, relationships: case20Rels });

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]?.itemIds).toEqual(["c20-1", "c20-3"]);
    expect(result.ungroupedItemIds).toEqual(["c20-2"]);
    expect(validateGroupWorkInvariants(result, case20Items).valid).toBe(true);
  });
});
