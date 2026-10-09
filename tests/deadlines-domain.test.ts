import { describe, it, expect } from "vitest";
import {
  DeadlineKindSchema,
  DetectedDeadlineSchema,
  DetectedDeadlinesSchema,
  DetectDeadlinesInputSchema,
} from "../src/domain/deadlines";
import {
  isValidIsoDate,
  isVagueNonDeadline,
  resolveDateDeterministically,
  validateDeadlinesInvariants,
  cleanAndValidateDeadlines,
} from "../src/skills/detect-deadlines/deterministic";
import { ExtractedItem } from "../src/domain/items";

describe("Domain: Deadlines & Temporal Invariants", () => {
  it("validates DeadlineKindSchema valid values", () => {
    expect(DeadlineKindSchema.safeParse("exact_date").success).toBe(true);
    expect(DeadlineKindSchema.safeParse("relative_date").success).toBe(true);
    expect(DeadlineKindSchema.safeParse("date_range").success).toBe(true);
    expect(DeadlineKindSchema.safeParse("recurring").success).toBe(true);
    expect(DeadlineKindSchema.safeParse("unspecified").success).toBe(true);
    expect(DeadlineKindSchema.safeParse("invalid_kind").success).toBe(false);
  });

  it("validates DetectedDeadlineSchema structure", () => {
    const valid = {
      itemId: "item-1",
      raw: "el 15 de noviembre",
      kind: "exact_date",
      resolvedStart: "2026-11-15",
      resolvedEnd: null,
      confidence: "high",
    };
    const parsed = DetectedDeadlineSchema.safeParse(valid);
    expect(parsed.success).toBe(true);
  });

  it("rejects DetectedDeadlineSchema with empty raw or invalid confidence", () => {
    const emptyRaw = {
      itemId: "item-1",
      raw: "",
      kind: "exact_date",
      resolvedStart: "2026-11-15",
      confidence: "high",
    };
    expect(DetectedDeadlineSchema.safeParse(emptyRaw).success).toBe(false);

    const badConfidence = {
      itemId: "item-1",
      raw: "mañana",
      kind: "relative_date",
      confidence: "very_high",
    };
    expect(DetectedDeadlineSchema.safeParse(badConfidence).success).toBe(false);
  });

  it("validates DetectedDeadlinesSchema wrapper", () => {
    const valid = {
      deadlines: [
        {
          itemId: "item-1",
          raw: "mañana",
          kind: "relative_date",
          confidence: "high",
        },
      ],
    };
    expect(DetectedDeadlinesSchema.safeParse(valid).success).toBe(true);
  });

  it("validates DetectDeadlinesInputSchema requires valid ISO currentDate", () => {
    const valid = {
      items: [{ id: "item-1", rawText: "t", title: "T", type: "task" }],
      currentDate: "2026-10-08",
    };
    expect(DetectDeadlinesInputSchema.safeParse(valid).success).toBe(true);

    const invalidDate = {
      items: [],
      currentDate: "08/10/2026",
    };
    expect(DetectDeadlinesInputSchema.safeParse(invalidDate).success).toBe(false);
  });

  describe("isValidIsoDate", () => {
    it("accepts valid calendar dates in YYYY-MM-DD", () => {
      expect(isValidIsoDate("2026-10-08")).toBe(true);
      expect(isValidIsoDate("2024-02-29")).toBe(true); // Leap year
    });

    it("rejects invalid format or impossible calendar dates", () => {
      expect(isValidIsoDate("2026/10/08")).toBe(false);
      expect(isValidIsoDate("2026-02-30")).toBe(false); // Feb 30 does not exist
      expect(isValidIsoDate("2026-13-01")).toBe(false);
      expect(isValidIsoDate("not-a-date")).toBe(false);
    });
  });

  describe("isVagueNonDeadline", () => {
    it("identifies vague expressions that are not deadlines", () => {
      expect(isVagueNonDeadline("cuando estemos más tranquilos")).toBe(true);
      expect(isVagueNonDeadline("algún día")).toBe(true);
      expect(isVagueNonDeadline("más adelante")).toBe(true);
      expect(isVagueNonDeadline("cuando pueda")).toBe(true);
      expect(isVagueNonDeadline("en algún momento")).toBe(true);
    });

    it("does not flag concrete or relative deadlines as vague", () => {
      expect(isVagueNonDeadline("mañana")).toBe(false);
      expect(isVagueNonDeadline("el viernes")).toBe(false);
      expect(isVagueNonDeadline("antes del martes")).toBe(false);
      expect(isVagueNonDeadline("este fin de semana")).toBe(false);
      expect(isVagueNonDeadline("el 15 de noviembre")).toBe(false);
    });
  });

  describe("resolveDateDeterministically", () => {
    const currentDate = "2026-10-08"; // Thursday (day 4)

    it("resolves 'hoy'", () => {
      const res = resolveDateDeterministically("hoy", currentDate);
      expect(res?.resolvedStart).toBe("2026-10-08");
    });

    it("resolves 'mañana'", () => {
      const res = resolveDateDeterministically("mañana", currentDate);
      expect(res?.resolvedStart).toBe("2026-10-09");
    });

    it("resolves 'pasado mañana'", () => {
      const res = resolveDateDeterministically("pasado mañana", currentDate);
      expect(res?.resolvedStart).toBe("2026-10-10");
    });

    it("resolves 'este viernes' as next day from Thursday", () => {
      const res = resolveDateDeterministically("este viernes", currentDate);
      expect(res?.resolvedStart).toBe("2026-10-09");
    });

    it("resolves 'este fin de semana' as range", () => {
      const res = resolveDateDeterministically("este fin de semana", currentDate);
      expect(res?.resolvedStart).toBe("2026-10-10");
      expect(res?.resolvedEnd).toBe("2026-10-11");
    });
  });

  describe("validateDeadlinesInvariants & cleanAndValidateDeadlines", () => {
    const items: ExtractedItem[] = [
      { id: "item-1", rawText: "Entregar informe mañana", title: "Entregar informe", type: "task" },
      { id: "item-2", rawText: "Lanzar beta", title: "Lanzar beta", type: "task" },
    ];

    it("detects phantom item ID and chronological range inversion", () => {
      const invalid = {
        deadlines: [
          {
            itemId: "phantom-99",
            raw: "mañana",
            kind: "relative_date" as const,
            resolvedStart: "2026-10-09",
            confidence: "high" as const,
          },
          {
            itemId: "item-1",
            raw: "del 15 al 10",
            kind: "date_range" as const,
            resolvedStart: "2026-10-15",
            resolvedEnd: "2026-10-10",
            confidence: "high" as const,
          },
        ],
      };

      const check = validateDeadlinesInvariants(invalid, items);
      expect(check.valid).toBe(false);
      expect(check.errors.some((e) => e.includes("phantom-99"))).toBe(true);
      expect(check.errors.some((e) => e.includes("after resolvedEnd"))).toBe(true);
    });

    it("cleanAndValidateDeadlines removes phantoms, vague entries and fixes deterministic relative dates", () => {
      const rawDeadlines = [
        {
          itemId: "phantom-x",
          raw: "mañana",
          kind: "relative_date" as const,
          confidence: "high" as const,
        },
        {
          itemId: "item-2",
          raw: "algún día cuando estemos más tranquilos",
          kind: "unspecified" as const,
          confidence: "low" as const,
        },
        {
          itemId: "item-1",
          raw: "mañana",
          kind: "relative_date" as const,
          confidence: "high" as const,
        },
      ];

      const cleaned = cleanAndValidateDeadlines(rawDeadlines, items, "2026-10-08");
      expect(cleaned.deadlines).toHaveLength(1);
      expect(cleaned.deadlines[0]?.itemId).toBe("item-1");
      expect(cleaned.deadlines[0]?.resolvedStart).toBe("2026-10-09");

      const check = validateDeadlinesInvariants(cleaned, items);
      expect(check.valid).toBe(true);
    });
  });
});
