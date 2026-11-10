import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createEmptyProposedWeek, ProposedWeek } from "../src/domain/week";
import { PlanningConfirmationSummary } from "../src/web/components/planning-confirmation-summary";

function proposal(): ProposedWeek {
  const result = createEmptyProposedWeek("2026-11-10", {
    startDate: "2026-11-16",
    endDate: "2026-11-22",
  });
  result.weekSummary.intent = "Cuidar el proyecto y descansar";
  result.weekSummary.capacity = {
    totalAvailableHours: 20,
    plannableHours: 15,
    plannedHours: 8,
    knownEstimatedHours: 8,
    estimationCompleteness: "complete",
    protectedSpaceHours: 5,
    capacityStatus: "within_capacity",
    protectedSpaceStatus: "respected",
  };
  result.foci = [
    {
      id: "focus",
      title: "Proyecto principal",
      contributingItemIds: ["task-a", "task-b", "task-c"],
      desiredOutcome: "Un avance concreto",
      rationale: "Elegido",
      estimatedHours: 4,
    },
  ];
  result.obligations = [
    {
      itemId: "commitment",
      title: "Entregar informe",
      dueDate: "2026-11-19",
      commitmentType: "strict_deadline",
      rationale: "Fecha acordada",
      estimatedHours: 4,
    },
  ];
  result.flexibleOptions = [{ itemId: "optional", title: "Explorar una idea", estimatedHours: 99 }];
  result.deferredItems = [
    {
      itemId: "later",
      title: "Otro proyecto",
      reason: "not_scheduled",
      rationale: "No entra ahora",
    },
    { itemId: "archived", title: "Idea archivada", reason: "archived", rationale: "Archivada" },
  ];
  return result;
}

function render(value: ProposedWeek) {
  return renderToStaticMarkup(<PlanningConfirmationSummary proposal={value} />);
}

describe("Exact proposal summary before activation", () => {
  it("counts focus areas rather than contributing tasks and separates optional/deferred items", () => {
    const html = render(proposal());
    expect(html).toContain("1 foco");
    expect(html).toContain("1 compromiso");
    expect(html).toContain("1 opción flexible");
    expect(html).toContain("2 elementos fuera de esta semana");
    expect(html).toContain("Proyecto principal");
    expect(html).toContain("Entregar informe");
    expect(html.indexOf("Entregar informe")).toBeLessThan(html.indexOf("<details"));
    expect(html).toContain("Idea archivada");
  });

  it("reads intention, dates, and stored time totals from the proposal, excluding optional hours", () => {
    const html = render(proposal());
    expect(html).toContain("Cuidar el proyecto y descansar");
    expect(html).toContain('dateTime="2026-11-16"');
    expect(html).toContain('dateTime="2026-11-22"');
    expect(html).toContain('data-testid="confirmation-available-hours">20h');
    expect(html).toContain('data-testid="confirmation-planned-hours">8h');
    expect(html).toContain('data-testid="confirmation-protected-hours">5h');
    expect(html).toContain("sus horas no están incluidas");
    expect(html).not.toContain("107h");
  });

  it("keeps unknown capacity provisional even when task estimates are complete", () => {
    const value = proposal();
    value.weekSummary.capacity.totalAvailableHours = null;
    value.weekSummary.capacity.protectedSpaceHours = null;
    value.weekSummary.capacity.capacityStatus = "unknown";
    value.weekSummary.capacity.protectedSpaceStatus = "unknown";
    const html = render(value);
    expect(html).toContain("Propuesta provisional");
    expect(html).toContain('data-testid="confirmation-planned-hours">8h');
    expect(html).toContain('data-testid="confirmation-protected-hours">Por definir');
    expect(html).not.toContain("el tiempo previsto cabe");
  });

  it("shows partial estimates without presenting them as a complete planned total", () => {
    const value = proposal();
    Object.assign(value.weekSummary.capacity, {
      plannedHours: null,
      knownEstimatedHours: 4,
      estimationCompleteness: "partial",
      capacityStatus: "unknown",
      protectedSpaceStatus: "unknown",
    });
    const html = render(value);
    expect(html).toContain("4h conocidas; estimación parcial");
    expect(html).toContain("Faltan estimaciones");
    expect(html).not.toContain("el tiempo previsto cabe");
  });

  it("makes overload and compromised protected time visible", () => {
    const value = proposal();
    Object.assign(value.weekSummary.capacity, {
      capacityStatus: "over_capacity",
      protectedSpaceStatus: "compromised",
    });
    const html = render(value);
    expect(html).toContain("El plan supera el tiempo planificable");
    expect(html).not.toContain("el tiempo previsto cabe");
  });

  it("preserves explicit zero hours and does not invent an intention or tasks", () => {
    const value = createEmptyProposedWeek("2026-11-10");
    Object.assign(value.weekSummary.capacity, {
      totalAvailableHours: 0,
      plannableHours: 0,
      protectedSpaceHours: 0,
    });
    const html = render(value);
    expect(html).toContain('data-testid="confirmation-available-hours">0h');
    expect(html).toContain('data-testid="confirmation-protected-hours">0h');
    expect(html).toContain("Sin intención definida");
    expect(html).toContain("0 focos");
    expect(html).toContain("0 compromisos");
    expect(html).not.toContain("Propuesta provisional");
    expect(html).not.toContain("el tiempo previsto cabe");
  });
});
