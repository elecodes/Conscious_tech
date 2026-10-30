import {
  DeferredReason,
  CapacityStatus,
  ProtectedSpaceStatus,
  EstimationCompleteness,
} from "../../domain/week";
import { SuggestedAdjustmentAction } from "../../domain/adjustment";
import { StoredWeeklyPlan } from "../../domain/repositories/types";
import { WeeklySchedule } from "../../domain/schedule";

export function getWeekDays(startDate?: string): Array<{ date: string; label: string }> {
  if (!startDate) return [];
  const days = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
  const result: Array<{ date: string; label: string }> = [];
  const [y, m, d] = startDate.split("-").map(Number);
  if (!y || !m || !d) return [];
  const start = new Date(Date.UTC(y, m - 1, d));
  for (let i = 0; i < 7; i++) {
    const cur = new Date(start);
    cur.setUTCDate(start.getUTCDate() + i);
    const isoDate = cur.toISOString().split("T")[0]!;
    result.push({
      date: isoDate,
      label: `${days[i]} (${cur.getUTCDate()} ${["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"][cur.getUTCMonth()]})`,
    });
  }
  return result;
}

export function formatDeferredReason(reason: DeferredReason): string {
  switch (reason) {
    case "not_scheduled":
      return "Sin programar en la semana";
    case "intentional_postponement":
      return "Postergada conscientemente";
    case "out_of_capacity":
      return "Fuera de capacidad";
    case "waiting_dependency":
      return "En espera de dependencia";
    case "low_attention":
      return "Baja atención / opcional";
    case "archived":
      return "Archivada";
    default:
      return "No incluida en la semana";
  }
}

export interface UnscheduledCategoryInfo {
  label:
    | "Pendiente de decisión"
    | "Dejado para después por decisión humana"
    | "Pendiente de información"
    | "Fuera de la propuesta actual";
  badgeClass: string;
  description: string;
}

export function formatUnscheduledCategory(
  reason: DeferredReason,
  userDecision?: string
): UnscheduledCategoryInfo {
  if (userDecision === "intentional_postponement" || reason === "intentional_postponement") {
    return {
      label: "Dejado para después por decisión humana",
      badgeClass: "badge-idea",
      description: "Postergado conscientemente por decisión de la persona.",
    };
  }
  if (reason === "waiting_dependency") {
    return {
      label: "Pendiente de información",
      badgeClass: "badge-commitment",
      description: "En espera de dependencias o datos externos para poder avanzar.",
    };
  }
  if (reason === "out_of_capacity" || reason === "low_attention" || reason === "archived") {
    return {
      label: "Fuera de la propuesta actual",
      badgeClass: "badge-muted",
      description: "Excede el límite de capacidad planificable de esta semana.",
    };
  }
  return {
    label: "Pendiente de decisión",
    badgeClass: "badge-task",
    description: "Elemento extraído pendiente de asignar o descartar.",
  };
}

export function formatCapacityStatus(status: CapacityStatus): string {
  switch (status) {
    case "within_capacity":
      return "Dentro de la capacidad";
    case "over_capacity":
      return "Por encima de la capacidad";
    case "unknown":
      return "Capacidad desconocida";
    default:
      return status;
  }
}

export function formatProtectedSpaceStatus(status: ProtectedSpaceStatus): string {
  switch (status) {
    case "respected":
      return "Respetado";
    case "compromised":
      return "Comprometido";
    case "unknown":
      return "Desconocido";
    default:
      return status;
  }
}

export function formatEstimationCompleteness(completeness: EstimationCompleteness): string {
  switch (completeness) {
    case "complete":
      return "Estimaciones completas";
    case "partial":
      return "Estimación parcial";
    case "none":
      return "Sin estimar";
    default:
      return completeness;
  }
}

export function formatHours(
  hours: number | null | undefined,
  fallback: string = "Desconocido"
): string {
  if (typeof hours === "number" && Number.isFinite(hours)) {
    return `${hours}h`;
  }
  return fallback;
}

