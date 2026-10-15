import { useState, useEffect } from "react";
import { AIProvider } from "../../providers/ai-provider";
import { MockProvider } from "../../providers/mock-provider";
import { useWeeklySession } from "../context/weekly-session-context";
import { StoredWeeklyPlan } from "../../domain/repositories/types";
import { ExtractedItem } from "../../domain/items";
import {
  WeeklySchedule,
  ScheduleAdjustmentRecord,
  DailyWorkAllocation,
} from "../../domain/schedule";
import { SuggestedAdjustmentAction } from "../../domain/adjustment";
import { ItemOutcomeInput } from "../../domain/close-week";
import { StoreCandidate } from "../../domain/memory";
import {
  WeeklyCapacitySummary,
  CapacityStatus,
  ProtectedSpaceStatus,
  EstimationCompleteness,
  DeferredReason,
  WeeklyFlexibleOption,
} from "../../domain/week";
import { calculateWeeklyCapacity } from "../../skills/build-week/deterministic";
import { WeeklyPlanningFromNotes } from "./weekly-planning-from-notes";

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

export function formatAdjustmentActionType(
  type: SuggestedAdjustmentAction["type"]
): string {
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
            <strong>Redistribución:</strong> {action.hoursToMove}h desde{" "}
            {action.sourceDay} hacia {action.targetDay}
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
            <strong>Aceptación de riesgo:</strong> Conflicto{" "}
            <code>{action.conflictId}</code> ({action.toleratedRisk})
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
      map.set(o.itemId, {
        itemId: o.itemId,
        title: o.title,
        source: "Obligación",
        estimatedHours: o.estimatedHours,
        rationale: o.rationale,
        dueDate: o.dueDate,
      });
    }
  }

  for (const f of plan.proposal.flexibleOptions) {
    if (!map.has(f.itemId)) {
      map.set(f.itemId, {
        itemId: f.itemId,
        title: f.title,
        source: "Opción flexible",
        estimatedHours: f.estimatedHours,
      });
    }
  }

  for (const focus of plan.proposal.foci) {
    for (const itemId of focus.contributingItemIds) {
      if (!map.has(itemId)) {
        map.set(itemId, {
          itemId,
          title: `${focus.title} (${itemId})`,
          source: "Foco",
          estimatedHours: focus.estimatedHours,
          rationale: focus.rationale,
        });
      }
    }
  }

  for (const d of plan.proposal.deferredItems) {
    if (!map.has(d.itemId)) {
      map.set(d.itemId, {
        itemId: d.itemId,
        title: d.title,
        source: formatDeferredReason(d.reason),
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

export function CapacityProtectedSpaceSection({
  capacity,
}: {
  capacity: WeeklyCapacitySummary;
}) {
  const isComplete = capacity.estimationCompleteness === "complete";
  const isPartial = capacity.estimationCompleteness === "partial";
  const isNone = capacity.estimationCompleteness === "none";

  const protectedSpaceBadgeClass =
    capacity.protectedSpaceStatus === "respected"
      ? "badge-task"
      : capacity.protectedSpaceStatus === "compromised"
      ? "badge-commitment"
      : "badge-muted";

  const capacityStatusBadgeClass =
    capacity.capacityStatus === "within_capacity"
      ? "badge-task"
      : capacity.capacityStatus === "over_capacity"
      ? "badge-commitment"
      : "badge-muted";

  const estimationBadgeClass =
    isComplete
      ? "badge-task"
      : isPartial
      ? "badge-idea"
      : "badge-muted";

  const isCapacityConfigured = capacity.totalAvailableHours !== null;

  return (
    <section
      className="results-section calm-box"
      style={{ marginTop: "24px" }}
      aria-label="Capacidad y espacio protegido"
      data-testid="capacity-protected-space-section"
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          flexWrap: "wrap",
          gap: "8px",
          marginBottom: "6px",
        }}
      >
        <h3 style={{ margin: 0 }}>Capacidad y margen</h3>
        <span
          className="calm-muted"
          data-testid="guiding-principle"
          style={{ fontSize: "0.8rem", fontStyle: "italic" }}
        >
          «El espacio libre no es automáticamente tiempo disponible para asumir más compromisos.»
        </span>
      </div>
      <p
        className="calm-muted"
        style={{ fontSize: "0.82rem", margin: "0 0 12px 0", color: "#666" }}
      >
        El espacio protegido deja margen para imprevistos, descanso y cambios de prioridad.
      </p>

      {/* Resumen compacto de viabilidad y capacidad (Fase 5) */}
      <div
        className="capacity-compact-bar calm-box"
        data-testid="capacity-compact-bar"
        style={{
          marginBottom: "16px",
          padding: "12px 16px",
          background: "var(--bg-card, #fcfbf9)",
          border: "1px solid var(--border-color, #e8e3d9)",
          borderRadius: "8px",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: "8px",
            marginBottom: "8px",
          }}
        >
          <span style={{ fontWeight: 600, fontSize: "0.92rem" }}>
            Balance de tu semana:
          </span>
          <span
            className={`badge ${capacityStatusBadgeClass}`}
            data-testid="compact-capacity-status"
          >
            {isCapacityConfigured && capacity.capacityStatus === "unknown"
              ? "Tareas sin estimar"
              : formatCapacityStatus(capacity.capacityStatus)}
          </span>
        </div>

        {/* Tu tiempo de un vistazo (visual bar) */}
        {capacity.totalAvailableHours != null && capacity.totalAvailableHours > 0 && (
          <div className="cognitive-budget-card" style={{ margin: "4px 0 12px", padding: "10px 14px" }}>
            <div className="cognitive-budget-header">
              <span className="cognitive-budget-title">Tu tiempo de un vistazo</span>
              <span className="cognitive-budget-ratio">
                {capacity.plannedHours != null
                  ? `${capacity.plannedHours}h asignadas`
                  : "Tareas sin estimar en horas"}{" "}
                / {capacity.totalAvailableHours}h disponibles
              </span>
            </div>
            <div className="cognitive-bar-track">
              {capacity.plannedHours != null && capacity.plannedHours > 0 && (
                <div
                  className="cognitive-bar-fill"
                  style={{
                    width: `${Math.min(100, Math.round((capacity.plannedHours / capacity.totalAvailableHours) * 100))}%`,
                  }}
                  title={`Planificadas: ${capacity.plannedHours}h`}
                />
              )}
              {capacity.protectedSpaceHours != null && capacity.protectedSpaceHours > 0 && (
                <div
                  className="cognitive-bar-fill protected"
                  style={{
                    width: `${Math.min(100, Math.round((capacity.protectedSpaceHours / capacity.totalAvailableHours) * 100))}%`,
                  }}
                  title={`Margen de calma: ${capacity.protectedSpaceHours}h`}
                />
              )}
            </div>
          </div>
        )}

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
            gap: "10px",
            fontSize: "0.85rem",
          }}
        >
          <div
            style={{
              background: "#f9f8f6",
              padding: "8px 12px",
              borderRadius: "6px",
              border: "1px solid #eeebe4",
            }}
          >
            <span className="calm-muted" style={{ display: "block", fontSize: "0.78rem" }}>
              Disponibles:
            </span>
            <strong style={{ fontSize: "1.05rem" }}>
              {formatHours(capacity.totalAvailableHours, "No disponible")}
            </strong>
          </div>
          <div
            style={{
              background: "#f9f8f6",
              padding: "8px 12px",
              borderRadius: "6px",
              border: "1px solid #eeebe4",
            }}
          >
            <span className="calm-muted" style={{ display: "block", fontSize: "0.78rem" }}>
              Protegidas:
            </span>
            <strong style={{ fontSize: "1.05rem" }}>
              {formatHours(capacity.protectedSpaceHours, "Desconocido")}
            </strong>
            <span className="calm-muted" style={{ display: "block", fontSize: "0.72rem", marginTop: "2px" }}>
              Margen de calma
            </span>
          </div>
          <div
            style={{
              background: "#f9f8f6",
              padding: "8px 12px",
              borderRadius: "6px",
              border: "1px solid #eeebe4",
            }}
          >
            <span className="calm-muted" style={{ display: "block", fontSize: "0.78rem" }}>
              Planificables:
            </span>
            <strong style={{ fontSize: "1.05rem" }}>
              {formatHours(capacity.plannableHours, "Desconocido")}
            </strong>
          </div>
          <div
            style={{
              background: "#f9f8f6",
              padding: "8px 12px",
              borderRadius: "6px",
              border: "1px solid #eeebe4",
            }}
          >
            <span className="calm-muted" style={{ display: "block", fontSize: "0.78rem" }}>
              Planificadas:
            </span>
            <strong style={{ fontSize: "1.05rem" }}>
              {capacity.plannedHours != null
                ? formatHours(capacity.plannedHours)
                : formatHours(capacity.knownEstimatedHours, "Sin estimar")}
            </strong>
          </div>
          <div
            style={{
              background: "#f9f8f6",
              padding: "8px 12px",
              borderRadius: "6px",
              border: "1px solid #eeebe4",
            }}
          >
            <span className="calm-muted" style={{ display: "block", fontSize: "0.78rem" }}>
              Restantes:
            </span>
            <strong style={{ fontSize: "1.05rem" }}>
              {capacity.plannableHours != null && capacity.plannedHours != null
                ? formatHours(Math.max(0, capacity.plannableHours - capacity.plannedHours))
                : capacity.plannableHours != null
                ? `Hasta ${formatHours(capacity.plannableHours)}`
                : "Desconocido"}
            </strong>
          </div>
        </div>

        <p
          className="calm-muted"
          data-testid="protected-space-reservation-notice"
          style={{
            fontSize: "0.82rem",
            marginTop: "12px",
            marginBottom: 0,
            color: "#595959",
          }}
        >
          {capacity.plannedHours == null && capacity.plannableHours != null
            ? `Se ha reservado espacio protegido en el plan (margen de calma). Disponés de hasta ${formatHours(capacity.plannableHours)} para tareas sin estimar.`
            : "Se ha reservado espacio protegido en el plan como margen de calma para imprevistos y descanso."}
        </p>
      </div>

      {/* Divulgación progresiva: Desglose completo de cálculos y límites */}
      <details className="calm-details" style={{ marginTop: "12px" }}>
        <summary
          style={{
            cursor: "pointer",
            fontWeight: 600,
            fontSize: "0.88rem",
            color: "var(--accent-color, #2b6cb0)",
            padding: "4px 0",
            userSelect: "none",
          }}
        >
          Ver desglose completo de cálculos y límites
        </summary>
        <div style={{ marginTop: "12px" }}>
          {/* Rejilla de límites de tiempo y carga */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
              gap: "18px",
            }}
          >
        {/* 1. Límites de tiempo */}
        <div
          className="item-card"
          style={{ flexDirection: "column", gap: "10px", margin: 0 }}
          data-testid="time-boundaries-card"
        >
          <div className="item-title" style={{ fontSize: "1.05rem" }}>
            <strong>Límites de tiempo</strong>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "8px", width: "100%" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: "8px" }}>
              <span className="calm-muted">Tiempo disponible:</span>
              <strong data-testid="total-available-hours">
                {formatHours(capacity.totalAvailableHours, "No disponible")}
              </strong>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", gap: "8px" }}>
              <span className="calm-muted">Tiempo planificable:</span>
              <strong data-testid="plannable-hours">
                {formatHours(capacity.plannableHours, "Desconocido")}
              </strong>
            </div>

            {capacity.plannableHours != null && capacity.plannedHours != null && (
              <div style={{ display: "flex", justifyContent: "space-between", gap: "8px" }}>
                <span className="calm-muted">Capacidad restante:</span>
                <strong data-testid="remaining-plannable-hours">
                  {formatHours(Math.max(0, capacity.plannableHours - capacity.plannedHours))}
                </strong>
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "space-between", gap: "8px" }}>
              <span className="calm-muted">Espacio protegido:</span>
              <strong data-testid="protected-space-hours">
                {formatHours(capacity.protectedSpaceHours, "Desconocido")}
              </strong>
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginTop: "4px",
                paddingTop: "8px",
                borderTop: "1px solid var(--border-color, #e8e3d9)",
              }}
            >
              <span className="calm-muted" style={{ fontSize: "0.85rem" }}>
                Margen protegido:
              </span>
              <span
                className={`badge ${protectedSpaceBadgeClass}`}
                data-testid="protected-space-status"
                aria-label={`Estado del espacio protegido: ${
                  !isCapacityConfigured && capacity.protectedSpaceStatus === "unknown"
                    ? "Desconocido (sin configurar)"
                    : formatProtectedSpaceStatus(capacity.protectedSpaceStatus)
                }`}
              >
                {!isCapacityConfigured && capacity.protectedSpaceStatus === "unknown"
                  ? "Desconocido (sin configurar)"
                  : formatProtectedSpaceStatus(capacity.protectedSpaceStatus)}
              </span>
            </div>

            {!isCapacityConfigured && (
              <p
                className="calm-muted"
                data-testid="unconfigured-capacity-note"
                style={{
                  fontSize: "0.82rem",
                  marginTop: "6px",
                  padding: "6px 8px",
                  background: "#f7f7f7",
                  borderRadius: "4px",
                }}
              >
                Capacidad no configurada: la entrada no aportó horas disponibles. El tiempo planificable y el margen protegido quedan sin definir.
              </p>
            )}
          </div>
        </div>

        {/* 2. Estimación de tareas */}
        <div
          className="item-card"
          style={{ flexDirection: "column", gap: "10px", margin: 0 }}
          data-testid="workload-certainty-card"
        >
          <div className="item-title" style={{ fontSize: "1.05rem" }}>
            <strong>Estimación de tareas</strong>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "8px", width: "100%" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: "8px" }}>
              <span className="calm-muted">Estado:</span>
              <span
                className={`badge ${estimationBadgeClass}`}
                data-testid="estimation-completeness"
                aria-label={`Completitud de estimaciones: ${formatEstimationCompleteness(
                  capacity.estimationCompleteness
                )}`}
              >
                {formatEstimationCompleteness(capacity.estimationCompleteness)}
              </span>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", gap: "8px" }}>
              <span className="calm-muted">Horas calculadas:</span>
              <strong data-testid="planned-hours">
                {isComplete && capacity.plannedHours != null
                  ? formatHours(capacity.plannedHours)
                  : "Por definir"}
              </strong>
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginTop: "4px",
                paddingTop: "8px",
                borderTop: "1px solid var(--border-color, #e8e3d9)",
              }}
            >
              <span className="calm-muted" style={{ fontSize: "0.85rem" }}>
                Balance:
              </span>
              <span
                className={`badge ${capacityStatusBadgeClass}`}
                data-testid="capacity-status"
                aria-label={`Estado de capacidad: ${
                  !isCapacityConfigured && capacity.capacityStatus === "unknown"
                    ? "Capacidad desconocida (sin configurar)"
                    : isCapacityConfigured && capacity.capacityStatus === "unknown"
                    ? "Capacidad desconocida (faltan estimaciones)"
                    : formatCapacityStatus(capacity.capacityStatus)
                }`}
              >
                {!isCapacityConfigured && capacity.capacityStatus === "unknown"
                  ? "Sin configurar"
                  : isCapacityConfigured && capacity.capacityStatus === "unknown"
                  ? "Pendiente de estimar"
                  : formatCapacityStatus(capacity.capacityStatus)}
              </span>
            </div>
          </div>

          {/* Contextual honest explanations */}
          {!isCapacityConfigured && (
            <p
              className="calm-muted"
              data-testid="unconfigured-balance-note"
              style={{
                fontSize: "0.82rem",
                marginTop: "4px",
                padding: "6px 8px",
                background: "#f7f7f7",
                borderRadius: "4px",
              }}
            >
              No se puede calcular el balance porque no has configurado horas disponibles.
            </p>
          )}

          {isCapacityConfigured && isPartial && (
            <p
              className="calm-muted"
              data-testid="partial-estimation-note"
              style={{
                fontSize: "0.82rem",
                marginTop: "4px",
                padding: "6px 8px",
                background: "#fdf8ee",
                borderRadius: "4px",
              }}
            >
              Hay {formatHours(capacity.knownEstimatedHours, "algunas horas")} estimadas, pero aún faltan tareas por definir.
            </p>
          )}

          {isNone && (
            <p
              className="calm-muted"
              data-testid="none-estimation-note"
              style={{
                fontSize: "0.82rem",
                marginTop: "4px",
                padding: "6px 8px",
                background: "#f7f7f7",
                borderRadius: "4px",
              }}
            >
              Tienes tareas previstas, pero aún no les has asignado horas.
            </p>
          )}
        </div>
      </div>
        </div>
      </details>
    </section>
  );
}


