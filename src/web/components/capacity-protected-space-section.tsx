import { WeeklyCapacitySummary } from "../../domain/week";
import {
  formatCapacityStatus,
  formatProtectedSpaceStatus,
  formatEstimationCompleteness,
  formatHours,
} from "./weekly-session-formatters";

export interface CapacityProtectedSpaceSectionProps {
  capacity: WeeklyCapacitySummary;
}

export function CapacityProtectedSpaceSection({
  capacity,
}: CapacityProtectedSpaceSectionProps) {
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
      className="results-section"
      style={{ marginTop: "16px", marginBottom: "8px" }}
      aria-label="Capacidad y espacio protegido"
      data-testid="capacity-protected-space-section"
    >
      <div
        className="capacity-compact-bar calm-box"
        data-testid="capacity-compact-bar"
        style={{
          padding: "10px 14px",
          background: "var(--bg-card, #fcfbf9)",
          border: "1px solid var(--border-color, #e8e3d9)",
          borderRadius: "8px",
          display: "flex",
          flexDirection: "column",
          gap: "8px",
        }}
      >
        {/* Fila superior: Resumen HUD */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: "8px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
            <span style={{ fontWeight: 600, fontSize: "0.88rem" }}>
              Balance de tu semana:
            </span>
            <span
              className={`badge ${capacityStatusBadgeClass}`}
              data-testid="compact-capacity-status"
              style={{ fontSize: "0.78rem" }}
            >
              {isCapacityConfigured && capacity.capacityStatus === "unknown"
                ? "Tareas sin estimar"
                : formatCapacityStatus(capacity.capacityStatus)}
            </span>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              flexWrap: "wrap",
              gap: "6px",
              fontSize: "0.82rem",
            }}
          >
            <span style={{ background: "#f3f0ea", padding: "3px 8px", borderRadius: "4px" }}>
              <span className="calm-muted">Disponibles:</span> <strong>{formatHours(capacity.totalAvailableHours, "No disponible")}</strong>
            </span>
            <span style={{ background: "#f3f0ea", padding: "3px 8px", borderRadius: "4px" }}>
              <span className="calm-muted">Planificadas:</span>{" "}
              <strong>
                {capacity.plannedHours != null
                  ? formatHours(capacity.plannedHours)
                  : formatHours(capacity.knownEstimatedHours, "Sin estimar")}
              </strong>
            </span>
            <span style={{ background: "#f3f0ea", padding: "3px 8px", borderRadius: "4px" }}>
              <span className="calm-muted">Planificables:</span> <strong>{formatHours(capacity.plannableHours, "Desconocido")}</strong>
            </span>
            <span style={{ background: "#f3f0ea", padding: "3px 8px", borderRadius: "4px" }}>
              <span className="calm-muted">Protegidas:</span> <strong>{formatHours(capacity.protectedSpaceHours, "Desconocido")}</strong>
            </span>
            <span style={{ background: "#f3f0ea", padding: "3px 8px", borderRadius: "4px" }}>
              <span className="calm-muted">Restantes:</span>{" "}
              <strong>
                {capacity.plannableHours != null && (capacity.plannedHours != null || capacity.knownEstimatedHours != null)
                  ? formatHours(Math.max(0, capacity.plannableHours - (capacity.plannedHours ?? capacity.knownEstimatedHours!)))
                  : capacity.plannableHours != null
                  ? `Hasta ${formatHours(capacity.plannableHours)}`
                  : "Desconocido"}
              </strong>
            </span>
          </div>
        </div>

        {/* Barra visual limpia de 1 línea */}
        {capacity.totalAvailableHours != null && capacity.totalAvailableHours > 0 && (() => {
          const effectivePlanned = capacity.plannedHours ?? capacity.knownEstimatedHours;
          return (
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginTop: "2px" }}>
              <span className="cognitive-budget-title" style={{ fontSize: "0.75rem", whiteSpace: "nowrap" }}>
                Tu tiempo de un vistazo
              </span>
              <div className="cognitive-bar-track" style={{ flex: 1, height: "6px", margin: 0 }}>
                {effectivePlanned != null && effectivePlanned > 0 && (
                  <div
                    className="cognitive-bar-fill"
                    style={{
                      width: `${Math.min(100, Math.round((effectivePlanned / capacity.totalAvailableHours) * 100))}%`,
                    }}
                    title={`Planificadas: ${effectivePlanned}h`}
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
              <span className="cognitive-budget-ratio" style={{ fontSize: "0.75rem", whiteSpace: "nowrap" }}>
                {capacity.plannedHours != null
                  ? `${capacity.plannedHours}h asignadas`
                  : effectivePlanned != null && effectivePlanned > 0
                  ? `~${effectivePlanned}h asignadas (parcial)`
                  : "Tareas sin estimar en horas"}{" "}
                / {capacity.totalAvailableHours}h disponibles
              </span>
            </div>
          );
        })()}

        {/* Desglose progresivo */}
        <details className="calm-details" style={{ marginTop: "4px" }}>
          <summary
            style={{
              cursor: "pointer",
              fontSize: "0.8rem",
              color: "var(--accent-color, #2b6cb0)",
              userSelect: "none",
            }}
          >
            Ver desglose completo de cálculos y límites
          </summary>
          <div style={{ marginTop: "8px", display: "flex", flexDirection: "column", gap: "8px" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              <span
                className="calm-muted"
                data-testid="guiding-principle"
                style={{ fontSize: "0.78rem", fontStyle: "italic" }}
              >
                «El espacio libre no es automáticamente tiempo disponible para asumir más compromisos.»
              </span>
              <p
                className="calm-muted"
                style={{ fontSize: "0.78rem", margin: 0 }}
              >
                El espacio protegido deja margen para imprevistos, descanso y cambios de prioridad.
              </p>
              <p
                className="calm-muted"
                data-testid="protected-space-reservation-notice"
                style={{ fontSize: "0.78rem", margin: 0 }}
              >
                {(() => {
                  const currentEstimated = capacity.plannedHours ?? capacity.knownEstimatedHours;
                  if (currentEstimated != null && capacity.plannableHours != null) {
                    if (currentEstimated > capacity.plannableHours) {
                      return "Se ha reservado espacio protegido en el plan (margen de calma). La carga estimada actual supera el tiempo planificable disponible.";
                    }
                    const remaining = Math.max(0, capacity.plannableHours - currentEstimated);
                    return `Se ha reservado espacio protegido en el plan (margen de calma). Disponés de hasta ${formatHours(remaining)} para tareas adicionales o pendientes de estimar.`;
                  }
                  if (currentEstimated == null && capacity.plannableHours != null) {
                    return `Se ha reservado espacio protegido en el plan (margen de calma). Disponés de hasta ${formatHours(capacity.plannableHours)} para tareas sin estimar.`;
                  }
                  return "Se ha reservado espacio protegido en el plan (margen de calma) para asegurar equilibrio y evitar sobrecarga.";
                })()}
              </p>
            </div>
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
                      {capacity.plannedHours != null
                        ? formatHours(capacity.plannedHours)
                        : capacity.knownEstimatedHours != null
                        ? `${formatHours(capacity.knownEstimatedHours)} (parcial · Por definir total)`
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
      </div>
    </section>
  );
}