export function formatAdjustmentActionType(type: SuggestedAdjustmentAction["type"]): string {
  switch (type) {
    case "reassign_time_block":
      return "Reasignación de bloque horario";
    case "reallocate_day_work":
      return "Redistribución de esfuerzo diario";
    case "postpone_item":
      return "Postergación de tarea";
    case "unblock_dependency":
      return "Desbloqueo de dependencia";
    case "accept_risk":
      return "Aceptación de riesgo";
    case "request_information":
      return "Solicitud de información";
    default:
      return type;
  }
}

export function getAdjustmentTargetItem(action: SuggestedAdjustmentAction): string {
  if ("itemId" in action && action.itemId) return action.itemId;
  if ("dependentItemId" in action && action.dependentItemId) return action.dependentItemId;
  if ("conflictId" in action && action.conflictId) return action.conflictId;
  if ("targetItemId" in action && action.targetItemId) return action.targetItemId;
  return "agenda";
}

export function renderAdjustmentDetails(action: SuggestedAdjustmentAction) {
  switch (action.type) {
    case "reassign_time_block":
      return (
        <div style={{ fontSize: "0.9rem", marginTop: "4px" }}>
          <div>
            <strong>Bloque anterior:</strong> {action.currentBlock.day} (
            {action.currentBlock.startTime} - {action.currentBlock.endTime})
          </div>
          <div>
            <strong>Nuevo bloque:</strong> {action.proposedBlock.day} (
            {action.proposedBlock.startTime} - {action.proposedBlock.endTime})
          </div>
          {action.rationale && (
            <div className="calm-muted" style={{ marginTop: "2px" }}>
              <em>Motivo propuesto:</em> {action.rationale}
            </div>
          )}
        </div>
      );
    case "reallocate_day_work":
      return (
        <div style={{ fontSize: "0.9rem", marginTop: "4px" }}>
          <div>
            <strong>Redistribución:</strong> {action.hoursToMove}h desde {action.sourceDay} hacia{" "}
            {action.targetDay}
          </div>
          {action.rationale && (
            <div className="calm-muted" style={{ marginTop: "2px" }}>
              <em>Motivo propuesto:</em> {action.rationale}
            </div>
          )}
        </div>
      );
    case "postpone_item":
      return (
        <div style={{ fontSize: "0.9rem", marginTop: "4px" }}>
          <div>
            <strong>Postergación:</strong>{" "}
            {action.hoursFreed ? `${action.hoursFreed}h liberadas. ` : ""}
            Destino: {action.targetReason}
          </div>
          {action.targetWeek && (
            <div>
              <strong>Semana objetivo:</strong> {action.targetWeek.startDate} al{" "}
              {action.targetWeek.endDate}
            </div>
          )}
          {action.rationale && (
            <div className="calm-muted" style={{ marginTop: "2px" }}>
              <em>Motivo propuesto:</em> {action.rationale}
            </div>
          )}
        </div>
      );
    case "unblock_dependency":
      return (
        <div style={{ fontSize: "0.9rem", marginTop: "4px" }}>
          <div>
            <strong>Desbloqueo:</strong> Prerrequisito con ítem{" "}
            <code>{action.prerequisiteItemId}</code> (Acción: {action.requiredAction})
          </div>
          {action.rationale && (
            <div className="calm-muted" style={{ marginTop: "2px" }}>
              <em>Motivo propuesto:</em> {action.rationale}
            </div>
          )}
        </div>
      );
    case "accept_risk":
      return (
        <div style={{ fontSize: "0.9rem", marginTop: "4px" }}>
          <div>
            <strong>Aceptación de riesgo:</strong> Conflicto <code>{action.conflictId}</code> (
            {action.toleratedRisk})
          </div>
          {action.rationale && (
            <div className="calm-muted" style={{ marginTop: "2px" }}>
              <em>Motivo propuesto:</em> {action.rationale}
            </div>
          )}
        </div>
      );
    case "request_information":
      return (
        <div style={{ fontSize: "0.9rem", marginTop: "4px" }}>
          <div>
            <strong>Solicitud de información:</strong> {action.question}
          </div>
          <div className="calm-muted" style={{ marginTop: "2px" }}>
            <em>Campo requerido:</em> {action.missingField}
          </div>
        </div>
      );
    default:
      return null;
  }
}

