import { WeeklySchedule, ScheduleAdjustmentRecord } from "../../domain/schedule";
import {
  formatAdjustmentActionType,
  getAdjustmentTargetItem,
  renderAdjustmentDetails,
} from "./weekly-session-formatters";

export interface ScheduleAdjustmentHistorySectionProps {
  schedule: WeeklySchedule;
}

export function ScheduleAdjustmentHistorySection({
  schedule,
}: ScheduleAdjustmentHistorySectionProps) {
  return (
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
            Una propuesta no es una decisión; una decisión no es una aplicación; una aplicación no
            implica que el ajuste siga vigente.
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
                        <strong>{typeLabel}</strong> · Ítem:{" "}
                        <code>{getAdjustmentTargetItem(action)}</code>
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
                          Aplicación:{" "}
                          {rec.applicationOutcome === "applied" ? "Aplicado" : "Fallido"}
                        </span>
                        <span
                          className={`badge ${
                            rec.lifecycleStatus === "active" ? "badge-idea" : "badge-muted"
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
                    <div style={{ marginTop: "8px" }}>{renderAdjustmentDetails(action)}</div>

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
  );
}
