import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { WeeklySessionView } from "../src/web/components/weekly-session-view";
import { WeeklyPlanningFromNotes } from "../src/web/components/weekly-planning-from-notes";
import {
  WeeklySessionReactContext,
  WeeklySessionContextValue,
  initialWeeklySessionState,
} from "../src/web/context/weekly-session-context";
import { MockProvider } from "../src/providers/mock-provider";
import { StoredWeeklyPlan } from "../src/domain/repositories/types";
import { WeeklySchedule } from "../src/domain/schedule";
import { TargetWeek, ProposedWeek } from "../src/domain/week";
import { ExtractedItem } from "../src/domain/items";

const mockProvider = new MockProvider();

function createSampleProposal(targetWeek: TargetWeek): ProposedWeek {
  return {
    weekSummary: {
      targetWeek,
      capacity: {
        totalAvailableHours: 20,
        plannableHours: 15,
        plannedHours: 8,
        knownEstimatedHours: 8,
        estimationCompleteness: "complete",
        protectedSpaceHours: 5,
        capacityStatus: "within_capacity",
        protectedSpaceStatus: "respected",
      },
      intent: "Semana activa",
    },
    foci: [
      {
        id: "focus-1",
        title: "Foco Principal",
        desiredOutcome: "Resultado",
        rationale: "Razón",
        contributingItemIds: ["item-1"],
        estimatedHours: 4,
      },
    ],
    obligations: [
      {
        itemId: "item-2",
        title: "Obligación",
        commitmentType: "strict_deadline",
        rationale: "Razón",
        estimatedHours: 4,
      },
    ],
    flexibleOptions: [],
    deferredItems: [],
    unplannedSpace: {
      recommendedHours: 5,
      rationale: "Espacio protegido",
    },
    confirmationPrompt: {
      question: "¿Confirmar?",
      keyTradeoffs: [],
      pendingQuestions: [],
    },
  };
}