export function formatMemoryCategory(category?: string): string {
  switch (category) {
    case "project_context":
      return "Contexto de proyecto";
    case "preference":
      return "Preferencia de trabajo";
    case "decision":
      return "Decisión consciente";
    case "temporal_constraint":
      return "Restricción temporal";
    case "working_hypothesis":
      return "Hipótesis de trabajo";
    case "fact":
    default:
      return "Aprendizaje";
  }
}

export function formatProvenanceSource(source?: string): string {
  switch (source) {
    case "user_explicit":
      return "Tu reflexión personal";
    case "conversation_inference":
      return "Deducido del cierre";
    case "plan_decision":
      return "Decisión de la semana";
    case "system":
    default:
      return "Registro del sistema";
  }
}

export function formatConfirmationStatus(status?: string): string {
  switch (status) {
    case "confirmed":
      return "Confirmado";
    case "inferred":
      return "Sugerido";
    case "unconfirmed":
      return "Pendiente";
    default:
      return status ?? "";
  }
}

export interface PlanItemDescriptor {
  itemId: string;
  title: string;
  source: string;
  estimatedHours?: number | null;
  rationale?: string;
  deferredReason?: DeferredReason;
  dueDate?: string;
}

export function extractPlanItems(
  plan?: StoredWeeklyPlan | null,
  schedule?: WeeklySchedule | null
): PlanItemDescriptor[] {
  if (!plan) return [];
  const map = new Map<string, PlanItemDescriptor>();

  for (const o of plan.proposal.obligations) {
    if (!map.has(o.itemId)) {
      const alloc = schedule?.dailyAllocations.find((a) => a.itemId === o.itemId);
      map.set(o.itemId, {
        itemId: o.itemId,
        title: o.title,
        source: "Obligación",
        estimatedHours: o.estimatedHours ?? alloc?.allocatedHours ?? null,
        rationale: o.rationale,
        dueDate: o.dueDate,
      });
    }
  }

  for (const f of plan.proposal.flexibleOptions) {
    if (!map.has(f.itemId)) {
      const alloc = schedule?.dailyAllocations.find((a) => a.itemId === f.itemId);
      map.set(f.itemId, {
        itemId: f.itemId,
        title: f.title,
        source: "Opción flexible",
        estimatedHours: f.estimatedHours ?? alloc?.allocatedHours ?? null,
      });
    }
  }

  for (const focus of plan.proposal.foci) {
    for (const itemId of focus.contributingItemIds) {
      if (!map.has(itemId)) {
        const alloc = schedule?.dailyAllocations.find((a) => a.itemId === itemId);
        map.set(itemId, {
          itemId,
          title: `${focus.title} (${itemId})`,
          source: "Foco",
          estimatedHours: focus.estimatedHours ?? alloc?.allocatedHours ?? null,
          rationale: focus.rationale,
        });
      }
    }
  }

  for (const d of plan.proposal.deferredItems) {
    if (!map.has(d.itemId)) {
      const alloc = schedule?.dailyAllocations.find((a) => a.itemId === d.itemId);
      map.set(d.itemId, {
        itemId: d.itemId,
        title: d.title,
        source: formatDeferredReason(d.reason),
        estimatedHours: alloc?.allocatedHours ?? null,
        rationale: d.rationale,
        deferredReason: d.reason,
      });
    }
  }

  if (schedule) {
    for (const a of schedule.dailyAllocations) {
      if (!map.has(a.itemId)) {
        map.set(a.itemId, {
          itemId: a.itemId,
          title: `Tarea asignada (${a.itemId})`,
          source: "Agenda",
        });
      }
    }
    for (const b of schedule.timeBlocks) {
      if (!map.has(b.itemId)) {
        map.set(b.itemId, {
          itemId: b.itemId,
          title: `Bloque (${b.itemId})`,
          source: "Agenda",
        });
      }
    }
  }

  return Array.from(map.values());
}
