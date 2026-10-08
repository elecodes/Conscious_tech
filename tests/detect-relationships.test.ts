import { describe, it, expect } from "vitest";
import { MockProvider } from "../src/providers/mock-provider";
import { detectRelationships, DetectRelationshipsService } from "../src/skills/detect-relationships";
import { ExtractedItem } from "../src/domain/items";
import mockCasesData from "../cases/mock-extractions.json";

describe("Skill 02: detect_relationships - Behavioral & Minimum Test Suite", () => {
  // 1. Empty input
  it("1. Empty input: returns empty relationships without calling provider", async () => {
    let providerCalled = false;
    const provider = new MockProvider();
    provider.setRelationshipsHandler(async () => {
      providerCalled = true;
      return { relationships: [] };
    });

    const result = await detectRelationships(provider, { items: [] });
    expect(result.relationships).toEqual([]);
    expect(providerCalled).toBe(false);
  });

  // 2. One item
  it("2. One item: cannot have self-relations, short-circuits to empty array", async () => {
    let providerCalled = false;
    const provider = new MockProvider();
    provider.setRelationshipsHandler(async () => {
      providerCalled = true;
      return { relationships: [] };
    });

    const items: ExtractedItem[] = [
      { id: "item-1", rawText: "una sola tarea", title: "Tarea solitaria", type: "task" },
    ];
    const result = await detectRelationships(provider, { items });
    expect(result.relationships).toEqual([]);
    expect(providerCalled).toBe(false);
  });

  // 3. Same objective
  it("3. Same objective: detects same_objective when two items pursue the same concrete goal", async () => {
    const items: ExtractedItem[] = [
      { id: "solid-1", rawText: "Estudiar principios SOLID en profundidad", title: "Estudiar SOLID", type: "task" },
      { id: "solid-2", rawText: "Aplicar principios SOLID a la arquitectura de ArchitectAI", title: "Aplicar SOLID a ArchitectAI", type: "task" },
    ];
    const provider = new MockProvider();
    provider.setRelationshipsHandler(async () => ({
      relationships: [
        {
          sourceItemId: "solid-1",
          targetItemId: "solid-2",
          type: "same_objective",
          confidence: "high",
          reason: "Ambos elementos persiguen concretamente dominar y materializar la arquitectura SOLID",
        },
      ],
    }));

    const result = await detectRelationships(provider, { items });
    expect(result.relationships).toHaveLength(1);
    expect(result.relationships[0]?.type).toBe("same_objective");
    expect(result.relationships[0]?.confidence).toBe("high");
  });

  // 4. Same project
  it("4. Same project: detects same_project for items in the same product/initiative", async () => {
    const items: ExtractedItem[] = [
      { id: "arch-1", rawText: "Revisar autenticación de ArchitectAI", title: "Revisar autenticación", type: "task", project: "ArchitectAI" },
      { id: "arch-2", rawText: "Preparar documentación de ArchitectAI", title: "Preparar documentación", type: "task", project: "ArchitectAI" },
    ];
    const provider = new MockProvider();
    provider.setRelationshipsHandler(async () => ({
      relationships: [
        {
          sourceItemId: "arch-1",
          targetItemId: "arch-2",
          type: "same_project",
          confidence: "high",
          reason: "Ambos pertenecen claramente al proyecto ArchitectAI",
        },
      ],
    }));

    const result = await detectRelationships(provider, { items });
    expect(result.relationships).toHaveLength(1);
    expect(result.relationships[0]?.type).toBe("same_project");
  });

  // 5. Part of
  it("5. Part of: detects part_of with correct direction (source = subtarea, target = entregable)", async () => {
    const items: ExtractedItem[] = [
      { id: "slides-1", rawText: "Preparar las diapositivas de la presentación", title: "Preparar diapositivas", type: "task" },
      { id: "class-1", rawText: "Preparar la clase de Cibervoluntarios del martes", title: "Preparar clase Cibervoluntarios", type: "commitment" },
    ];
    const provider = new MockProvider();
    provider.setRelationshipsHandler(async () => ({
      relationships: [
        {
          sourceItemId: "slides-1",
          targetItemId: "class-1",
          type: "part_of",
          confidence: "high",
          reason: "Las diapositivas son una parte constitutiva de la preparación de la clase",
        },
      ],
    }));

    const result = await detectRelationships(provider, { items });
    expect(result.relationships).toHaveLength(1);
    expect(result.relationships[0]?.sourceItemId).toBe("slides-1");
    expect(result.relationships[0]?.targetItemId).toBe("class-1");
    expect(result.relationships[0]?.type).toBe("part_of");
  });

  // 6. Dependency
  it("6. Dependency: detects depends_on with correct direction (webhook depends_on credentials)", async () => {
    const items: ExtractedItem[] = [
      { id: "stripe-webhook", rawText: "Configurar webhook de Stripe en la tienda", title: "Configurar webhook Stripe", type: "task" },
      { id: "stripe-creds", rawText: "Conseguir las credenciales de webhook de Stripe del cliente", title: "Conseguir credenciales Stripe", type: "task" },
    ];
    const provider = new MockProvider();
    provider.setRelationshipsHandler(async () => ({
      relationships: [
        {
          sourceItemId: "stripe-webhook",
          targetItemId: "stripe-creds",
          type: "depends_on",
          confidence: "high",
          reason: "El webhook necesita las credenciales de Stripe para poder configurarse",
        },
      ],
    }));

    const result = await detectRelationships(provider, { items });
    expect(result.relationships).toHaveLength(1);
    expect(result.relationships[0]?.sourceItemId).toBe("stripe-webhook");
    expect(result.relationships[0]?.targetItemId).toBe("stripe-creds");
    expect(result.relationships[0]?.type).toBe("depends_on");
  });

  // 7. No false dependency
  it("7. No false dependency: related items without causal link do not produce depends_on", async () => {
    const items: ExtractedItem[] = [
      { id: "task-a", rawText: "Escribir tests para el login", title: "Escribir tests login", type: "task" },
      { id: "task-b", rawText: "Revisar diseño de pantalla de registro", title: "Diseño pantalla registro", type: "task" },
    ];
    const provider = new MockProvider();
    provider.setRelationshipsHandler(async () => ({
      relationships: [
        {
          sourceItemId: "task-a",
          targetItemId: "task-b",
          type: "related_to",
          confidence: "low",
          reason: "Ambas tareas tocan la autenticación pero ninguna bloquea causalmente a la otra",
        },
      ],
    }));

    const result = await detectRelationships(provider, { items });
    const hasDependency = result.relationships.some((r) => r.type === "depends_on");
    expect(hasDependency).toBe(false);
  });

  // 8. Duplicate
  it("8. Duplicate: detects duplicate when two items represent the same intention", async () => {
    const items: ExtractedItem[] = [
      { id: "doc-1", rawText: "Revisar documentación de la API", title: "Revisar documentación API", type: "task" },
      { id: "doc-2", rawText: "Mirar la documentación de la API", title: "Mirar documentación API", type: "task" },
    ];
    const provider = new MockProvider();
    provider.setRelationshipsHandler(async () => ({
      relationships: [
        {
          sourceItemId: "doc-1",
          targetItemId: "doc-2",
          type: "duplicate",
          confidence: "high",
          reason: "Ambos elementos expresan exactamente la misma intención de lectura",
        },
      ],
    }));

    const result = await detectRelationships(provider, { items });
    expect(result.relationships).toHaveLength(1);
    expect(result.relationships[0]?.type).toBe("duplicate");
  });

  // 9. Independent items
  it("9. Independent items: items without connection produce empty relationships", async () => {
    const items: ExtractedItem[] = [
      { id: "db-1", rawText: "Investigar Postgres vs SQLite para proyecto personal", title: "Investigar Postgres vs SQLite", type: "task" },
      { id: "paper-1", rawText: "Escribir paper académico sobre cognición", title: "Escribir paper", type: "task" },
    ];
    const provider = new MockProvider();
    provider.setRelationshipsHandler(async () => ({
      relationships: [],
    }));

    const result = await detectRelationships(provider, { items });
    expect(result.relationships).toEqual([]);
  });

  // 10. Invalid IDs
  it("10. Invalid IDs: validation rejects relationships referencing nonexistent IDs", async () => {
    const items: ExtractedItem[] = [
      { id: "item-1", rawText: "tarea válida", title: "Tarea válida", type: "task" },
      { id: "item-2", rawText: "otra tarea válida", title: "Otra válida", type: "task" },
    ];
    const provider = new MockProvider();
    provider.setRelationshipsHandler(async () => ({
      relationships: [
        {
          sourceItemId: "item-1",
          targetItemId: "phantom-id",
          type: "depends_on",
          confidence: "high",
          reason: "Depende de un fantasma",
        },
      ],
    }));

    const result = await detectRelationships(provider, { items });
    expect(result.relationships).toHaveLength(0);
  });

  // Real Case: Caso 12 — Beta
  it("Real Case: Caso 12 (Beta) detects part_of constituent tasks without grouping", async () => {
    const case12Items = mockCasesData["case-12"]!.items as ExtractedItem[];
    const provider = new MockProvider();

    const result = await detectRelationships(provider, { items: case12Items });
    const partOfRels = result.relationships.filter(
      (r) => r.targetItemId === "c12-1" && r.type === "part_of"
    );
    expect(partOfRels).toHaveLength(4);
    for (const rel of partOfRels) {
      expect(rel.confidence).toBe("high");
      expect(rel.reason).toContain("beta");
    }
  });

  // Real Case: Caso 19 — Presupuesto y Pablo
  it("Real Case: Caso 19 detects 'Enviar presupuesto depends_on Hablar con Pablo' and keeps hotfix independent", async () => {
    const case19Items = mockCasesData["case-19"]!.items as ExtractedItem[];
    const provider = new MockProvider();

    const result = await detectRelationships(provider, { items: case19Items });
    const pabloDep = result.relationships.find(
      (r) => r.sourceItemId === "c19-1" && r.targetItemId === "c19-2" && r.type === "depends_on"
    );
    expect(pabloDep).toBeDefined();
    expect(pabloDep?.reason).toContain("Pablo");

    // Hotfix (c19-3) must NOT be related to budget or Pablo
    const hotfixRel = result.relationships.find(
      (r) => r.sourceItemId === "c19-3" || r.targetItemId === "c19-3"
    );
    expect(hotfixRel).toBeUndefined();
  });

  // Real Case: Caso 20 — Conscious Tech (Concern isolated, precondition is depends_on)
  it("Real Case: Caso 20 isolates concern and detects 'motor depends_on notas'", async () => {
    const case20Items = mockCasesData["case-20"]!.items as ExtractedItem[];
    const provider = new MockProvider();

    const result = await detectRelationships(provider, { items: case20Items });
    expect(result.relationships).toHaveLength(1);

    const dep = result.relationships.find(
      (r) => r.sourceItemId === "c20-1" && r.targetItemId === "c20-3" && r.type === "depends_on"
    );
    expect(dep).toBeDefined();
    expect(dep?.reason).toContain("notas");

    // Concern (c20-2) must be completely isolated
    const concernRel = result.relationships.find(
      (r) => r.sourceItemId === "c20-2" || r.targetItemId === "c20-2"
    );
    expect(concernRel).toBeUndefined();
  });

  // Real Case: Caso 02 — Hacienda (Concern isolated, tasks linked)
  it("Real Case: Caso 02 isolates agobio concern and links fiscal tasks", async () => {
    const case02Items = mockCasesData["case-02"]!.items as ExtractedItem[];
    const provider = new MockProvider();

    const result = await detectRelationships(provider, { items: case02Items });
    expect(result.relationships).toHaveLength(1);

    const taskRel = result.relationships.find(
      (r) =>
        ((r.sourceItemId === "c02-1" && r.targetItemId === "c02-3") ||
          (r.sourceItemId === "c02-3" && r.targetItemId === "c02-1")) &&
        r.type === "same_objective"
    );
    expect(taskRel).toBeDefined();

    // Concern (c02-2) must have no relationships
    const concernRel = result.relationships.find(
      (r) => r.sourceItemId === "c02-2" || r.targetItemId === "c02-2"
    );
    expect(concernRel).toBeUndefined();
  });

  // Real Case: Caso 15 — Precondition 'antes tengo que' is depends_on
  it("Real Case: Caso 15 detects 'subir npm depends_on correr tests'", async () => {
    const case15Items = mockCasesData["case-15"]!.items as ExtractedItem[];
    const provider = new MockProvider();

    const result = await detectRelationships(provider, { items: case15Items });
    expect(result.relationships).toHaveLength(1);

    const npmDep = result.relationships.find(
      (r) => r.sourceItemId === "c15-2" && r.targetItemId === "c15-1" && r.type === "depends_on"
    );
    expect(npmDep).toBeDefined();
  });

  // Real Case: Caso 25 — Constituent task is part_of
  it("Real Case: Caso 25 detects 'rescatar valiosos part_of revisar pendientes'", async () => {
    const case25Items = mockCasesData["case-25"]!.items as ExtractedItem[];
    const provider = new MockProvider();

    const result = await detectRelationships(provider, { items: case25Items });
    expect(result.relationships).toHaveLength(1);

    const partOfRel = result.relationships.find(
      (r) => r.sourceItemId === "c25-2" && r.targetItemId === "c25-1" && r.type === "part_of"
    );
    expect(partOfRel).toBeDefined();
  });

  // Real Case: Caso 03 — Independent items
  it("Real Case: Caso 03 produces empty relationships for independent items", async () => {
    const case03Items = mockCasesData["case-03"]!.items as ExtractedItem[];
    const provider = new MockProvider();

    const result = await detectRelationships(provider, { items: case03Items });
    expect(result.relationships).toEqual([]);
  });

  // Service Retry
  it("Service retry recovery when initial call fails schema validation", async () => {
    const items: ExtractedItem[] = [
      { id: "item-1", rawText: "tarea 1", title: "Tarea 1", type: "task" },
      { id: "item-2", rawText: "tarea 2", title: "Tarea 2", type: "task" },
    ];
    let callCount = 0;
    const provider = new MockProvider();
    provider.setRelationshipsHandler(async () => {
      callCount++;
      if (callCount === 1) {
        // Violates schema refine (sourceItemId === targetItemId)
        return {
          relationships: [
            {
              sourceItemId: "item-1",
              targetItemId: "item-1",
              type: "related_to" as const,
              confidence: "high" as const,
              reason: "Auto-relación",
            },
          ],
        };
      }
      return {
        relationships: [
          {
            sourceItemId: "item-1",
            targetItemId: "item-2",
            type: "related_to" as const,
            confidence: "high" as const,
            reason: "Relación válida tras retry",
          },
        ],
      };
    });

    const service = new DetectRelationshipsService(provider, { maxRetries: 1 });
    const result = await service.execute({ items });
    expect(callCount).toBe(2);
    expect(result.relationships).toHaveLength(1);
    expect(result.relationships[0]?.sourceItemId).toBe("item-1");
    expect(result.relationships[0]?.targetItemId).toBe("item-2");
  });
});
