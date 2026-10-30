import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { indexedDB as fakeIDB, IDBKeyRange as fakeKeyRange } from "fake-indexeddb";
import { MockProvider } from "../src/providers/mock-provider";
import { extractItems } from "../src/skills/extract-items";
import { TargetWeek, ProposedWeek } from "../src/domain/week";
import { calculateWeeklyCapacity } from "../src/skills/build-week/deterministic";
import { generateWeeklyProposalFromItemsDetailed } from "../src/application/planning-pipeline";
import { WeeklyPlanningFromNotes } from "../src/web/components/weekly-planning-from-notes";
import { WeeklySessionView } from "../src/web/components/weekly-session-view";
import {
  WeeklySessionReactContext,
  WeeklySessionContextValue,
} from "../src/web/context/weekly-session-context";
import { createIndexedDbStorage, deleteDatabase } from "../src/infrastructure/storage/indexeddb";
import { WeeklySessionService } from "../src/application/weekly-session-service";
import { StoredWeeklyPlan } from "../src/domain/repositories/types";

describe("Mejoras de capacidad: Separación visual, eliminación de redundancia, accesibilidad y persistencia", () => {
  const currentDate = "2026-10-12";
  const targetWeek: TargetWeek = {
    startDate: "2026-10-19",
    endDate: "2026-10-25",
  };
  const userNote =
    "Preparar el informe trimestral antes del jueves (6 horas). Reunión de alineación con el equipo el martes a las 10 (2 horas). Comprar café.";

  const TEST_DB_NAME = "conscious_tech_capacity_test_db";

  if (typeof globalThis.IDBKeyRange === "undefined") {
    (globalThis as unknown as { IDBKeyRange: typeof fakeKeyRange }).IDBKeyRange = fakeKeyRange;
  }

  beforeEach(async () => {
    await deleteDatabase(TEST_DB_NAME, fakeIDB);
  });

  function createMockSessionContext(
    overrides?: Partial<WeeklySessionContextValue>
  ): WeeklySessionContextValue {
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
        draftPlan: null,
      },
      isLoading: false,
      error: null,
      service: {
        getPendingCarryOverTasks: vi.fn().mockResolvedValue([]),
        createOrSavePlanAndSchedule: vi.fn().mockResolvedValue({ status: "success" }),
        saveDraftPlan: vi.fn().mockResolvedValue({ status: "success" }),
        getDraftPlan: vi.fn().mockResolvedValue(null),
        clearDraftPlan: vi.fn().mockResolvedValue(undefined),
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
      saveDraftPlan: vi.fn().mockResolvedValue({ status: "success" }),
      clearDraftPlan: vi.fn().mockResolvedValue(undefined),
      ...overrides,
    } as unknown as WeeklySessionContextValue;
  }

  it("1. Separación visual: 'Desconocido' y '8 h planificadas' aparecen en paneles independientes y no en badges pegadas", async () => {
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
    const modifiedFoci = [
      ...proposal.foci,
      {
        id: "focus-recovery-item-mock-1",
        title: "Recuperación: Preparar el informe trimestral",
        desiredOutcome: "Completar como prioridad de recuperación la tarea vencida",
        rationale: "Incluida conscientemente como prioridad de recuperación",
        contributingItemIds: ["item-mock-1"],
        estimatedHours: 6,
      },
    ];

    const proposalWith8Hours = {
      ...proposal,
      foci: modifiedFoci,
      weekSummary: {
        ...proposal.weekSummary,
        capacity: {
          ...proposal.weekSummary.capacity,
          totalAvailableHours: null,
          plannableHours: null,
          protectedSpaceHours: null,
          plannedHours: 8,
          knownEstimatedHours: 8,
          estimationCompleteness: "complete" as const,
          capacityStatus: "unknown" as const,
          protectedSpaceStatus: "unknown" as const,
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
          initialProposedWeek={proposalWith8Hours}
        />
      </WeeklySessionReactContext.Provider>
    );

    // 1. Debe existir la sección general de capacidad con contenedor calm-box
    expect(html).toContain('data-testid="planning-capacity-section"');

    // 2. Debe renderizar el Panel 1 exclusivo para límites de tiempo y disponibilidad
    expect(html).toContain('data-testid="planning-time-boundaries-card"');
    expect(html).toContain("Límites de tiempo y disponibilidad");
    expect(html).toContain('data-testid="planning-available-hours"');
    expect(html).toContain("No registrado");
    expect(html).toContain('data-testid="planning-plannable-hours"');
    expect(html).toContain("Desconocido");
    expect(html).toContain('data-testid="planning-protected-space-hours"');

    // 3. Debe renderizar el Panel 2 exclusivo para carga planificada y viabilidad
    expect(html).toContain('data-testid="planning-workload-viability-card"');
    expect(html).toContain("Carga planificada y viabilidad");
    expect(html).toContain('data-testid="planning-planned-hours"');
    expect(html).toContain("8h");

    // 4. Invariante: las dos métricas residen en tarjetas separadas
    const timeBoundariesIndex = html.indexOf('data-testid="planning-time-boundaries-card"');
    const workloadViabilityIndex = html.indexOf('data-testid="planning-workload-viability-card"');
    const plannableIndex = html.indexOf('data-testid="planning-plannable-hours"');
    const plannedIndex = html.indexOf('data-testid="planning-planned-hours"');

    expect(timeBoundariesIndex).toBeGreaterThan(-1);
    expect(workloadViabilityIndex).toBeGreaterThan(timeBoundariesIndex);
    expect(plannableIndex).toBeGreaterThan(timeBoundariesIndex);
    expect(plannableIndex).toBeLessThan(workloadViabilityIndex);
    expect(plannedIndex).toBeGreaterThan(workloadViabilityIndex);
  });

  it("2. Permite registrar horas reales disponibles y espacio a proteger en la preparación (Step 2)", async () => {
    const provider = new MockProvider();
    const extractionResult = await extractItems(provider, {
      text: userNote,
      currentDate,
    });

    const mockContext = createMockSessionContext();

    const html = renderToStaticMarkup(
      <WeeklySessionReactContext.Provider value={mockContext}>
        <WeeklyPlanningFromNotes
          provider={provider}
          currentDate={currentDate}
          initialItems={extractionResult.items}
        />
      </WeeklySessionReactContext.Provider>
    );

    // Debe mostrar la sección de pre-configuración de capacidad en el paso 2
    expect(html).toContain('data-testid="planning-capacity-pre-config"');
    expect(html).toContain('data-testid="planning-available-hours-input"');
    expect(html).toContain('data-testid="planning-protected-space-input"');
    expect(html).toContain("Horas realmente disponibles:");
    expect(html).toContain("Espacio a proteger (% margen):");
  });

  it("3. Caso de prueba específico: 20 h disponibles, 25 % espacio protegido (5 h), 15 h planificables, 8 h planificadas y 7 h restantes", async () => {
    const provider = new MockProvider();
    const extractionResult = await extractItems(provider, {
      text: userNote,
      currentDate,
    });

    const detailedPlan = await generateWeeklyProposalFromItemsDetailed(provider, {
      items: extractionResult.items,
      currentDate,
      targetWeek,
      totalAvailableHours: 20,
      minProtectedSpaceRatio: 0.25,
    });

    const proposal = detailedPlan.proposal;
    // 20h disponibles * 0.25 = 5h protegidas, 15h planificables
    expect(proposal.weekSummary.capacity.totalAvailableHours).toBe(20);
    expect(proposal.weekSummary.capacity.protectedSpaceHours).toBe(5);
    expect(proposal.weekSummary.capacity.plannableHours).toBe(15);

    // Informe trimestral incluido como foco de recuperación (6h)
    const modifiedFoci = [
      ...proposal.foci,
      {
        id: "focus-recovery-item-mock-1",
        title: "Recuperación: Preparar el informe trimestral",
        desiredOutcome: "Completar informe",
        rationale: "Foco de recuperación con fecha original 2026-10-15",
        contributingItemIds: ["item-mock-1"],
        estimatedHours: 6,
      },
    ];

    const capacitySummary = calculateWeeklyCapacity({
      capacityConfig: { totalAvailableHours: 20, minProtectedSpaceRatio: 0.25 },
      foci: modifiedFoci,
      obligations: proposal.obligations, // 2h reunión
    });

    // 6h informe + 2h reunión = 8h planificadas
    expect(capacitySummary.plannedHours).toBe(8);
    expect(capacitySummary.plannableHours).toBe(15);
    expect(capacitySummary.protectedSpaceHours).toBe(5);
    expect(capacitySummary.capacityStatus).toBe("within_capacity");
    expect(capacitySummary.protectedSpaceStatus).toBe("respected");

    const verifiedProposal: ProposedWeek = {
      ...proposal,
      foci: modifiedFoci,
      weekSummary: {
        ...proposal.weekSummary,
        capacity: capacitySummary,
      },
      unplannedSpace: {
        ...proposal.unplannedSpace,
        recommendedHours: capacitySummary.protectedSpaceHours,
      },
    };

    const mockContext = createMockSessionContext();

    const html = renderToStaticMarkup(
      <WeeklySessionReactContext.Provider value={mockContext}>
        <WeeklyPlanningFromNotes
          provider={provider}
          currentDate={currentDate}
          initialItems={extractionResult.items}
          initialProposedWeek={verifiedProposal}
        />
      </WeeklySessionReactContext.Provider>
    );

    // Verificar las métricas honestas en UI
    expect(html).toContain('data-testid="planning-available-hours"');
    expect(html).toContain("20h");
    expect(html).toContain('data-testid="planning-plannable-hours"');
    expect(html).toContain("15h");
    expect(html).toContain('data-testid="planning-protected-space-hours"');
    expect(html).toContain("5h");
    expect(html).toContain('data-testid="planning-planned-hours"');
    expect(html).toContain("8h");

    // Capacidad restante: 15h - 8h = 7h
    expect(html).toContain('data-testid="planning-remaining-plannable-hours"');
    expect(html).toContain("7h");

    // Comprar café debe estar en elementos diferidos / no programados
    expect(html).toContain('data-testid="proposed-deferred-item-item-mock-3"');
    expect(html).toContain("Comprar café");
  });

  it("4. Eliminación de redundancia: si la capacidad ya está calibrada, se oculta el formulario y se muestra el resumen y el botón 'Modificar capacidad'", async () => {
    const provider = new MockProvider();
    const extractionResult = await extractItems(provider, {
      text: userNote,
      currentDate,
    });

    const detailedPlan = await generateWeeklyProposalFromItemsDetailed(provider, {
      items: extractionResult.items,
      currentDate,
      targetWeek,
      totalAvailableHours: 20,
      minProtectedSpaceRatio: 0.25,
    });

    const capacitySummary = calculateWeeklyCapacity({
      capacityConfig: { totalAvailableHours: 20, minProtectedSpaceRatio: 0.25 },
      foci: detailedPlan.proposal.foci,
      obligations: detailedPlan.proposal.obligations,
    });

    const calibratedProposal: ProposedWeek = {
      ...detailedPlan.proposal,
      weekSummary: {
        ...detailedPlan.proposal.weekSummary,
        capacity: capacitySummary,
      },
    };

    const mockContext = createMockSessionContext();

    const html = renderToStaticMarkup(
      <WeeklySessionReactContext.Provider value={mockContext}>
        <WeeklyPlanningFromNotes
          provider={provider}
          currentDate={currentDate}
          initialItems={extractionResult.items}
          initialProposedWeek={calibratedProposal}
        />
      </WeeklySessionReactContext.Provider>
    );

    // 1. El resumen validado debe mostrarse
    expect(html).toContain('data-testid="capacity-validated-summary"');
    expect(html).toContain("Capacidad configurada y validada");

    // 2. La acción secundaria para modificar capacidad debe existir
    expect(html).toContain('data-testid="modify-capacity-button"');
    expect(html).toContain("Modificar capacidad");

    // 3. Los inputs de edición directa NO deben mostrarse cuando no se está editando
    expect(html).not.toContain('data-testid="available-hours-proposal-input"');
    expect(html).not.toContain('data-testid="protected-space-proposal-input"');
  });

  it("5. Muestra formulario de calibración cuando la capacidad no ha sido configurada", async () => {
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

    // Debe contener el panel interactivo de calibración porque totalAvailableHours es null
    expect(html).toContain('data-testid="capacity-calibration-box"');
    expect(html).toContain('data-testid="available-hours-proposal-input"');
    expect(html).toContain('data-testid="protected-space-proposal-input"');
    expect(html).toContain('data-testid="verify-viability-button"');
    expect(html).toContain("Registrar o calibrar capacidad para verificar viabilidad");
  });

  it("6. Presentación visual y accesible de decisiones sobre tareas vencidas (aria-pressed, roles y tarjetas distintivas)", async () => {
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

    // Simulamos que el informe está marcado como prioridad de recuperación
    const proposal = detailedPlan.proposal;
    const modifiedFoci = [
      ...proposal.foci,
      {
        id: "focus-recovery-item-mock-1",
        title: "Recuperación: Preparar el informe trimestral",
        desiredOutcome: "Completar informe vencido",
        rationale: "Foco de recuperación",
        contributingItemIds: ["item-mock-1"],
        estimatedHours: 6,
      },
    ];

    const proposalWithRecovery = {
      ...proposal,
      foci: modifiedFoci,
      deferredItems: proposal.deferredItems.filter((d) => d.itemId !== "item-mock-1"),
    };

    const mockContext = createMockSessionContext();

    const html = renderToStaticMarkup(
      <WeeklySessionReactContext.Provider value={mockContext}>
        <WeeklyPlanningFromNotes
          provider={provider}
          currentDate={currentDate}
          initialItems={extractionResult.items}
          initialProposedWeek={proposalWithRecovery}
        />
      </WeeklySessionReactContext.Provider>
    );

    // 1. Debe tener role="group" con etiqueta accesible
    expect(html).toContain('role="group"');
    expect(html).toContain('aria-labelledby="overdue-decision-label-item-mock-1"');

    // 2. Atributos aria-pressed accesibles
    expect(html).toContain('data-testid="decision-unscheduled-item-mock-1"');
    expect(html).toContain('aria-pressed="false"'); // Inactiva

    expect(html).toContain('data-testid="decision-recovery-item-mock-1"');
    expect(html).toContain('aria-pressed="true"'); // Activa

    expect(html).toContain('data-testid="decision-postpone-item-mock-1"');

    // 3. Badge "Seleccionada" en la opción activa
    expect(html).toContain("Seleccionada");

    // 4. Descripciones legibles en las opciones
    expect(html).toContain("No consume capacidad planificable");
    expect(html).toContain("consumiendo 6h planificables");
    expect(html).toContain("Se posterga conscientemente a una semana posterior");
  });

  it("7. Modificar la capacidad preserva las decisiones sobre tareas vencidas y los focos existentes", () => {
    // Escenario: El usuario ya decidió incluir el informe trimestral (6h) como prioridad de recuperación
    const existingFoci = [
      {
        id: "focus-recovery-item-mock-1",
        title: "Recuperación: Preparar el informe trimestral",
        desiredOutcome: "Completar informe",
        rationale: "Foco de recuperación",
        contributingItemIds: ["item-mock-1"],
        estimatedHours: 6,
      },
    ];
    const existingObligations = [
      {
        id: "obl-meeting",
        title: "Reunión de alineación",
        dueDate: "2026-10-20",
        commitmentType: "external" as const,
        estimatedHours: 2,
      },
    ];

    // Calculamos capacidad inicial con 20h
    const initialCap = calculateWeeklyCapacity({
      capacityConfig: { totalAvailableHours: 20, minProtectedSpaceRatio: 0.25 },
      foci: existingFoci,
      obligations: existingObligations,
    });

    expect(initialCap.plannableHours).toBe(15);
    expect(initialCap.plannedHours).toBe(8);

    // Ahora el usuario modifica la capacidad a 30h
    const updatedCap = calculateWeeklyCapacity({
      capacityConfig: { totalAvailableHours: 30, minProtectedSpaceRatio: 0.25 },
      foci: existingFoci, // Invariante: focos preservados
      obligations: existingObligations,
    });

    // La capacidad planificable sube a 22.5h, pero las 8h planificadas y el foco del informe siguen intactos
    expect(updatedCap.totalAvailableHours).toBe(30);
    expect(updatedCap.plannableHours).toBe(22.5);
    expect(updatedCap.protectedSpaceHours).toBe(7.5);
    expect(updatedCap.plannedHours).toBe(8);
    expect(updatedCap.capacityStatus).toBe("within_capacity");
  });

  it("8. Persistencia y recuperación en IndexedDB: la capacidad se persiste en StoredWeeklyPlan y se restaura íntegramente al recargar la sesión", async () => {
    const storage = await createIndexedDbStorage({ dbName: TEST_DB_NAME, customFactory: fakeIDB });
    const service = new WeeklySessionService({
      plans: storage.plans,
      schedules: storage.schedules,
      closeReports: storage.closeReports,
      memories: storage.memories,
      getDb: () => storage.db,
    });

    const targetWeek: TargetWeek = {
      startDate: "2026-10-19",
      endDate: "2026-10-25",
    };

    const planToSave: StoredWeeklyPlan = {
      planId: "plan-2026-10-19",
      targetWeek,
      status: "active",
      createdAt: "2026-10-14T10:00:00.000Z",
      updatedAt: "2026-10-14T10:00:00.000Z",
      proposal: {
        weekSummary: {
          targetWeek,
          capacity: {
            totalAvailableHours: 20,
            plannableHours: 15,
            protectedSpaceHours: 5,
            plannedHours: 8,
            knownEstimatedHours: 8,
            estimationCompleteness: "complete",
            capacityStatus: "within_capacity",
            protectedSpaceStatus: "respected",
          },
          intent: "Semana balanceada con recuperación del informe",
        },
        foci: [
          {
            id: "focus-recovery-item-mock-1",
            title: "Recuperación: Preparar el informe trimestral",
            desiredOutcome: "Completar informe",
            rationale: "Foco de recuperación",
            contributingItemIds: ["item-mock-1"],
            estimatedHours: 6,
          },
        ],
        obligations: [
          {
            itemId: "item-mock-2",
            title: "Reunión de alineación",
            dueDate: "2026-10-20",
            commitmentType: "external",
            rationale: "Reunión de equipo con participantes externos",
            estimatedHours: 2,
          },
        ],
        flexibleOptions: [],
        deferredItems: [
          {
            itemId: "item-mock-3",
            title: "Comprar café",
            reason: "not_scheduled",
            rationale: "Elemento no programado",
          },
        ],
        unplannedSpace: {
          recommendedHours: 5,
          rationale: "Espacio protegido del 25%",
        },
        confirmationPrompt: {
          question: "¿Confirma este plan semanal con 8h planificadas y 5h de margen protegido?",
          keyTradeoffs: ["6h dedicadas al informe trimestral en recuperación"],
          pendingQuestions: [],
        },
      },
    };

    // 1. Guardar en IndexedDB
    const saveResult = await service.createOrSavePlanAndSchedule(planToSave);
    expect(saveResult.status).toBe("success");

    // 2. Simular recarga de sesión llamando a resumeSession()
    const sessionResult = await service.resumeSession();
    expect(sessionResult.status).toBe("session_resumed");

    if (sessionResult.status === "session_resumed" && sessionResult.state?.activePlan) {
      const restoredCapacity = sessionResult.state.activePlan.proposal.weekSummary.capacity;
      // Comprobar que no vuelve a "Desconocido" ni null
      expect(restoredCapacity.totalAvailableHours).toBe(20);
      expect(restoredCapacity.plannableHours).toBe(15);
      expect(restoredCapacity.protectedSpaceHours).toBe(5);
      expect(restoredCapacity.plannedHours).toBe(8);
      expect(restoredCapacity.capacityStatus).toBe("within_capacity");
      expect(restoredCapacity.protectedSpaceStatus).toBe("respected");
    }
  });

  it("9. Active view (WeeklySessionView) renderiza la capacidad restante calculada (7h)", () => {
    const activePlan: StoredWeeklyPlan = {
      planId: "plan-2026-10-19",
      targetWeek: {
        startDate: "2026-10-19",
        endDate: "2026-10-25",
      },
      status: "active",
      createdAt: "2026-10-14T10:00:00.000Z",
      updatedAt: "2026-10-14T10:00:00.000Z",
      proposal: {
        weekSummary: {
          targetWeek: {
            startDate: "2026-10-19",
            endDate: "2026-10-25",
          },
          capacity: {
            totalAvailableHours: 20,
            plannableHours: 15,
            protectedSpaceHours: 5,
            plannedHours: 8,
            knownEstimatedHours: 8,
            estimationCompleteness: "complete",
            capacityStatus: "within_capacity",
            protectedSpaceStatus: "respected",
          },
          intent: "Semana balanceada",
        },
        foci: [],
        obligations: [],
        flexibleOptions: [],
        deferredItems: [],
        unplannedSpace: {
          recommendedHours: 5,
          rationale: "Espacio protegido",
        },
        confirmationPrompt: {
          question: "¿Confirma este plan semanal?",
          keyTradeoffs: [],
          pendingQuestions: [],
        },
      },
    };

    const mockContext = createMockSessionContext({
      state: {
        status: "session_resumed",
        activePlan,
        activeSchedule: {
          scheduleId: "schedule-plan-2026-10-19",
          planId: "plan-2026-10-19",
          version: 1,
          weekRange: activePlan.targetWeek,
          timeBlocks: [],
          dailyAllocations: [],
          appliedAdjustments: [],
          createdAt: "2026-10-14T10:00:00.000Z",
          updatedAt: "2026-10-14T10:00:00.000Z",
        },
        latestCloseReport: null,
        latestClosedPlan: null,
        latestClosedWeek: null,
        concurrencyConflict: null,
        memories: [],
        memoryCandidates: [],
        ambiguousPlanIds: [],
        inconsistencyReason: null,
        errorMessage: null,
        draftPlan: null,
      },
    });

    const html = renderToStaticMarkup(
      <WeeklySessionReactContext.Provider value={mockContext}>
        <WeeklySessionView />
      </WeeklySessionReactContext.Provider>
    );

    // Debe mostrar la capacidad restante: 15h - 8h = 7h
    expect(html).toContain('data-testid="remaining-plannable-hours"');
    expect(html).toContain("7h");
    expect(html).toContain('data-testid="plannable-hours"');
    expect(html).toContain("15h");
  });

  it("10. Detecta honestamente sobrecarga cuando las horas disponibles son insuficientes (ej. 6h disponibles, 8h planificadas)", () => {
    const overloadedCapacity = calculateWeeklyCapacity({
      capacityConfig: { totalAvailableHours: 6, minProtectedSpaceRatio: 0.25 },
      foci: [{ estimatedHours: 6 }],
      obligations: [{ estimatedHours: 2 }],
    });

    // Con 6h disponibles y 25% protegido -> 1.5h protegido y 4.5h planificable
    // 8h planificadas > 4.5h planificable -> sobrecarga
    expect(overloadedCapacity.totalAvailableHours).toBe(6);
    expect(overloadedCapacity.plannableHours).toBe(4.5);
    expect(overloadedCapacity.protectedSpaceHours).toBe(1.5);
    expect(overloadedCapacity.plannedHours).toBe(8);
    expect(overloadedCapacity.capacityStatus).toBe("over_capacity");
    expect(overloadedCapacity.protectedSpaceStatus).toBe("compromised");
  });
});
