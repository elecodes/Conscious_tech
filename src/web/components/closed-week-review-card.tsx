import { ClosedWeekSummary } from "../../domain/repositories/types";

export interface ClosedWeekReviewCardProps {
  latestClosedWeek: ClosedWeekSummary;
  isClosedWeekDetailsOpen: boolean;
  setIsClosedWeekDetailsOpen: (val: boolean) => void;
  isReopening: boolean;
  handleReopenWeek: (planId: string) => void;
  reopenFeedback: string | null;
}

export function ClosedWeekReviewCard({
  latestClosedWeek,
  isClosedWeekDetailsOpen,
  setIsClosedWeekDetailsOpen,
  isReopening,
  handleReopenWeek,
  reopenFeedback,
}: ClosedWeekReviewCardProps) {
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
          {latestClosedWeek.plan.targetWeek.startDate} al{" "}
          {latestClosedWeek.plan.targetWeek.endDate}
        </span>
      </div>
      <p className="calm-text" style={{ marginTop: "8px" }}>
        {latestClosedWeek.plan.proposal.weekSummary.intent || "Semana cerrada."}
      </p>
      <div className="config-row" style={{ marginTop: "12px", flexWrap: "wrap", gap: "8px" }}>
        <span className="badge badge-task">
          Cerrada el: {latestClosedWeek.closeReport.closedAt}
        </span>
        <span className="badge badge-muted">
          Completadas:{" "}
          {latestClosedWeek.closeReport.output.itemDispositions.completed.length}
        </span>
        {latestClosedWeek.closeReport.output.reflectiveSummary.consciousPostponements.length > 0 && (
          <span className="badge badge-idea">
            Postergadas:{" "}
            {latestClosedWeek.closeReport.output.reflectiveSummary.consciousPostponements.length}
          </span>
        )}
        {latestClosedWeek.closeReport.output.itemDispositions.dropped.length > 0 && (
          <span className="badge badge-muted">
            Descartadas:{" "}
            {latestClosedWeek.closeReport.output.itemDispositions.dropped.length}
          </span>
        )}
      </div>
      {latestClosedWeek.closeReport.output.reflectiveSummary.headline && (
        <p className="calm-muted" style={{ fontStyle: "italic", marginTop: "8px" }}>
          "{latestClosedWeek.closeReport.output.reflectiveSummary.headline}"
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
          onClick={() => handleReopenWeek(latestClosedWeek.plan.planId)}
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
          {latestClosedWeek.plan.proposal.foci.length > 0 && (
            <div style={{ marginBottom: "16px" }}>
              <h4 style={{ fontSize: "0.95rem", marginBottom: "8px" }}>Focos de la semana</h4>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {latestClosedWeek.plan.proposal.foci.map((focus) => (
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
          {latestClosedWeek.plan.proposal.obligations.length > 0 && (
            <div style={{ marginBottom: "16px" }}>
              <h4 style={{ fontSize: "0.95rem", marginBottom: "8px" }}>Obligaciones y compromisos fijos</h4>
              <ul style={{ margin: 0, paddingLeft: "20px", display: "flex", flexDirection: "column", gap: "6px" }}>
                {latestClosedWeek.plan.proposal.obligations.map((ob) => (
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
          {latestClosedWeek.plan.proposal.flexibleOptions.length > 0 && (
            <div style={{ marginBottom: "16px" }}>
              <h4 style={{ fontSize: "0.95rem", marginBottom: "8px" }}>Opciones flexibles</h4>
              <ul style={{ margin: 0, paddingLeft: "20px", display: "flex", flexDirection: "column", gap: "6px" }}>
                {latestClosedWeek.plan.proposal.flexibleOptions.map((flex) => (
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
          {latestClosedWeek.closeReport.output.classifiedItems &&
            latestClosedWeek.closeReport.output.classifiedItems.length > 0 && (
              <div style={{ marginBottom: "16px" }}>
                <h4 style={{ fontSize: "0.95rem", marginBottom: "8px" }}>Balance de tareas e ítems</h4>
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  {latestClosedWeek.closeReport.output.classifiedItems.map((item) => (
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
            {latestClosedWeek.closeReport.output.capacityAnalysis?.explanation && (
              <p className="calm-text" style={{ fontSize: "0.85rem", marginBottom: "4px" }}>
                <strong>Capacidad y espacio:</strong> {latestClosedWeek.closeReport.output.capacityAnalysis.explanation}
              </p>
            )}
            {latestClosedWeek.closeReport.output.reflectiveSummary.accomplishments.length > 0 && (
              <div style={{ fontSize: "0.85rem", marginBottom: "4px" }}>
                <strong>Logros:</strong>
                <ul style={{ margin: "4px 0 0 20px", padding: 0 }}>
                  {latestClosedWeek.closeReport.output.reflectiveSummary.accomplishments.map((acc, i) => (
                    <li key={i}>{acc}</li>
                  ))}
                </ul>
              </div>
            )}
            {latestClosedWeek.closeReport.output.reflectiveSummary.questionsForNextCycle.length > 0 && (
              <div style={{ fontSize: "0.85rem", marginTop: "4px" }}>
                <strong>Preguntas para el próximo ciclo:</strong>
                <ul style={{ margin: "4px 0 0 20px", padding: 0 }}>
                  {latestClosedWeek.closeReport.output.reflectiveSummary.questionsForNextCycle.map((q, i) => (
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
}
