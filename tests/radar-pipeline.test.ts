import { describe, it, expect } from "vitest";
import { MockProvider } from "../src/providers/mock-provider";
import { ProposedWeek, TargetWeek } from "../src/domain/week";
import {
  evaluateRadarInput,
  EvaluateRadarParams,
  RadarVerdictOutcome,
} from "../src/application/radar-pipeline";

describe("Radar de Imprevistos — Application Pipeline (Sección 21-25 PROJECT_CONTEXT)", () => {
  const targetWeek: TargetWeek = {
    startDate: "2026-10-12",
    endDate: "2026-10-18",
  };

  const sampleActivePlan: ProposedWeek = {
    weekSummary: {
      targetWeek,
      capacity: {
        totalAvailableHours: 25,
        plannableHours: 18,
        plannedHours: 10,
        knownEstimatedHours: 10,
        estimationCompleteness: "complete",
        protectedSpaceHours: 7,
        capacityStatus: "within_capacity",
        protectedSpaceStatus: "respected",
      },
      intent: "Semana balanceada de arquitectura",
    },
    foci: [
      {
        id: "focus-solid",
        title: "Arquitectura limpia y SOLID",
        desiredOutcome: "Refactor completado",
        rationale: "Foco principal",
        contributingItemIds: ["task-solid-1", "task-solid-2"],
        estimatedHours: 6,
      },
    ],
    obligations: [
      {
        itemId: "task-sync",
        title: "Reunión de equipo",
        dueDate: "2026-10-13",
        commitmentType: "external",
        rationale: "Compromiso fijo",
        estimatedHours: 2,
      },
    ],
    flexibleOptions: [
      {
        itemId: "task-flex-1",
        title: "Lectura de documentación",
        condition: "Si sobra tiempo",
        estimatedHours: 2,
      },
    ],
    deferredItems: [],
    unplannedSpace: {
      recommendedHours: 7,
      rationale: "Margen de calma protegido",
    },
    confirmationPrompt: {
      question: "¿Refleja este plan tus intenciones reales?",
      keyTradeoffs: [],
      pendingQuestions: [],
    },
  };

  const provider = new MockProvider();

  it("1. 🟢 No cambia la semana: ideas o inquietudes sin compromiso no interrumpen la semana", async () => {
    const params: EvaluateRadarParams = {
      changeDescription: "Se me ha ocurrido hacer un podcast sobre tecnología consciente",
      currentDate: "2026-10-14",
      activePlan: sampleActivePlan,
    };

    const result = await evaluateRadarInput(provider, params);

    expect(result.outcome).toBe<RadarVerdictOutcome>("no_change");
    expect(result.verdictTitle).toMatch(/no cambia la semana/i);
    expect(result.verdictExplanation).toMatch(/idea|no necesita interrumpir/i);
    expect(result.changeAnalysis.status).toBe("no_impact");
    expect(result.conflictReport.hasBlockingConflicts).toBe(false);
  });

  it("2. 🟡 Puede entrar si hay espacio: opciones flexibles u opcionales no compiten por focos principales", async () => {
    const params: EvaluateRadarParams = {
      changeDescription: "Si me da tiempo quería avanzar un poco en leer sobre Vitest",
      currentDate: "2026-10-14",
      activePlan: sampleActivePlan,
    };

    const result = await evaluateRadarInput(provider, params);

    expect(result.outcome).toBe<RadarVerdictOutcome>("flexible_option");
    expect(result.verdictTitle).toMatch(/opción flexible|si hay espacio/i);
    expect(result.conflictReport.hasBlockingConflicts).toBe(false);
  });

  it("3. 🟢 Cabe en el espacio disponible: compromiso que cabe en el margen sin tocar focos", async () => {
    // Plan has 18h plannable, 10h planned -> 8h remaining margin
    const params: EvaluateRadarParams = {
      changeDescription:
        "Tengo que preparar la presentación para el cliente el jueves, me llevará 2 horas",
      currentDate: "2026-10-14",
      activePlan: sampleActivePlan,
    };

    const result = await evaluateRadarInput(provider, params);

    expect(result.outcome).toBe<RadarVerdictOutcome>("fits_available_space");
    expect(result.verdictTitle).toMatch(/cabe en el espacio/i);
    expect(result.conflictReport.hasBlockingConflicts).toBe(false);
    expect(result.changeAnalysis.capacityImpact.arithmeticBalance).toBe("surplus_known");
    expect(result.changeAnalysis.capacityImpact.notes).toMatch(/12h/i);
  });

  it("4. 🔴 Cambia el equilibrio: tarea con horas que excede la capacidad plannable propone alternativas", async () => {
    // 18h plannable, 10h planned -> 8h remaining. New task takes 15h -> 25h total > 18h plannable!
    const params: EvaluateRadarParams = {
      changeDescription:
        "Surgió una urgencia de migración de base de datos que llevará 15 horas para el viernes",
      currentDate: "2026-10-14",
      activePlan: sampleActivePlan,
    };

    const result = await evaluateRadarInput(provider, params);

    expect(result.outcome).toBe<RadarVerdictOutcome>("changes_balance");
    expect(result.verdictTitle).toMatch(/cambia el equilibrio/i);
    expect(result.changeAnalysis.capacityImpact.arithmeticBalance).toBe("deficit_known");
    expect(result.adjustmentProposals).toBeDefined();
    expect(result.adjustmentProposals!.length).toBeGreaterThan(0);
  });

  it("5. Inmutabilidad: el plan activo no es mutado durante la evaluación", async () => {
    const planClone = JSON.parse(JSON.stringify(sampleActivePlan));

    await evaluateRadarInput(provider, {
      changeDescription: "Nueva reunión de 10 horas",
      currentDate: "2026-10-14",
      activePlan: sampleActivePlan,
    });

    expect(sampleActivePlan).toEqual(planClone);
  });

  it("6. Entrada vacía devuelve no_change limpiamente sin lanzar errores", async () => {
    const result = await evaluateRadarInput(provider, {
      changeDescription: "   ",
      currentDate: "2026-10-14",
      activePlan: sampleActivePlan,
    });

    expect(result.outcome).toBe("no_change");
    expect(result.extractedItems).toHaveLength(0);
  });
});
