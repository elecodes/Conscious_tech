import { ItemType, ItemStatus, CommitmentType, Importance } from "../domain/items";

export const ITEM_TYPE_LABELS: Record<ItemType, string> = {
  task: "Tarea",
  project: "Proyecto",
  idea: "Idea",
  commitment: "Compromiso",
  concern: "Preocupación",
};

export const ITEM_STATUS_LABELS: Record<ItemStatus, string> = {
  pending: "Pendiente",
  started: "En marcha",
  exploring: "Explorando",
  archived: "Archivado",
};

export const COMMITMENT_TYPE_LABELS: Record<CommitmentType, string> = {
  external: "Externo",
  personal: "Personal",
  none: "Ninguno",
};

export const IMPORTANCE_LABELS: Record<Importance, string> = {
  high: "Alta",
  medium: "Media",
  low: "Baja",
};

export const PLAN_CATEGORY_ORIGIN_LABELS: Record<string, string> = {
  focus: "Foco",
  obligation: "Obligación",
  flexible_option: "Opción flexible",
  deferred: "Postergada",
};

export const RELATIONSHIP_TYPE_LABELS: Record<string, string> = {
  same_project: "Mismo proyecto",
  same_objective: "Mismo objetivo",
  related_to: "Relacionado con",
  part_of: "Parte de",
  depends_on: "Depende de",
  duplicate: "Duplicado",
};

export const DEADLINE_KIND_LABELS: Record<string, string> = {
  explicit_date: "Fecha explícita",
  relative_date: "Fecha relativa",
  recurring: "Recurrente",
  vague: "Sin fecha concreta",
};

export const CONTEXT_SIGNAL_LABELS: Record<string, string> = {
  deadline: "Plazo",
  gravity: "Gravedad",
  dependency: "Dependencia",
  waiting: "En espera",
  blocked: "Bloqueado",
  exploratory: "Exploratorio",
};

export function formatItemType(type: string | null | undefined): string {
  if (!type) return "";
  return ITEM_TYPE_LABELS[type as ItemType] || type;
}

export function formatItemStatus(status: string | null | undefined): string {
  if (!status) return "";
  return ITEM_STATUS_LABELS[status as ItemStatus] || status;
}

export function formatCommitmentType(commitment: string | null | undefined): string {
  if (!commitment) return "";
  return COMMITMENT_TYPE_LABELS[commitment as CommitmentType] || commitment;
}

export function formatImportance(importance: string | null | undefined): string {
  if (!importance) return "";
  return IMPORTANCE_LABELS[importance as Importance] || importance;
}

export function formatPlanCategoryOrigin(origin: string | null | undefined): string {
  if (!origin) return "";
  return PLAN_CATEGORY_ORIGIN_LABELS[origin] || origin;
}

export function formatRelationshipType(rel: string | null | undefined): string {
  if (!rel) return "";
  return RELATIONSHIP_TYPE_LABELS[rel] || rel;
}

export function formatDeadlineKind(kind: string | null | undefined): string {
  if (!kind) return "";
  return DEADLINE_KIND_LABELS[kind] || kind;
}

export function formatContextSignal(signal: string | null | undefined): string {
  if (!signal) return "";
  return CONTEXT_SIGNAL_LABELS[signal] || signal;
}

/**
 * Builds an explanation of how selected ideas split between scheduled and pending in the week proposal.
 * Returns null when all selected ideas are scheduled, or when counts are invalid.
 * Examples:
 * - (5, 2, 3) -> "De tus 5 ideas, 2 entran en la semana y 3 quedan pendientes de decidir."
 * - (3, 1, 2) -> "De tus 3 ideas, 1 entra en la semana y 2 quedan pendientes de decidir."
 * - (3, 2, 1) -> "De tus 3 ideas, 2 entran en la semana y 1 queda pendiente de decidir."
 * - (2, 1, 1) -> "De tus 2 ideas, 1 entra en la semana y 1 queda pendiente de decidir."
 * - (1, 0, 1) -> "De tu 1 idea, 0 entran en la semana y 1 queda pendiente de decidir."
 * - (5, 5, 0) -> null (hidden when all selected ideas are scheduled)
 */
export function formatIdeasSplitExplanation(
  selectedCount: number,
  scheduledCount: number,
  pendingCount: number
): string | null {
  if (selectedCount <= 0 || pendingCount <= 0 || scheduledCount >= selectedCount) {
    return null;
  }

  const ideasPrefix = selectedCount === 1 ? "De tu 1 idea" : `De tus ${selectedCount} ideas`;
  const scheduledPart =
    scheduledCount === 1 ? "1 entra en la semana" : `${scheduledCount} entran en la semana`;
  const pendingPart =
    pendingCount === 1
      ? "1 queda pendiente de decidir"
      : `${pendingCount} quedan pendientes de decidir`;

  return `${ideasPrefix}, ${scheduledPart} y ${pendingPart}.`;
}
