import { describe, it, expect } from "vitest";
import {
  resolveDateDeterministically,
  isVagueNonDeadline,
} from "../src/skills/detect-deadlines/deterministic";
import { ExtractedItem } from "../src/domain/items";
import { detectDeadlines } from "../src/skills/detect-deadlines";
import { MockProvider } from "../src/providers/mock-provider";

describe("Skill 04 — Microcalibración Semántica Determinista", () => {
  // Fecha base fija: Viernes 9 de octubre de 2026 (day 5 = Viernes)
  const baseFriday = "2026-10-09";

  // 1. «hoy», «mañana» y «pasado mañana»
  it("1. Resuelve 'hoy', 'mañana' y 'pasado mañana' conservando raw y alta confianza", () => {
    const rHoy = resolveDateDeterministically("hoy", baseFriday);
    expect(rHoy).toEqual({
      resolvedStart: "2026-10-09",
      resolvedEnd: null,
      kind: "relative_date",
      confidence: "high",
    });

    const rManana = resolveDateDeterministically("mañana", baseFriday);
    expect(rManana).toEqual({
      resolvedStart: "2026-10-10",
      resolvedEnd: null,
      kind: "relative_date",
      confidence: "high",
    });

    const rPasadoManana = resolveDateDeterministically("pasado mañana", baseFriday);
    expect(rPasadoManana).toEqual({
      resolvedStart: "2026-10-11",
      resolvedEnd: null,
      kind: "relative_date",
      confidence: "high",
    });
  });

  // 2. «este viernes» cuando hoy es viernes
  it("2. Resuelve 'este viernes' como hoy cuando la fecha base ya es viernes", () => {
    const res = resolveDateDeterministically("este viernes", baseFriday);
    expect(res).toEqual({
      resolvedStart: "2026-10-09",
      resolvedEnd: null,
      kind: "relative_date",
      confidence: "high",
    });
  });

  // 3. «el jueves» cuando el jueves de esta semana ya ha pasado
  it("3. Resuelve 'el jueves' al próximo jueves con confianza media cuando el jueves de esta semana ya pasó", () => {
    // Viernes 9: el jueves de esta semana fue ayer (8 de octubre).
    // Para una tarea futura sin calificador, proyecta al siguiente jueves (15 de octubre) con confianza media.
    const res = resolveDateDeterministically("el jueves", baseFriday);
    expect(res).toEqual({
      resolvedStart: "2026-10-15",
      resolvedEnd: null,
      kind: "relative_date",
      confidence: "medium",
    });
  });

  // 4. «el próximo jueves»
  it("4. Resuelve 'el próximo jueves' a la siguiente semana con alta confianza", () => {
    const res = resolveDateDeterministically("el próximo jueves", baseFriday);
    expect(res).toEqual({
      resolvedStart: "2026-10-15",
      resolvedEnd: null,
      kind: "relative_date",
      confidence: "high",
    });
  });

  // 5. «el jueves que viene»
  it("5. Resuelve 'el jueves que viene' a la siguiente semana con alta confianza", () => {
    const res = resolveDateDeterministically("el jueves que viene", baseFriday);
    expect(res).toEqual({
      resolvedStart: "2026-10-15",
      resolvedEnd: null,
      kind: "relative_date",
      confidence: "high",
    });
  });

  // 6. «antes del martes»
  it("6. Resuelve 'antes del martes' como límite tope en resolvedEnd (sin resolvedStart) y conserva raw", () => {
    // Desde viernes 9, el martes próximo es martes 13 de octubre (semana siguiente -> confianza media).
    const res = resolveDateDeterministically("antes del martes", baseFriday);
    expect(res).toEqual({
      resolvedStart: null,
      resolvedEnd: "2026-10-13",
      kind: "relative_date",
      confidence: "medium",
    });
  });

  // 7. «antes del 20», sin mes explícito
  it("7. Resuelve 'antes del 20' como límite terminal con confianza media por mes implícito", () => {
    const res = resolveDateDeterministically("antes del 20", baseFriday);
    expect(res).toEqual({
      resolvedStart: null,
      resolvedEnd: "2026-10-20",
      kind: "relative_date",
      confidence: "medium",
    });
  });

  // 8. «del 10 al 12 de noviembre»
  it("8. Resuelve 'del 10 al 12 de noviembre' como date_range completo con alta confianza", () => {
    const res = resolveDateDeterministically("del 10 al 12 de noviembre", baseFriday);
    expect(res).toEqual({
      resolvedStart: "2026-11-10",
      resolvedEnd: "2026-11-12",
      kind: "date_range",
      confidence: "high",
    });
  });

  // 9. «este fin de semana», incluyendo el domingo
  it("9. Resuelve 'este fin de semana' abarcando sábado y domingo, y si hoy es domingo abarca el día actual", () => {
    // Desde el viernes 9: fin de semana es 10 a 11 de octubre
    const resFriday = resolveDateDeterministically("este fin de semana", baseFriday);
    expect(resFriday).toEqual({
      resolvedStart: "2026-10-10",
      resolvedEnd: "2026-10-11",
      kind: "date_range",
      confidence: "high",
    });

    // Desde el domingo 11 de octubre:
    const baseSunday = "2026-10-11";
    const resSunday = resolveDateDeterministically("este finde", baseSunday);
    expect(resSunday).toEqual({
      resolvedStart: "2026-10-11",
      resolvedEnd: "2026-10-11",
      kind: "date_range",
      confidence: "high",
    });
  });

  // 10. «cuando estemos más tranquilos»
  it("10. Expresión vaga 'cuando estemos más tranquilos' no genera deadline", () => {
    expect(isVagueNonDeadline("cuando estemos más tranquilos")).toBe(true);
    const res = resolveDateDeterministically("cuando estemos más tranquilos", baseFriday);
    expect(res).toBeNull();
  });

  // 11. «más adelante»
  it("11. Expresión vaga 'más adelante' no genera deadline", () => {
    expect(isVagueNonDeadline("más adelante")).toBe(true);
    const res = resolveDateDeterministically("más adelante", baseFriday);
    expect(res).toBeNull();
  });

  // 12. Intención personal que incluye «hoy»
  it("12. Intención personal con horizonte temporal 'hoy' detecta la fecha sin atribuir prioridad", async () => {
    const items: ExtractedItem[] = [
      {
        id: "item-personal",
        rawText: "A ver si logro aflojarle al café hoy",
        title: "Aflojarle al café",
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
            itemId: "item-personal",
            raw: "hoy",
            kind: "relative_date",
            resolvedStart: null,
            resolvedEnd: null,
            confidence: "high",
          },
        ],
      })
    );

    const result = await detectDeadlines(provider, {
      items,
      currentDate: baseFriday,
    });

    expect(result.deadlines).toHaveLength(1);
    expect(result.deadlines[0]).toEqual({
      itemId: "item-personal",
      raw: "hoy",
      kind: "relative_date",
      resolvedStart: "2026-10-09",
      resolvedEnd: null,
      confidence: "high",
    });
  });

  // 13. Evento con fecha que no es fecha de entrega
  it("13. Evento con horizonte temporal 'el mes que viene' conserva intervalo mensual sin inventar un día concreto", async () => {
    const items: ExtractedItem[] = [
      {
        id: "item-event",
        rawText: "Confirmé mi participación en el meetup de TypeScript del mes que viene",
        title: "Meetup TypeScript",
        type: "commitment",
      },
    ];

    const provider = new MockProvider(
      undefined,
      undefined,
      undefined,
      async () => ({
        deadlines: [
          {
            itemId: "item-event",
            raw: "el mes que viene",
            kind: "relative_date",
            resolvedStart: null,
            resolvedEnd: null,
            confidence: "medium",
          },
        ],
      })
    );

    const result = await detectDeadlines(provider, {
      items,
      currentDate: baseFriday, // Octubre 2026
    });

    expect(result.deadlines).toHaveLength(1);
    expect(result.deadlines[0]?.raw).toBe("el mes que viene");
    // El mes siguiente es noviembre: del 1 al 30 de noviembre
    expect(result.deadlines[0]?.resolvedStart).toBe("2026-11-01");
    expect(result.deadlines[0]?.resolvedEnd).toBe("2026-11-30");
    expect(result.deadlines[0]?.confidence).toBe("medium");
  });

  // 14. Transiciones de calendario: cambio de mes y cambio de año
  describe("14. Transiciones de calendario (mes y año)", () => {
    it("resuelve 'mañana' y 'el próximo lunes' correctamente a fin de mes (31 de octubre)", () => {
      const endOfOctober = "2026-10-31"; // Sábado 31 de octubre
      const resTomorrow = resolveDateDeterministically("mañana", endOfOctober);
      expect(resTomorrow?.resolvedStart).toBe("2026-11-01"); // 1 de noviembre

      const resMonday = resolveDateDeterministically("el próximo lunes", endOfOctober);
      // Siguiente lunes es 2 de noviembre
      expect(resMonday?.resolvedStart).toBe("2026-11-02");
    });

    it("resuelve cambio de año (31 de diciembre a enero)", () => {
      const endOfYear = "2026-12-31"; // Jueves 31 de diciembre
      const resTomorrow = resolveDateDeterministically("mañana", endOfYear);
      expect(resTomorrow?.resolvedStart).toBe("2027-01-01");

      const resWeekend = resolveDateDeterministically("este finde", endOfYear);
      expect(resWeekend?.resolvedStart).toBe("2027-01-02");
      expect(resWeekend?.resolvedEnd).toBe("2027-01-03");

      const resNextMonth = resolveDateDeterministically("el mes que viene", endOfYear);
      expect(resNextMonth?.resolvedStart).toBe("2027-01-01");
      expect(resNextMonth?.resolvedEnd).toBe("2027-01-31");
    });

    it("resuelve 'antes del 20' cuando el día 20 ya pasó en el mes actual proyectándolo al mes siguiente", () => {
      const lateOctober = "2026-10-25";
      const res = resolveDateDeterministically("antes del 20", lateOctober);
      expect(res?.resolvedEnd).toBe("2026-11-20");
    });
  });
});
