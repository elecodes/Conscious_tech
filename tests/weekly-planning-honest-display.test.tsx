import { describe, it, expect } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  extractPlanItems,
  formatDeferredReason,
  CapacityProtectedSpaceSection,
} from "../src/web/components/weekly-session-view";
import { WeeklyPlanningFromNotes } from "../src/web/components/weekly-planning-from-notes";
import { StoredWeeklyPlan } from "../src/domain/repositories/types";
import { WeeklyCapacitySummary } from "../src/domain/week";
import { MockProvider } from "../src/providers/mock-provider";
import { WeeklySessionReactContext } from "../src/web/context/weekly-session-context";

describe("Honestidad en la visualización semanal y flujo de planificación", () => {
  describe("1. Clasificación y motivo de ítems no programados (deferredItems)", () => {
    it("no debe etiquetar ítems con reason 'not_scheduled' como 'Postergada previamente'", () => {
      expect(formatDeferredReason("not_scheduled")).toBe("Sin programar en la semana");
      expect(formatDeferredReason("intentional_postponement")).toBe("Postergada conscientemente");
      expect(formatDeferredReason("out_of_capacity")).toBe("Fuera de capacidad");
      expect(formatDeferredReason("waiting_dependency")).toBe("En espera de dependencia");
    });

    it("extractPlanItems debe asignar 'Sin programar en la semana' y conservar el rationale real", () => {
      const mockPlan: StoredWeeklyPlan = {
        planId: "plan-test-1",
        createdAt: "2026-10-12T10:00:00.000Z",
        updatedAt: "2026-10-12T10:00:00.000Z",
        targetWeek: {
          startDate: "2026-10-19",
          endDate: "2026-10-25",
        },
        status: "active",
        proposal: {
          weekSummary: {
            targetWeek: {
              startDate: "2026-10-19",
              endDate: "2026-10-25",
            },
            capacity: {
              totalAvailableHours: null,
              plannableHours: null,
              plannedHours: null,
              knownEstimatedHours: 6,
              estimationCompleteness: "partial",
              protectedSpaceHours: null,
              capacityStatus: "unknown",
              protectedSpaceStatus: "unknown",
            },
          },
          foci: [],
          obligations: [
            {
              itemId: "item-meeting",
              title: "Reunión de alineación con el equipo",
              commitmentType: "strict_deadline",
              rationale: "Compromiso estricto",
              estimatedHours: 2,
            },
          ],
          flexibleOptions: [],
          deferredItems: [
            {
              itemId: "item-quarterly-report",
              title: "Preparar el informe trimestral antes del jueves",
              reason: "not_scheduled",
              rationale:
                "Elemento no programado en la propuesta; conservado para decisión de la persona.",
            },
          ],
          unplannedSpace: {
            rationale: "Margen de maniobra",
            recommendedHours: null,
          },
          confirmationPrompt: {
            question: "¿Confirmás esta semana?",
            keyTradeoffs: [],
            pendingQuestions: [],
          },
        },
      };

      const items = extractPlanItems(mockPlan, null);
      const reportItem = items.find((i) => i.itemId === "item-quarterly-report");

      expect(reportItem).toBeDefined();
      expect(reportItem?.source).toBe("Sin programar en la semana");
      expect(reportItem?.source).not.toBe("Postergada previamente");
      expect(reportItem?.rationale).toBe(
        "Elemento no programado en la propuesta; conservado para decisión de la persona."
      );
      expect(reportItem?.deferredReason).toBe("not_scheduled");
    });
  });

  describe("2. Distinción honesta de capacidad: sin configurar vs estimaciones faltantes", () => {
    it("muestra aviso explícito cuando la capacidad no fue configurada en la entrada", () => {
      const unconfiguredCapacity: WeeklyCapacitySummary = {
        totalAvailableHours: null,
        plannableHours: null,
        protectedSpaceHours: null,
        plannedHours: null,
        knownEstimatedHours: 6,
        estimationCompleteness: "partial",
        capacityStatus: "unknown",
        protectedSpaceStatus: "unknown",
      };

      const html = renderToStaticMarkup(
        React.createElement(CapacityProtectedSpaceSection, {
          capacity: unconfiguredCapacity,
        })
      );

      // Debe explicar que la capacidad no ha sido configurada
      expect(html).toContain("Capacidad no configurada");
      expect(html).toContain("la entrada no aportó horas disponibles");
      expect(html).toContain("Capacidad desconocida (sin configurar)");
      expect(html).toContain("Desconocido (sin configurar)");
      // No debe inventar horas disponibles
      expect(html).not.toMatch(/<strong[^>]*data-testid="total-available-hours"[^>]*>0h<\/strong>/);
    });

    it("distingue cuando la capacidad sí fue configurada pero la carga es desconocida por falta de estimaciones", () => {
      const configuredCapacityWithoutEstimates: WeeklyCapacitySummary = {
        totalAvailableHours: 35,
        plannableHours: 25,
        protectedSpaceHours: 10,
        plannedHours: null,
        knownEstimatedHours: 6,
        estimationCompleteness: "partial",
        capacityStatus: "unknown",
        protectedSpaceStatus: "unknown",
      };

      const html = renderToStaticMarkup(
        React.createElement(CapacityProtectedSpaceSection, {
          capacity: configuredCapacityWithoutEstimates,
        })
      );

      // No debe mostrar la nota de capacidad no configurada
      expect(html).not.toContain(
        "Capacidad no configurada: la entrada no aportó horas disponibles"
      );
      // Debe indicar que faltan estimaciones
      expect(html).toContain("Capacidad desconocida (faltan estimaciones)");
      expect(html).toContain("Desconocido");
      expect(html).toContain("35h");
    });
  });

  describe("3. Diagnóstico de etapas intermedias en WeeklyPlanningFromNotes", () => {
    it("no debe mostrar la caja de advertencia 'Fallback aplicado' cuando todas las etapas son exitosas", () => {
      const provider = new MockProvider();
      const onPlanCreated = () => {};

      const mockContextValue: any = {
        state: { status: "no_active_session" },
        service: {},
        controller: {},
        reloadSession: async () => {},
        createOrSavePlan: async () => ({ status: "success" }),
        applyAdjustment: async () => ({ status: "success" }),
        closeWeek: async () => ({ status: "success" }),
        confirmMemoryCandidate: async () => ({ status: "confirmed" }),
        confirmMemoryOperation: async () => ({ status: "confirmed" }),
        purgeSession: async () => ({ status: "success" }),
        resolveAmbiguity: async () => {},
      };

      const html = renderToStaticMarkup(
        React.createElement(
          WeeklySessionReactContext.Provider,
          { value: mockContextValue },
          React.createElement(WeeklyPlanningFromNotes, {
            provider,
            onPlanCreated,
            currentDate: "2026-10-12",
          })
        )
      );

      // En el estado inicial o cuando no hay fallbacks, no debe haber ningún banner de aviso con 'Fallback aplicado'
      expect(html).not.toContain("Fallback aplicado");
      expect(html).not.toContain("Avisos en la preparación de la propuesta");
    });
  });
});