describe("Claridad de Navegación y Ajuste de Elementos en Preparación", () => {
  const activeTargetWeek: TargetWeek = {
    startDate: "2026-10-19",
    endDate: "2026-10-25",
  };

  const activePlan: StoredWeeklyPlan = {
    planId: "plan-active-1019",
    status: "active",
    targetWeek: activeTargetWeek,
    proposal: createSampleProposal(activeTargetWeek),
    createdAt: "2026-10-19T08:00:00.000Z",
    updatedAt: "2026-10-19T08:00:00.000Z",
  };

  const activeSchedule: WeeklySchedule = {
    scheduleId: "sched-active-1019",
    planId: "plan-active-1019",
    weekRange: activeTargetWeek,
    timeBlocks: [],
    dailyAllocations: [
      { day: "2026-10-19", allocatedHours: 4, itemId: "item-1" },
    ],
    dayConstraints: [],
    appliedAdjustments: [],
    version: 4,
    createdAt: "2026-10-19T08:00:00.000Z",
    updatedAt: "2026-10-19T08:00:00.000Z",
  };

  const draftTargetWeek: TargetWeek = {
    startDate: "2026-10-26",
    endDate: "2026-11-01",
  };

  const draftPlan: StoredWeeklyPlan = {
    planId: "draft-2026-10-26",
    status: "draft",
    targetWeek: draftTargetWeek,
    proposal: createSampleProposal(draftTargetWeek),
    createdAt: "2026-10-19T09:00:00.000Z",
    updatedAt: "2026-10-19T09:00:00.000Z",
  };

  const dummyContext: WeeklySessionContextValue = {
    state: {
      ...initialWeeklySessionState,
      status: "session_resumed",
      activePlan,
      activeSchedule,
      latestCloseReport: null,
      memories: [],
      draftPlan,
      draftPlans: [draftPlan],
    },
    service: {} as any,
    controller: {} as any,
    reloadSession: vi.fn(),
    createOrSavePlan: vi.fn(),
    applyAdjustment: vi.fn(),
    closeWeek: vi.fn(),
    saveDraftPlan: vi.fn(),
    clearDraftPlan: vi.fn(),
    confirmMemoryCandidate: vi.fn(),
    confirmMemoryOperation: vi.fn(),
    purgeSession: vi.fn(),
    resolveAmbiguity: vi.fn(),
  };

  it("WeeklySessionView en espacio 'active' NO renderiza el formulario embebido de planificación de próxima semana", () => {
    const html = renderToStaticMarkup(
      <WeeklySessionReactContext.Provider value={dummyContext}>
        <WeeklySessionView
          provider={mockProvider}
          activeSpace="active"
          onNavigateSpace={vi.fn()}
        />
      </WeeklySessionReactContext.Provider>
    );

    // Debe contener el botón de navegación limpia a la preparación
    expect(html).toContain("data-testid=\"nav-to-prepare-button\"");
    expect(html).toContain("🗓️ Preparar próxima semana");

    // NO debe contener el formulario embebido de planificación en el medio de la vista activa
    expect(html).not.toContain("data-testid=\"visible-future-planning-section\"");
    expect(html).not.toContain("Planificación futura y tareas postergadas");
  });

  it("WeeklyPlanningFromNotes calcula la semana siguiente por defecto cuando existe una semana activa", () => {
    const html = renderToStaticMarkup(
      <WeeklySessionReactContext.Provider value={dummyContext}>
        <WeeklyPlanningFromNotes provider={mockProvider} />
      </WeeklySessionReactContext.Provider>
    );

    // Habiendo activa la semana 2026-10-19 al 2026-10-25, la semana propuesta por defecto debe ser 2026-10-26 al 2026-11-01
    expect(html).toContain("value=\"2026-10-26\"");
    expect(html).toContain("value=\"2026-11-01\"");
  });

  it("WeeklyPlanningFromNotes incluye inputs para editar horas estimadas y fecha límite en cada tarjeta de elemento identificado", () => {
    const sampleItems: ExtractedItem[] = [
      {
        id: "item-pg",
        title: "Evaluar Postgres vs SQLite",
        type: "idea",
        rawText: "Evaluar Postgres vs SQLite",
      },
      {
        id: "item-paper",
        title: "Leer paper de Google sobre agentes",
        type: "idea",
        rawText: "Leer paper de Google sobre agentes",
      },
    ];

    const html = renderToStaticMarkup(
      <WeeklySessionReactContext.Provider value={dummyContext}>
        <WeeklyPlanningFromNotes
          provider={mockProvider}
          initialItems={sampleItems}
        />
      </WeeklySessionReactContext.Provider>
    );

    // Debe mostrar inputs de horas estimadas para los elementos
    expect(html).toContain("aria-label=\"Horas estimadas para Evaluar Postgres vs SQLite\"");
    expect(html).toContain("aria-label=\"Horas estimadas para Leer paper de Google sobre agentes\"");

    // Debe mostrar inputs de fecha límite para los elementos
    expect(html).toContain("aria-label=\"Fecha límite para Evaluar Postgres vs SQLite\"");
    expect(html).toContain("aria-label=\"Fecha límite para Leer paper de Google sobre agentes\"");
  });

  it("WeeklyPlanningFromNotes muestra badge de 'Borrador en cuaderno local' al visualizar la propuesta", () => {
    const html = renderToStaticMarkup(
      <WeeklySessionReactContext.Provider value={dummyContext}>
        <WeeklyPlanningFromNotes
          provider={mockProvider}
          initialProposedWeek={createSampleProposal(draftTargetWeek)}
        />
      </WeeklySessionReactContext.Provider>
    );

    expect(html).toContain("data-testid=\"draft-notebook-status-badge\"");
    expect(html).toContain("📒 Borrador en cuaderno local");
  });

  it("WeeklyPlanningFromNotes agrupa el desglose de cálculos y viabilidad en un desplegable 'calm-details'", () => {
    const html = renderToStaticMarkup(
      <WeeklySessionReactContext.Provider value={dummyContext}>
        <WeeklyPlanningFromNotes
          provider={mockProvider}
          initialProposedWeek={createSampleProposal(draftTargetWeek)}
        />
      </WeeklySessionReactContext.Provider>
    );

    expect(html).toContain("data-testid=\"planning-capacity-details\"");
    expect(html).toContain("Ver desglose completo de cálculos y viabilidad");
  });

  it("WeeklySessionView muestra horas calculadas parciales en vez de 'Por definir' cuando hay estimación parcial", () => {
    const partialProposal = createSampleProposal(activeTargetWeek);
    partialProposal.weekSummary.capacity = {
      totalAvailableHours: 25,
      plannableHours: 18.75,
      plannedHours: null,
      knownEstimatedHours: 22,
      estimationCompleteness: "partial",
      protectedSpaceHours: 6.25,
      capacityStatus: "over_capacity",
      protectedSpaceStatus: "compromised",
    };

    const partialPlan: StoredWeeklyPlan = {
      ...activePlan,
      proposal: partialProposal,
    };

    const partialContext: WeeklySessionContextValue = {
      ...dummyContext,
      state: {
        ...dummyContext.state,
        activePlan: partialPlan,
      },
    };

    const html = renderToStaticMarkup(
      <WeeklySessionReactContext.Provider value={partialContext}>
        <WeeklySessionView provider={mockProvider} activeSpace="active" />
      </WeeklySessionReactContext.Provider>
    );

    // Muestra las 22h calculadas parcialmente indicando que el total está por definir
    expect(html).toContain("22h (parcial · Por definir total)");
    expect(html).toContain("~22h asignadas (parcial)");
  });

  it("WeeklyPlanningFromNotes incluye botones de 'Elegir como foco' y 'Ajustar horas' en las opciones flexibles", () => {
    const proposalWithFlexible = createSampleProposal(draftTargetWeek);
    proposalWithFlexible.foci = [];
    proposalWithFlexible.obligations = [];
    proposalWithFlexible.flexibleOptions = [
      {
        itemId: "item-pg",
        title: "Evaluar Postgres vs SQLite para MVP",
        condition: "Oportunidad flexible o exploratoria",
        estimatedHours: 2,
      },
      {
        itemId: "item-paper",
        title: "Leer paper de Google sobre agentes",
        condition: "Oportunidad flexible o exploratoria",
        estimatedHours: 2,
      },
    ];

    const html = renderToStaticMarkup(
      <WeeklySessionReactContext.Provider value={dummyContext}>
        <WeeklyPlanningFromNotes
          provider={mockProvider}
          initialProposedWeek={proposalWithFlexible}
        />
      </WeeklySessionReactContext.Provider>
    );

    // Debe contener los botones de acción en opciones flexibles
    expect(html).toContain("data-testid=\"promote-flexible-to-focus-item-pg\"");
    expect(html).toContain("⭐ Elegir como foco");
    expect(html).toContain("data-testid=\"adjust-flexible-hours-item-pg\"");
    expect(html).toContain("⏱️ Ajustar horas");

    // En carga planificada debe desglosar las horas flexibles en lugar de mostrar 'Sin estimar' confuso
    expect(html).toContain("0h fijas (~4h flexibles)");
    expect(html).toContain("Opciones flexibles (2)");
    expect(html).toContain("Capacidad disponible (4h flexibles)");
  });
});

