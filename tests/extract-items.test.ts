import { describe, it, expect } from "vitest";
import { MockProvider } from "../src/providers/mock-provider";
import { ExtractItemsService, extractItems } from "../src/skills/extract-items";
import { TEST_CASES } from "./fixtures/cases";
import { ExtractionValidationError } from "../src/skills/extract-items/parser";

describe("ExtractItems Skill - Behavioral Tests", () => {
  const currentDate = "2026-10-06";

  it("1. Tarea simple", async () => {
    const fixture = TEST_CASES.simpleTask!;
    const provider = new MockProvider(async () => fixture.expected);
    const result = await extractItems(provider, { text: fixture.input, currentDate });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.type).toBe("task");
    expect(result.items[0]?.title).toBe("Enviar reporte de ventas");
  });

  it("2. Proyecto", async () => {
    const fixture = TEST_CASES.project!;
    const provider = new MockProvider(async () => fixture.expected);
    const result = await extractItems(provider, { text: fixture.input, currentDate });

    expect(result.items[0]?.type).toBe("project");
    expect(result.items[0]?.project).toBe("Rediseño Web");
  });

  it("3. Idea", async () => {
    const fixture = TEST_CASES.idea!;
    const provider = new MockProvider(async () => fixture.expected);
    const result = await extractItems(provider, { text: fixture.input, currentDate });

    expect(result.items[0]?.type).toBe("idea");
    expect(result.items[0]?.status).toBe("exploring");
  });

  it("4. Compromiso externo", async () => {
    const fixture = TEST_CASES.externalCommitment!;
    const provider = new MockProvider(async () => fixture.expected);
    const result = await extractItems(provider, { text: fixture.input, currentDate });

    expect(result.items[0]?.type).toBe("commitment");
    expect(result.items[0]?.commitment).toBe("external");
    expect(result.items[0]?.deadline?.raw).toBe("el martes");
  });

  it("5. Preocupación", async () => {
    const fixture = TEST_CASES.concern!;
    const provider = new MockProvider(async () => fixture.expected);
    const result = await extractItems(provider, { text: fixture.input, currentDate });

    expect(result.items[0]?.type).toBe("concern");
  });

  it("6. Varios elementos en un mismo texto", async () => {
    const fixture = TEST_CASES.multipleItems!;
    const provider = new MockProvider(async () => fixture.expected);
    const result = await extractItems(provider, { text: fixture.input, currentDate });

    expect(result.items).toHaveLength(5);
    const types = result.items.map((i) => i.type);
    expect(types).toContain("commitment");
    expect(types).toContain("task");
    expect(types).toContain("project");
    expect(types).toContain("idea");
  });

  it("7. Deadline explícito", async () => {
    const fixture = TEST_CASES.explicitDeadline!;
    const provider = new MockProvider(async () => fixture.expected);
    const result = await extractItems(provider, { text: fixture.input, currentDate });

    expect(result.items[0]?.deadline?.resolved).toBe("2026-10-15");
    expect(result.items[0]?.deadline?.confidence).toBe("high");
  });

  it("8. Fecha relativa conservada sin resolver forzadamente", async () => {
    const fixture = TEST_CASES.relativeDate!;
    const provider = new MockProvider(async () => fixture.expected);
    const result = await extractItems(provider, { text: fixture.input, currentDate });

    expect(result.items[0]?.deadline?.raw).toBe("este finde");
    expect(result.items[0]?.deadline?.resolved).toBeUndefined();
  });

  it("9. Esfuerzo explícito expresado por la persona", async () => {
    const fixture = TEST_CASES.explicitEffort!;
    const provider = new MockProvider(async () => fixture.expected);
    const result = await extractItems(provider, { text: fixture.input, currentDate });

    expect(result.items[0]?.estimatedEffort).toEqual({
      value: 3,
      unit: "hours",
      source: "user",
    });
  });

  it("10. Importancia explícita", async () => {
    const fixture = TEST_CASES.explicitImportance!;
    const provider = new MockProvider(async () => fixture.expected);
    const result = await extractItems(provider, { text: fixture.input, currentDate });

    expect(result.items[0]?.importance).toBe("high");
  });

  it("11. Elemento ya iniciado", async () => {
    const fixture = TEST_CASES.startedItem!;
    const provider = new MockProvider(async () => fixture.expected);
    const result = await extractItems(provider, { text: fixture.input, currentDate });

    expect(result.items[0]?.status).toBe("started");
  });

  it("12. Elemento exploratorio", async () => {
    const fixture = TEST_CASES.exploratoryItem!;
    const provider = new MockProvider(async () => fixture.expected);
    const result = await extractItems(provider, { text: fixture.input, currentDate });

    expect(result.items[0]?.status).toBe("exploring");
    expect(result.items[0]?.type).toBe("idea");
  });

  it("13. Lenguaje ambiguo", async () => {
    const fixture = TEST_CASES.ambiguousThought!;
    const provider = new MockProvider(async () => fixture.expected);
    const result = await extractItems(provider, { text: fixture.input, currentDate });

    expect(result.items[0]?.type).toBe("idea");
  });

  it("14. Pensamiento que NO debe convertirse en tarea", async () => {
    const fixture = TEST_CASES.noTaskConversion!;
    const provider = new MockProvider(async () => fixture.expected);
    const result = await extractItems(provider, { text: fixture.input, currentDate });

    expect(result.items[0]?.type).not.toBe("task");
    expect(result.items[0]?.type).toBe("concern");
  });

  it("15. Salida inválida del modelo con reintento controlado", async () => {
    let callCount = 0;
    const provider = new MockProvider(async () => {
      callCount++;
      if (callCount === 1) {
        throw new ExtractionValidationError("Malformed schema from LLM");
      }
      return {
        items: [
          {
            id: "item-retry",
            rawText: "texto reintentado",
            title: "Item Recuperado",
            type: "task",
          },
        ],
      };
    });

    const service = new ExtractItemsService(provider, { maxRetries: 1 });
    const result = await service.execute({ text: "algun texto", currentDate });

    expect(callCount).toBe(2);
    expect(result.items[0]?.title).toBe("Item Recuperado");
  });

  it("16. Respuesta vacía lanza error controlado", async () => {
    const provider = new MockProvider(async () => {
      throw new Error("Provider returned an empty response");
    });
    const service = new ExtractItemsService(provider);
    await expect(service.execute({ text: "...", currentDate })).rejects.toThrow(
      "Provider returned an empty response"
    );
  });

  it("17. Varios elementos relacionados al mismo proyecto", async () => {
    const fixture = TEST_CASES.multipleRelated!;
    const provider = new MockProvider(async () => fixture.expected);
    const result = await extractItems(provider, { text: fixture.input, currentDate });

    expect(result.items).toHaveLength(3);
    expect(result.items.every((i) => i.project === "Conscious Tech")).toBe(true);
  });

  it("18. Texto largo con mezcla de tareas, ideas y preocupaciones", async () => {
    const fixture = TEST_CASES.longText!;
    const provider = new MockProvider(async () => fixture.expected);
    const result = await extractItems(provider, { text: fixture.input, currentDate });

    expect(result.items.length).toBeGreaterThanOrEqual(4);
  });

  it("19. Español natural (conservadurismo y fidelidad)", async () => {
    const fixture = TEST_CASES.multipleItems!;
    const provider = new MockProvider(async () => fixture.expected);
    const result = await extractItems(provider, { text: fixture.input, currentDate, locale: "es-ES" });

    expect(result.items[4]?.rawText).toContain("quería mirar Zapsac");
    expect(result.items[4]?.type).toBe("idea");
  });

  it("20. Validación de entrada vacía rechazada por el schema", async () => {
    const provider = new MockProvider();
    const service = new ExtractItemsService(provider);

    await expect(
      service.execute({ text: "", currentDate })
    ).rejects.toThrow();
  });

  it("21. Elemento conscientemente archivado conserva status archived", async () => {
    const provider = new MockProvider(async () => ({
      items: [
        {
          id: "item-1",
          rawText: "decidimos no hacer la integración con Discord por ahora. Queda archivada",
          title: "Integración con Discord archivada conscientemente",
          type: "idea",
          status: "archived",
        },
      ],
    }));
    const result = await extractItems(provider, {
      text: "decidimos no hacer la integración con Discord por ahora",
      currentDate,
    });
    expect(result.items[0]?.status).toBe("archived");
    expect(result.items[0]?.type).toBe("idea");
  });
});
