import { ProposedWeek } from "../../domain/week";
import { CalendarWeekSummary } from "../../domain/calendar";
import {
  formatCapacityStatus,
  formatProtectedSpaceStatus,
  formatEstimationCompleteness,
  formatHours,
} from "./weekly-session-formatters";

export interface PlanningCapacityHudProps {
  proposedWeek: ProposedWeek;
  calendarSummary?: CalendarWeekSummary | null;
  isEditingCapacity: boolean;
  setIsEditingCapacity: (val: boolean) => void;
  availableHoursInput: string;
  setAvailableHoursInput: (val: string) => void;
  protectedSpacePercentInput: string;
  setProtectedSpacePercentInput: (val: string) => void;
  capacityFeedbackMessage: string | null;
  onStartEditCapacity: () => void;
  onCancelEditCapacity: () => void;
  onVerifyCapacity: () => void;
}

export function PlanningCapacityHud({
  proposedWeek,
  calendarSummary,
  isEditingCapacity,
  setIsEditingCapacity,
  availableHoursInput,
  setAvailableHoursInput,
  protectedSpacePercentInput,
  setProtectedSpacePercentInput,
  capacityFeedbackMessage,
  onStartEditCapacity,
  onCancelEditCapacity,
  onVerifyCapacity,
}: PlanningCapacityHudProps) {
  const isCapacityConfigured = proposedWeek.weekSummary.capacity.totalAvailableHours != null;
  const effectivePlanned =
    proposedWeek.weekSummary.capacity.plannedHours ??
    proposedWeek.weekSummary.capacity.knownEstimatedHours;

  return (
    <div
      className="calm-box"
      style={{
        marginTop: "16px",
        background: "#fafafa",
        borderColor: "#e0e0e0",
        padding: "16px",
      }}
      data-testid="planning-capacity-section"
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          flexWrap: "wrap",
          gap: "8px",
          marginBottom: "8px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
          <h5 style={{ margin: 0, fontSize: "1rem" }}>Balance de tu semana</h5>
          <span
            className={`badge ${
              proposedWeek.weekSummary.capacity.capacityStatus === "within_capacity"
                ? "badge-success"
                : proposedWeek.weekSummary.capacity.capacityStatus === "over_capacity"
                  ? "badge-error"
                  : "badge-warning"
            }`}
            data-testid="planning-capacity-status-summary-badge"
          >
            {proposedWeek.weekSummary.capacity.totalAvailableHours == null
              ? "Capacidad no configurada"
              : proposedWeek.weekSummary.capacity.capacityStatus === "over_capacity"
                ? "Por encima de la capacidad"
                : proposedWeek.weekSummary.capacity.capacityStatus === "within_capacity"
                  ? "Dentro de la capacidad"
                  : "Estimación parcial"}
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
          <span style={{ background: "#f3f0ea", padding: "2px 6px", borderRadius: "4px" }}>
            <span className="calm-muted">Disponibles:</span>{" "}
            <strong>
              {formatHours(proposedWeek.weekSummary.capacity.totalAvailableHours, "No disponible")}
            </strong>
          </span>
          <span style={{ background: "#f3f0ea", padding: "2px 6px", borderRadius: "4px" }}>
            <span className="calm-muted">Planificadas:</span>{" "}
            <strong>
              {proposedWeek.weekSummary.capacity.plannedHours != null
                ? formatHours(proposedWeek.weekSummary.capacity.plannedHours)
                : formatHours(proposedWeek.weekSummary.capacity.knownEstimatedHours, "Sin estimar")}
            </strong>
          </span>
          <span style={{ background: "#f3f0ea", padding: "2px 6px", borderRadius: "4px" }}>
            <span className="calm-muted">Planificables:</span>{" "}
            <strong>
              {formatHours(proposedWeek.weekSummary.capacity.plannableHours, "Desconocido")}
            </strong>
          </span>
          <span style={{ background: "#f3f0ea", padding: "2px 6px", borderRadius: "4px" }}>
            <span className="calm-muted">Protegidas:</span>{" "}
            <strong>
              {formatHours(proposedWeek.weekSummary.capacity.protectedSpaceHours, "Desconocido")}
            </strong>
          </span>
        </div>
      </div>

      {/* Tu tiempo de un vistazo (visual bar) */}
      {proposedWeek.weekSummary.capacity.totalAvailableHours != null &&
        proposedWeek.weekSummary.capacity.totalAvailableHours > 0 && (
          <div
            className="cognitive-budget-card"
            style={{ margin: "4px 0 10px", padding: "10px 14px" }}
          >
            <div className="cognitive-budget-header">
              <span className="cognitive-budget-title">Tu tiempo de un vistazo</span>
              <span className="cognitive-budget-ratio">
                {proposedWeek.weekSummary.capacity.plannedHours != null
                  ? `${proposedWeek.weekSummary.capacity.plannedHours}h asignadas`
                  : effectivePlanned != null && effectivePlanned > 0
                    ? `~${effectivePlanned}h asignadas (parcial)`
                    : "Tareas sin estimar en horas"}{" "}
                / {proposedWeek.weekSummary.capacity.totalAvailableHours}h disponibles
              </span>
            </div>
            <div className="cognitive-bar-track">
              {effectivePlanned != null && effectivePlanned > 0 && (
                <div
                  className="cognitive-bar-fill"
                  style={{
                    width: `${Math.min(
                      100,
                      Math.round(
                        (effectivePlanned / proposedWeek.weekSummary.capacity.totalAvailableHours) *
                          100
                      )
                    )}%`,
                  }}
                  title={`Planificadas: ${effectivePlanned}h`}
                />
              )}
              {proposedWeek.weekSummary.capacity.protectedSpaceHours != null &&
                proposedWeek.weekSummary.capacity.protectedSpaceHours > 0 && (
                  <div
                    className="cognitive-bar-fill protected"
                    style={{
                      width: `${Math.min(
                        100,
                        Math.round(
                          (proposedWeek.weekSummary.capacity.protectedSpaceHours /
                            proposedWeek.weekSummary.capacity.totalAvailableHours) *
                            100
                        )
                      )}%`,
                    }}
                    title={`Espacio protegido: ${proposedWeek.weekSummary.capacity.protectedSpaceHours}h`}
                  />
                )}
            </div>
          </div>
        )}

      {/* Desglose progresivo tipo desplegable */}
      <details
        className="calm-details"
        style={{ marginTop: "4px" }}
        data-testid="planning-capacity-details"
      >
        <summary
          style={{
            cursor: "pointer",
            fontSize: "0.82rem",
            color: "var(--accent-color, #2b6cb0)",
            userSelect: "none",
          }}
        >
          Ver desglose completo de cálculos y viabilidad
        </summary>
        <div style={{ marginTop: "12px", display: "flex", flexDirection: "column", gap: "12px" }}>
          {/* Separación visual nítida en dos paneles independientes */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
              gap: "16px",
            }}
          >
            {/* Panel 1: Límites de tiempo y disponibilidad */}
            <div
              className="item-card"
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "10px",
                margin: 0,
                padding: "14px",
                background: "#ffffff",
                border: "1px solid #e5e5e5",
                borderRadius: "6px",
              }}
              data-testid="planning-time-boundaries-card"
            >
              <div style={{ fontWeight: 600, fontSize: "0.95rem", color: "#374151" }}>
                Límites de tiempo y disponibilidad
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: "8px" }}>
                  <span className="calm-muted" style={{ fontSize: "0.85rem" }}>
                    Tiempo disponible real:
                  </span>
                  <strong data-testid="planning-available-hours">
                    {formatHours(
                      proposedWeek.weekSummary.capacity.totalAvailableHours,
                      "No registrado"
                    )}
                  </strong>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", gap: "8px" }}>
                  <span className="calm-muted" style={{ fontSize: "0.85rem" }}>
                    Capacidad planificable:
                  </span>
                  <strong data-testid="planning-plannable-hours">
                    {formatHours(proposedWeek.weekSummary.capacity.plannableHours, "Desconocido")}
                  </strong>
                </div>
                {proposedWeek.weekSummary.capacity.plannableHours != null &&
                  (proposedWeek.weekSummary.capacity.plannedHours != null ||
                    proposedWeek.weekSummary.capacity.knownEstimatedHours != null) && (
                    <div style={{ display: "flex", justifyContent: "space-between", gap: "8px" }}>
                      <span className="calm-muted" style={{ fontSize: "0.85rem" }}>
                        Capacidad planificable restante:
                      </span>
                      <strong data-testid="planning-remaining-plannable-hours">
                        {formatHours(
                          Math.max(
                            0,
                            proposedWeek.weekSummary.capacity.plannableHours -
                              (proposedWeek.weekSummary.capacity.plannedHours ??
                                proposedWeek.weekSummary.capacity.knownEstimatedHours!)
                          )
                        )}
                      </strong>
                    </div>
                  )}
                <div style={{ display: "flex", justifyContent: "space-between", gap: "8px" }}>
                  <span className="calm-muted" style={{ fontSize: "0.85rem" }}>
                    Espacio protegido:
                  </span>
                  <strong data-testid="planning-protected-space-hours">
                    {formatHours(
                      proposedWeek.weekSummary.capacity.protectedSpaceHours,
                      "Desconocido"
                    )}
                  </strong>
                </div>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginTop: "4px",
                    paddingTop: "6px",
                    borderTop: "1px solid #f0f0f0",
                  }}
                >
                  <span className="calm-muted" style={{ fontSize: "0.82rem" }}>
                    Margen protegido:
                  </span>
                  <span className="badge badge-idea" data-testid="planning-protected-space-badge">
                    {formatProtectedSpaceStatus(
                      proposedWeek.weekSummary.capacity.protectedSpaceStatus
                    )}
                  </span>
                </div>
              </div>
            </div>

            {/* Panel 2: Carga planificada y viabilidad */}
            <div
              className="item-card"
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "10px",
                margin: 0,
                padding: "14px",
                background: "#ffffff",
                border: "1px solid #e5e5e5",
                borderRadius: "6px",
              }}
              data-testid="planning-workload-viability-card"
            >
              <div style={{ fontWeight: 600, fontSize: "0.95rem", color: "#374151" }}>
                Carga planificada y viabilidad
              </div>
              {(() => {
                const hasZeroCommitted =
                  proposedWeek.foci.length === 0 && proposedWeek.obligations.length === 0;
                const flexibleHours = proposedWeek.flexibleOptions.reduce(
                  (acc, o) => acc + (o.estimatedHours ?? 0),
                  0
                );

                return (
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: "8px" }}>
                      <span className="calm-muted" style={{ fontSize: "0.85rem" }}>
                        Horas planificadas:
                      </span>
                      <strong data-testid="planning-planned-hours">
                        {hasZeroCommitted && flexibleHours > 0
                          ? `0h fijas (~${flexibleHours}h flexibles)`
                          : formatHours(
                              proposedWeek.weekSummary.capacity.plannedHours,
                              proposedWeek.weekSummary.capacity.knownEstimatedHours !== null
                                ? `~${proposedWeek.weekSummary.capacity.knownEstimatedHours}h parcial`
                                : "Sin estimar"
                            )}
                      </strong>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: "8px" }}>
                      <span className="calm-muted" style={{ fontSize: "0.85rem" }}>
                        Completitud de estimaciones:
                      </span>
                      <span className="badge badge-muted" data-testid="planning-estimation-badge">
                        {hasZeroCommitted && flexibleHours > 0
                          ? `Opciones flexibles (${proposedWeek.flexibleOptions.length})`
                          : formatEstimationCompleteness(
                              proposedWeek.weekSummary.capacity.estimationCompleteness
                            )}
                      </span>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        marginTop: "4px",
                        paddingTop: "6px",
                        borderTop: "1px solid #f0f0f0",
                      }}
                    >
                      <span className="calm-muted" style={{ fontSize: "0.82rem" }}>
                        Estado de viabilidad:
                      </span>
                      <span
                        className={`badge ${
                          proposedWeek.weekSummary.capacity.capacityStatus === "within_capacity" ||
                          (hasZeroCommitted &&
                            proposedWeek.weekSummary.capacity.totalAvailableHours != null &&
                            flexibleHours <=
                              (proposedWeek.weekSummary.capacity.plannableHours ?? 0))
                            ? "badge-success"
                            : proposedWeek.weekSummary.capacity.capacityStatus === "over_capacity"
                              ? "badge-error"
                              : proposedWeek.weekSummary.capacity.totalAvailableHours != null &&
                                  proposedWeek.weekSummary.capacity.estimationCompleteness !==
                                    "complete"
                                ? "badge-warning"
                                : "badge-task"
                        }`}
                        data-testid="planning-capacity-status-badge"
                      >
                        {proposedWeek.weekSummary.capacity.totalAvailableHours == null
                          ? "Capacidad desconocida · Viabilidad no verificada"
                          : proposedWeek.weekSummary.capacity.capacityStatus === "over_capacity"
                            ? "Por encima de la capacidad"
                            : hasZeroCommitted && flexibleHours > 0
                              ? `Capacidad disponible (${flexibleHours}h flexibles)`
                              : proposedWeek.weekSummary.capacity.capacityStatus ===
                                  "within_capacity"
                                ? "Dentro de la capacidad"
                                : proposedWeek.weekSummary.capacity.estimationCompleteness !==
                                    "complete"
                                  ? "Estimaciones incompletas · Viabilidad no confirmada"
                                  : formatCapacityStatus(
                                      proposedWeek.weekSummary.capacity.capacityStatus
                                    )}
                      </span>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>

          {/* Panel de registro y calibración de capacidad */}
          <div
            style={{
              background: "#f9fafb",
              border: "1px solid #e5e7eb",
              borderRadius: "6px",
              padding: "12px 14px",
              marginTop: "8px",
            }}
            data-testid="capacity-calibration-box"
          >
            {isCapacityConfigured && !isEditingCapacity ? (
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: "10px",
                }}
                data-testid="capacity-validated-summary"
              >
                <div
                  style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}
                >
                  <strong style={{ fontSize: "0.88rem", color: "#1f2937" }}>
                    ✓ Capacidad configurada y validada (
                    {proposedWeek.weekSummary.capacity.totalAvailableHours}h disponibles)
                  </strong>
                  {calendarSummary && (
                    <span style={{ fontSize: "0.82rem", color: "#0369a1" }}>
                      (📅 {calendarSummary.totalCommittedHours}h en reuniones de Google Calendar)
                    </span>
                  )}
                  {proposedWeek.weekSummary.capacity.capacityStatus === "within_capacity" ||
                  (proposedWeek.foci.length === 0 &&
                    proposedWeek.obligations.length === 0 &&
                    proposedWeek.weekSummary.capacity.totalAvailableHours != null &&
                    proposedWeek.flexibleOptions.reduce(
                      (acc, o) => acc + (o.estimatedHours ?? 0),
                      0
                    ) <= (proposedWeek.weekSummary.capacity.plannableHours ?? 0)) ? (
                    <span className="badge badge-success" data-testid="viability-confirmed-badge">
                      ✓ Viabilidad confirmada
                    </span>
                  ) : proposedWeek.weekSummary.capacity.capacityStatus === "over_capacity" ? (
                    <span className="badge badge-error" data-testid="over-capacity-badge">
                      ⚠️ Sobrecarga detectada (
                      {formatHours(proposedWeek.weekSummary.capacity.knownEstimatedHours)}{" "}
                      estimadas)
                    </span>
                  ) : (
                    <span
                      className="badge badge-warning"
                      data-testid="incomplete-estimations-badge"
                    >
                      ℹ️ Viabilidad no confirmada: estimaciones incompletas
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  className="secondary small"
                  onClick={onStartEditCapacity}
                  data-testid="modify-capacity-button"
                >
                  Modificar capacidad
                </button>
              </div>
            ) : (
              <>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "baseline",
                    flexWrap: "wrap",
                    gap: "8px",
                    marginBottom: "8px",
                  }}
                >
                  <div>
                    <strong style={{ fontSize: "0.9rem", color: "#1f2937" }}>
                      {isCapacityConfigured
                        ? "Modificar límites de capacidad y espacio protegido"
                        : "Registrar o calibrar capacidad para verificar viabilidad"}
                    </strong>
                    <span className="calm-muted" style={{ fontSize: "0.8rem", display: "block" }}>
                      {isCapacityConfigured
                        ? "Ajusta las horas disponibles o el margen para recalcular la viabilidad"
                        : "Ingresa tus horas reales para evaluar si la semana es viable"}
                    </span>
                  </div>
                  {isCapacityConfigured && (
                    <button
                      type="button"
                      className="secondary small"
                      onClick={onCancelEditCapacity}
                      data-testid="cancel-modify-capacity-button"
                      aria-label="Volver sin cambios"
                    >
                      Volver sin cambios
                    </button>
                  )}
                </div>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: "12px",
                    alignItems: "flex-end",
                  }}
                >
                  <div style={{ flex: "1 1 180px" }}>
                    <label
                      htmlFor="proposal-available-hours"
                      style={{
                        display: "block",
                        fontSize: "0.82rem",
                        fontWeight: 500,
                        marginBottom: "4px",
                        color: "#4b5563",
                      }}
                    >
                      Horas realmente disponibles:
                    </label>
                    <input
                      id="proposal-available-hours"
                      type="number"
                      min="0"
                      step="0.5"
                      value={availableHoursInput}
                      onChange={(e) => setAvailableHoursInput(e.target.value)}
                      placeholder="Ej: 20"
                      style={{
                        width: "100%",
                        padding: "6px 10px",
                        fontSize: "0.88rem",
                        boxSizing: "border-box",
                      }}
                      data-testid="available-hours-proposal-input"
                    />
                  </div>
                  <div style={{ flex: "1 1 180px" }}>
                    <label
                      htmlFor="proposal-protected-space-ratio"
                      style={{
                        display: "block",
                        fontSize: "0.82rem",
                        fontWeight: 500,
                        marginBottom: "4px",
                        color: "#4b5563",
                      }}
                    >
                      Espacio a proteger (% margen):
                    </label>
                    <input
                      id="proposal-protected-space-ratio"
                      type="number"
                      min="0"
                      max="100"
                      step="5"
                      value={protectedSpacePercentInput}
                      onChange={(e) => setProtectedSpacePercentInput(e.target.value)}
                      placeholder="25"
                      style={{
                        width: "100%",
                        padding: "6px 10px",
                        fontSize: "0.88rem",
                        boxSizing: "border-box",
                      }}
                      data-testid="protected-space-proposal-input"
                    />
                  </div>
                  <button
                    type="button"
                    className="primary small"
                    onClick={() => {
                      onVerifyCapacity();
                      setIsEditingCapacity(false);
                    }}
                    style={{ height: "36px", whiteSpace: "nowrap" }}
                    data-testid="verify-viability-button"
                  >
                    {isCapacityConfigured ? "Guardar y recalcular" : "Verificar viabilidad"}
                  </button>
                </div>
              </>
            )}

            {capacityFeedbackMessage && (
              <div
                className="status-message"
                style={{
                  marginTop: "10px",
                  padding: "8px 12px",
                  fontSize: "0.85rem",
                  background:
                    proposedWeek.weekSummary.capacity.capacityStatus === "within_capacity"
                      ? "#ecfdf5"
                      : "#fff7ed",
                  border:
                    proposedWeek.weekSummary.capacity.capacityStatus === "within_capacity"
                      ? "1px solid #a7f3d0"
                      : "1px solid #ffedd5",
                  color:
                    proposedWeek.weekSummary.capacity.capacityStatus === "within_capacity"
                      ? "#065f46"
                      : "#9a3412",
                  borderRadius: "4px",
                }}
                data-testid="capacity-feedback-message"
              >
                {capacityFeedbackMessage}
              </div>
            )}
          </div>

          {/* Aviso de viabilidad no verificada cuando capacidad es desconocida y hay tareas de recuperación */}
          {proposedWeek.foci.some((f) => f.id.startsWith("focus-recovery-")) &&
            proposedWeek.weekSummary.capacity.capacityStatus === "unknown" && (
              <div
                className="status-message status-warning"
                style={{
                  marginTop: "12px",
                  background: "#fffbeb",
                  border: "1px solid #fef3c7",
                  borderRadius: "6px",
                  padding: "10px 14px",
                  color: "#92400e",
                  fontSize: "0.85rem",
                }}
                data-testid="unverified-capacity-warning"
                role="status"
              >
                ⚠️ <strong>Viabilidad no verificada:</strong> Se programó una tarea de recuperación
                (
                {proposedWeek.foci
                  .filter((f) => f.id.startsWith("focus-recovery-"))
                  .reduce((acc, f) => acc + (f.estimatedHours ?? 0), 0)}
                h) con capacidad disponible desconocida. No se inventa capacidad disponible; la
                viabilidad no está confirmada hasta registrar tus horas reales disponibles.
              </div>
            )}
        </div>
      </details>
    </div>
  );
}
