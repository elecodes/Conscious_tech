import { describe, it, expect } from "vitest";
import { MockProvider } from "../src/providers/mock-provider";
import { extractItems } from "../src/skills/extract-items";
import {
  splitNotesIntoSegments,
  resolveDayOfWeek,
  extractEffort,
  splitCoordinatedActions,
  normalizeFusedWords,
  cleanTitle,
  extractProject,
} from "../src/providers/mock-deterministic-extractor";
import { ExtractedItemsSchema } from "../src/domain/items";
import { generateWeeklyProposalFromItems } from "../src/application/planning-pipeline";

describe("MockProvider — Extracción determinista de notas arbitrarias", () => {
  const currentDate = "2026-10-12"; // Monday

  // --------------------------------------------------------------------------
  // 1. Regresión específica del reporte del usuario
  // --------------------------------------------------------------------------
  it("debe extraer 3 elementos independientes a partir de la nota del usuario sin truncar a 60 caracteres", async () => {
    const userNote =
      "Preparar el informe trimestral antes del jueves (6 horas). Reunión de alineación con el equipo el martes a las 10 (2 horas). Comprar café.";

    const provider = new MockProvider();
    const result = await extractItems(provider, {
      text: userNote,
      currentDate,
    });

    // Validar esquema Zod
    expect(ExtractedItemsSchema.safeParse(result).success).toBe(true);

    // Debe producir exactamente 3 elementos independientes
    expect(result.items).toHaveLength(3);

    const [item1, item2, item3] = result.items;

    // Ítem 1: Preparar informe trimestral
    expect(item1?.rawText).toBe(
      "Preparar el informe trimestral antes del jueves (6 horas)."
    );
    expect(item1?.title).toBe(
      "Preparar el informe trimestral antes del jueves"
    );
    expect(item1?.type).toBe("task");
    expect(item1?.estimatedEffort).toEqual({
      value: 6,
      unit: "hours",
      source: "user",
    });
    expect(item1?.deadline?.raw).toBe("antes del jueves");
    expect(item1?.deadline?.resolved).toBe("2026-10-15"); // Jueves de esa semana
    expect(item1?.deadline?.confidence).toBe("high");

    // Ítem 2: Reunión de alineación
    expect(item2?.rawText).toBe(
      "Reunión de alineación con el equipo el martes a las 10 (2 horas)."
    );
    expect(item2?.title).toBe(
      "Reunión de alineación con el equipo el martes a las 10"
    );
    expect(item2?.type).toBe("commitment");
    expect(item2?.commitment).toBe("external"); // involucra al equipo
    expect(item2?.estimatedEffort).toEqual({
      value: 2,
      unit: "hours",
      source: "user",
    });
    expect(item2?.deadline?.raw).toBe("el martes a las 10");
    expect(item2?.deadline?.resolved).toBe("2026-10-13"); // Martes de esa semana
    expect(item2?.deadline?.confidence).toBe("high");

    // Ítem 3: Comprar café
    expect(item3?.rawText).toBe("Comprar café.");
    expect(item3?.title).toBe("Comprar café");
    expect(item3?.type).toBe("task");
    expect(item3?.deadline).toBeNull();
    expect(item3?.estimatedEffort).toBeNull();
  });

  // --------------------------------------------------------------------------
  // 2. Nota con una sola idea
  // --------------------------------------------------------------------------
  it("debe extraer correctamente una nota con una sola idea conservando esfuerzo y fecha", async () => {
    const singleNote =
      "Revisar la configuración de seguridad del servidor mañana (3 horas).";

    const provider = new MockProvider();
    const result = await extractItems(provider, {
      text: singleNote,
      currentDate,
    });

    expect(result.items).toHaveLength(1);
    const item = result.items[0];
    expect(item?.title).toBe("Revisar la configuración de seguridad del servidor mañana");
    expect(item?.type).toBe("task");
    expect(item?.estimatedEffort).toEqual({
      value: 3,
      unit: "hours",
      source: "user",
    });
    expect(item?.deadline?.raw).toBe("mañana");
    expect(item?.deadline?.resolved).toBe("2026-10-13");
  });

  // --------------------------------------------------------------------------
  // 3. Varias ideas formateadas con viñetas o saltos de línea
  // --------------------------------------------------------------------------
  it("debe separar ideas en listas con viñetas y saltos de línea", async () => {
    const listNote = `
      - Terminar la documentación técnica (4 horas)
      - Sync con diseño el viernes a las 11
      - Investigar sobre arquitectura hexagonal
    `;

    const provider = new MockProvider();
    const result = await extractItems(provider, {
      text: listNote,
      currentDate,
    });

    expect(result.items).toHaveLength(3);
    expect(result.items[0]?.title).toBe("Terminar la documentación técnica");
    expect(result.items[0]?.estimatedEffort?.value).toBe(4);

    expect(result.items[1]?.title).toBe("Sync con diseño el viernes a las 11");
    expect(result.items[1]?.type).toBe("commitment");
    expect(result.items[1]?.deadline?.resolved).toBe("2026-10-16");

    expect(result.items[2]?.title).toBe("Investigar sobre arquitectura hexagonal");
    expect(result.items[2]?.type).toBe("idea");
  });

  // --------------------------------------------------------------------------
  // 4. Texto ambiguo o pensamiento exploratorio
  // --------------------------------------------------------------------------
  it("debe clasificar texto ambiguo como idea exploratoria sin forzarlo a tarea", async () => {
    const ambiguousText =
      "No sé si tiene sentido migrar a Postgres o si con SQLite nos sobra para el MVP ahora mismo.";

    const provider = new MockProvider();
    const result = await extractItems(provider, {
      text: ambiguousText,
      currentDate,
    });

    expect(result.items).toHaveLength(1);
    const item = result.items[0];
    expect(item?.type).toBe("idea");
    expect(item?.status).toBe("exploring");
    expect(item?.commitment).toBe("none");
  });

  // --------------------------------------------------------------------------
  // 5. Preocupación o agobio
  // --------------------------------------------------------------------------
  it("debe clasificar expresiones de agobio o preocupación como concern", async () => {
    const concernText =
      "Me preocupa no llegar con el presupuesto de fin de mes y vengo durmiendo mal.";

    const provider = new MockProvider();
    const result = await extractItems(provider, {
      text: concernText,
      currentDate,
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.type).toBe("concern");
  });

  // --------------------------------------------------------------------------
  // 6. Integración del flujo completo hacia la planificación semanal
  // --------------------------------------------------------------------------
  it("permite que los elementos extraídos de la nota del usuario alimenten la propuesta semanal sin errores", async () => {
    const userNote =
      "Preparar el informe trimestral antes del jueves (6 horas). Reunión de alineación con el equipo el martes a las 10 (2 horas). Comprar café.";

    const provider = new MockProvider();
    const extractionResult = await extractItems(provider, {
      text: userNote,
      currentDate,
    });

    const proposal = await generateWeeklyProposalFromItems(provider, {
      items: extractionResult.items,
      currentDate,
    });

    expect(proposal).toBeDefined();
    // La reunión con el equipo debe quedar preservada como obligación
    const hasObligation = proposal.obligations.some((o) =>
      o.title.toLowerCase().includes("reunión") || o.title.toLowerCase().includes("alineación")
    );
    expect(hasObligation).toBe(true);
  });

  // --------------------------------------------------------------------------
  // 7. Pruebas unitarias de las funciones auxiliares del extractor
  // --------------------------------------------------------------------------
  describe("Funciones auxiliares del extractor", () => {
    it("splitNotesIntoSegments no rompe números decimales como 2.5 horas", () => {
      const text = "Avanzar en el diseño 2.5 horas. Revisar código.";
      const segments = splitNotesIntoSegments(text);
      expect(segments).toHaveLength(2);
      expect(segments[0]).toBe("Avanzar en el diseño 2.5 horas.");
      expect(segments[1]).toBe("Revisar código.");
    });

    it("resolveDayOfWeek resuelve los días de la semana con y sin tildes", () => {
      // 2026-10-12 es Lunes
      expect(resolveDayOfWeek("2026-10-12", "martes")).toBe("2026-10-13");
      expect(resolveDayOfWeek("2026-10-12", "miércoles")).toBe("2026-10-14");
      expect(resolveDayOfWeek("2026-10-12", "miercoles")).toBe("2026-10-14");
      expect(resolveDayOfWeek("2026-10-12", "jueves")).toBe("2026-10-15");
      expect(resolveDayOfWeek("2026-10-12", "viernes")).toBe("2026-10-16");
    });

    it("extractEffort reconoce horas, minutos y días en varios formatos", () => {
      expect(extractEffort("(6 horas)")).toEqual({ value: 6, unit: "hours", source: "user" });
      expect(extractEffort("2 hs")).toEqual({ value: 2, unit: "hours", source: "user" });
      expect(extractEffort("30 mins")).toEqual({ value: 30, unit: "minutes", source: "user" });
      expect(extractEffort("1 día")).toEqual({ value: 1, unit: "days", source: "user" });
    });

    it("normalizeFusedWords separa palabras pegadas como quieroavanzar o voyahacer", () => {
      expect(normalizeFusedWords("También quieroavanzar")).toBe("También quiero avanzar");
      expect(normalizeFusedWords("voyahacer la tarea")).toBe("voy a hacer la tarea");
    });

    it("splitCoordinatedActions no rompe listas de sustantivos comunes", () => {
      const nouns = "Comprar manzanas, peras y plátanos";
      const res = splitCoordinatedActions(nouns);
      expect(res).toEqual(["Comprar manzanas, peras y plátanos"]);
    });

    it("splitCoordinatedActions separa acciones coordinadas con verbos de acción", () => {
      const actions = "Avanzar Tecnología Consciente, estudiar SOLID y seguir con ArchitectAI";
      const res = splitCoordinatedActions(actions);
      expect(res).toEqual([
        "Avanzar Tecnología Consciente",
        "estudiar SOLID",
        "seguir con ArchitectAI",
      ]);
    });

    it("extractProject reconoce proyectos clave como Tecnología Consciente y ArchitectAI", () => {
      expect(extractProject("Avanzar Tecnología Consciente")).toBe("Tecnología Consciente");
      expect(extractProject("seguir con ArchitectAI")).toBe("ArchitectAI");
      expect(extractProject("estudiar SOLID")).toBeNull();
    });

    it("cleanTitle limpia prefijos conversacionales como 'También quiero'", () => {
      expect(cleanTitle("También quiero avanzar Tecnología Consciente")).toBe(
        "Avanzar Tecnología Consciente"
      );
      expect(cleanTitle("estudiar SOLID")).toBe("Estudiar SOLID");
      expect(cleanTitle("seguir con ArchitectAI.")).toBe("Seguir con ArchitectAI");
    });
  });

  // --------------------------------------------------------------------------
  // 8. Descomposición de oraciones compuestas con múltiples acciones (caso real usuario)
  // --------------------------------------------------------------------------
  it("descompone 'También quieroavanzar Tecnología Consciente, estudiar SOLID y seguir con ArchitectAI' en 3 tareas independientes", async () => {
    const rawNote =
      "También quieroavanzar Tecnología Consciente, estudiar SOLID y seguir con ArchitectAI.";

    const provider = new MockProvider();
    const result = await extractItems(provider, {
      text: rawNote,
      currentDate,
    });

    expect(ExtractedItemsSchema.safeParse(result).success).toBe(true);
    expect(result.items).toHaveLength(3);

    const [t1, t2, t3] = result.items;

    // Tarea 1: Avanzar Tecnología Consciente
    expect(t1?.title).toBe("Avanzar Tecnología Consciente");
    expect(t1?.type).toBe("task");
    expect(t1?.status).toBe("pending");
    expect(t1?.commitment).toBe("personal");
    expect(t1?.project).toBe("Tecnología Consciente");

    // Tarea 2: Estudiar SOLID
    expect(t2?.title).toBe("Estudiar SOLID");
    expect(t2?.type).toBe("task");
    expect(t2?.status).toBe("pending");
    expect(t2?.commitment).toBe("personal");
    expect(t2?.project).toBeNull();

    // Tarea 3: Seguir con ArchitectAI
    expect(t3?.title).toBe("Seguir con ArchitectAI");
    expect(t3?.type).toBe("task");
    expect(t3?.status).toBe("pending");
    expect(t3?.commitment).toBe("personal");
    expect(t3?.project).toBe("ArchitectAI");
  });
});
