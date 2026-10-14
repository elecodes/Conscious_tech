import { describe, it, expect, beforeEach } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { indexedDB as fakeIDB, IDBKeyRange as fakeKeyRange } from "fake-indexeddb";
import {
  createIndexedDbStorage,
  deleteDatabase,
  IndexedDbStorageContext,
} from "../src/infrastructure/storage/indexeddb";
import { WeeklySessionService } from "../src/application/weekly-session-service";
import { WeeklySessionController } from "../src/web/context/weekly-session-context";
import {
  CapacityProtectedSpaceSection,
  formatCapacityStatus,
  formatProtectedSpaceStatus,
  formatEstimationCompleteness,
  formatHours,
} from "../src/web/components/weekly-session-view";
import { StoredWeeklyPlan } from "../src/domain/repositories/types";
import { WeeklySchedule } from "../src/domain/schedule";
import { ProposedWeek, WeeklyCapacitySummary } from "../src/domain/week";

describe("Fase P5.3 — Visualización honesta de capacidad y espacio protegido", () => {
  const TEST_DB_NAME = "conscious_tech_p5_3_test_db";

  if (typeof globalThis.IDBKeyRange === "undefined") {
    (globalThis as unknown as { IDBKeyRange: typeof fakeKeyRange }).IDBKeyRange = fakeKeyRange;
  }

  let storage: IndexedDbStorageContext;
  let service: WeeklySessionService;
  let controller: WeeklySessionController;

  const validTargetWeek = {
    startDate: "2026-10-12",
    endDate: "2026-10-18",
  };

  beforeEach(async () => {
    await deleteDatabase(TEST_DB_NAME, fakeIDB);
    storage = await createIndexedDbStorage({
      dbName: TEST_DB_NAME,
      customFactory: fakeIDB,
    });
    service = new WeeklySessionService({
      plans: storage.plans,
      schedules: storage.schedules,
      closeReports: storage.closeReports,
      memories: storage.memories,
      getDb: () => storage.db,
    });
    controller = new WeeklySessionController(service);
  });

  describe("Ayudantes de formato y traducción de estados", () => {
    it("debe formatear horas sin producir 'nullh', 'NaNh' ni ceros inventados", () => {
      expect(formatHours(40)).toBe("40h");
      expect(formatHours(0)).toBe("0h"); // un cero explícito sí es 0h
      expect(formatHours(null)).toBe("Desconocido");
      expect(formatHours(null, "No disponible")).toBe("No disponible");
      expect(formatHours(undefined)).toBe("Desconocido");
      expect(formatHours(NaN)).toBe("Desconocido");
    });

    it("debe traducir CapacityStatus a etiquetas humanas comprensibles", () => {
      expect(formatCapacityStatus("within_capacity")).toBe("Dentro de la capacidad");
      expect(formatCapacityStatus("over_capacity")).toBe("Por encima de la capacidad");
      expect(formatCapacityStatus("unknown")).toBe("Capacidad desconocida");
    });

    it("debe traducir ProtectedSpaceStatus a etiquetas comprensibles", () => {
      expect(formatProtectedSpaceStatus("respected")).toBe("Respetado");
      expect(formatProtectedSpaceStatus("compromised")).toBe("Comprometido");
      expect(formatProtectedSpaceStatus("unknown")).toBe("Desconocido");
    });

    it("debe traducir EstimationCompleteness a etiquetas comprensibles", () => {
      expect(formatEstimationCompleteness("complete")).toBe("Estimaciones completas");
      expect(formatEstimationCompleteness("partial")).toBe("Estimación parcial");
      expect(formatEstimationCompleteness("none")).toBe("Sin estimar");
    });
  });

  describe("Casos de visualización de capacidad e incertidumbre", () => {
    it("1. Capacidad conocida y estimaciones completas", () => {
      const capacity: WeeklyCapacitySummary = {
        totalAvailableHours: 40,
        plannableHours: 30,
        protectedSpaceHours: 10,
        plannedHours: 25,
        knownEstimatedHours: 25,
        estimationCompleteness: "complete",
        capacityStatus: "within_capacity",
        protectedSpaceStatus: "respected",
      };

      const html = renderToStaticMarkup(
        React.createElement(CapacityProtectedSpaceSection, { capacity })
      );

      expect(html).toContain("40h");
      expect(html).toContain("30h");
      expect(html).toContain("10h");
      expect(html).toContain("25h");
      expect(html).toContain("Respetado");
      expect(html).toContain("Estimaciones completas");
      expect(html).toContain("Dentro de la capacidad");
      expect(html).not.toContain("Carga total desconocida");
    });

    it("2. Estimaciones parciales: se muestran horas conocidas pero carga total desconocida", () => {
      const capacity: WeeklyCapacitySummary = {
        totalAvailableHours: 35,
        plannableHours: 25,
        protectedSpaceHours: 10,
        plannedHours: null, // Invariante: null cuando es parcial
        knownEstimatedHours: 12,
        estimationCompleteness: "partial",
        capacityStatus: "unknown",
        protectedSpaceStatus: "unknown",
      };

      const html = renderToStaticMarkup(
        React.createElement(CapacityProtectedSpaceSection, { capacity })
      );

      expect(html).toContain("12h");
      expect(html).toContain("Estimación parcial");
      expect(html).toContain("Carga total desconocida");
      expect(html).toContain(
        "Se conocen 12h de tareas estimadas, pero la carga total de la semana sigue siendo desconocida."
      );
    });

    it("3. Sin estimaciones: no representa la semana como vacía ni como carga cero", () => {
      const capacity: WeeklyCapacitySummary = {
        totalAvailableHours: 30,
        plannableHours: 20,
        protectedSpaceHours: 10,
        plannedHours: null,
        knownEstimatedHours: null,
        estimationCompleteness: "none",
        capacityStatus: "unknown",
        protectedSpaceStatus: "unknown",
      };

      const html = renderToStaticMarkup(
        React.createElement(CapacityProtectedSpaceSection, { capacity })
      );

      expect(html).toContain("Sin estimar");
      expect(html).toContain("Carga total desconocida");
      expect(html).toContain("No disponible");
      expect(html).toContain(
        "No hay estimaciones horarias cargadas. Esto no significa que la semana esté libre de trabajo."
      );
      // No debe contener "0h" inventado en carga planificada
      expect(html).not.toMatch(/<strong[^>]*data-testid="planned-hours"[^>]*>0h<\/strong>/);
    });

    it("4. Capacidad total desconocida", () => {
      const capacity: WeeklyCapacitySummary = {
        totalAvailableHours: null,
        plannableHours: null,
        protectedSpaceHours: null,
        plannedHours: null,
        knownEstimatedHours: null,
        estimationCompleteness: "none",
        capacityStatus: "unknown",
        protectedSpaceStatus: "unknown",
      };

      const html = renderToStaticMarkup(
        React.createElement(CapacityProtectedSpaceSection, { capacity })
      );

      expect(html).toContain("No disponible"); // totalAvailableHours
      expect(html).toContain("Capacidad desconocida"); // status
    });

    it("5. Tiempo planificable desconocido", () => {
      const capacity: WeeklyCapacitySummary = {
        totalAvailableHours: null,
        plannableHours: null,
        protectedSpaceHours: null,
        plannedHours: null,
        knownEstimatedHours: null,
        estimationCompleteness: "none",
        capacityStatus: "unknown",
        protectedSpaceStatus: "unknown",
      };

      const html = renderToStaticMarkup(
        React.createElement(CapacityProtectedSpaceSection, { capacity })
      );

      expect(html).toMatch(/<strong[^>]*data-testid="plannable-hours"[^>]*>Desconocido<\/strong>/);
    });

    it("6. Espacio protegido desconocido", () => {
      const capacity: WeeklyCapacitySummary = {
        totalAvailableHours: null,
        plannableHours: null,
        protectedSpaceHours: null,
        plannedHours: null,
        knownEstimatedHours: null,
        estimationCompleteness: "none",
        capacityStatus: "unknown",
        protectedSpaceStatus: "unknown",
      };

      const html = renderToStaticMarkup(
        React.createElement(CapacityProtectedSpaceSection, { capacity })
      );

      expect(html).toMatch(/<strong[^>]*data-testid="protected-space-hours"[^>]*>Desconocido<\/strong>/);
    });

    it("7. protectedSpaceStatus === 'compromised'", () => {
      const capacity: WeeklyCapacitySummary = {
        totalAvailableHours: 30,
        plannableHours: 20,
        protectedSpaceHours: 10,
        plannedHours: 25,
        knownEstimatedHours: 25,
        estimationCompleteness: "complete",
        capacityStatus: "over_capacity",
        protectedSpaceStatus: "compromised",
      };

      const html = renderToStaticMarkup(
        React.createElement(CapacityProtectedSpaceSection, { capacity })
      );

      expect(html).toContain("Comprometido");
      expect(html).toContain("badge-commitment");
    });

    it("8. capacityStatus === 'over_capacity'", () => {
      const capacity: WeeklyCapacitySummary = {
        totalAvailableHours: 30,
        plannableHours: 20,
        protectedSpaceHours: 10,
        plannedHours: 28,
        knownEstimatedHours: 28,
        estimationCompleteness: "complete",
        capacityStatus: "over_capacity",
        protectedSpaceStatus: "compromised",
      };

      const html = renderToStaticMarkup(
        React.createElement(CapacityProtectedSpaceSection, { capacity })
      );

      expect(html).toContain("Por encima de la capacidad");
      expect(html).toContain("badge-commitment");
    });

    it("9. Ausencia total de 'nullh', 'NaNh' o ceros ficticios en estados inciertos", () => {
      const capacity: WeeklyCapacitySummary = {
        totalAvailableHours: null,
        plannableHours: null,
        protectedSpaceHours: null,
        plannedHours: null,
        knownEstimatedHours: null,
        estimationCompleteness: "none",
        capacityStatus: "unknown",
        protectedSpaceStatus: "unknown",
      };

      const html = renderToStaticMarkup(
        React.createElement(CapacityProtectedSpaceSection, { capacity })
      );

      expect(html).not.toMatch(/nullh/i);
      expect(html).not.toMatch(/NaNh/i);
      expect(html).not.toMatch(/undefinedh/i);
    });

    it("10. Texto rector visible y no alarmista", () => {
      const capacity: WeeklyCapacitySummary = {
        totalAvailableHours: 40,
        plannableHours: 30,
        protectedSpaceHours: 10,
        plannedHours: 20,
        knownEstimatedHours: 20,
        estimationCompleteness: "complete",
        capacityStatus: "within_capacity",
        protectedSpaceStatus: "respected",
      };

      const html = renderToStaticMarkup(
        React.createElement(CapacityProtectedSpaceSection, { capacity })
      );

      expect(html).toContain(
        "«El espacio libre no es automáticamente tiempo disponible para asumir más compromisos.»"
      );
      expect(html).toContain(
        "El espacio protegido deja margen para imprevistos, descanso y cambios de prioridad."
      );
    });

    it("11. Recuperación de la sesión desde IndexedDB sin alterar valores de capacidad", async () => {
      const proposalWithPartialCapacity: ProposedWeek = {
        weekSummary: {
          targetWeek: validTargetWeek,
          capacity: {
            totalAvailableHours: 35,
            plannableHours: 25,
            plannedHours: null,
            knownEstimatedHours: 15,
            estimationCompleteness: "partial",
            protectedSpaceHours: 10,
            capacityStatus: "unknown",
            protectedSpaceStatus: "unknown",
          },
          intent: "Semana con foco parcial para validar persistencia de capacidad",
        },
        foci: [],
        obligations: [],
        flexibleOptions: [],
        deferredItems: [],
        unplannedSpace: {
          recommendedHours: 10,
          rationale: "Espacio no planificado",
        },
        confirmationPrompt: {
          question: "¿Aceptas este plan?",
          keyTradeoffs: [],
          pendingQuestions: [],
        },
      };

      const plan: StoredWeeklyPlan = {
        planId: "plan-p5-3-cap",
        status: "active",
        targetWeek: validTargetWeek,
        proposal: proposalWithPartialCapacity,
        createdAt: "2026-10-12T08:00:00Z",
        updatedAt: "2026-10-12T08:00:00Z",
      };

      const schedule: WeeklySchedule = {
        scheduleId: "sched-p5-3-cap",
        planId: "plan-p5-3-cap",
        weekRange: validTargetWeek,
        version: 1,
        timeBlocks: [],
        dailyAllocations: [],
        appliedAdjustments: [],
        createdAt: "2026-10-12T08:00:00Z",
        updatedAt: "2026-10-12T08:00:00Z",
      };

      await storage.plans.save(plan);
      await storage.schedules.save(schedule);

      await controller.reloadSession();
      const snapshot = controller.getSnapshot();

      expect(snapshot.status).toBe("session_resumed");
      expect(snapshot.activePlan).toBeDefined();

      const loadedCapacity = snapshot.activePlan!.proposal.weekSummary.capacity;
      expect(loadedCapacity.totalAvailableHours).toBe(35);
      expect(loadedCapacity.plannableHours).toBe(25);
      expect(loadedCapacity.plannedHours).toBeNull();
      expect(loadedCapacity.knownEstimatedHours).toBe(15);
      expect(loadedCapacity.estimationCompleteness).toBe("partial");
      expect(loadedCapacity.protectedSpaceHours).toBe(10);
      expect(loadedCapacity.capacityStatus).toBe("unknown");
      expect(loadedCapacity.protectedSpaceStatus).toBe("unknown");
    });

    it("12. Accesibilidad básica de la sección y de sus etiquetas semánticas", () => {
      const capacity: WeeklyCapacitySummary = {
        totalAvailableHours: 40,
        plannableHours: 30,
        protectedSpaceHours: 10,
        plannedHours: 25,
        knownEstimatedHours: 25,
        estimationCompleteness: "complete",
        capacityStatus: "within_capacity",
        protectedSpaceStatus: "respected",
      };

      const html = renderToStaticMarkup(
        React.createElement(CapacityProtectedSpaceSection, { capacity })
      );

      expect(html).toContain('aria-label="Capacidad y espacio protegido"');
      expect(html).toContain('aria-label="Estado del espacio protegido: Respetado"');
      expect(html).toContain('aria-label="Completitud de estimaciones: Estimaciones completas"');
      expect(html).toContain('aria-label="Estado de capacidad: Dentro de la capacidad"');
      expect(html).toContain('data-testid="capacity-protected-space-section"');
      expect(html).toContain('data-testid="guiding-principle"');
    });
  });
});
