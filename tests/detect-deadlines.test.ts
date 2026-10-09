import { describe, it, expect, vi } from "vitest";
import { MockProvider } from "../src/providers/mock-provider";
import { DetectDeadlinesService, detectDeadlines } from "../src/skills/detect-deadlines";
import { ExtractedItem } from "../src/domain/items";
import { DetectedDeadlines } from "../src/domain/deadlines";
import mockDeadlinesData from "../cases/mock-deadlines.json";
import mockExtractionsData from "../cases/mock-extractions.json";

describe("Skill 04: detect_deadlines", () => {
  const currentDate = "2026-10-08";

  it("handles empty items with immediate short-circuit without calling provider", async () => {
    const mockProvider = new MockProvider();
    const detectDeadlinesSpy = vi.spyOn(mockProvider, "detectDeadlines");

    const service = new DetectDeadlinesService(mockProvider);
    const result = await service.execute({
      items: [],
      currentDate,
    });

    expect(result).toEqual({ deadlines: [] });
    expect(detectDeadlinesSpy).not.toHaveBeenCalled();
  });

  it("never invents a date for items without temporal expressions", async () => {
    const items: ExtractedItem[] = [
      {
        id: "item-no-date",
        rawText: "Quiero preparar el examen de certificación de AWS.",
        title: "Preparar examen AWS",
        type: "task",
      },
    ];

    const provider = new MockProvider(
      undefined,
      undefined,
      undefined,
      async () => ({ deadlines: [] })
    );

    const result = await detectDeadlines(
      provider,
      { items, currentDate }
    );

    expect(result.deadlines).toHaveLength(0);
  });

  it("detects explicit exact dates with high confidence", async () => {
    const items: ExtractedItem[] = [
      {
        id: "item-exam",
        rawText: "El examen de AWS es el 15 de noviembre.",
        title: "Examen AWS",
        type: "task",
      },
    ];

    const provider = new MockProvider(
      undefined,
      undefined,
      undefined,
      async () => ({
        deadlines: [
          {
            itemId: "item-exam",
            raw: "el 15 de noviembre",
            kind: "exact_date",
            resolvedStart: "2026-11-15",
            resolvedEnd: null,
            confidence: "high",
          },
        ],
      })
    );

    const result = await detectDeadlines(
      provider,
      { items, currentDate }
    );

    expect(result.deadlines).toHaveLength(1);
    expect(result.deadlines[0]).toMatchObject({
      itemId: "item-exam",
      kind: "exact_date",
      resolvedStart: "2026-11-15",
      confidence: "high",
    });
  });

  it("resolves relative references deterministically based on currentDate", async () => {
    const items: ExtractedItem[] = [
      {
        id: "item-deploy",
        rawText: "Necesito subir la release a producción mañana.",
        title: "Subir release",
        type: "task",
      },
    ];

    const provider = new MockProvider(
      undefined,
      undefined,
      undefined,
      async () => ({
        deadlines: [
          {
            itemId: "item-deploy",
            raw: "mañana",
            kind: "relative_date",
            confidence: "high",
          },
        ],
      })
    );

    const result = await detectDeadlines(
      provider,
      { items, currentDate: "2026-10-08" }
    );

    expect(result.deadlines).toHaveLength(1);
    expect(result.deadlines[0]?.resolvedStart).toBe("2026-10-09");
  });

  it("detects date ranges with start and end coherently (start <= end)", async () => {
    const items: ExtractedItem[] = [
      {
        id: "item-workshop",
        rawText: "El taller intensivo es del 10 al 12 de noviembre.",
        title: "Taller intensivo",
        type: "task",
      },
    ];

    const provider = new MockProvider(
      undefined,
      undefined,
      undefined,
      async () => ({
        deadlines: [
          {
            itemId: "item-workshop",
            raw: "del 10 al 12 de noviembre",
            kind: "date_range",
            resolvedStart: "2026-11-10",
            resolvedEnd: "2026-11-12",
            confidence: "high",
          },
        ],
      })
    );

    const result = await detectDeadlines(
      provider,
      { items, currentDate }
    );

    expect(result.deadlines).toHaveLength(1);
    const d = result.deadlines[0]!;
    expect(d.kind).toBe("date_range");
    expect(d.resolvedStart).toBe("2026-11-10");
    expect(d.resolvedEnd).toBe("2026-11-12");
  });

  it("discards vague non-deadlines such as 'cuando estemos más tranquilos' or 'algún día'", async () => {
    const items: ExtractedItem[] = [
      {
        id: "item-vague",
        rawText: "Revisar la arquitectura cuando estemos más tranquilos o algún día.",
        title: "Revisar arquitectura",
        type: "idea",
      },
    ];

    // Even if an AI provider mistakenly emitted a deadline for a vague desire,
    // the deterministic validator must filter it out.
    const provider = new MockProvider(
      undefined,
      undefined,
      undefined,
      async () => ({
        deadlines: [
          {
            itemId: "item-vague",
            raw: "cuando estemos más tranquilos",
            kind: "unspecified",
            confidence: "low",
          },
        ],
      })
    );

    const result = await detectDeadlines(
      provider,
      { items, currentDate }
    );

    expect(result.deadlines).toHaveLength(0);
  });

  it("handles weak temporal horizons without inventing a specific day", async () => {
    const items: ExtractedItem[] = [
      {
        id: "item-horizon",
        rawText: "Conviene migrar la base de datos antes de diciembre.",
        title: "Migrar base de datos",
        type: "task",
      },
    ];

    const provider = new MockProvider(
      undefined,
      undefined,
      undefined,
      async () => ({
        deadlines: [
          {
            itemId: "item-horizon",
            raw: "antes de diciembre",
            kind: "relative_date",
            resolvedStart: null,
            resolvedEnd: null,
            confidence: "medium",
          },
        ],
      })
    );

    const result = await detectDeadlines(
      provider,
      { items, currentDate }
    );

    expect(result.deadlines).toHaveLength(1);
    expect(result.deadlines[0]?.raw).toBe("antes de diciembre");
    expect(result.deadlines[0]?.resolvedStart).toBeNull();
    expect(result.deadlines[0]?.resolvedEnd).toBeNull();
    expect(result.deadlines[0]?.confidence).toBe("medium");
  });

  it("does not confuse past narrative context with a future deadline", async () => {
    const items: ExtractedItem[] = [
      {
        id: "item-convo",
        rawText: "El viernes pasado estuve hablando con Marta sobre el rediseño.",
        title: "Conversación con Marta",
        type: "task",
      },
    ];

    const provider = new MockProvider(
      undefined,
      undefined,
      undefined,
      async () => ({
        deadlines: [],
      })
    );

    const result = await detectDeadlines(
      provider,
      { items, currentDate }
    );

    expect(result.deadlines).toHaveLength(0);
  });

  it("strips phantom itemIds not present in input", async () => {
    const items: ExtractedItem[] = [
      {
        id: "item-valid",
        rawText: "Entregar viernes",
        title: "Entregar viernes",
        type: "task",
      },
    ];

    const provider = new MockProvider(
      undefined,
      undefined,
      undefined,
      async () => ({
        deadlines: [
          {
            itemId: "phantom-999",
            raw: "este viernes",
            kind: "relative_date",
            confidence: "high",
          },
          {
            itemId: "item-valid",
            raw: "este viernes",
            kind: "relative_date",
            confidence: "high",
          },
        ],
      })
    );

    const result = await detectDeadlines(
      provider,
      { items, currentDate }
    );

    expect(result.deadlines).toHaveLength(1);
    expect(result.deadlines[0]?.itemId).toBe("item-valid");
  });

  describe("Integration with MockProvider Cases", () => {
    it("returns expected deadlines for mock case-01", async () => {
      const case01Extraction = (mockExtractionsData as Record<string, { items: ExtractedItem[] }>)["case-01"];
      expect(case01Extraction).toBeDefined();

      const provider = new MockProvider();
      const result = await provider.detectDeadlines({
        items: case01Extraction.items,
        currentDate: "2026-10-08",
      });

      const expected = (mockDeadlinesData as Record<string, DetectedDeadlines>)["case-01"];
      expect(result.deadlines).toEqual(expected.deadlines);
    });

    it("returns empty deadlines for mock case-03 (items without dates)", async () => {
      const case03Extraction = (mockExtractionsData as Record<string, { items: ExtractedItem[] }>)["case-03"];
      expect(case03Extraction).toBeDefined();

      const provider = new MockProvider();
      const result = await provider.detectDeadlines({
        items: case03Extraction.items,
        currentDate: "2026-10-08",
      });

      expect(result.deadlines).toEqual([]);
    });
  });
});
