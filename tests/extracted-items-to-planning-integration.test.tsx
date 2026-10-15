import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MockProvider } from "../src/providers/mock-provider";
import { extractItems } from "../src/skills/extract-items";
import { TargetWeek } from "../src/domain/week";
import {
  generateWeeklyProposalFromItemsDetailed,
  prepareBuildWeekInputDetailed,
} from "../src/application/planning-pipeline";
import { WeeklyPlanningFromNotes } from "../src/web/components/weekly-planning-from-notes";
import { WeeklySessionReactContext, WeeklySessionContextValue } from "../src/web/context/weekly-session-context";
import { App } from "../src/web/App";

describe("Conectar Extracción y volcado con la planificación semanal", () => {
  const currentDate = "2026-10-12"; // Monday
  const userNote =
    "Preparar el informe trimestral antes del jueves (6 horas). Reunión de alineación con el equipo el martes a las 10 (2 horas). Comprar café.";

  // Helper para simular contexto de sesión en pruebas de renderizado
  function createMockSessionContext() {
    return {
      state: {
        status: "no_active_session",
        activePlan: null,
        activeSchedule: null,
        latestCloseReport: null,
        latestClosedPlan: null,
        latestClosedWeek: null,
        concurrencyConflict: null,
        memories: [],
        memoryCandidates: [],
        ambiguousPlanIds: [],
        inconsistencyReason: null,
        errorMessage: null,
      },
      service: {
        getPendingCarryOverTasks: vi.fn().mockResolvedValue([]),
        createOrSavePlanAndSchedule: vi.fn(),
      } as any,
      controller: {} as any,
      reloadSession: vi.fn(),
      createOrSavePlan: vi.fn(),
      applyAdjustment: vi.fn(),
      closeWeek: vi.fn(),
      confirmMemoryCandidate: vi.fn(),
      confirmMemoryOperation: vi.fn(),
      purgeSession: vi.fn(),
      resolveAmbiguity: vi.fn(),
    } as unknown as WeeklySessionContextValue;
  }

  it("1. Extrae los tres elementos independientes con metadatos reales y los valida", async () => {
    const provider = new MockProvider();
    const extractionResult = await extractItems(provider, {
      text: userNote,
      currentDate,
    });

    expect(extractionResult.items).toHaveLength(3);

    const [itemReport, itemMeeting, itemCoffee] = extractionResult.items;

    // Ítem 1: Informe trimestral
    expect(itemReport?.id).toBe("item-mock-1");
    expect(itemReport?.title).toContain("Preparar el informe trimestral");
    expect(itemReport?.type).toBe("task");
    expect(itemReport?.estimatedEffort).toEqual({
      value: 6,
      unit: "hours",
      source: "user",
    });
    expect(itemReport?.deadline?.resolved).toBe("2026-10-15");

    // Ítem 2: Reunión de alineación
    expect(itemMeeting?.id).toBe("item-mock-2");
    expect(itemMeeting?.title).toContain("Reunión de alineación");
    expect(itemMeeting?.commitment).toBe("external");
    expect(itemMeeting?.estimatedEffort).toEqual({
      value: 2,
      unit: "hours",
      source: "user",
    });
    expect(itemMeeting?.deadline?.resolved).toBe("2026-10-13");

    // Ítem 3: Comprar café
    expect(itemCoffee?.id).toBe("item-mock-3");
    expect(itemCoffee?.title).toBe("Comprar café");
    expect(itemCoffee?.type).toBe("task");
    expect(itemCoffee?.estimatedEffort).toBeNull();
    expect(itemCoffee?.deadline).toBeNull();
  });

  it("2. Convierte los elementos extraídos a BuildWeekInput sin perder información ni inventar datos", async () => {
    const provider = new MockProvider();
    const extractionResult = await extractItems(provider, {
      text: userNote,
      currentDate,
    });

    const targetWeek: TargetWeek = {
      startDate: "2026-10-19",
      endDate: "2026-10-25",
    };

    const preparedResult = await prepareBuildWeekInputDetailed(provider, {
      items: extractionResult.items,
      currentDate,
      targetWeek,
      userIntent: "Foco en ordenar tareas y compromisos",
    });

    const input = preparedResult.input;

    // Invariante: Preservación de identidad de los elementos
    expect(input.items).toHaveLength(3);
    expect(input.items.map((i) => i.id)).toEqual([
      "item-mock-1",
      "item-mock-2",
      "item-mock-3",
    ]);

    // Invariante: Preservación de estimaciones originales
    const reportItem = input.items.find((i) => i.id === "item-mock-1");
    expect(reportItem?.estimatedEffort?.value).toBe(6);
    expect(reportItem?.estimatedEffort?.unit).toBe("hours");

    // Invariante: Preservación de fechas límite originales
    expect(reportItem?.deadline?.resolved).toBe("2026-10-15");

    // Invariante: Preservación de semana objetivo seleccionada
    expect(input.targetWeek).toEqual(targetWeek);
  });

  it("3. Genera una propuesta donde el informe con deadline anterior a la semana objetivo se preserva en deferredItems con explicación clara", async () => {
    const provider = new MockProvider();
    const extractionResult = await extractItems(provider, {
      text: userNote,
      currentDate,
    });

    // Semana objetivo: semana posterior (2026-10-19 .. 2026-10-25).
    // El informe tiene deadline 2026-10-15 (anterior a la semana objetivo).
    const targetWeek: TargetWeek = {
      startDate: "2026-10-19",
      endDate: "2026-10-25",
    };

    const detailedPlan = await generateWeeklyProposalFromItemsDetailed(provider, {
      items: extractionResult.items,
      currentDate,
      targetWeek,
    });

    expect(detailedPlan.proposal).toBeDefined();
    const proposal = detailedPlan.proposal;

    // Verificar que la propuesta usa la semana objetivo solicitada
    expect(proposal.weekSummary.targetWeek).toEqual(targetWeek);

    // El informe (item-mock-1, vencido respecto a la semana 19..25) DEBE estar en deferredItems
    const deferredReport = proposal.deferredItems.find(
      (d) => d.itemId === "item-mock-1"
    );

    expect(deferredReport).toBeDefined();
    expect(deferredReport?.title).toContain("informe trimestral");
    expect(deferredReport?.reason).toBe("not_scheduled");
    expect(deferredReport?.rationale).toBeDefined();
    expect(deferredReport?.rationale.length).toBeGreaterThan(10);

    // No se activó ni persistió automáticamente (invariante de soberanía humana)
    expect(proposal.confirmationPrompt).toBeDefined();
    expect(proposal.confirmationPrompt.question).toBeTruthy();
  });

  it("4. WeeklyPlanningFromNotes renderiza los elementos transferidos y la sección diferida del informe con su motivo", async () => {
    const provider = new MockProvider();
    const extractionResult = await extractItems(provider, {
      text: userNote,
      currentDate,
    });

    const mockContext = createMockSessionContext();

    // Renderizamos WeeklyPlanningFromNotes con initialItems cargados desde la extracción
    const htmlWithTransferred = renderToStaticMarkup(
      <WeeklySessionReactContext.Provider value={mockContext}>
        <WeeklyPlanningFromNotes
          provider={provider}
          currentDate={currentDate}
          initialItems={extractionResult.items}
        />
      </WeeklySessionReactContext.Provider>
    );

    // 1. Debe mostrar el banner de elementos transferidos
    expect(htmlWithTransferred).toContain("transferred-items-notice");
    expect(htmlWithTransferred).toContain("Se cargaron 3 elemento(s) extraídos");

    // 2. Debe permitir seleccionar la semana objetivo
    expect(htmlWithTransferred).toContain("target-week-start-input");
    expect(htmlWithTransferred).toContain("target-week-end-input");

    // 3. Debe mostrar los tres elementos extraídos listos para revisión
    expect(htmlWithTransferred).toContain("Preparar el informe trimestral");
    expect(htmlWithTransferred).toContain("Reunión de alineación con el equipo");
    expect(htmlWithTransferred).toContain("Comprar café");
  });

  it("5. App renderiza la navegación y secciones de volcado y ciclo semanal", () => {
    const mockContext = createMockSessionContext();
    const html = renderToStaticMarkup(<App service={mockContext.service} initialTab="dump" />);
    expect(html).toContain("Tecnología Consciente");
    expect(html).toContain("1. Capturar ideas");
    expect(html).toContain("¿Qué tienes en la cabeza?");
  });

  it("6. Muestra la propuesta semanal con el informe vencido en deferredItems y su explicación clara", async () => {
    const provider = new MockProvider();
    const extractionResult = await extractItems(provider, {
      text: userNote,
      currentDate,
    });

    const targetWeek: TargetWeek = {
      startDate: "2026-10-19",
      endDate: "2026-10-25",
    };

    const detailedPlan = await generateWeeklyProposalFromItemsDetailed(provider, {
      items: extractionResult.items,
      currentDate,
      targetWeek,
    });

    const mockContext = createMockSessionContext();

    const htmlWithProposal = renderToStaticMarkup(
      <WeeklySessionReactContext.Provider value={mockContext}>
        <WeeklyPlanningFromNotes
          provider={provider}
          currentDate={currentDate}
          initialProposedWeek={detailedPlan.proposal}
        />
      </WeeklySessionReactContext.Provider>
    );

    // Debe mostrar la sección de elementos diferidos
    expect(htmlWithProposal).toContain("proposed-deferred-items-section");
    expect(htmlWithProposal).toContain("Elementos no programados o diferidos");

    // Debe mostrar el informe trimestral
    expect(htmlWithProposal).toContain("proposed-deferred-item-item-mock-1");
    expect(htmlWithProposal).toContain("Preparar el informe trimestral");

    // Debe mostrar la insignia 'Sin programar en la semana'
    expect(htmlWithProposal).toContain("Sin programar en la semana");

    // Debe mostrar la explicación clara (rationale)
    expect(htmlWithProposal).toContain("proposed-deferred-rationale-item-mock-1");
  });
});
