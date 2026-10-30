import { ProposedWeek, TargetWeek } from "../../domain/week";
import { PipelineDiagnostic } from "../../application/planning-pipeline";
import { generateIcsCalendarExport } from "../../domain/calendar";

export interface PlanningProposalReviewFooterProps {
  proposedWeek: ProposedWeek;
  activeTargetWeek: TargetWeek;
  diagnostics: PipelineDiagnostic[];
  activePlanConflict: {
    existingActivePlanId: string;
    targetWeek: TargetWeek;
  } | null;
  setActivePlanConflict: (val: null) => void;
  onPlanCreated?: () => void;
  confirmationError: string | null;
  userIntent: string;
  setUserIntent: (val: string) => void;
  isConfirming: boolean;
  handleAdjustElements: () => void;
  setIsReviewingSelection: (val: boolean) => void;
  handleStartFreshWeek: () => void;
  handleConfirmPlan: () => void;
}

export function PlanningProposalReviewFooter({
  proposedWeek,
  activeTargetWeek,
  diagnostics,
  activePlanConflict,
  setActivePlanConflict,
  onPlanCreated,
  confirmationError,
  userIntent,
  setUserIntent,
  isConfirming,
  handleAdjustElements,
  setIsReviewingSelection,
  handleStartFreshWeek,
  handleConfirmPlan,
}: PlanningProposalReviewFooterProps) {
  return (
    <>
      {/* Confirmation Prompt & Key Tradeoffs */}
      {proposedWeek.confirmationPrompt && (
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
          {proposedWeek.confirmationPrompt.keyTradeoffs.length > 0 && (
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
        </div>
      )}

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
            verla y ajustarla en cualquier momento desde esta pestaña (
            <strong>2. Preparar semana</strong>). En cuanto completes el cierre reflexivo de tu
            semana actual, podrás activarla directamente.
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

      {/* Apunte a lápiz / intuición (como en el diseño) */}
      <div
        style={{
          marginTop: "20px",
          padding: "14px 16px",
          background: "var(--surface-warm, #fcfbf8)",
          border: "1px dashed var(--border-color, #e6ded1)",
          borderRadius: "10px",
        }}
      >
        <div style={{ marginBottom: "6px" }}>
          <label
            htmlFor="apunte-lapiz-input"
            style={{
              fontSize: "0.85rem",
              fontWeight: 600,
              color: "var(--text-main)",
            }}
          >
            ✏️ Notas o ajustes libres para esta semana (opcional):
          </label>
        </div>
        <textarea
          id="apunte-lapiz-input"
          rows={2}
          style={{
            width: "100%",
            padding: "8px 12px",
            fontSize: "0.9rem",
            fontFamily: "var(--font-serif)",
            background: "#ffffff",
            border: "1px solid var(--border-color)",
            borderRadius: "6px",
            boxSizing: "border-box",
            minHeight: "60px",
          }}
          placeholder="Escribe aquí si necesitas más tiempo o aligerar algo..."
          value={userIntent}
          onChange={(e) => setUserIntent(e.target.value)}
        />
      </div>

      {/* Confirmation Actions */}
      <div
        style={{
          marginTop: "20px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "10px",
        }}
      >
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <button
            type="button"
            className="secondary"
            aria-label="Volver a revisar la selección de elementos"
            disabled={isConfirming}
            onClick={handleAdjustElements}
            data-testid="adjust-elements-button"
          >
            ✏️ Ajustar elementos
          </button>
          <button
            type="button"
            className="secondary"
            aria-label="Añadir más ideas o tareas a esta propuesta"
            disabled={isConfirming}
            onClick={() => setIsReviewingSelection(true)}
            data-testid="add-more-ideas-button"
          >
            ➕ Añadir más ideas
          </button>
          <button
            type="button"
            className="secondary"
            style={{ color: "#8c8273" }}
            aria-label="Comenzar otra semana desde cero"
            disabled={isConfirming}
            onClick={handleStartFreshWeek}
            data-testid="start-fresh-week-button"
          >
            ✨ Planificar otra semana
          </button>
        </div>

        <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
          <button
            type="button"
            className="secondary"
            data-testid="proposal-export-to-gcal"
            style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
            onClick={() => {
              const exportItems = [
                ...proposedWeek.foci.map((f) => ({
                  title: f.title,
                  day: activeTargetWeek.startDate,
                  durationHours: f.estimatedHours || 2,
                  description: `Foco: ${f.desiredOutcome}`,
                })),
                ...proposedWeek.obligations.map((o) => ({
                  title: o.title,
                  day: o.dueDate || activeTargetWeek.startDate,
                  durationHours: o.estimatedHours || 1,
                  description: `Compromiso (${o.commitmentType})`,
                })),
                ...proposedWeek.flexibleOptions.map((fl) => ({
                  title: fl.title,
                  day: activeTargetWeek.startDate,
                  durationHours: fl.estimatedHours || 1,
                  description: fl.condition ? `Condición: ${fl.condition}` : "Opción flexible",
                })),
              ];
              const ics = generateIcsCalendarExport(exportItems, "Conscious Tech — Propuesta");
              const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `conscious-tech-propuesta-${activeTargetWeek.startDate}.ics`;
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              URL.revokeObjectURL(url);
            }}
          >
            <span>📅</span>
            <span>Exportar propuesta (.ics / Google Cal)</span>
          </button>

          <button
            type="button"
            className="primary"
            aria-label="Confirmar y activar semana"
            disabled={isConfirming}
            onClick={handleConfirmPlan}
            data-testid="confirm-plan-button"
          >
            {isConfirming ? "Guardando semana..." : "✓ Confirmar y activar semana"}
          </button>
        </div>
      </div>
    </>
  );
}
