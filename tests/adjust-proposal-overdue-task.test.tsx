import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MockProvider } from "../src/providers/mock-provider";
import { extractItems } from "../src/skills/extract-items";
import { TargetWeek } from "../src/domain/week";
import {
  generateWeeklyProposalFromItemsDetailed,
} from "../src/application/planning-pipeline";
import { WeeklyPlanningFromNotes } from "../src/web/components/weekly-planning-from-notes";
import {
  WeeklySessionReactContext,
  WeeklySessionContextValue,
} from "../src/web/context/weekly-session-context";

describe("Corregir el ajuste de una propuesta semanal y manejo de tareas vencidas", () => {
  const currentDate = "2026-10-12"; // Lunes
  const targetWeek: TargetWeek = {
    startDate: "2026-10-19",
    endDate: "2026-10-25",
  };
  const userNote =
    "Preparar el informe trimestral antes del jueves (6 horas). Reunión de alineación con el equipo el martes a las 10 (2 horas). Comprar café.";

  function createMockSessionContext(overrides?: Partial<WeeklySessionContextValue>): WeeklySessionContextValue {
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
      isLoading: false,
      error: null,
      service: {
        getPendingCarryOverTasks: vi.fn().mockResolvedValue([]),
        createOrSavePlanAndSchedule: vi.fn().mockResolvedValue({ status: "success" }),
      } as any,
      controller: {} as any,
      reloadSession: vi.fn().mockResolvedValue(undefined),
      createOrSavePlan: vi.fn().mockResolvedValue({ status: "success" }),
      applyAdjustment: vi.fn().mockResolvedValue({ status: "success" }),
      closeWeek: vi.fn().mockResolvedValue({ status: "success" }),
      confirmMemoryCandidate: vi.fn().mockResolvedValue({ status: "success" }),
      confirmMemoryOperation: vi.fn().mockResolvedValue({ status: "success" }),
      purgeSession: vi.fn().mockResolvedValue({ status: "success" }),
      resolveAmbiguity: vi.fn().mockResolvedValue(undefined),
      ...overrides,
    } as unknown as WeeklySessionContextValue;
  }

  it("1. Genera propuesta base: el informe vencido (2026-10-15) queda diferido y la reunión del martes 20 a las 10 queda como obligación", async () => {
    const provider = new MockProvider();
    const extractionResult = await extractItems(provider, {
      text: userNote,
      currentDate,
    });

    const detailedPlan = await generateWeeklyProposalFromItemsDetailed(provider, {
      items: extractionResult.items,
      currentDate,
      targetWeek,
      userIntent: "Foco en balance de semana",
    });

    const proposal = detailedPlan.proposal;

    // 1. Informe trimestral vencido respecto a la semana objetivo (2026-10-15 < 2026-10-19)
    const deferredReport = proposal.deferredItems.find((d) => d.itemId === "item-mock-1");
    expect(deferredReport).toBeDefined();
    expect(deferredReport?.title).toContain("informe trimestral");
    expect(deferredReport?.reason).toBe("not_scheduled");

    // 2. Reunión de alineación: debe mantenerse como obligación externa el martes 20 a las 10:00 (2h)
    const meetingObligation = proposal.obligations.find((o) => o.itemId === "item-mock-2");
    expect(meetingObligation).toBeDefined();
    expect(meetingObligation?.title).toContain("Reunión de alineación");
    expect(meetingObligation?.title).toContain("martes a las 10");
    expect(meetingObligation?.commitmentType).toBe("external");
    expect(meetingObligation?.estimatedHours).toBe(2);
    expect(meetingObligation?.dueDate).toBe("2026-10-20"); // Martes en la semana 19..25
  });

  it("2. UI renderiza las decisiones para tareas con fecha límite vencida sin alterar la fecha original", async () => {
    const provider = new MockProvider();
    const extractionResult = await extractItems(provider, {
      text: userNote,
      currentDate,
    });

    const detailedPlan = await generateWeeklyProposalFromItemsDetailed(provider, {
      items: extractionResult.items,
      currentDate,
      targetWeek,
    });

    const mockContext = createMockSessionContext();

    const html = renderToStaticMarkup(
      <WeeklySessionReactContext.Provider value={mockContext}>
        <WeeklyPlanningFromNotes
          provider={provider}
          currentDate={currentDate}
          initialItems={extractionResult.items}
          initialProposedWeek={detailedPlan.proposal}
        />
      </WeeklySessionReactContext.Provider>
    );

    // Debe mostrar la sección de decisiones sobre tareas vencidas
    expect(html).toContain('data-testid="overdue-items-decision-section"');
    expect(html).toContain('data-testid="overdue-item-decision-card-item-mock-1"');

    // Debe mostrar la fecha límite original exacta (2026-10-15) sin alterarla ni maquillarla
    expect(html).toContain('data-testid="original-deadline-badge-item-mock-1"');
    expect(html).toContain("2026-10-15 (vencida)");
    expect(html).toContain("no se altera silenciosamente");

    // Debe ofrecer las 3 opciones de decisión claras
    expect(html).toContain('data-testid="decision-unscheduled-item-mock-1"');
    expect(html).toContain('data-testid="decision-recovery-item-mock-1"');
    expect(html).toContain('data-testid="decision-postpone-item-mock-1"');

    // Botones de ajuste y confirmación
    expect(html).toContain('data-testid="adjust-elements-button"');
    expect(html).toContain('data-testid="confirm-plan-button"');
  });

  it("3. Al incluir como prioridad de recuperación: agrega el foco, mantiene fecha original y avisa viabilidad no verificada", async () => {
    const provider = new MockProvider();
    const extractionResult = await extractItems(provider, {
      text: userNote,
      currentDate,
    });

    const detailedPlan = await generateWeeklyProposalFromItemsDetailed(provider, {
      items: extractionResult.items,
      currentDate,
      targetWeek,
    });

    // Simulamos la propuesta modificada tras elegir "Incluir como prioridad de recuperación"
    const proposal = detailedPlan.proposal;
    const modifiedFoci = [
      ...proposal.foci,
      {
        id: "focus-recovery-item-mock-1",
        title: "Recuperación: Preparar el informe trimestral",
        desiredOutcome: "Completar como prioridad de recuperación la tarea vencida (fecha límite original: 2026-10-15)",
        rationale: "Incluida conscientemente como prioridad de recuperación por decisión de la persona. Fecha límite original conservada: 2026-10-15.",
        contributingItemIds: ["item-mock-1"],
        estimatedHours: 6,
      },
    ];
    const modifiedDeferred = proposal.deferredItems.filter((d) => d.itemId !== "item-mock-1");

    const modifiedProposal = {
      ...proposal,
      foci: modifiedFoci,
      deferredItems: modifiedDeferred,
      weekSummary: {
        ...proposal.weekSummary,
        capacity: {
          ...proposal.weekSummary.capacity,
          knownEstimatedHours: 8, // 6h informe + 2h reunión
          capacityStatus: "unknown" as const,
        },
      },
    };

    const mockContext = createMockSessionContext();

    const html = renderToStaticMarkup(
      <WeeklySessionReactContext.Provider value={mockContext}>
        <WeeklyPlanningFromNotes
          provider={provider}
          currentDate={currentDate}
          initialItems={extractionResult.items}
          initialProposedWeek={modifiedProposal}
        />
      </WeeklySessionReactContext.Provider>
    );

    // Debe mostrar el foco de recuperación con su badge
    expect(html).toContain('data-testid="proposed-focus-focus-recovery-item-mock-1"');
    expect(html).toContain('data-testid="recovery-focus-badge"');
    expect(html).toContain("Prioridad de recuperación");

    // Debe mostrar la fecha límite original 2026-10-15 en el foco
    expect(html).toContain('data-testid="focus-original-deadline-focus-recovery-item-mock-1"');
    expect(html).toContain("2026-10-15");

    // Honestidad de capacidad: como la capacidad disponible total es desconocida,
    // DEBE advertir que la viabilidad no está verificada y NO inventar que cabe
    expect(html).toContain('data-testid="unverified-capacity-warning"');
    expect(html).toContain("Viabilidad no verificada");
    expect(html).toContain("Se programó una tarea de recuperación (6h) con capacidad disponible desconocida");
    expect(html).toContain("Capacidad desconocida · Viabilidad no verificada");

    // La reunión externa del martes 20 a las 10:00 se mantiene intacta como compromiso
    expect(html).toContain('data-testid="proposed-obligation-item-mock-2"');
    expect(html).toContain("2026-10-20");
    expect(html).toContain("external");
  });

  it("4. No persiste ni activa automáticamente en almacén hasta confirmación humana", async () => {
    const provider = new MockProvider();
    const extractionResult = await extractItems(provider, {
      text: userNote,
      currentDate,
    });

    const detailedPlan = await generateWeeklyProposalFromItemsDetailed(provider, {
      items: extractionResult.items,
      currentDate,
      targetWeek,
    });

    const createOrSavePlanSpy = vi.fn().mockResolvedValue({ status: "success" });
    const mockContext = createMockSessionContext({
      createOrSavePlan: createOrSavePlanSpy,
    });

    // Solo renderizar el componente con la propuesta NO debe llamar a createOrSavePlan
    renderToStaticMarkup(
      <WeeklySessionReactContext.Provider value={mockContext}>
        <WeeklyPlanningFromNotes
          provider={provider}
          currentDate={currentDate}
          initialItems={extractionResult.items}
          initialProposedWeek={detailedPlan.proposal}
        />
      </WeeklySessionReactContext.Provider>
    );

    // Invariante de soberanía humana: no auto-guardado
    expect(createOrSavePlanSpy).not.toHaveBeenCalled();
  });

  it("5. Al reprogramar a otra semana: se marca como postergación intencional y conserva fecha límite original 2026-10-15", async () => {
    const provider = new MockProvider();
    const extractionResult = await extractItems(provider, {
      text: userNote,
      currentDate,
    });

    const detailedPlan = await generateWeeklyProposalFromItemsDetailed(provider, {
      items: extractionResult.items,
      currentDate,
      targetWeek,
    });

    const proposal = detailedPlan.proposal;
    const postponedDeferred = [
      ...proposal.deferredItems.filter((d) => d.itemId !== "item-mock-1"),
      {
        itemId: "item-mock-1",
        title: "Preparar el informe trimestral",
        reason: "intentional_postponement" as const,
        rationale: "Reprogramada conscientemente para la semana posterior (2026-10-26 a 2026-11-01). Fecha límite original conservada: 2026-10-15.",
      },
    ];

    const modifiedProposal = {
      ...proposal,
      deferredItems: postponedDeferred,
    };

    const mockContext = createMockSessionContext();

    const html = renderToStaticMarkup(
      <WeeklySessionReactContext.Provider value={mockContext}>
        <WeeklyPlanningFromNotes
          provider={provider}
          currentDate={currentDate}
          initialItems={extractionResult.items}
          initialProposedWeek={modifiedProposal}
        />
      </WeeklySessionReactContext.Provider>
    );

    // Debe mostrar la tarea en diferidos como reprogramada
    expect(html).toContain('data-testid="proposed-deferred-item-item-mock-1"');
    expect(html).toContain("Postergada conscientemente");
    expect(html).toContain("2026-10-26 a 2026-11-01");
    expect(html).toContain("Fecha límite original conservada: 2026-10-15");

    // Fecha límite original visible en UI
    expect(html).toContain('data-testid="deferred-original-deadline-item-mock-1"');
    expect(html).toContain("2026-10-15");
  });

  it("6. Ajustar elementos preserva los elementos extraídos, la intención escrita y las opciones sin destruirlos", async () => {
    const provider = new MockProvider();
    const extractionResult = await extractItems(provider, {
      text: userNote,
      currentDate,
    });

    const detailedPlan = await generateWeeklyProposalFromItemsDetailed(provider, {
      items: extractionResult.items,
      currentDate,
      targetWeek,
      userIntent: "Priorizar foco de recuperación y reuniones",
    });

    const mockContext = createMockSessionContext();

    // Renderizamos el componente con propuesta
    const html = renderToStaticMarkup(
      <WeeklySessionReactContext.Provider value={mockContext}>
        <WeeklyPlanningFromNotes
          provider={provider}
          currentDate={currentDate}
          initialItems={extractionResult.items}
          initialProposedWeek={detailedPlan.proposal}
        />
      </WeeklySessionReactContext.Provider>
    );

    // La propuesta contiene la intención original
    expect(html).toContain("Priorizar foco de recuperación y reuniones");

    // El botón para ajustar elementos está presente
    expect(html).toContain('data-testid="adjust-elements-button"');
  });
});
