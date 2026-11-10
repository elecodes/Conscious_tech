import { ProposedWeek, TargetWeek } from "../../domain/week";
import { PipelineDiagnostic } from "../../application/planning-pipeline";
import { PlanningConfirmationSummary } from "./planning-confirmation-summary";

export interface PlanningProposalReviewFooterProps {
  proposedWeek: ProposedWeek;
  diagnostics: PipelineDiagnostic[];
  activePlanConflict: {
    existingActivePlanId: string;
    targetWeek: TargetWeek;
  } | null;
  setActivePlanConflict: (val: null) => void;
  onPlanCreated?: () => void;
  confirmationError: string | null;
  isConfirming: boolean;
  handleAdjustElements: () => void;
  setIsReviewingSelection: (val: boolean) => void;
  handleStartFreshWeek: () => void;
  handleConfirmPlan: () => void;
}

export function PlanningProposalReviewFooter({
  proposedWeek,
  diagnostics,
  activePlanConflict,
  setActivePlanConflict,
  onPlanCreated,
  confirmationError,
  isConfirming,
  handleAdjustElements,
  setIsReviewingSelection,
  handleStartFreshWeek,
  handleConfirmPlan,
}: PlanningProposalReviewFooterProps) {
  return (
    <>
      {/* Confirmation Prompt & Key Tradeoffs */}
      {(() => {
        if (!proposedWeek.confirmationPrompt) return null;
        const hasKeyTradeoffs = proposedWeek.confirmationPrompt.keyTradeoffs.length > 0;
        const hasPendingQuestions = Boolean(
          proposedWeek.confirmationPrompt.pendingQuestions &&
          proposedWeek.confirmationPrompt.pendingQuestions.length > 0
        );
        const isCustomQuestion =
          Boolean(proposedWeek.confirmationPrompt.question) &&
          proposedWeek.confirmationPrompt.question.trim().length > 0 &&
          proposedWeek.confirmationPrompt.question !==
            "¿Te representa esta propuesta para estructurar la semana?";

        // Hide technical box unless it carries actual content
        if (!hasKeyTradeoffs && !hasPendingQuestions && !isCustomQuestion) {
          return null;
        }

        return (
          <div
            className="calm-box"
            style={{
              marginTop: "20px",
              padding: "16px 18px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
              <span style={{ fontSize: "1.1rem" }}>💡</span>
              <h4 style={{ margin: 0, fontSize: "1.05rem" }}>Revisión del plan</h4>
            </div>
            <p className="calm-text" style={{ fontWeight: 500, margin: "4px 0" }}>
              {proposedWeek.confirmationPrompt.question}
            </p>
            {hasKeyTradeoffs && (
              <div style={{ marginTop: "8px" }}>
                <span style={{ fontSize: "0.85rem", fontWeight: 600 }}>
                  Puntos a tener en cuenta:
                </span>
                <ul style={{ margin: "4px 0 0 16px", fontSize: "0.85rem", color: "#444" }}>
                  {proposedWeek.confirmationPrompt.keyTradeoffs.map((tradeoff, idx) => (
                    <li key={idx}>{tradeoff}</li>
                  ))}
                </ul>
              </div>
            )}
            {hasPendingQuestions && (
              <div style={{ marginTop: "8px" }}>
                <span style={{ fontSize: "0.85rem", fontWeight: 600 }}>Preguntas pendientes:</span>
                <ul style={{ margin: "4px 0 0 16px", fontSize: "0.85rem", color: "#444" }}>
                  {proposedWeek.confirmationPrompt.pendingQuestions?.map((q, idx) => (
                    <li key={idx}>{q}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        );
      })()}

      {(() => {
        const fallbackWarnings = diagnostics.filter((diag) => diag.status === "fallback_used");
        if (fallbackWarnings.length === 0) return null;
        return (
          <details
            className="status-message status-warning calm-details"
            style={{
              marginTop: "16px",
              background: "var(--color-bg-warning, #fffbeb)",
              border: "1px solid var(--color-border-warning, #fef3c7)",
              padding: "10px 14px",
              borderRadius: "6px",
              color: "var(--color-text-warning, #92400e)",
            }}
            role="status"
            aria-label="Avisos sobre la propuesta semanal"
          >
            <summary style={{ fontWeight: 600, cursor: "pointer", userSelect: "none" }}>
              Avisos en la preparación de la propuesta ({fallbackWarnings.length})
            </summary>
            <ul style={{ margin: "8px 0 0 0", paddingLeft: "20px", fontSize: "0.85rem" }}>
              {fallbackWarnings.map((diag, idx) => (
                <li key={idx}>
                  <strong>{diag.stage}:</strong>{" "}
                  {diag.fallbackRationale || diag.sanitizedError || "Fallback aplicado"}
                </li>
              ))}
            </ul>
          </details>
        );
      })()}

      {activePlanConflict && (
        <div
          className="calm-box"
          style={{
            marginTop: "16px",
            background: "#eff6ff",
            border: "1px solid #bfdbfe",
            borderRadius: "8px",
            padding: "16px",
          }}
          data-testid="active-plan-conflict-transition"
        >
          <h4 style={{ margin: "0 0 8px 0", color: "#1e40af" }}>
            🗓️ Propuesta guardada como borrador futuro
          </h4>
          <p style={{ margin: "0 0 8px 0", fontSize: "0.9rem", color: "#1e3a8a" }}>
            Ya tienes una semana activa en curso (
            <code>{activePlanConflict.existingActivePlanId}</code>). Para proteger tu claridad
            mental y no saturar tu atención con múltiples agendas simultáneas,{" "}
            <strong>solo puede haber una semana activa a la vez</strong>.
          </p>
          <p style={{ margin: "0 0 12px 0", fontSize: "0.85rem", color: "#2563eb" }}>
            Tu planificación para la semana del{" "}
            <strong>{activePlanConflict.targetWeek.startDate}</strong> al{" "}
            <strong>{activePlanConflict.targetWeek.endDate}</strong> está guardada de forma segura
            como borrador en tu cuaderno local (almacenamiento en este dispositivo). Puedes volver a
            verla y ajustarla en cualquier momento desde esta pestaña (<strong>Nueva semana</strong>
            ). En cuanto completes el cierre de semana de tu semana actual, podrás activarla
            directamente.
          </p>
          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
            <button
              type="button"
              className="primary small"
              onClick={() => {
                setActivePlanConflict(null);
                if (onPlanCreated) onPlanCreated();
              }}
              data-testid="dismiss-conflict-transition-button"
            >
              Entendido, volver a la semana activa
            </button>
            <button
              type="button"
              className="secondary small"
              onClick={() => setActivePlanConflict(null)}
              data-testid="keep-editing-draft-button"
            >
              Seguir editando este borrador
            </button>
          </div>
        </div>
      )}

      {confirmationError && (
        <div className="status-message status-error" style={{ marginTop: "16px" }} role="alert">
          <strong>No se pudo activar la semana:</strong> {confirmationError}
        </div>
      )}

      <PlanningConfirmationSummary proposal={proposedWeek} />
      <p className="calm-muted activation-explanation" id="activation-explanation">
        Al activar, guardas esta propuesta en este navegador y pasa a ser tu semana activa. Después
        podrás exportarla o compartirla desde Mi semana.
      </p>
      <div className="confirmation-actions">
        <button
          type="button"
          className="primary"
          aria-label="Confirmar y activar semana"
          aria-describedby="activation-explanation"
          disabled={isConfirming}
          onClick={handleConfirmPlan}
          data-testid="confirm-plan-button"
        >
          {isConfirming ? "Guardando semana..." : "✓ Confirmar y activar semana"}
        </button>
      </div>
      <details className="calm-details" data-testid="proposal-more-actions-details">
        <summary data-testid="proposal-more-actions-summary">⚙️ Más acciones</summary>
        <div className="confirmation-secondary-actions">
          <button
            type="button"
            className="secondary small"
            disabled={isConfirming}
            aria-label="Volver a revisar la intención y los elementos"
            onClick={handleAdjustElements}
            data-testid="adjust-elements-button"
          >
            Editar intención o elementos
          </button>
          <button
            type="button"
            className="secondary small"
            disabled={isConfirming}
            aria-label="Añadir más ideas o tareas a esta propuesta"
            onClick={() => setIsReviewingSelection(true)}
            data-testid="add-more-ideas-button"
          >
            Añadir más ideas
          </button>
          <button
            type="button"
            className="secondary small"
            disabled={isConfirming}
            aria-label="Comenzar otra semana desde cero"
            onClick={handleStartFreshWeek}
            data-testid="start-fresh-week-button"
          >
            Planificar otra semana
          </button>
        </div>
      </details>
    </>
  );
}
