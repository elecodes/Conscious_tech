import { createEmptyProposedWeek } from "../../src/domain/week";
import { ExtractedItem } from "../../src/domain/items";
import { StoredWeeklyPlan } from "../../src/domain/repositories/types";

export function createReviewFixture(includePending = false) {
  const targetWeek = { startDate: "2026-12-07", endDate: "2026-12-13" };
  const item = (
    id: string,
    title: string,
    type: ExtractedItem["type"] = "task"
  ): ExtractedItem => ({
    id,
    title,
    rawText: title,
    type,
    status: "pending",
    commitment: "none",
    estimatedEffort: { value: 1, unit: "hours", source: "user" },
  });
  const items: ExtractedItem[] = [
    item("a", "Investigar el proyecto"),
    item("b", "Preparar el prototipo"),
    item("c", "Entregar el informe", "commitment"),
    item("d", "Leer documentación"),
    item("e", "Una idea para explorar", "idea"),
    item("f", "Me preocupa el ritmo", "concern"),
    item("g", "Revisar una tarea pendiente"),
    item("h", "Un elemento excluido"),
    { ...item("j", "Una nota archivada"), status: "archived" },
  ];
  for (const source of items.slice(0, 3))
    source.estimatedEffort = { value: 2, unit: "hours", source: "user" };
  items[0]!.deadline = { raw: "1 de diciembre", resolved: "2026-12-01", confidence: "high" };
  items[2]!.commitment = "external";
  items[2]!.deadline = { raw: "10 de diciembre", resolved: "2026-12-10", confidence: "high" };
  items[1]!.rawText = `Una nota larga: ${"detalle".repeat(600)}`;
  if (includePending) items.push(item("i", "Una nota recién añadida"));
  items.find((source) => source.id === "g")!.estimatedEffort = {
    value: 45,
    unit: "minutes",
    source: "user",
  };
  const proposal = createEmptyProposedWeek("2026-11-10", targetWeek);
  proposal.weekSummary.intent = "Cuidar el proyecto con espacio";
  proposal.weekSummary.capacity = {
    totalAvailableHours: 16,
    plannableHours: 12,
    plannedHours: 6,
    knownEstimatedHours: 6,
    estimationCompleteness: "complete",
    protectedSpaceHours: 4,
    capacityStatus: "within_capacity",
    protectedSpaceStatus: "respected",
  };
  proposal.foci = [
    {
      id: "group-focus",
      title: "Avanzar en el proyecto",
      desiredOutcome: "Un prototipo revisado",
      rationale: "Dos pasos del mismo proyecto",
      contributingItemIds: ["a", "b"],
      estimatedHours: 4,
    },
  ];
  proposal.obligations = [
    {
      itemId: "c",
      title: "Entregar el informe",
      dueDate: "2026-12-10",
      commitmentType: "external",
      rationale: "Compromiso acordado",
      estimatedHours: 2,
    },
  ];
  proposal.flexibleOptions = [
    {
      itemId: "d",
      title: "Leer documentación",
      condition: "Solo si queda espacio",
      estimatedHours: 1,
    },
  ];
  proposal.deferredItems = ["e", "f", "g", "j"].map((id) => ({
    itemId: id,
    title: items.find((source) => source.id === id)!.title,
    reason: id === "j" ? ("archived" as const) : ("not_scheduled" as const),
    rationale: "Se conserva fuera de esta semana",
  }));
  const selectedIds = items.filter((source) => source.id !== "h").map((source) => source.id);
  const plan: StoredWeeklyPlan = {
    planId: "draft-2026-12-07",
    status: "draft",
    targetWeek,
    proposal,
    createdAt: "2026-11-10T12:00:00.000Z",
    updatedAt: "2026-11-10T12:00:00.000Z",
    draftContext: {
      extractedItems: items,
      acceptedItemIds: selectedIds,
      selectedCarryOverItemIds: [],
      availableHoursInput: "16",
      protectedSpacePercentInput: "25",
      userIntent: "",
      overdueDecisions: { a: { decision: "include_recovery" } },
      noteText: items.map((source) => source.title).join(". "),
    },
  };
  return { plan, items, selectedIds, proposal };
}
