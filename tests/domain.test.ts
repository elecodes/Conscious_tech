import { describe, it, expect } from "vitest";
import {
  ExtractedItemSchema,
  ExtractedItemsSchema,
  ExtractItemsInputSchema,
  EffortSchema,
  DateReferenceSchema,
} from "../src/domain/items";

describe("Domain Schemas & Validation", () => {
  it("validates a minimal valid ExtractedItem", () => {
    const item = {
      id: "item-1",
      rawText: "Estudiar SOLID",
      title: "Estudiar SOLID",
      type: "task",
    };
    const parsed = ExtractedItemSchema.safeParse(item);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.title).toBe("Estudiar SOLID");
      expect(parsed.data.type).toBe("task");
    }
  });

  it("validates an item with all optional fields present", () => {
    const fullItem = {
      id: "item-1",
      rawText: "preparar clase para el martes con 3 horas",
      title: "Preparar clase",
      type: "commitment",
      project: "Cibervoluntarios",
      status: "pending",
      deadline: {
        raw: "el martes",
        resolved: "2026-10-13",
        confidence: "high",
      },
      estimatedEffort: {
        value: 3,
        unit: "hours",
        source: "user",
      },
      importance: "high",
      commitment: "external",
    };
    const parsed = ExtractedItemSchema.safeParse(fullItem);
    expect(parsed.success).toBe(true);
  });

  it("rejects invalid item types", () => {
    const invalidItem = {
      id: "item-1",
      rawText: "comprar pan",
      title: "Comprar pan",
      type: "errand", // Not in allowed enum
    };
    const parsed = ExtractedItemSchema.safeParse(invalidItem);
    expect(parsed.success).toBe(false);
  });

  it("rejects items missing required rawText or id", () => {
    const missingRaw = {
      id: "item-1",
      title: "Item sin raw",
      type: "task",
    };
    expect(ExtractedItemSchema.safeParse(missingRaw).success).toBe(false);

    const missingId = {
      rawText: "texto",
      title: "Sin id",
      type: "task",
    };
    expect(ExtractedItemSchema.safeParse(missingId).success).toBe(false);
  });

  it("validates effort with positive numbers only", () => {
    expect(EffortSchema.safeParse({ value: 2, unit: "hours" }).success).toBe(true);
    expect(EffortSchema.safeParse({ value: -1, unit: "hours" }).success).toBe(false);
    expect(EffortSchema.safeParse({ value: 0, unit: "hours" }).success).toBe(false);
  });

  it("validates date references", () => {
    const valid = { raw: "mañana", confidence: "medium" };
    expect(DateReferenceSchema.safeParse(valid).success).toBe(true);

    const invalid = { raw: "mañana", confidence: "maybe" };
    expect(DateReferenceSchema.safeParse(invalid).success).toBe(false);
  });

  it("validates ExtractedItems wrapper schema", () => {
    const validWrapper = {
      items: [
        {
          id: "1",
          rawText: "hacer A",
          title: "Hacer A",
          type: "task",
        },
      ],
    };
    expect(ExtractedItemsSchema.safeParse(validWrapper).success).toBe(true);
    expect(ExtractedItemsSchema.safeParse({ items: "not-an-array" }).success).toBe(false);
  });

  it("validates ExtractItemsInput with optional locale", () => {
    const parsed = ExtractItemsInputSchema.parse({
      text: "Tengo que enviar presupuesto",
      currentDate: "2026-10-06",
    });
    expect(parsed.locale).toBeUndefined();

    const withLocale = ExtractItemsInputSchema.parse({
      text: "Tengo que enviar presupuesto",
      currentDate: "2026-10-06",
      locale: "es-AR",
    });
    expect(withLocale.locale).toBe("es-AR");
  });
});