export type ItemDispositionChoice =
  | "unreviewed"
  | "completed"
  | "in_progress"
  | "not_started"
  | "consciously_postponed"
  | "dropped";

export interface ItemDispositionForm {
  status: ItemDispositionChoice;
  postponementReason: string;
}

export interface WeeklySessionViewProps {
  provider?: AIProvider;
  initialPlanningItems?: ExtractedItem[];
  onClearPlanningItems?: () => void;
  activeSpace?: "prepare" | "active" | "review";
  onNavigateSpace?: (space: "capture" | "prepare" | "active" | "review") => void;
}

export function WeeklySessionView({
  provider = new MockProvider(),
  initialPlanningItems,
  onClearPlanningItems,
  activeSpace,
  onNavigateSpace,
}: WeeklySessionViewProps = {}) {
  const {
    state,
    reloadSession,
    createOrSavePlan,
    applyAdjustment,
    closeWeek,
    reopenWeek,
    confirmMemoryCandidate,
    purgeSession,
    resolveAmbiguity,
  } = useWeeklySession();

  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);
  const [reflectionNotes, setReflectionNotes] = useState("");
  const [dispositions, setDispositions] = useState<Record<string, ItemDispositionForm>>({});
  const [isPurgeConfirming, setIsPurgeConfirming] = useState(false);
  const [isClosedWeekDetailsOpen, setIsClosedWeekDetailsOpen] = useState(false);
  const [reopenFeedback, setReopenFeedback] = useState<string | null>(null);
  const [isReopening, setIsReopening] = useState(false);
  const [closeStep, setCloseStep] = useState<"dispositions" | "reflection">("dispositions");
  const [isEarlyCloseConfirmed, setIsEarlyCloseConfirmed] = useState(false);

  // Interactive Adjustment Proposal State
  const [selectedAdjustmentItemId, setSelectedAdjustmentItemId] = useState<string>("");
  const [targetWeekStart, setTargetWeekStart] = useState("2026-10-26");
  const [targetWeekEnd, setTargetWeekEnd] = useState("2026-11-01");
  const [deadlineInput, setDeadlineInput] = useState("");
  const [taskHoursInput, setTaskHoursInput] = useState<string>("");
  const [taskDayInput, setTaskDayInput] = useState<string>("");
  const [isAdjustmentPreviewOpen, setIsAdjustmentPreviewOpen] = useState(false);
  const [isFuturePlanningOpen, setIsFuturePlanningOpen] = useState(
    Boolean(initialPlanningItems && initialPlanningItems.length > 0)
  );

  const plan = state.activePlan;
  const schedule = state.activeSchedule;
  const planItems = extractPlanItems(plan, schedule);
  const effectiveItemId = selectedAdjustmentItemId || planItems[0]?.itemId || "";
  const selectedItem = planItems.find((i) => i.itemId === effectiveItemId) || planItems[0];

  useEffect(() => {
    if (selectedItem) {
      setTaskHoursInput(selectedItem.estimatedHours != null ? String(selectedItem.estimatedHours) : "");
      const alloc = schedule?.dailyAllocations.find((a) => a.itemId === selectedItem.itemId);
      setTaskDayInput(alloc?.day || "");
    }
  }, [selectedItem?.itemId, selectedItem?.estimatedHours, schedule]);

  const handleSaveTaskHours = async (itemId: string, itemTitle: string) => {
    if (!plan) return;
    const parsed = taskHoursInput.trim() ? parseFloat(taskHoursInput) : null;
    if (parsed !== null && (isNaN(parsed) || parsed < 0)) return;

    let updatedObligations = plan.proposal.obligations.map((o) =>
      o.itemId === itemId ? { ...o, estimatedHours: parsed } : o
    );
    let updatedFlexible = plan.proposal.flexibleOptions.map((f) =>
      f.itemId === itemId ? { ...f, estimatedHours: parsed } : f
    );
    let updatedFoci = plan.proposal.foci.map((focus) =>
      focus.contributingItemIds.includes(itemId)
        ? { ...focus, estimatedHours: parsed }
        : focus
    );
    let updatedDeferred = plan.proposal.deferredItems.map((d) =>
      d.itemId === itemId ? { ...d } : d
    );

    // Si la tarea estaba diferida y ahora tiene horas estimadas, incorporarla como opción flexible
    if (plan.proposal.deferredItems.some((d) => d.itemId === itemId) && parsed !== null) {
      const deferredItem = plan.proposal.deferredItems.find((d) => d.itemId === itemId)!;
      updatedDeferred = plan.proposal.deferredItems.filter((d) => d.itemId !== itemId);
      if (!updatedFlexible.some((f) => f.itemId === itemId)) {
        updatedFlexible.push({
          itemId: deferredItem.itemId,
          title: deferredItem.title,
          estimatedHours: parsed,
          condition: "Estimada manualmente por la persona",
        });
      }
    }

    const allPlannedEntries = [
      ...updatedFoci.map((f) => ({ estimatedHours: f.estimatedHours })),
      ...updatedObligations.map((o) => ({ estimatedHours: o.estimatedHours })),
      ...updatedFlexible.map((f) => ({ estimatedHours: f.estimatedHours })),
    ];
    let sum = 0;
    let nonNullCount = 0;
    for (const e of allPlannedEntries) {
      if (typeof e.estimatedHours === "number" && Number.isFinite(e.estimatedHours)) {
        sum += e.estimatedHours;
        nonNullCount++;
      }
    }
    const completeness: EstimationCompleteness =
      nonNullCount === allPlannedEntries.length && allPlannedEntries.length > 0
        ? "complete"
        : nonNullCount > 0
        ? "partial"
        : "none";
    const explicitKnownEstimatedHours = nonNullCount > 0 ? Math.round(sum * 100) / 100 : null;

    const updatedCapacity = calculateWeeklyCapacity({
      capacityConfig: {
        totalAvailableHours: plan.proposal.weekSummary.capacity.totalAvailableHours ?? undefined,
        minProtectedSpaceRatio:
          plan.proposal.weekSummary.capacity.totalAvailableHours &&
          plan.proposal.weekSummary.capacity.protectedSpaceHours
            ? plan.proposal.weekSummary.capacity.protectedSpaceHours /
              plan.proposal.weekSummary.capacity.totalAvailableHours
            : 0.25,
      },
      explicitKnownEstimatedHours,
      explicitCompleteness: completeness,
      foci: updatedFoci,
      obligations: updatedObligations,
    });

    const updatedPlan: StoredWeeklyPlan = {
      ...plan,
      proposal: {
        ...plan.proposal,
        obligations: updatedObligations,
        flexibleOptions: updatedFlexible,
        foci: updatedFoci,
        deferredItems: updatedDeferred,
        weekSummary: {
          ...plan.proposal.weekSummary,
          capacity: updatedCapacity,
        },
      },
      updatedAt: new Date().toISOString(),
    };

    let updatedSchedule = schedule;
    if (schedule && schedule.dailyAllocations.some((a) => a.itemId === itemId)) {
      updatedSchedule = {
        ...schedule,
        dailyAllocations: schedule.dailyAllocations.map((a) =>
          a.itemId === itemId ? { ...a, allocatedHours: parsed ?? a.allocatedHours } : a
        ),
        version: schedule.version + 1,
        updatedAt: new Date().toISOString(),
      };
    }

    await createOrSavePlan(updatedPlan, updatedSchedule ?? undefined);
    setIsAdjustmentPreviewOpen(false);
    setFeedbackMessage(
      `Horas guardadas para «${itemTitle}»: ${parsed != null ? `${parsed}h` : "sin estimar"} (repartidas en la semana actual, sin día fijo).`
    );
  };

  const handleAssignTaskDay = async (
    itemId: string,
    itemTitle: string,
    defaultHours?: number | null
  ) => {
    if (!schedule || !plan) return;
    let newDailyAllocations = [...schedule.dailyAllocations];
    const existingIdx = newDailyAllocations.findIndex((a) => a.itemId === itemId);
    const parsedHours = taskHoursInput.trim() ? parseFloat(taskHoursInput) : null;
    const hours =
      parsedHours && !isNaN(parsedHours) && parsedHours > 0
        ? parsedHours
        : defaultHours ?? 1;

    let updatedPlan = plan;

    if (taskDayInput) {
      const allocation: DailyWorkAllocation = {
        itemId,
        day: taskDayInput,
        allocatedHours: hours,
      };
      if (existingIdx >= 0) {
        newDailyAllocations[existingIdx] = allocation;
      } else {
        newDailyAllocations.push(allocation);
      }

      // Si la tarea estaba en deferredItems, promoverla a flexibleOptions
      if (plan.proposal.deferredItems.some((d) => d.itemId === itemId)) {
        const deferredItem = plan.proposal.deferredItems.find((d) => d.itemId === itemId)!;
        const updatedDeferred = plan.proposal.deferredItems.filter((d) => d.itemId !== itemId);
        const updatedFlexible: WeeklyFlexibleOption[] = [
          ...plan.proposal.flexibleOptions,
          {
            itemId: deferredItem.itemId,
            title: deferredItem.title,
            estimatedHours: defaultHours ?? (parsedHours || null),
            condition: "Programada manualmente por la persona",
          },
        ];
        updatedPlan = {
          ...plan,
          proposal: {
            ...plan.proposal,
            deferredItems: updatedDeferred,
            flexibleOptions: updatedFlexible,
          },
          updatedAt: new Date().toISOString(),
        };
      }
    } else {
      newDailyAllocations = newDailyAllocations.filter((a) => a.itemId !== itemId);
    }

    const updatedSchedule: WeeklySchedule = {
      ...schedule,
      dailyAllocations: newDailyAllocations,
      version: schedule.version + 1,
      updatedAt: new Date().toISOString(),
    };

    await createOrSavePlan(updatedPlan, updatedSchedule);
    setIsAdjustmentPreviewOpen(false);
    setFeedbackMessage(
      taskDayInput
        ? `Tarea «${itemTitle}» programada para el ${taskDayInput}.`
        : `Tarea «${itemTitle}» sin día asignado (repartida en la semana).`
    );
  };

  const handleReopenWeek = async (planId: string) => {
    setIsReopening(true);
    setReopenFeedback(null);
    try {
      if (!reopenWeek) {
        throw new Error("La función para reabrir semanas no está disponible.");
      }
      const res = await reopenWeek(planId);
      if (res.status === "success") {
        setFeedbackMessage("Semana reabierta exitosamente. Ahora podés continuar planificando o modificando tus tareas.");
      } else if (res.status === "conflict_active_plan_exists") {
        setReopenFeedback(
          `No es posible reabrir esta semana porque ya existe otra semana activa (${res.existingActivePlanId}). Cerrá o purgá la semana activa antes de reabrir esta.`
        );
      } else {
        setReopenFeedback(
          `No se pudo reabrir la semana: ${res.status === "failed" ? res.reason : res.status}`
        );
      }
    } catch (err) {
      setReopenFeedback((err as Error).message || "Ocurrió un error inesperado al reabrir la semana.");
    } finally {
      setIsReopening(false);
    }
  };

  useEffect(() => {
    if (initialPlanningItems && initialPlanningItems.length > 0) {
      setIsFuturePlanningOpen(true);
    }
  }, [initialPlanningItems]);

  const handleDispositionChange = (itemId: string, status: ItemDispositionChoice) => {
    setDispositions((prev) => ({
      ...prev,
      [itemId]: {
        status,
        postponementReason: prev[itemId]?.postponementReason || "",
      },
    }));
  };

  const handlePostponementReasonChange = (itemId: string, reason: string) => {
    setDispositions((prev) => ({
      ...prev,
      [itemId]: {
        status: prev[itemId]?.status || "consciously_postponed",
        postponementReason: reason,
      },
    }));
  };

  // --------------------------------------------------------------------------
  // Loading State
  // --------------------------------------------------------------------------
  if (state.status === "loading") {
    return (
      <div className="session-container calm-box" role="status" aria-live="polite">
        <p className="calm-text">Revisando tu cuaderno y agenda...</p>
      </div>
    );
  }

  // --------------------------------------------------------------------------
  // Error State
  // --------------------------------------------------------------------------
  if (state.status === "error") {
    return (
      <div className="session-container status-message status-error" role="alert">
        <h3>Se produjo una interrupción en el almacenamiento</h3>
        <p>{state.errorMessage}</p>
        <button
          className="primary"
          aria-label="Reintentar conexión con la base de datos"
          onClick={() => reloadSession()}
        >
          Reintentar conexión
        </button>
      </div>
    );
  }

  // --------------------------------------------------------------------------
  // Inconsistent References State
  // --------------------------------------------------------------------------
  if (state.status === "inconsistent_references") {
    return (
      <div className="session-container calm-box warning-box" role="alert">
        <h3>Incoherencia detectada en las referencias del plan</h3>
        <p className="calm-text">
          La agenda o informe guardado no coincide exactamente con el plan activo:
        </p>
        <blockquote className="raw-json-box">{state.inconsistencyReason}</blockquote>
        <p className="calm-muted">
          Para preservar la integridad de tus datos, no realizamos mutaciones automáticas.
        </p>
        <div className="actions">
          <button
            className="secondary"
            aria-label="Recargar sesión para verificar estado"
            onClick={() => reloadSession()}
          >
            Recargar
          </button>
        </div>
      </div>
    );
  }

  // --------------------------------------------------------------------------
  // Ambiguous Active Plans State
  // --------------------------------------------------------------------------
  if (state.status === "ambiguous_active_plans") {
    return (
      <div className="session-container calm-box warning-box" role="alert">
        <h3>Múltiples planes activos detectados</h3>
        <p className="calm-text">
          Existen varios planes marcados simultáneamente como activos. Tú decides
          cuál conservar como el plan de esta semana:
        </p>
        <ul className="items-list" aria-label="Lista de planes activos ambiguos">
          {state.ambiguousPlanIds.map((id) => (
            <li
              key={id}
              className="item-card"
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span>
                Plan ID: <strong>{id}</strong>
              </span>
              <button
                className="primary"
                aria-label={`Mantener plan ${id} como activo`}
                onClick={async () => {
                  await resolveAmbiguity(id);
                  setFeedbackMessage(`Se seleccionó el plan ${id} como activo.`);
                }}
              >
                Mantener este plan
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  // --------------------------------------------------------------------------
  // Helper: Latest Closed Week Section (Reused across views)
  // --------------------------------------------------------------------------
  const renderLatestClosedWeekSection = () => {
    if (!state.latestClosedWeek) return null;
    return (
      <section
        className="calm-box"
        style={{
          marginTop: "20px",
          background: "var(--card-bg, #fbfbfb)",
          borderColor: "var(--border-color, #e0e0e0)",
        }}
        aria-label="Historial del último cierre semanal"
        data-testid="latest-closed-week-card"
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            flexWrap: "wrap",
            gap: "8px",
          }}
        >
          <h3>Última semana cerrada</h3>
          <span className="badge badge-muted">
            {state.latestClosedWeek.plan.targetWeek.startDate} al{" "}
            {state.latestClosedWeek.plan.targetWeek.endDate}
          </span>
        </div>
        <p className="calm-text" style={{ marginTop: "8px" }}>
          {state.latestClosedWeek.plan.proposal.weekSummary.intent || "Semana cerrada."}
        </p>
        <div className="config-row" style={{ marginTop: "12px", flexWrap: "wrap", gap: "8px" }}>
          <span className="badge badge-task">
            Cerrada el: {state.latestClosedWeek.closeReport.closedAt}
          </span>
          <span className="badge badge-muted">
            Completadas:{" "}
            {state.latestClosedWeek.closeReport.output.itemDispositions.completed.length}
          </span>
          {state.latestClosedWeek.closeReport.output.reflectiveSummary.consciousPostponements.length > 0 && (
            <span className="badge badge-idea">
              Postergadas:{" "}
              {state.latestClosedWeek.closeReport.output.reflectiveSummary.consciousPostponements.length}
            </span>
          )}
          {state.latestClosedWeek.closeReport.output.itemDispositions.dropped.length > 0 && (
            <span className="badge badge-muted">
              Descartadas:{" "}
              {state.latestClosedWeek.closeReport.output.itemDispositions.dropped.length}
            </span>
          )}
        </div>
        {state.latestClosedWeek.closeReport.output.reflectiveSummary.headline && (
          <p className="calm-muted" style={{ fontStyle: "italic", marginTop: "8px" }}>
            "{state.latestClosedWeek.closeReport.output.reflectiveSummary.headline}"
          </p>
        )}

        {/* Acciones principales de la semana cerrada */}
        <div
          style={{
            marginTop: "16px",
            display: "flex",
            gap: "10px",
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          <button
            type="button"
            className="btn-secondary"
            data-testid="toggle-closed-week-details"
            onClick={() => setIsClosedWeekDetailsOpen(!isClosedWeekDetailsOpen)}
            style={{ fontSize: "0.88rem", padding: "6px 12px", cursor: "pointer" }}
          >
            {isClosedWeekDetailsOpen ? "Ocultar detalle de la semana" : "Ver detalle de la semana"}
          </button>

          <button
            type="button"
            className="btn-secondary"
            data-testid="reopen-closed-week-button"
            disabled={isReopening}
            onClick={() => handleReopenWeek(state.latestClosedWeek!.plan.planId)}
            style={{ fontSize: "0.88rem", padding: "6px 12px", cursor: isReopening ? "not-allowed" : "pointer" }}
          >
            {isReopening ? "Reabriendo semana..." : "Reabrir semana para modificar"}
          </button>
        </div>

        {reopenFeedback && (
          <p
            className="calm-muted"
            style={{
              color: "#a94442",
              marginTop: "10px",
              fontSize: "0.88rem",
              padding: "8px 12px",
              background: "#fdf7f7",
              borderRadius: "4px",
              border: "1px solid #f2dede",
            }}
            data-testid="reopen-week-error"
          >
            {reopenFeedback}
          </p>
        )}

        {/* Vista detallada desplegable */}
        {isClosedWeekDetailsOpen && (
          <div
            data-testid="closed-week-details-content"
            style={{
              marginTop: "16px",
              paddingTop: "16px",
              borderTop: "1px solid var(--border-color, #e0e0e0)",
            }}
          >
            {/* 1. Focos definidos */}
            {state.latestClosedWeek.plan.proposal.foci.length > 0 && (
              <div style={{ marginBottom: "16px" }}>
                <h4 style={{ fontSize: "0.95rem", marginBottom: "8px" }}>Focos de la semana</h4>
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  {state.latestClosedWeek.plan.proposal.foci.map((focus) => (
                    <div
                      key={focus.id}
                      className="calm-box"
                      style={{
                        padding: "10px 14px",
                        background: "var(--bg-secondary, #fafafa)",
                        borderRadius: "6px",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                        <strong>{focus.title}</strong>
                        <span className="badge badge-task">
                          {focus.estimatedHours ? `${focus.estimatedHours}h estimadas` : "Sin estimación"}
                        </span>
                      </div>
                      {focus.desiredOutcome && (
                        <p className="calm-text" style={{ fontSize: "0.85rem", marginTop: "4px" }}>
                          Resultado esperado: {focus.desiredOutcome}
                        </p>
                      )}
                      {focus.rationale && (
                        <p className="calm-muted" style={{ fontSize: "0.8rem", marginTop: "2px" }}>
                          {focus.rationale}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 2. Obligaciones y Compromisos */}
            {state.latestClosedWeek.plan.proposal.obligations.length > 0 && (
              <div style={{ marginBottom: "16px" }}>
                <h4 style={{ fontSize: "0.95rem", marginBottom: "8px" }}>Obligaciones y compromisos fijos</h4>
                <ul style={{ margin: 0, paddingLeft: "20px", display: "flex", flexDirection: "column", gap: "6px" }}>
                  {state.latestClosedWeek.plan.proposal.obligations.map((ob) => (
                    <li key={ob.itemId} style={{ fontSize: "0.88rem" }}>
                      <strong>{ob.title}</strong>
                      {ob.estimatedHours ? ` (${ob.estimatedHours}h)` : ""}
                      {ob.dueDate ? ` · Límite: ${ob.dueDate}` : ""}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* 3. Opciones flexibles */}
            {state.latestClosedWeek.plan.proposal.flexibleOptions.length > 0 && (
              <div style={{ marginBottom: "16px" }}>
                <h4 style={{ fontSize: "0.95rem", marginBottom: "8px" }}>Opciones flexibles</h4>
                <ul style={{ margin: 0, paddingLeft: "20px", display: "flex", flexDirection: "column", gap: "6px" }}>
                  {state.latestClosedWeek.plan.proposal.flexibleOptions.map((flex) => (
                    <li key={flex.itemId} style={{ fontSize: "0.88rem" }}>
                      <strong>{flex.title}</strong>
                      {flex.estimatedHours ? ` (${flex.estimatedHours}h)` : ""}
                      {flex.condition ? ` · Condición: ${flex.condition}` : ""}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* 4. Tareas e ítems clasificados al cierre */}
            {state.latestClosedWeek.closeReport.output.classifiedItems &&
              state.latestClosedWeek.closeReport.output.classifiedItems.length > 0 && (
                <div style={{ marginBottom: "16px" }}>
                  <h4 style={{ fontSize: "0.95rem", marginBottom: "8px" }}>Balance de tareas e ítems</h4>
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    {state.latestClosedWeek.closeReport.output.classifiedItems.map((item) => (
                      <div
                        key={item.itemId}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          flexWrap: "wrap",
                          padding: "8px 12px",
                          background: "var(--card-bg, #ffffff)",
                          border: "1px solid var(--border-color, #e0e0e0)",
                          borderRadius: "6px",
                          gap: "8px",
                        }}
                      >
                        <div>
                          <span style={{ fontSize: "0.9rem", fontWeight: 500 }}>{item.title}</span>
                          <div style={{ fontSize: "0.8rem", color: "#666", marginTop: "2px" }}>
                            {item.actualHours != null && <span>{item.actualHours}h reales</span>}
                            {item.actualHours != null && item.estimatedHours != null && <span> · </span>}
                            {item.estimatedHours != null && <span>{item.estimatedHours}h estimadas</span>}
                            {item.postponementReason && (
                              <span style={{ display: "block", color: "#8a6d3b" }}>
                                Motivo postergación: {item.postponementReason}
                              </span>
                            )}
                            {item.userNotes && (
                              <span style={{ display: "block", fontStyle: "italic" }}>
                                Nota: {item.userNotes}
                              </span>
                            )}
                          </div>
                        </div>
                        <span
                          className={`badge ${
                            item.finalDisposition === "completed"
                              ? "badge-task"
                              : item.finalDisposition === "consciously_postponed"
                              ? "badge-idea"
                              : "badge-muted"
                          }`}
                        >
                          {item.finalDisposition === "completed"
                            ? "Completada"
                            : item.finalDisposition === "consciously_postponed"
                            ? "Postergada"
                            : item.finalDisposition === "dropped"
                            ? "Descartada"
                            : item.finalDisposition === "in_progress"
                            ? "En progreso"
                            : item.finalDisposition === "not_started"
                            ? "No iniciada"
                            : "Sin reportar"}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

            {/* 5. Reflexiones de cierre */}
            <div style={{ marginTop: "12px", background: "var(--bg-secondary, #f8f9fa)", padding: "12px", borderRadius: "6px" }}>
              <h4 style={{ fontSize: "0.9rem", marginBottom: "6px" }}>Reflexión del cierre</h4>
              {state.latestClosedWeek.closeReport.output.capacityAnalysis?.explanation && (
                <p className="calm-text" style={{ fontSize: "0.85rem", marginBottom: "4px" }}>
                  <strong>Capacidad y espacio:</strong> {state.latestClosedWeek.closeReport.output.capacityAnalysis.explanation}
                </p>
              )}
              {state.latestClosedWeek.closeReport.output.reflectiveSummary.accomplishments.length > 0 && (
                <div style={{ fontSize: "0.85rem", marginBottom: "4px" }}>
                  <strong>Logros:</strong>
                  <ul style={{ margin: "4px 0 0 20px", padding: 0 }}>
                    {state.latestClosedWeek.closeReport.output.reflectiveSummary.accomplishments.map((acc, i) => (
                      <li key={i}>{acc}</li>
                    ))}
                  </ul>
                </div>
              )}
              {state.latestClosedWeek.closeReport.output.reflectiveSummary.questionsForNextCycle.length > 0 && (
                <div style={{ fontSize: "0.85rem", marginTop: "4px" }}>
                  <strong>Preguntas para el próximo ciclo:</strong>
                  <ul style={{ margin: "4px 0 0 20px", padding: 0 }}>
                    {state.latestClosedWeek.closeReport.output.reflectiveSummary.questionsForNextCycle.map((q, i) => (
                      <li key={i}>{q}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        )}
      </section>
    );
  };

  const renderDevOptions = () => (
    <div
      style={{
        marginTop: "24px",
        paddingTop: "12px",
        borderTop: "1px dashed var(--border-color, #ddd)",
      }}
      data-testid="dev-options-section"
    >
      <details className="calm-details">
        <summary style={{ cursor: "pointer", fontSize: "0.85rem", color: "#666" }}>
          Opciones de desarrollo: Iniciar semana de ejemplo prefijada
        </summary>
        <div style={{ marginTop: "12px" }}>
          <button
            type="button"
            className="secondary"
            aria-label="Iniciar nueva semana de ejemplo"
            onClick={async () => {
              const today = new Date().toISOString().split("T")[0]!;
              const planId = `plan-${today}`;
              const demoPlan: StoredWeeklyPlan = {
                planId,
                status: "active",
                targetWeek: {
                  startDate: "2026-10-12",
                  endDate: "2026-10-18",
                },
                proposal: {
                  weekSummary: {
                    targetWeek: {
                      startDate: "2026-10-12",
                      endDate: "2026-10-18",
                    },
                    capacity: {
                      totalAvailableHours: 30,
                      plannableHours: 22.5,
                      plannedHours: 16,
                      knownEstimatedHours: 16,
                      estimationCompleteness: "complete",
                      protectedSpaceHours: 7.5,
                      capacityStatus: "within_capacity",
                      protectedSpaceStatus: "respected",
                    },
                    intent: "Semana de consolidación y respiro",
                  },
                  foci: [
                    {
                      id: "focus-1",
                      title: "Reporte estratégico",
                      desiredOutcome: "Borrador revisado",
                      rationale: "Foco principal de la semana",
                      contributingItemIds: ["task-reporte"],
                      estimatedHours: 12,
                    },
                  ],
                  obligations: [
                    {
                      itemId: "task-reunion",
                      title: "Reunión de equipo",
                      dueDate: "2026-10-13",
                      commitmentType: "external",
                      rationale: "Compromiso de coordinación",
                      estimatedHours: 4,
                    },
                  ],
                  flexibleOptions: [],
                  deferredItems: [],
                  unplannedSpace: {
                    recommendedHours: 7.5,
                    rationale: "Espacio protegido para imprevistos",
                  },
                  confirmationPrompt: {
                    question: "¿Te representa este plan?",
                    keyTradeoffs: ["Foco en reporte estratégico vs otras tareas"],
                    pendingQuestions: [],
                  },
                },
                createdAt: today,
                updatedAt: today,
              };

              const demoSchedule: WeeklySchedule = {
                scheduleId: `sched-${planId}`,
                planId,
                weekRange: {
                  startDate: "2026-10-12",
                  endDate: "2026-10-18",
                },
                version: 1,
                timeBlocks: [
                  {
                    itemId: "task-reporte",
                    day: "2026-10-12",
                    startTime: "09:00",
                    endTime: "11:00",
                  },
                ],
                dailyAllocations: [
                  { day: "2026-10-12", allocatedHours: 5, itemId: "task-reporte" },
                  { day: "2026-10-13", allocatedHours: 4, itemId: "task-reunion" },
                ],
                appliedAdjustments: [],
                createdAt: today,
                updatedAt: today,
              };

              const res = await createOrSavePlan(demoPlan, demoSchedule);
              if (res.status === "success") {
                setFeedbackMessage("Semana de ejemplo iniciada correctamente.");
                reloadSession();
                onNavigateSpace?.("active");
              }
            }}
          >
            Iniciar semana activa de ejemplo (12 al 18 Octubre)
          </button>
        </div>
      </details>
    </div>
  );

  // --------------------------------------------------------------------------
  // Space 2: Preparar semana (Dedicated space view)
  // --------------------------------------------------------------------------
  if (activeSpace === "prepare") {
    return (
      <div className="session-container calm-box">
        {feedbackMessage && (
          <div className="status-message status-info" role="status">
            {feedbackMessage}
            <button
              style={{
                marginLeft: "auto",
                background: "none",
                border: "none",
                cursor: "pointer",
              }}
              aria-label="Cerrar notificación"
              onClick={() => setFeedbackMessage(null)}
            >
              ×
            </button>
          </div>
        )}
        <section className="plan-summary-card" aria-label="Espacio de preparación de semana">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: "8px" }}>
            <h2>2. Preparar semana</h2>
            {state.status === "session_resumed" && state.activePlan && (
              <span className="badge badge-task">
                Semana activa: {state.activePlan.targetWeek.startDate} al {state.activePlan.targetWeek.endDate}
              </span>
            )}
          </div>
          <p className="calm-muted" style={{ marginTop: "6px" }}>
            {state.status === "session_resumed"
              ? "Tienes una semana activa en curso. Aquí puedes estructurar un borrador para la próxima semana e incorporar tareas postergadas sin alterar la semana activa."
              : "Configura tu semana objetivo, capacidad y foco a partir de tus notas o elementos extraídos."}
          </p>
          {onNavigateSpace && (
            <div style={{ marginTop: "12px", display: "flex", gap: "8px", flexWrap: "wrap" }}>
              <button
                type="button"
                className="secondary"
                data-testid="nav-back-to-capture-button"
                onClick={() => onNavigateSpace("capture")}
              >
                ← Volver a Capturar
              </button>
              {state.status === "session_resumed" && (
                <button
                  type="button"
                  className="secondary"
                  data-testid="nav-to-active-from-prepare-button"
                  onClick={() => onNavigateSpace("active")}
                >
                  Ver Mi semana activa →
                </button>
              )}
            </div>
          )}
        </section>

        <div style={{ marginTop: "16px" }}>
          <WeeklyPlanningFromNotes
            provider={provider}
            initialItems={initialPlanningItems}
            hasActivePlan={state.status === "session_resumed"}
            onPlanCreated={() => {
              onClearPlanningItems?.();
              reloadSession();
              if (onNavigateSpace && state.status !== "session_resumed") {
                onNavigateSpace("active");
              }
            }}
          />
        </div>

        {state.latestClosedWeek && (
          <details className="calm-details" style={{ marginTop: "24px" }}>
            <summary style={{ cursor: "pointer", fontWeight: 600, color: "var(--accent-color, #2b6cb0)", userSelect: "none" }}>
              Ver aprendizajes y tareas de la última semana cerrada
            </summary>
            <div style={{ marginTop: "12px" }}>
              {renderLatestClosedWeekSection()}
            </div>
          </details>
        )}

        {renderDevOptions()}
      </div>
    );
  }

  // --------------------------------------------------------------------------
  // Space 3: Mi semana (Empty state when no active plan)
  // --------------------------------------------------------------------------
  if (activeSpace === "active" && state.status === "no_active_session") {
    return (
      <div className="session-container calm-box">
        {feedbackMessage && (
          <div className="status-message status-info" role="status">
            {feedbackMessage}
            <button
              style={{
                marginLeft: "auto",
                background: "none",
                border: "none",
                cursor: "pointer",
              }}
              aria-label="Cerrar notificación"
              onClick={() => setFeedbackMessage(null)}
            >
              ×
            </button>
          </div>
        )}
        <section className="plan-summary-card" aria-label="Espacio de mi semana activa">
          <h2>3. Mi semana</h2>
          <p className="calm-text" style={{ marginTop: "8px" }}>
            Tu cuaderno está despejado. No hay ninguna semana activa en este momento.
          </p>
          <div className="actions" style={{ marginTop: "16px", display: "flex", gap: "10px", flexWrap: "wrap" }}>
            <button
              className="primary"
              data-testid="nav-to-prepare-from-active-button"
              onClick={() => onNavigateSpace?.("prepare")}
            >
              🗓️ Preparar una semana
            </button>
            <button
              className="secondary"
              data-testid="nav-to-capture-from-active-button"
              onClick={() => onNavigateSpace?.("capture")}
            >
              ✍️ Capturar ideas
            </button>
          </div>
        </section>

        {/* Borradores guardados de semanas en preparación */}
        {state.draftPlans && state.draftPlans.length > 0 && (
          <div
            className="calm-box"
            style={{
              marginTop: "20px",
              padding: "16px",
              background: "var(--bg-card, #fcfbf9)",
              border: "1px solid var(--border-color, #e8e3d9)",
            }}
            data-testid="active-space-drafts-notice"
          >
            <h4 style={{ margin: "0 0 8px 0" }}>📂 Borradores de semana guardados ({state.draftPlans.length})</h4>
            <p className="calm-muted" style={{ fontSize: "0.88rem", marginBottom: "12px" }}>
              Tienes planificación guardada en tu cuaderno local. Puedes abrir el borrador para revisarlo o activarlo:
            </p>
            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
              {state.draftPlans.map((draft) => (
                <button
                  key={draft.planId}
                  className="secondary"
                  style={{ display: "flex", alignItems: "center", gap: "6px" }}
                  onClick={() => onNavigateSpace?.("prepare")}
                >
                  <span>🗓️ Semana {draft.targetWeek.startDate} al {draft.targetWeek.endDate}</span>
                  <span className="badge badge-muted">Continuar borrador →</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {state.latestClosedWeek && (
          <div style={{ marginTop: "24px" }}>
            {renderLatestClosedWeekSection()}
          </div>
        )}

        {renderDevOptions()}
      </div>
    );
  }

  // --------------------------------------------------------------------------
  // Space 4: Revisar y aprender (Empty state when no active plan)
  // --------------------------------------------------------------------------
  if (activeSpace === "review" && state.status === "no_active_session") {
    return (
      <div className="session-container">
        {feedbackMessage && (
          <div className="status-message status-info" role="status">
            {feedbackMessage}
            <button
              style={{
                marginLeft: "auto",
                background: "none",
                border: "none",
                cursor: "pointer",
              }}
              aria-label="Cerrar notificación"
              onClick={() => setFeedbackMessage(null)}
            >
              ×
            </button>
          </div>
        )}
        <section className="plan-summary-card" aria-label="Espacio de revisión y aprendizaje">
          <h2>4. Revisar y aprender</h2>
          <p className="calm-muted" style={{ marginTop: "6px" }}>
            Cierre de ciclo, evaluación honesta de tareas y aprendizaje para las próximas semanas. Nada se guarda en memoria sin tu confirmación explícita.
          </p>
        </section>

        {renderLatestClosedWeekSection()}

        {!state.latestClosedWeek && !state.latestCloseReport && (
          <div className="calm-box" style={{ marginTop: "20px" }}>
            <p className="calm-muted">No hay semanas cerradas ni activas para revisar en este momento.</p>
            <button
              className="primary"
              style={{ marginTop: "12px" }}
              onClick={() => onNavigateSpace?.("prepare")}
            >
              Ir a preparar semana
            </button>
          </div>
        )}
      </div>
    );
  }

  // --------------------------------------------------------------------------
  // No Active Session State (With optional latest closed week recovery)
  // --------------------------------------------------------------------------
  if (state.status === "no_active_session") {
    return (
      <div className="session-container calm-box">
        <h2>Sin semana activa</h2>
        <p className="calm-text">
          Tu cuaderno está despejado. No hay ninguna semana activa en este momento.
        </p>

        {renderLatestClosedWeekSection()}

        <WeeklyPlanningFromNotes
          provider={provider}
          initialItems={initialPlanningItems}
          onPlanCreated={() => {
            onClearPlanningItems?.();
            reloadSession();
          }}
        />

        <div style={{ marginTop: "24px", paddingTop: "12px", borderTop: "1px dashed var(--border-color, #ddd)" }}>
          <details>
            <summary style={{ cursor: "pointer", fontSize: "0.85rem", color: "#666" }}>
              Opciones de desarrollo: Iniciar semana de ejemplo prefijada
            </summary>
            <div style={{ marginTop: "12px" }}>
              <button
                className="secondary"
                aria-label="Iniciar nueva semana de ejemplo"
                onClick={async () => {
                  const today = new Date().toISOString().split("T")[0]!;
                  const planId = `plan-${today}`;
                  const demoPlan: StoredWeeklyPlan = {
                    planId,
                    status: "active",
                    targetWeek: {
                      startDate: "2026-10-12",
                      endDate: "2026-10-18",
                    },
                    proposal: {
                      weekSummary: {
                        targetWeek: {
                          startDate: "2026-10-12",
                          endDate: "2026-10-18",
                        },
                        capacity: {
                          totalAvailableHours: 30,
                          plannableHours: 22.5,
                          plannedHours: 16,
                          knownEstimatedHours: 16,
                          estimationCompleteness: "complete",
                          protectedSpaceHours: 7.5,
                          capacityStatus: "within_capacity",
                          protectedSpaceStatus: "respected",
                        },
                        intent: "Semana de consolidación y respiro",
                      },
                      foci: [
                        {
                          id: "focus-1",
                          title: "Reporte estratégico",
                          desiredOutcome: "Borrador revisado",
                          rationale: "Foco principal de la semana",
                          contributingItemIds: ["task-reporte"],
                          estimatedHours: 12,
                        },
                      ],
                      obligations: [
                        {
                          itemId: "task-reunion",
                          title: "Reunión de equipo",
                          dueDate: "2026-10-13",
                          commitmentType: "external",
                          rationale: "Compromiso de coordinación",
                          estimatedHours: 4,
                        },
                      ],
                      flexibleOptions: [],
                      deferredItems: [],
                      unplannedSpace: {
                        recommendedHours: 7.5,
                        rationale: "Espacio protegido para imprevistos",
                      },
                      confirmationPrompt: {
                        question: "¿Te representa este plan?",
                        keyTradeoffs: ["Foco en reporte estratégico vs otras tareas"],
                        pendingQuestions: [],
                      },
                    },
                    createdAt: today,
                    updatedAt: today,
                  };

                  const demoSchedule: WeeklySchedule = {
                    scheduleId: `sched-${planId}`,
                    planId,
                    weekRange: {
                      startDate: "2026-10-12",
                      endDate: "2026-10-18",
                    },
                    version: 1,
                    timeBlocks: [
                      {
                        itemId: "task-reporte",
                        day: "2026-10-12",
                        startTime: "09:00",
                        endTime: "11:00",
                      },
                    ],
                    dailyAllocations: [
                      { day: "2026-10-12", allocatedHours: 5, itemId: "task-reporte" },
                      { day: "2026-10-13", allocatedHours: 4, itemId: "task-reunion" },
                    ],
                    appliedAdjustments: [],
                    createdAt: today,
                    updatedAt: today,
                  };

                  await createOrSavePlan(demoPlan, demoSchedule);
                  setFeedbackMessage("Semana iniciada con éxito.");
                }}
              >
                Iniciar nueva semana de ejemplo
              </button>
            </div>
          </details>
        </div>
      </div>
    );
  }

  // --------------------------------------------------------------------------
  // Active Session View (session_resumed)
  // --------------------------------------------------------------------------

  return (
    <div className="session-container">
      {feedbackMessage && (
        <div className="status-message status-info" role="status">
          {feedbackMessage}
          <button
            style={{
              marginLeft: "auto",
              background: "none",
              border: "none",
              cursor: "pointer",
            }}
            aria-label="Cerrar notificación"
            onClick={() => setFeedbackMessage(null)}
          >
            ×
          </button>
        </div>
      )}

      {state.concurrencyConflict && (
        <div
          className="status-message status-error"
          role="alert"
          style={{ display: "flex", flexDirection: "column", gap: "8px" }}
        >
          <div>
            <strong>Conflicto de versión detectado:</strong> La versión esperada era v
            {state.concurrencyConflict.expectedVersion}, pero la agenda se encuentra en
            v{state.concurrencyConflict.currentVersion} (posible cambio en otra pestaña o
            sesión). El ajuste <strong>no se ha aplicado</strong>.
          </div>
          <div>
            <button
              className="primary"
              aria-label="Recargar agenda para sincronizar versión"
              style={{ alignSelf: "flex-start" }}
              onClick={() => reloadSession()}
            >
              Recargar agenda para sincronizar
            </button>
          </div>
        </div>
      )}

      {/* Plan Header */}
      <section className="plan-summary-card" aria-label="Resumen de la semana">
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            flexWrap: "wrap",
            gap: "8px",
          }}
        >
          <h2>
            {activeSpace === "active"
              ? "3. Mi semana"
              : activeSpace === "review"
              ? "4. Revisar y aprender"
              : plan?.status === "closed"
              ? "Semana cerrada"
              : "Semana en curso"}
          </h2>
          <span className="badge badge-task">
            {plan?.targetWeek.startDate} al {plan?.targetWeek.endDate}
          </span>
        </div>
        <p className="calm-text" style={{ marginTop: "8px" }}>
          {plan?.proposal.weekSummary.intent || "Plan semanal activo."}
        </p>

        <div className="config-row" style={{ marginTop: "12px", flexWrap: "wrap", gap: "8px", alignItems: "center" }}>
          <span className="badge badge-muted">
            Versión de agenda: v{schedule?.version ?? 0}
          </span>
          {onNavigateSpace ? (
            <div style={{ marginLeft: "auto", display: "flex", gap: "8px", flexWrap: "wrap" }}>
              <button
                type="button"
                className="secondary"
                data-testid="nav-to-prepare-button"
                aria-label="Preparar próxima semana"
                onClick={() => onNavigateSpace("prepare")}
              >
                🗓️ Preparar próxima semana
              </button>
              {activeSpace !== "review" && (
                <button
                  type="button"
                  className="primary"
                  data-testid="nav-to-review-button"
                  aria-label="Ir a revisar y cerrar semana"
                  onClick={() => onNavigateSpace("review")}
                >
                  Revisar y cerrar semana →
                </button>
              )}
            </div>
          ) : (
            <button
              type="button"
              className={isFuturePlanningOpen ? "primary" : "secondary"}
              style={{ fontSize: "0.85rem", padding: "4px 10px", marginLeft: "auto" }}
              data-testid="toggle-future-planning-button"
              aria-label="Preparar próxima semana y ver tareas postergadas"
              onClick={() => setIsFuturePlanningOpen((prev) => !prev)}
            >
              {isFuturePlanningOpen
                ? "▲ Ocultar preparación de siguiente semana"
                : "🗓️ Preparar próxima semana y tareas postergadas"}
            </button>
          )}
        </div>
      </section>

      {/* Preparación visible de la próxima semana y tareas postergadas */}
      {isFuturePlanningOpen && (
        <section
          style={{
            marginTop: "16px",
            padding: "16px",
            background: "#fafafa",
            border: "1px solid var(--border-color, #e0e0e0)",
            borderRadius: "8px",
          }}
          data-testid="visible-future-planning-section"
          aria-label="Preparación de siguiente semana"
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              flexWrap: "wrap",
              gap: "8px",
            }}
          >
            <h3 style={{ margin: 0 }}>Planificación futura y tareas postergadas</h3>
            <button
              type="button"
              className="secondary"
              style={{ fontSize: "0.8rem", padding: "2px 8px" }}
              onClick={() => setIsFuturePlanningOpen(false)}
            >
              Cerrar vista
            </button>
          </div>
          <p className="calm-muted" style={{ fontSize: "0.88rem", marginTop: "4px" }}>
            Puedes estructurar un borrador para la próxima semana e incorporar tareas postergadas.
            <strong> Para activar un nuevo plan de forma definitiva, deberás cerrar la semana actual primero.</strong>
          </p>
          <div style={{ marginTop: "12px" }}>
            <WeeklyPlanningFromNotes
              provider={provider}
              initialItems={initialPlanningItems}
              hasActivePlan={true}
              onPlanCreated={() => {
                onClearPlanningItems?.();
                reloadSession();
              }}
            />
          </div>
        </section>
      )}

      {/* Capacidad y espacio protegido */}
      {plan?.proposal.weekSummary.capacity && (
        <CapacityProtectedSpaceSection capacity={plan.proposal.weekSummary.capacity} />
      )}

      {/* Schedule & Blocks */}
      {schedule && (activeSpace === undefined || activeSpace === "active") && (
        <section className="results-section" style={{ marginTop: "24px" }} aria-label="Agenda y bloques">
          <h3>Agenda y bloques planificados</h3>
          <div className="items-list">
            {schedule.timeBlocks.length === 0 && schedule.dailyAllocations.length === 0 ? (
              <p className="calm-muted">No hay bloques horarios ni días asignados todavía. Podés asignar un día a tus tareas abajo en «Ajustar y programar tareas».</p>
            ) : (
              <>
                {schedule.dailyAllocations.map((alloc) => {
                  const item = planItems.find((i) => i.itemId === alloc.itemId);
                  return (
                    <div
                      key={alloc.itemId}
                      className="item-card"
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        flexWrap: "wrap",
                        gap: "8px",
                      }}
                    >
                      <div>
                        <strong>{item?.title ?? alloc.itemId}</strong>
                      </div>
                      <div className="item-tags" style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                        <span className="badge badge-task">📅 {alloc.day}</span>
                        <span className="badge badge-muted">⏱ {alloc.allocatedHours}h</span>
                        <button
                          type="button"
                          className="secondary"
                          style={{ fontSize: "0.75rem", padding: "2px 8px" }}
                          onClick={() => {
                            setSelectedAdjustmentItemId(alloc.itemId);
                          }}
                        >
                          Modificar
                        </button>
                      </div>
                    </div>
                  );
                })}
                {schedule.timeBlocks.map((block, idx) => (
                  <div key={idx} className="item-card">
                    <div className="item-title">{block.itemId}</div>
                    <div className="item-tags">
                      <span className="badge badge-muted">📅 {block.day}</span>
                      <span className="badge badge-muted">
                        ⏰ {block.startTime} - {block.endTime}
                      </span>
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>

          {/* Adjustments simulation / Human Decision */}
          <div className="calm-box" style={{ marginTop: "20px" }} data-testid="adjustment-proposal-box" id="adjustment-proposal-box">
            <h4 style={{ margin: "0 0 4px 0" }}>Ajustar y programar tareas</h4>
            <p className="calm-muted" style={{ fontSize: "0.84rem", marginBottom: "14px" }}>
              Elegí una tarea para definir sus horas estimadas, asignarla a un día de la semana o moverla a otra fecha.
            </p>

            {planItems.length === 0 ? (
              <p className="calm-muted">No hay tareas identificadas en el plan para ajustar.</p>
            ) : (
              (() => {
                const effectiveItemId =
                  selectedAdjustmentItemId || planItems[0]?.itemId || "";
                const selectedItem =
                  planItems.find((i) => i.itemId === effectiveItemId) ||
                  planItems[0];

                const effectiveDeadline =
                  deadlineInput.trim() ||
                  selectedItem?.dueDate ||
                  (selectedItem?.title.toLowerCase().includes("informe")
                    ? "2026-10-15"
                    : "");

                const isDeadlineOverdue =
                  Boolean(effectiveDeadline && effectiveDeadline < targetWeekStart);

                const isCapacityUnconfigured =
                  plan?.proposal.weekSummary.capacity.totalAvailableHours === null;

                const hoursToFree =
                  selectedItem?.estimatedHours ??
                  (selectedItem?.title.toLowerCase().includes("informe") ? 6 : null);

                return (
                  <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                    {/* 1. Selector de tarea principal */}
                    <div>
                      <label
                        htmlFor="adjustment-item-select"
                        style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, marginBottom: "4px" }}
                      >
                        Tarea a ajustar:
                      </label>
                      <select
                        id="adjustment-item-select"
                        data-testid="adjustment-item-select"
                        aria-label="Seleccionar tarea a ajustar"
                        value={effectiveItemId}
                        onChange={(e) => {
                          setSelectedAdjustmentItemId(e.target.value);
                          setIsAdjustmentPreviewOpen(false);
                        }}
                        style={{ width: "100%", padding: "7px 8px" }}
                      >
                        {planItems.map((item) => {
                          const alloc = schedule?.dailyAllocations.find((a) => a.itemId === item.itemId);
                          return (
                            <option key={item.itemId} value={item.itemId}>
                              {item.title} ({item.source})
                              {item.estimatedHours ? ` · ${item.estimatedHours}h` : " · Sin estimar"}
                              {alloc ? ` · 📅 ${alloc.day}` : ""}
                            </option>
                          );
                        })}
                      </select>
                    </div>

                    {/* 2. Asignar horas y día en esta semana */}
                    <div
                      style={{
                        padding: "12px 14px",
                        background: "var(--bg-card, #fcfbf9)",
                        border: "1px solid var(--border-color, #e8e3d9)",
                        borderRadius: "6px",
                        display: "flex",
                        flexDirection: "column",
                        gap: "10px",
                      }}
                    >
                      <div style={{ fontWeight: 600, fontSize: "0.9rem", color: "#374151" }}>
                        ⏱️ Estimar horas o asignar día en esta semana
                      </div>
                      <p className="calm-muted" style={{ fontSize: "0.82rem", margin: 0 }}>
                        💡 Si sólo indicas horas sin asignar un día específico, la tarea queda en tu semana actual como opción flexible repartida en los 7 días. No necesitas asignar día ni reprogramar.
                      </p>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                          gap: "12px",
                          alignItems: "end",
                        }}
                      >
                        <div>
                          <label
                            htmlFor="task-hours-input"
                            style={{ display: "block", fontSize: "0.82rem", fontWeight: 500, marginBottom: "4px" }}
                          >
                            Horas estimadas:
                          </label>
                          <div style={{ display: "flex", gap: "6px" }}>
                            <input
                              id="task-hours-input"
                              data-testid="task-hours-input"
                              type="number"
                              min="0.25"
                              max="40"
                              step="0.5"
                              placeholder={selectedItem?.estimatedHours ? `${selectedItem.estimatedHours}` : "Ej: 2"}
                              value={taskHoursInput}
                              onChange={(e) => setTaskHoursInput(e.target.value)}
                              style={{ width: "100%", padding: "6px 8px" }}
                            />
                            <button
                              type="button"
                              className="primary"
                              data-testid="save-task-hours-button"
                              onClick={() => handleSaveTaskHours(selectedItem.itemId, selectedItem.title)}
                              style={{ whiteSpace: "nowrap", padding: "6px 12px" }}
                            >
                              Guardar horas
                            </button>
                          </div>
                        </div>

                        <div>
                          <label
                            htmlFor="task-day-select"
                            style={{ display: "block", fontSize: "0.82rem", fontWeight: 500, marginBottom: "4px" }}
                          >
                            Día asignado (opcional):
                          </label>
                          <div style={{ display: "flex", gap: "6px" }}>
                            <select
                              id="task-day-select"
                              data-testid="task-day-select"
                              value={taskDayInput}
                              onChange={(e) => setTaskDayInput(e.target.value)}
                              style={{ width: "100%", padding: "6px 8px" }}
                            >
                              <option value="">Sin día asignado (repartida en la semana)</option>
                              {getWeekDays(plan?.targetWeek.startDate).map((d) => (
                                <option key={d.date} value={d.date}>
                                  {d.label}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              className="secondary"
                              data-testid="assign-task-day-button"
                              onClick={() => handleAssignTaskDay(selectedItem.itemId, selectedItem.title, selectedItem.estimatedHours)}
                              style={{ whiteSpace: "nowrap", padding: "6px 12px" }}
                            >
                              {taskDayInput ? "Asignar día" : "Dejar abierta"}
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* 3. Mover a otra semana (reprogramar) */}
                    <div
                      style={{
                        padding: "12px 14px",
                        background: "#faf9f6",
                        border: "1px dashed var(--border-color, #d6d0c4)",
                        borderRadius: "6px",
                        display: "flex",
                        flexDirection: "column",
                        gap: "10px",
                      }}
                    >
                      <div style={{ fontWeight: 600, fontSize: "0.88rem", color: "#4b5563" }}>
                        🗓️ ¿Prefieres mover la tarea a una fecha posterior? (Opcional)
                      </div>
                      <p className="calm-muted" style={{ fontSize: "0.82rem", margin: 0 }}>
                        Usa esta opción solo si decides <strong>no hacer esta tarea esta semana</strong> y quieres postergarla a otra fecha.
                      </p>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                          gap: "12px",
                        }}
                      >
                        <div>
                          <label
                            htmlFor="target-week-start-input"
                            style={{ display: "block", fontSize: "0.82rem", fontWeight: 500, marginBottom: "4px" }}
                          >
                            Semana destino (Inicio):
                          </label>
                          <input
                            id="target-week-start-input"
                            data-testid="target-week-start-input"
                            type="text"
                            value={targetWeekStart}
                            onChange={(e) => {
                              setTargetWeekStart(e.target.value);
                              setIsAdjustmentPreviewOpen(false);
                            }}
                            style={{ width: "100%", padding: "6px 8px" }}
                          />
                        </div>

                        <div>
                          <label
                            htmlFor="target-week-end-input"
                            style={{ display: "block", fontSize: "0.82rem", fontWeight: 500, marginBottom: "4px" }}
                          >
                            Semana destino (Fin):
                          </label>
                          <input
                            id="target-week-end-input"
                            data-testid="target-week-end-input"
                            type="text"
                            value={targetWeekEnd}
                            onChange={(e) => {
                              setTargetWeekEnd(e.target.value);
                              setIsAdjustmentPreviewOpen(false);
                            }}
                            style={{ width: "100%", padding: "6px 8px" }}
                          />
                        </div>

                        <div>
                          <label
                            htmlFor="deadline-input"
                            style={{ display: "block", fontSize: "0.82rem", fontWeight: 500, marginBottom: "4px" }}
                          >
                            Deadline original (para verificar):
                          </label>
                          <input
                            id="deadline-input"
                            data-testid="deadline-input"
                            type="text"
                            placeholder={effectiveDeadline || "YYYY-MM-DD"}
                            value={deadlineInput}
                            onChange={(e) => {
                              setDeadlineInput(e.target.value);
                              setIsAdjustmentPreviewOpen(false);
                            }}
                            style={{ width: "100%", padding: "6px 8px" }}
                          />
                        </div>
                      </div>

                      {!isAdjustmentPreviewOpen && selectedItem && (
                        <div>
                          <button
                            type="button"
                            className="secondary"
                            data-testid="generate-proposal-button"
                            aria-label="Generar propuesta de reprogramación"
                            onClick={() => setIsAdjustmentPreviewOpen(true)}
                          >
                            Generar propuesta de reprogramación
                          </button>
                        </div>
                      )}
                    </div>

                    {isAdjustmentPreviewOpen && selectedItem && (
                      <div
                        className="item-card"
                        data-testid="proposal-preview-card"
                        style={{
                          flexDirection: "column",
                          gap: "10px",
                          marginTop: "8px",
                          border: "1px solid var(--accent-color, #708090)",
                        }}
                      >
                        <div style={{ fontWeight: 600, fontSize: "1rem" }}>
                          Reprogramar «{selectedItem.title}»
                        </div>

                        {/* Origen y Destino */}
                        <div style={{ fontSize: "0.88rem", display: "flex", flexDirection: "column", gap: "4px" }}>
                          <div>
                            <strong>Origen:</strong> {selectedItem.title} ({selectedItem.source})
                            {hoursToFree ? ` · ${hoursToFree}h estimadas` : " · Sin estimación"}
                            {effectiveDeadline && (
                              <span> · Fecha límite original: <code>{effectiveDeadline}</code></span>
                            )}
                          </div>
                          <div>
                            <strong>Mover a:</strong> Semana del {targetWeekStart} al {targetWeekEnd}.
                          </div>
                        </div>

                        {/* Consecuencias y advertencias evaluadas */}
                        <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginTop: "4px" }}>
                          {isDeadlineOverdue && (
                            <div
                              className="status-message status-warning"
                              data-testid="deadline-warning"
                              style={{
                                margin: 0,
                                padding: "6px 10px",
                                fontSize: "0.82rem",
                                background: "#fffbeb",
                                border: "1px solid #fef3c7",
                                color: "#92400e",
                              }}
                            >
                              ⚠️ <strong>Fecha límite vencida:</strong> La fecha original ({effectiveDeadline}) vencerá antes de la semana destino ({targetWeekStart} al {targetWeekEnd}).
                            </div>
                          )}

                          {isCapacityUnconfigured && (
                            <div
                              className="status-message status-warning"
                              data-testid="capacity-warning"
                              style={{
                                margin: 0,
                                padding: "6px 10px",
                                fontSize: "0.82rem",
                                background: "#fffbeb",
                                border: "1px solid #fef3c7",
                                color: "#92400e",
                              }}
                            >
                              ⚠️ <strong>Sin capacidad configurada:</strong> No hay horas disponibles confirmadas para esta semana.
                            </div>
                          )}

                          <div
                            className="calm-muted"
                            data-testid="schedule-effect"
                            style={{ fontSize: "0.82rem", lineHeight: 1.4 }}
                          >
                            ℹ️ La tarea se retirará de tu semana actual y pasará a la semana del {targetWeekStart} al {targetWeekEnd} para que la organices cuando la abras.
                          </div>
                          <span data-testid="domain-boundary-note" style={{ display: "none" }} />
                        </div>

                        {/* Acciones de decisión humana */}
                        <div className="actions" style={{ marginTop: "12px", display: "flex", gap: "8px", flexWrap: "wrap" }}>
                          <button
                            className="secondary"
                            data-testid="reject-proposal-button"
                            aria-label="Rechazar propuesta de ajuste"
                            onClick={async () => {
                              const action: SuggestedAdjustmentAction = {
                                type: "postpone_item",
                                itemId: selectedItem.itemId,
                                currentCategory: (
                                  plan?.proposal.obligations.some((o) => o.itemId === selectedItem.itemId)
                                    ? "obligations"
                                    : plan?.proposal.foci.some((f) => f.contributingItemIds.includes(selectedItem.itemId))
                                    ? "foci"
                                    : plan?.proposal.flexibleOptions.some((opt) => opt.itemId === selectedItem.itemId)
                                    ? "flexible_options"
                                    : "deferred_items"
                                ),
                                targetReason: "intentional_postponement",
                                hoursFreed: hoursToFree,
                                rationale: `Reprogramación intencional de '${selectedItem.title}' hacia la semana ${targetWeekStart} al ${targetWeekEnd}.`,
                                targetWeek: {
                                  startDate: targetWeekStart,
                                  endDate: targetWeekEnd,
                                },
                              };

                              const res = await applyAdjustment({
                                scheduleId: schedule.scheduleId,
                                proposalId: `prop-reschedule-${selectedItem.itemId}`,
                                adjustmentId: `adj-${Date.now()}`,
                                action,
                                expectedScheduleVersion: schedule.version,
                                humanDecision: "rejected",
                              });

                              if (res.status === "rejected") {
                                setFeedbackMessage(
                                  "Rechazaste la propuesta. La agenda permanece sin cambios."
                                );
                                setIsAdjustmentPreviewOpen(false);
                              }
                            }}
                          >
                            Rechazar propuesta
                          </button>

                          <button
                            className="primary"
                            data-testid="accept-proposal-button"
                            aria-label="Aceptar propuesta de ajuste"
                            onClick={async () => {
                              const action: SuggestedAdjustmentAction = {
                                type: "postpone_item",
                                itemId: selectedItem.itemId,
                                currentCategory: (
                                  plan?.proposal.obligations.some((o) => o.itemId === selectedItem.itemId)
                                    ? "obligations"
                                    : plan?.proposal.foci.some((f) => f.contributingItemIds.includes(selectedItem.itemId))
                                    ? "foci"
                                    : plan?.proposal.flexibleOptions.some((opt) => opt.itemId === selectedItem.itemId)
                                    ? "flexible_options"
                                    : "deferred_items"
                                ),
                                targetReason: "intentional_postponement",
                                hoursFreed: hoursToFree,
                                rationale: `Reprogramación intencional de '${selectedItem.title}' hacia la semana ${targetWeekStart} al ${targetWeekEnd}.`,
                                targetWeek: {
                                  startDate: targetWeekStart,
                                  endDate: targetWeekEnd,
                                },
                              };

                              const res = await applyAdjustment({
                                scheduleId: schedule.scheduleId,
                                proposalId: `prop-reschedule-${selectedItem.itemId}`,
                                adjustmentId: `adj-${Date.now()}`,
                                action,
                                expectedScheduleVersion: schedule.version,
                                humanDecision: "accepted",
                              });

                              if (res.status === "success") {
                                setFeedbackMessage(
                                  `Ajuste aplicado con éxito. Tarea reprogramada para ${targetWeekStart} al ${targetWeekEnd}. Nueva versión: v${res.schedule.version}`
                                );
                                setIsAdjustmentPreviewOpen(false);
                              } else if (res.status === "concurrency_conflict") {
                                setFeedbackMessage(
                                  `Conflicto de concurrencia: la versión esperada era ${res.expectedVersion}, pero la agenda está en v${res.currentVersion}.`
                                );
                              } else if (res.status === "failed") {
                                setFeedbackMessage(
                                  `No se pudo aplicar el ajuste: ${res.failureReason}`
                                );
                              }
                            }}
                          >
                            Aceptar propuesta
                          </button>

                          <button
                            type="button"
                            className="secondary"
                            data-testid="cancel-proposal-button"
                            aria-label="Cancelar propuesta"
                            onClick={() => setIsAdjustmentPreviewOpen(false)}
                          >
                            Cancelar
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()
            )}
          </div>
        </section>
      )}

      {/* Schedule Adjustment History Section */}
      {schedule && (activeSpace === undefined || activeSpace === "active") && (
        <section
          className="results-section calm-box"
          style={{ marginTop: "24px" }}
          aria-label="Historial de ajustes de la agenda semanal"
          data-testid="schedule-adjustments-history"
        >
          <details className="calm-details" open={schedule.appliedAdjustments.length > 0}>
            <summary
              style={{
                cursor: "pointer",
                fontWeight: 600,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                userSelect: "none",
              }}
            >
              <span>Historial de ajustes de la agenda</span>
              <span className="badge badge-muted">
                {schedule.appliedAdjustments.length}{" "}
                {schedule.appliedAdjustments.length === 1 ? "registro" : "registros"}
              </span>
            </summary>
            <div style={{ marginTop: "12px" }}>
              <p className="calm-muted" style={{ marginTop: "4px", marginBottom: "16px" }}>
                Una propuesta no es una decisión; una decisión no es una aplicación; una
                aplicación no implica que el ajuste siga vigente.
              </p>

          {schedule.appliedAdjustments.length === 0 ? (
            <p className="calm-muted" data-testid="no-adjustments-message">
              No se han registrado ajustes en esta agenda semanal.
            </p>
          ) : (
            <div className="items-list">
              {schedule.appliedAdjustments.map((rec: ScheduleAdjustmentRecord, idx: number) => {
                const action = rec.action;
                const typeLabel = formatAdjustmentActionType(action.type);
                return (
                  <div
                    key={rec.adjustmentId || idx}
                    className="item-card"
                    data-testid={`adjustment-record-${rec.adjustmentId}`}
                    style={{ marginBottom: "12px" }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "baseline",
                        flexWrap: "wrap",
                        gap: "8px",
                      }}
                    >
                      <div className="item-title">
                        <strong>{typeLabel}</strong> · Ítem: <code>{getAdjustmentTargetItem(action)}</code>
                      </div>
                      <div
                        className="item-tags"
                        style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}
                      >
                        <span
                          className={`badge ${
                            rec.humanDecision === "accepted" ? "badge-task" : "badge-muted"
                          }`}
                          aria-label={`Decisión humana: ${rec.humanDecision}`}
                        >
                          Decisión: {rec.humanDecision === "accepted" ? "Aceptado" : "Rechazado"}
                        </span>
                        <span
                          className={`badge ${
                            rec.applicationOutcome === "applied" ? "badge-task" : "badge-error"
                          }`}
                          aria-label={`Resultado de aplicación: ${rec.applicationOutcome}`}
                        >
                          Aplicación: {rec.applicationOutcome === "applied" ? "Aplicado" : "Fallido"}
                        </span>
                        <span
                          className={`badge ${
                            rec.lifecycleStatus === "active"
                              ? "badge-idea"
                              : "badge-muted"
                          }`}
                          aria-label={`Estado del ciclo de vida: ${rec.lifecycleStatus}`}
                        >
                          Estado:{" "}
                          {rec.lifecycleStatus === "active"
                            ? "Vigente"
                            : rec.lifecycleStatus === "superseded"
                            ? "Sustituido"
                            : "Revertido"}
                        </span>
                      </div>
                    </div>

                    {/* Temporal details */}
                    <div style={{ marginTop: "8px" }}>
                      {renderAdjustmentDetails(action)}
                    </div>

                    {/* Metadata & Timestamps */}
                    <div
                      className="config-row"
                      style={{
                        marginTop: "10px",
                        fontSize: "0.85rem",
                        color: "var(--muted-color, #666)",
                        flexWrap: "wrap",
                        gap: "12px",
                      }}
                    >
                      <span>Decidido: {rec.decidedAt}</span>
                      {rec.appliedAt && <span>Aplicado: {rec.appliedAt}</span>}
                      <span>Versión esperada: v{rec.expectedScheduleVersion}</span>
                    </div>

                    {/* Failure diagnostic */}
                    {rec.failureReason && (
                      <div
                        style={{
                          marginTop: "8px",
                          padding: "6px 10px",
                          background: "#fff0f0",
                          color: "#900",
                          borderRadius: "4px",
                          fontSize: "0.85rem",
                        }}
                      >
                        <strong>Motivo del fallo:</strong> {rec.failureReason}
                      </div>
                    )}

                    {/* User notes */}
                    {rec.userNotes && (
                      <div style={{ marginTop: "6px", fontSize: "0.85rem" }}>
                        <strong>Nota personal:</strong> <em>{rec.userNotes}</em>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          </div>
        </details>
      </section>
    )}

      {/* Review & Learning Sections (Review Space or Legacy Unified View) */}
      {(activeSpace === undefined || activeSpace === "review") && (
        <>
          {/* Close Week Section with Interactive Dispositions and Early Close Guard */}
          {(() => {
        const todayStr = new Date().toISOString().split("T")[0]!;
        const isEarly = Boolean(plan && plan.targetWeek.endDate > todayStr);

        if (isEarly && !isEarlyCloseConfirmed) {
          return (
            <section
              className="calm-box warning-box"
              style={{ marginTop: "24px" }}
              data-testid="early-close-guard-box"
              aria-label="Aviso de cierre anticipado"
            >
              <h3>⚠️ Cierre anticipado de semana</h3>
              <p className="calm-text">
                Esta semana está programada hasta el <strong>{plan?.targetWeek.endDate}</strong> y aún no ha concluido. Cerrarla ahora impedirá registrar avances naturales en los días restantes.
              </p>
              <p className="calm-muted" style={{ fontSize: "0.88rem" }}>
                <strong>Alternativa segura:</strong> Puedes mantenerla activa y continuar tu seguimiento en «Mi semana», o preparar borradores para semanas futuras desde «Preparar semana» sin necesidad de cerrar esta prematuramente.
              </p>
              <div className="actions" style={{ marginTop: "16px", display: "flex", gap: "10px", flexWrap: "wrap" }}>
                {onNavigateSpace && (
                  <button
                    type="button"
                    className="primary"
                    data-testid="cancel-early-close-button"
                    onClick={() => onNavigateSpace("active")}
                  >
                    Mantener semana activa
                  </button>
                )}
                <button
                  type="button"
                  className="secondary"
                  data-testid="confirm-early-close-button"
                  onClick={() => setIsEarlyCloseConfirmed(true)}
                >
                  Entiendo la situación y deseo cerrar anticipadamente
                </button>
              </div>
            </section>
          );
        }

        return (
          <section className="calm-box" style={{ marginTop: "24px" }} aria-label="Sección de cierre de semana">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: "8px" }}>
              <h3>Cierre de semana</h3>
              <div style={{ display: "flex", gap: "6px" }}>
                <button
                  type="button"
                  className={closeStep === "dispositions" ? "primary" : "secondary"}
                  style={{ fontSize: "0.8rem", padding: "3px 8px" }}
                  data-testid="tab-dispositions-step"
                  onClick={() => setCloseStep("dispositions")}
                >
                  1. Disposiciones
                </button>
                <button
                  type="button"
                  className={closeStep === "reflection" ? "primary" : "secondary"}
                  style={{ fontSize: "0.8rem", padding: "3px 8px" }}
                  data-testid="tab-reflection-step"
                  onClick={() => setCloseStep("reflection")}
                >
                  2. Reflexión
                </button>
              </div>
            </div>
            <p className="calm-muted" style={{ marginTop: "4px" }}>
              Al cerrar la semana, evaluamos qué se completó y qué aprendizajes surgen.
              Nada se guarda en memoria sin tu confirmación explícita.
            </p>

            {/* Step 1: Dispositions per item */}
            <div
              data-testid="close-week-step-dispositions"
              style={{ display: closeStep === "dispositions" ? "block" : "none", marginTop: "16px" }}
            >
              <h4>Disposición de tareas planificadas</h4>
              <p className="calm-muted" style={{ marginBottom: "12px" }}>
                Revisa cada ítem honestamente. Los ítems que no revises quedarán como no informados.
              </p>
              <div className="items-list">
                {planItems.length === 0 ? (
                  <p className="calm-muted">No hay tareas identificadas en el plan.</p>
                ) : (
                  planItems.map((item) => {
                    const current = dispositions[item.itemId] || {
                      status: "unreviewed",
                      postponementReason: "",
                    };
                    return (
                      <div
                        key={item.itemId}
                        className="item-card"
                        data-testid={`item-disposition-${item.itemId}`}
                        style={{ marginBottom: "12px" }}
                      >
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "baseline",
                            flexWrap: "wrap",
                            gap: "8px",
                          }}
                        >
                          <div>
                            <strong>{item.title}</strong>
                            <span className="badge badge-muted" style={{ marginLeft: "8px" }}>
                              {item.source}
                            </span>
                            {item.estimatedHours && (
                              <span className="badge badge-task" style={{ marginLeft: "4px" }}>
                                {item.estimatedHours}h
                              </span>
                            )}
                            {item.rationale && (
                              <div
                                className="calm-muted"
                                data-testid={`item-rationale-${item.itemId}`}
                                style={{ fontSize: "0.85rem", marginTop: "4px" }}
                              >
                                <em>Motivo:</em> {item.rationale}
                              </div>
                            )}
                          </div>
                          <div>
                            <label
                              htmlFor={`disposition-select-${item.itemId}`}
                              style={{
                                fontSize: "0.85rem",
                                marginRight: "6px",
                                color: "var(--muted-color, #666)",
                              }}
                            >
                              Disposición:
                            </label>
                            <select
                              id={`disposition-select-${item.itemId}`}
                              aria-label={`Disposición para ${item.title}`}
                              value={current.status}
                              onChange={(e) =>
                                handleDispositionChange(
                                  item.itemId,
                                  e.target.value as ItemDispositionChoice
                                )
                              }
                              style={{
                                padding: "6px 10px",
                                borderRadius: "4px",
                                border: "1px solid var(--border-color, #ccc)",
                              }}
                            >
                              <option value="unreviewed">Sin revisar (no informado)</option>
                              <option value="completed">Completada</option>
                              <option value="in_progress">En progreso</option>
                              <option value="not_started">No iniciada</option>
                              <option value="consciously_postponed">Postergada conscientemente</option>
                              <option value="dropped">Descartada</option>
                            </select>
                          </div>
                        </div>

                        {current.status === "consciously_postponed" && (
                          <div
                            style={{
                              marginTop: "10px",
                              padding: "8px 12px",
                              background: "var(--bg-muted, #f8f9fa)",
                              borderRadius: "4px",
                            }}
                          >
                            <label
                              htmlFor={`postpone-reason-${item.itemId}`}
                              style={{
                                display: "block",
                                fontSize: "0.85rem",
                                marginBottom: "4px",
                              }}
                            >
                              Motivo de la postergación consciente:
                            </label>
                            <input
                              id={`postpone-reason-${item.itemId}`}
                              aria-label={`Motivo de postergación para ${item.title}`}
                              type="text"
                              placeholder="Ej: Foco estratégico en otra prioridad o cambio de contexto"
                              value={current.postponementReason}
                              onChange={(e) =>
                                handlePostponementReasonChange(item.itemId, e.target.value)
                              }
                              style={{ width: "100%", padding: "6px" }}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
              <div className="actions" style={{ marginTop: "16px" }}>
                <button
                  type="button"
                  className="primary"
                  data-testid="go-to-reflection-step-button"
                  onClick={() => setCloseStep("reflection")}
                >
                  Siguiente: Reflexión personal →
                </button>
              </div>
            </div>

            {/* Step 2: Reflection */}
            <div
              data-testid="close-week-step-reflection"
              style={{ display: closeStep === "reflection" ? "block" : "none", marginTop: "16px" }}
            >
              <label htmlFor="week-reflection-notes" className="config-label">
                Reflexión personal sobre la semana:
              </label>
              <textarea
                id="week-reflection-notes"
                aria-label="Reflexión personal sobre la semana"
                rows={3}
                value={reflectionNotes}
                onChange={(e) => setReflectionNotes(e.target.value)}
                placeholder="¿Cómo te sentiste con el ritmo y la carga?"
                style={{ width: "100%", marginTop: "6px" }}
              />

              <div className="actions" style={{ marginTop: "16px", display: "flex", gap: "10px" }}>
                <button
                  type="button"
                  className="secondary"
                  data-testid="back-to-dispositions-step-button"
                  onClick={() => setCloseStep("dispositions")}
                >
                  ← Volver a Disposiciones
                </button>
                <button
                  type="button"
                  className="primary"
                  aria-label="Confirmar cierre de semana"
                  onClick={async () => {
                    if (!plan) return;
                    const closedAtTimestamp = new Date().toISOString();
                    const outcomes: ItemOutcomeInput[] = Object.entries(dispositions)
                      .filter(([_, disp]) => disp.status !== "unreviewed")
                      .map(([itemId, disp]) => ({
                        itemId,
                        status: disp.status as ItemOutcomeInput["status"],
                        ...(disp.status === "consciously_postponed" && disp.postponementReason.trim()
                          ? { postponementReason: disp.postponementReason.trim() }
                          : {}),
                      }));

                    const res = await closeWeek({
                      planId: plan.planId,
                      closedAt: closedAtTimestamp,
                      itemOutcomes: outcomes,
                      userReflection: reflectionNotes.trim()
                        ? { generalNotes: reflectionNotes.trim() }
                        : undefined,
                    });

                    if (res.status === "success") {
                      setFeedbackMessage(
                        "Semana cerrada exitosamente. Revisa el informe y los candidatos de memoria."
                      );
                      if (onNavigateSpace) {
                        onNavigateSpace("review");
                      }
                    }
                  }}
                >
                  Cerrar semana
                </button>
              </div>
            </div>
          </section>
        );
      })()}

      {/* Confirmed Close Report Section (shown only after persistence) */}
      {state.latestCloseReport && (
        <section
          className="results-section calm-box"
          style={{ marginTop: "24px" }}
          aria-label="Informe confirmado de cierre de semana"
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              flexWrap: "wrap",
              gap: "8px",
            }}
          >
            <h3>Informe confirmado de cierre</h3>
            <span className="badge badge-task">
              Cerrada el {state.latestCloseReport.closedAt}
            </span>
          </div>
          <div className="config-row" style={{ marginTop: "12px", flexWrap: "wrap", gap: "8px" }}>
            <span className="badge badge-muted">
              Completadas:{" "}
              {state.latestCloseReport.output.itemDispositions.completed.length}
            </span>
            {state.latestCloseReport.output.reflectiveSummary.consciousPostponements.length > 0 && (
              <span className="badge badge-idea">
                Postergadas conscientemente:{" "}
                {state.latestCloseReport.output.reflectiveSummary.consciousPostponements.length}
              </span>
            )}
            {state.latestCloseReport.output.itemDispositions.dropped.length > 0 && (
              <span className="badge badge-error">
                Descartadas: {state.latestCloseReport.output.itemDispositions.dropped.length}
              </span>
            )}
            {state.latestCloseReport.output.itemDispositions.unreported.length > 0 && (
              <span className="badge badge-muted">
                Sin informar: {state.latestCloseReport.output.itemDispositions.unreported.length}
              </span>
            )}
          </div>
          {state.latestCloseReport.output.reflectiveSummary.headline && (
            <div style={{ marginTop: "12px" }}>
              <strong>Resumen reflexivo:</strong>
              <p className="calm-text" style={{ fontStyle: "italic", marginTop: "4px" }}>
                "{state.latestCloseReport.output.reflectiveSummary.headline}"
              </p>
            </div>
          )}
        </section>
      )}

      {/* Memory Candidates Review Section (Sovereignty Invariant) */}
      {state.memoryCandidates.length > 0 && (
        <section className="results-section" style={{ marginTop: "24px" }} aria-label="Candidatos de memoria">
          <h3>Candidatos de memoria pendientes de decisión</h3>
          <p className="calm-text" style={{ marginBottom: "12px" }}>
            El sistema identificó posibles aprendizajes.{" "}
            <strong>No están guardados todavía.</strong> Tú decides cuáles conservar:
          </p>
          <div className="items-list">
            {state.memoryCandidates.map((candidate: StoreCandidate) => (
              <div key={candidate.candidateId} className="item-card">
                <div className="item-content">
                  <div className="item-title">"{candidate.rawText}"</div>
                  <div className="item-tags">
                    <span className="badge badge-idea">
                      Categoría sugerida: {candidate.suggestedCategory || "fact"}
                    </span>
                    <span className="badge badge-muted">
                      Origen: {candidate.provenanceSource || "sistema"}
                    </span>
                  </div>
                  <div className="actions" style={{ marginTop: "12px" }}>
                    <button
                      className="secondary"
                      aria-label={`Descartar candidato de memoria ${candidate.candidateId}`}
                      onClick={async () => {
                        await confirmMemoryCandidate(candidate, "rejected");
                        setFeedbackMessage("Candidato descartado.");
                      }}
                    >
                      Descartar
                    </button>
                    <button
                      className="primary"
                      aria-label={`Guardar en memoria candidato ${candidate.candidateId}`}
                      onClick={async () => {
                        await confirmMemoryCandidate(candidate, "accepted");
                        setFeedbackMessage("Recuerdo guardado con éxito.");
                      }}
                    >
                      Guardar en memoria
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Confirmed Active Memories */}
      {state.memories.length > 0 && (
        <section className="results-section" style={{ marginTop: "24px" }} aria-label="Memorias activas confirmadas">
          <h3>Memorias activas confirmadas</h3>
          <div className="items-list">
            {state.memories.map((mem) => (
              <div key={mem.id} className="item-card">
                <div className="item-content">
                  <div className="item-title">{mem.content}</div>
                  <div className="item-tags">
                    <span className="badge badge-muted">
                      {mem.category} · {mem.confirmationStatus}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Purge Week Option (Accessible in Review space or Legacy Unified View) */}
      <div
        style={{
          marginTop: "40px",
          borderTop: "1px solid var(--border-color)",
          paddingTop: "16px",
        }}
      >
        {isPurgeConfirming ? (
          <div
            className="status-message status-error"
            role="alert"
            aria-label="Confirmación para purgar semana"
            style={{ display: "flex", flexDirection: "column", gap: "8px" }}
          >
            <p>
              ¿Deseas purgar completamente esta semana y sus datos asociados? Esta
              acción eliminará el plan, la agenda y reportes de la base de datos local y
              no se puede deshacer.
            </p>
            <div style={{ display: "flex", gap: "8px" }}>
              <button
                className="primary"
                style={{ backgroundColor: "#8c2a2a", borderColor: "#8c2a2a" }}
                aria-label="Confirmar purga definitiva"
                onClick={async () => {
                  if (plan) {
                    await purgeSession(plan.planId);
                    setIsPurgeConfirming(false);
                    setFeedbackMessage("Semana purgada.");
                  }
                }}
              >
                Confirmar purga
              </button>
              <button
                className="secondary"
                aria-label="Cancelar purga"
                onClick={() => setIsPurgeConfirming(false)}
              >
                Cancelar
              </button>
            </div>
          </div>
        ) : (
          <button
            className="secondary"
            style={{ color: "#8c2a2a", borderColor: "#f0d0d0" }}
            aria-label="Purgar semana actual"
            onClick={() => setIsPurgeConfirming(true)}
          >
            Purgar semana actual
          </button>
        )}
      </div>
      </>
    )}

      {/* Plan New Week / Brain Dump (Accessible from active session in legacy unified view) */}
      {activeSpace === undefined && (
        <div
          style={{
            marginTop: "32px",
            borderTop: "1px solid var(--border-color)",
            paddingTop: "16px",
          }}
        >
          <details>
            <summary
              style={{
                cursor: "pointer",
                fontWeight: 600,
                color: "var(--text-color, #333)",
                fontSize: "1rem",
              }}
            >
              Capturar nuevas ideas o preparar la próxima semana
            </summary>
            <div style={{ marginTop: "12px" }}>
              <WeeklyPlanningFromNotes
                provider={provider}
                hasActivePlan={true}
                onPlanCreated={() => reloadSession()}
              />
            </div>
          </details>
        </div>
      )}
    </div>
  );
}
