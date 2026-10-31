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
