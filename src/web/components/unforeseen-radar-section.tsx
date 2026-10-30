import { RadarEvaluationResult } from "../../application/radar-pipeline";
import { AdjustmentProposal } from "../../domain/adjustment";
import { VoiceDictationButton } from "./voice-dictation-button";

export interface UnforeseenRadarSectionProps {
  radarInput: string;
  setRadarInput: (val: string) => void;
  radarEvaluating: boolean;
  radarError: string | null;
  setRadarError: (val: string | null) => void;
  radarResult: RadarEvaluationResult | null;
  setRadarResult: (val: RadarEvaluationResult | null) => void;
  handleEvaluateRadar: () => void;
  handleApplyRadarAdjustment: (prop: AdjustmentProposal) => void;
  handleIncorporateRadarItems: (mode: "auto" | "flexible") => void;
  setFeedbackMessage: (msg: string | null) => void;
}

export function UnforeseenRadarSection({
  radarInput,
  setRadarInput,
  radarEvaluating,
  radarError,
  setRadarError,
  radarResult,
  setRadarResult,
  handleEvaluateRadar,
  handleApplyRadarAdjustment,
  handleIncorporateRadarItems,
  setFeedbackMessage,
}: UnforeseenRadarSectionProps) {
  return (
    <section
      className="results-section calm-box"
      style={{ marginTop: "24px" }}
      aria-label="Radar de imprevistos"
      data-testid="radar-section"
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
        <h3 style={{ margin: 0, display: "flex", alignItems: "center", gap: "8px" }}>
          <span>📡 Radar: ¿Ha aparecido algo nuevo?</span>
        </h3>
        <span className="calm-muted" style={{ fontSize: "0.82rem" }}>
          AI propone, vos decidís · No interrumpe silenciosamente
        </span>
      </div>

      <p
        className="calm-text"
        style={{ fontSize: "0.88rem", marginTop: "8px", marginBottom: "12px" }}
      >
        Expresá lo que surgió o cambió en tu semana. El Radar evalúa el impacto en tu capacidad y
        compromisos sin alterar tu semana automáticamente.
      </p>

      <div style={{ marginTop: "12px", display: "flex", flexDirection: "column", gap: "8px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "8px" }}>
          <label htmlFor="radar-input" style={{ fontSize: "0.85rem", fontWeight: 600 }}>
            Describe el nuevo evento o tarea:
          </label>
          <VoiceDictationButton
            getText={() => radarInput}
            onTranscript={(t) => setRadarInput(t)}
            disabled={radarEvaluating}
          />
        </div>
        <textarea
          className="calm-input"
          data-testid="radar-input"
          rows={3}
          placeholder="Ej: Acabo de confirmar una reunión de 2 horas para el jueves con el cliente X, o Se me ocurrió una idea para..."
          value={radarInput}
          onChange={(e) => setRadarInput(e.target.value)}
          disabled={radarEvaluating}
          style={{
            width: "100%",
            resize: "vertical",
            padding: "10px",
            borderRadius: "6px",
            fontSize: "0.9rem",
          }}
        />

        <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
          <button
            type="button"
            className="primary"
            data-testid="radar-evaluate-button"
            onClick={handleEvaluateRadar}
            disabled={radarEvaluating || !radarInput.trim()}
            style={{ padding: "8px 18px", fontWeight: 600 }}
          >
            {radarEvaluating ? "Evaluando con Radar..." : "Evaluar con Radar"}
          </button>

          {radarResult && (
            <button
              type="button"
              className="secondary"
              data-testid="radar-clear-button"
              onClick={() => {
                setRadarResult(null);
                setRadarInput("");
                setRadarError(null);
              }}
              style={{ padding: "8px 14px", fontSize: "0.85rem" }}
            >
              Limpiar consulta
            </button>
          )}
        </div>
      </div>

      {radarError && (
        <div
          className="status-message status-error"
          style={{ marginTop: "12px" }}
          role="alert"
        >
          {radarError}
        </div>
      )}

      {/* Veredicto del Radar */}
      {radarResult && (
        <div
          className="calm-box"
          data-testid="radar-verdict"
          style={{
            marginTop: "16px",
            padding: "16px",
            borderRadius: "8px",
            border:
              radarResult.outcome === "changes_balance"
                ? "1px solid #f87171"
                : radarResult.outcome === "flexible_option"
                ? "1px solid #fbbf24"
                : "1px solid #86efac",
            background:
              radarResult.outcome === "changes_balance"
                ? "#fff5f5"
                : radarResult.outcome === "flexible_option"
                ? "#fffdf5"
                : "#f0fdf4",
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
            <h4 style={{ margin: 0, fontSize: "1rem", color: "#1f2937" }}>
              {radarResult.verdictTitle}
            </h4>
            <span
              className={
                radarResult.outcome === "changes_balance"
                  ? "badge badge-concern"
                  : radarResult.outcome === "flexible_option"
                  ? "badge badge-idea"
                  : "badge badge-task"
              }
              data-testid="radar-verdict-badge"
            >
              {radarResult.outcome === "no_change" && "🟢 No cambia la semana"}
              {radarResult.outcome === "flexible_option" && "🟡 Opción flexible"}
              {radarResult.outcome === "fits_available_space" && "🟢 Cabe en el espacio"}
              {radarResult.outcome === "changes_balance" && "🔴 Cambia el equilibrio"}
            </span>
          </div>

          <p
            className="calm-text"
            style={{ fontSize: "0.88rem", margin: "4px 0 12px 0", color: "#374151" }}
          >
            {radarResult.verdictExplanation}
          </p>

          {/* Elementos identificados */}
          {radarResult.extractedItems.length > 0 && (
            <div
              style={{
                marginTop: "10px",
                padding: "10px",
                background: "rgba(255,255,255,0.7)",
                borderRadius: "6px",
              }}
              data-testid="radar-extracted-items"
            >
              <span style={{ fontSize: "0.8rem", fontWeight: 600, color: "#4b5563" }}>
                Elementos identificados por el Radar:
              </span>
              <ul style={{ margin: "6px 0 0 18px", padding: 0, fontSize: "0.85rem" }}>
                {radarResult.extractedItems.map((item) => (
                  <li key={item.id}>
                    <strong>{item.title}</strong>
                    {item.estimatedEffort && (
                      <span className="calm-muted">
                        {" "}
                        ({item.estimatedEffort.value} {item.estimatedEffort.unit})
                      </span>
                    )}
                    {item.deadline?.resolved && (
                      <span className="calm-muted"> · Vence: {item.deadline.resolved}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Si cambia el equilibrio: alternativas de ajuste propuestas */}
          {radarResult.outcome === "changes_balance" &&
            radarResult.adjustmentProposals &&
            radarResult.adjustmentProposals.length > 0 && (
              <div style={{ marginTop: "14px" }} data-testid="radar-proposals-list">
                <h5 style={{ margin: "0 0 8px 0", fontSize: "0.9rem", color: "#991b1b" }}>
                  Alternativas propuestas por la IA (vos elegís):
                </h5>
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  {radarResult.adjustmentProposals.map((prop, idx) => (
                    <div
                      key={prop.id || idx}
                      style={{
                        padding: "12px",
                        background: "#ffffff",
                        border: "1px solid #fca5a5",
                        borderRadius: "6px",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        flexWrap: "wrap",
                        gap: "8px",
                      }}
                      data-testid={`radar-proposal-${prop.id}`}
                    >
                      <div style={{ flex: 1, minWidth: "220px" }}>
                        <div style={{ fontWeight: 600, fontSize: "0.88rem" }}>
                          {prop.title}
                        </div>
                        <div
                          className="calm-muted"
                          style={{ fontSize: "0.82rem", marginTop: "2px" }}
                        >
                          {prop.explanation}
                        </div>
                      </div>
                      <button
                        type="button"
                        className="secondary small"
                        data-testid={`apply-radar-proposal-${prop.id}`}
                        onClick={() => handleApplyRadarAdjustment(prop)}
                        style={{ padding: "6px 12px", fontSize: "0.82rem", fontWeight: 600 }}
                      >
                        Aplicar este ajuste
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

          {/* Acciones para veredictos */}
          {radarResult.outcome === "fits_available_space" && (
            <div style={{ marginTop: "14px", display: "flex", gap: "10px", flexWrap: "wrap" }}>
              <button
                type="button"
                className="primary small"
                data-testid="radar-add-to-week-button"
                onClick={() => handleIncorporateRadarItems("auto")}
                style={{ padding: "8px 14px", fontWeight: 600 }}
              >
                Añadir a mi semana
              </button>
              <button
                type="button"
                className="secondary small"
                data-testid="radar-add-as-flexible-button"
                onClick={() => handleIncorporateRadarItems("flexible")}
                style={{ padding: "8px 14px" }}
              >
                Añadir como opciones flexibles
              </button>
              <button
                type="button"
                className="secondary small"
                data-testid="radar-cancel-button"
                onClick={() => {
                  setRadarResult(null);
                  setRadarInput("");
                }}
                style={{ padding: "8px 14px" }}
              >
                Descartar
              </button>
            </div>
          )}

          {radarResult.outcome === "flexible_option" && (
            <div style={{ marginTop: "14px", display: "flex", gap: "10px", flexWrap: "wrap" }}>
              <button
                type="button"
                className="primary small"
                data-testid="radar-add-flexible-button"
                onClick={() => handleIncorporateRadarItems("flexible")}
                style={{ padding: "8px 14px", fontWeight: 600 }}
              >
                Añadir como opción flexible
              </button>
              <button
                type="button"
                className="secondary small"
                data-testid="radar-cancel-button"
                onClick={() => {
                  setRadarResult(null);
                  setRadarInput("");
                }}
                style={{ padding: "8px 14px" }}
              >
                Descartar
              </button>
            </div>
          )}

          {radarResult.outcome === "no_change" && (
            <div style={{ marginTop: "12px", display: "flex", gap: "8px" }}>
              <button
                type="button"
                className="secondary small"
                data-testid="radar-dismiss-button"
                onClick={() => {
                  setFeedbackMessage("Novedad archivada sin alterar la semana.");
                  setRadarResult(null);
                  setRadarInput("");
                }}
              >
                Entendido / Descartar aviso
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
