import { StoredWeeklyPlan } from "../../domain/repositories/types";
import { ItemOutcomeInput } from "../../domain/close-week";
import { ItemDispositionChoice, ItemDispositionForm } from "./weekly-session-view";

export interface PlanItemSummary {
  itemId: string;
  title: string;
  source: string;
  estimatedHours?: number | null;
  rationale?: string;
  dueDate?: string;
}

export interface WeeklyReflectiveClosingSectionProps {
  plan: StoredWeeklyPlan | null;
  isEarlyCloseConfirmed: boolean;
  setIsEarlyCloseConfirmed: (val: boolean) => void;
  onNavigateSpace?: (space: "capture" | "prepare" | "active" | "review") => void;
  closeStep: "dispositions" | "reflection";
  setCloseStep: (val: "dispositions" | "reflection") => void;
  planItems: PlanItemSummary[];
  dispositions: Record<string, ItemDispositionForm>;
  handleDispositionChange: (itemId: string, status: ItemDispositionChoice) => void;
  handlePostponementReasonChange: (itemId: string, reason: string) => void;
  reflectionNotes: string;
  setReflectionNotes: (val: string) => void;
  closeWeek: (input: {
    planId: string;
    closedAt: string;
    itemOutcomes: ItemOutcomeInput[];
    userReflection?: { generalNotes: string };
  }) => Promise<{ status: string }>;
  setFeedbackMessage: (msg: string | null) => void;
}

export function WeeklyReflectiveClosingSection({
  plan,
  isEarlyCloseConfirmed,
  setIsEarlyCloseConfirmed,
  onNavigateSpace,
  closeStep,
  setCloseStep,
  planItems,
  dispositions,
  handleDispositionChange,
  handlePostponementReasonChange,
  reflectionNotes,
  setReflectionNotes,
  closeWeek,
  setFeedbackMessage,
}: WeeklyReflectiveClosingSectionProps) {
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
}
