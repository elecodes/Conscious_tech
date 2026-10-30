import { ExtractedItem } from "../../domain/items";
import { VoiceDictationButton } from "./voice-dictation-button";

export interface PlanningExtractedItemsReviewProps {
  extractedItems: ExtractedItem[];
  acceptedItemIds: Set<string>;
  acceptedCount: number;
  handleAcceptAll: () => void;
  handleDiscardAll: () => void;
  handleStartFreshWeek: () => void;
  handleToggleItem: (id: string) => void;
  handleUpdateItemEffort: (itemId: string, hours: number | null) => void;
  handleUpdateItemDeadline: (itemId: string, dateStr: string | null) => void;
  noteText: string;
  setNoteText: (val: string) => void;
  isExtracting: boolean;
  handleExtract: (mode: "replace" | "append") => void;
  userIntent: string;
  setUserIntent: (val: string) => void;
  availableHoursInput: string;
  setAvailableHoursInput: (val: string) => void;
  protectedSpacePercentInput: string;
  setProtectedSpacePercentInput: (val: string) => void;
  isPlanning: boolean;
  planningError: string | null;
  selectedCarryOverItemIds: Set<string>;
  handleGenerateProposal: () => void;
}

export function PlanningExtractedItemsReview({
  extractedItems,
  acceptedItemIds,
  acceptedCount,
  handleAcceptAll,
  handleDiscardAll,
  handleStartFreshWeek,
  handleToggleItem,
  handleUpdateItemEffort,
  handleUpdateItemDeadline,
  noteText,
  setNoteText,
  isExtracting,
  handleExtract,
  userIntent,
  setUserIntent,
  availableHoursInput,
  setAvailableHoursInput,
  protectedSpacePercentInput,
  setProtectedSpacePercentInput,
  isPlanning,
  planningError,
  selectedCarryOverItemIds,
  handleGenerateProposal,
}: PlanningExtractedItemsReviewProps) {
  return (
    <div
      style={{
        marginTop: "20px",
        paddingTop: "16px",
        borderTop: "1px solid var(--border-color, #e0e0e0)",
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
        <h4 style={{ margin: 0, fontSize: "1.05rem" }}>
          Elementos identificados ({acceptedCount} de {extractedItems.length} seleccionados)
        </h4>
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
          <button
            type="button"
            className="secondary small"
            style={{ fontSize: "0.82rem", padding: "3px 8px" }}
            onClick={handleAcceptAll}
          >
            Aceptar todos
          </button>
          <button
            type="button"
            className="secondary small"
            style={{ fontSize: "0.82rem", padding: "3px 8px" }}
            onClick={handleDiscardAll}
          >
            Descartar todos
          </button>
          <button
            type="button"
            className="secondary small"
            style={{ fontSize: "0.82rem", padding: "3px 8px", color: "#8c8273" }}
            onClick={handleStartFreshWeek}
            data-testid="clear-extracted-items-button"
            title="Despejar elementos actuales y empezar una nueva semana"
          >
            ✨ Limpiar elementos
          </button>
        </div>
      </div>

      <p className="calm-muted" style={{ fontSize: "0.85rem", margin: "0 0 10px 0" }}>
        Selecciona qué elementos deseas incluir en la propuesta semanal. Los no seleccionados
        se descartarán de esta planificación.
      </p>

      {extractedItems.length === 0 ? (
        <p className="calm-muted" style={{ marginTop: "12px" }}>
          No se identificaron elementos accionables en el texto. Puedes intentar expresarlo con
          más detalle.
        </p>
      ) : (
        <ul
          className="items-list"
          style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "6px" }}
          aria-label="Lista de elementos identificados"
        >
          {extractedItems.map((item) => {
            const isAccepted = acceptedItemIds.has(item.id);
            return (
              <li
                key={item.id}
                className="item-card"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  padding: "8px 12px",
                  background: isAccepted ? "var(--bg-highlight, #fdfdfd)" : "#fafafa",
                  opacity: isAccepted ? 1 : 0.6,
                  border: isAccepted
                    ? "1px solid var(--border-color, #e0ded9)"
                    : "1px dashed #d1d5db",
                  borderRadius: "6px",
                }}
              >
                <input
                  type="checkbox"
                  id={`item-check-${item.id}`}
                  checked={isAccepted}
                  onChange={() => handleToggleItem(item.id)}
                  aria-label={`Incluir elemento ${item.title}`}
                  style={{ cursor: "pointer", flexShrink: 0 }}
                />
                <div
                  style={{
                    flex: 1,
                    display: "flex",
                    flexDirection: "column",
                    gap: "6px",
                    minWidth: 0,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: "8px",
                      flexWrap: "wrap",
                    }}
                  >
                    <strong
                      style={{
                        fontSize: "0.92rem",
                        textDecoration: isAccepted ? "none" : "line-through",
                        color: isAccepted ? "inherit" : "var(--text-muted, #888)",
                      }}
                    >
                      {item.title}
                    </strong>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                      <span className={`badge badge-${item.type}`}>{item.type}</span>
                      {item.project && (
                        <span className="badge badge-muted">📁 {item.project}</span>
                      )}
                      {item.estimatedEffort && (
                        <span className="badge badge-muted">
                          ⏱ {item.estimatedEffort.value} {item.estimatedEffort.unit}
                        </span>
                      )}
                      {item.deadline && (
                        <span className="badge badge-muted" style={{ color: "#b45309" }}>
                          📅 {item.deadline.raw}{" "}
                          {item.deadline.resolved ? `(${item.deadline.resolved})` : ""}
                        </span>
                      )}
                    </div>
                  </div>

                  {isAccepted && (
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "14px",
                        flexWrap: "wrap",
                        fontSize: "0.82rem",
                        color: "var(--text-muted, #666)",
                        marginTop: "2px",
                      }}
                    >
                      <label
                        htmlFor={`item-effort-${item.id}`}
                        style={{ display: "inline-flex", alignItems: "center", gap: "5px" }}
                      >
                        <span>⏱️ Horas:</span>
                        <input
                          id={`item-effort-${item.id}`}
                          type="number"
                          min="0"
                          max="100"
                          step="0.5"
                          placeholder="Sin estimar"
                          value={item.estimatedEffort?.value ?? ""}
                          onChange={(e) => {
                            const val = e.target.value === "" ? null : Number(e.target.value);
                            handleUpdateItemEffort(item.id, val);
                          }}
                          style={{
                            width: "80px",
                            padding: "2px 6px",
                            fontSize: "0.82rem",
                            borderRadius: "4px",
                            border: "1px solid var(--border-color, #ccc)",
                            background: "var(--bg-card, #fff)",
                          }}
                          aria-label={`Horas estimadas para ${item.title}`}
                        />
                        <span>h</span>
                      </label>

                      <label
                        htmlFor={`item-deadline-${item.id}`}
                        style={{ display: "inline-flex", alignItems: "center", gap: "5px" }}
                      >
                        <span>📅 Límite / Fecha:</span>
                        <input
                          id={`item-deadline-${item.id}`}
                          type="date"
                          value={
                            item.deadline?.resolved ||
                            (item.deadline?.raw && /^\d{4}-\d{2}-\d{2}$/.test(item.deadline.raw)
                              ? item.deadline.raw
                              : "")
                          }
                          onChange={(e) => {
                            handleUpdateItemDeadline(item.id, e.target.value || null);
                          }}
                          style={{
                            padding: "2px 6px",
                            fontSize: "0.82rem",
                            borderRadius: "4px",
                            border: "1px solid var(--border-color, #ccc)",
                            background: "var(--bg-card, #fff)",
                          }}
                          aria-label={`Fecha límite para ${item.title}`}
                        />
                      </label>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* Añadir más ideas o tareas a la lista */}
      <div
        style={{
          marginTop: "16px",
          padding: "12px 14px",
          background: "#fafaf8",
          border: "1px solid var(--border-color, #e6ded1)",
          borderRadius: "8px",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px", flexWrap: "wrap", gap: "8px" }}>
          <label
            htmlFor="planning-notes-input"
            style={{ fontWeight: 600, fontSize: "0.88rem", color: "var(--text-main)" }}
          >
            ➕ ¿Quieres añadir más ideas o tareas a esta semana? (opcional)
          </label>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>
              {noteText.length} caracteres
            </span>
            <VoiceDictationButton
              getText={() => noteText}
              onTranscript={(t) => setNoteText(t)}
            />
          </div>
        </div>
        <textarea
          id="planning-notes-input"
          rows={3}
          value={noteText}
          onChange={(e) => setNoteText(e.target.value)}
          placeholder="Escribe tareas o ideas adicionales que quieras sumar a la lista de arriba..."
          style={{ width: "100%", padding: "8px 10px", fontSize: "0.88rem", boxSizing: "border-box" }}
          disabled={isExtracting}
        />
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: "8px",
            marginTop: "8px",
            flexWrap: "wrap",
          }}
        >
          <button
            type="button"
            className="secondary small"
            aria-label="Añadir nuevas ideas a la lista existente"
            disabled={isExtracting || !noteText.trim()}
            onClick={() => handleExtract("append")}
            data-testid="extract-append-button"
          >
            {isExtracting ? "Entendiendo notas..." : "➕ Añadir a la lista existente"}
          </button>
          <button
            type="button"
            className="secondary small"
            aria-label="Analizar y extraer elementos de las notas"
            disabled={isExtracting || !noteText.trim()}
            onClick={() => handleExtract("replace")}
            data-testid="extract-replace-button"
          >
            🔄 Reemplazar lista actual
          </button>
        </div>
      </div>

      {/* User Intent Input */}
      <div style={{ marginTop: "16px" }}>
        <label
          htmlFor="weekly-intent-input"
          style={{ display: "block", fontSize: "0.9rem", fontWeight: 600, marginBottom: "4px" }}
        >
          Intención o foco prioritario para la semana (opcional):
        </label>
        <input
          id="weekly-intent-input"
          type="text"
          value={userIntent}
          onChange={(e) => setUserIntent(e.target.value)}
          placeholder="Ej: Foco en cerrar entregables críticos y reservar espacio para imprevistos"
          style={{ width: "100%", padding: "8px", boxSizing: "border-box" }}
          disabled={isPlanning}
        />
      </div>

      {/* Capacity & Protected Space Configuration (Optional, for verifying viability) */}
      <div
        style={{
          marginTop: "16px",
          padding: "12px 14px",
          background: "#f9fafb",
          border: "1px solid #e5e7eb",
          borderRadius: "6px",
        }}
        data-testid="planning-capacity-pre-config"
      >
        <div style={{ fontWeight: 600, fontSize: "0.9rem", marginBottom: "4px", color: "#374151" }}>
          Límites de capacidad y espacio protegido (opcional)
        </div>
        <p className="calm-muted" style={{ fontSize: "0.82rem", margin: "0 0 10px 0" }}>
          Registra cuántas horas tienes disponibles y cuánto margen quieres proteger para comprobar la viabilidad real.
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "12px" }}>
          <div style={{ flex: "1 1 200px" }}>
            <label
              htmlFor="planning-available-hours-input"
              style={{ display: "block", fontSize: "0.82rem", fontWeight: 500, marginBottom: "4px", color: "#4b5563" }}
            >
              Horas realmente disponibles:
            </label>
            <input
              id="planning-available-hours-input"
              type="number"
              min="0"
              step="0.5"
              value={availableHoursInput}
              onChange={(e) => setAvailableHoursInput(e.target.value)}
              placeholder="Ej: 30 (deja vacío si es desconocida)"
              style={{ width: "100%", padding: "6px 10px", fontSize: "0.88rem", boxSizing: "border-box" }}
              disabled={isPlanning}
              data-testid="planning-available-hours-input"
            />
          </div>
          <div style={{ flex: "1 1 200px" }}>
            <label
              htmlFor="planning-protected-space-ratio-input"
              style={{ display: "block", fontSize: "0.82rem", fontWeight: 500, marginBottom: "4px", color: "#4b5563" }}
            >
              Espacio a proteger (% margen):
            </label>
            <input
              id="planning-protected-space-ratio-input"
              type="number"
              min="0"
              max="100"
              step="5"
              value={protectedSpacePercentInput}
              onChange={(e) => setProtectedSpacePercentInput(e.target.value)}
              placeholder="25"
              style={{ width: "100%", padding: "6px 10px", fontSize: "0.88rem", boxSizing: "border-box" }}
              disabled={isPlanning}
              data-testid="planning-protected-space-input"
            />
          </div>
        </div>
      </div>

      {planningError && (
        <div
          className="status-message status-error"
          style={{ marginTop: "12px" }}
          role="alert"
        >
          <strong>Error de planificación:</strong> {planningError}
        </div>
      )}

      <div style={{ marginTop: "16px", display: "flex", justifyContent: "flex-end" }}>
        <button
          className="primary"
          aria-label="Generar propuesta semanal con los elementos aceptados"
          disabled={isPlanning || (acceptedCount === 0 && selectedCarryOverItemIds.size === 0)}
          onClick={handleGenerateProposal}
        >
          {isPlanning
            ? "Estructurando propuesta semanal..."
            : selectedCarryOverItemIds.size > 0
            ? `Generar propuesta semanal (${acceptedCount} notas + ${selectedCarryOverItemIds.size} postergadas)`
            : `Generar propuesta semanal (${acceptedCount} elementos)`}
        </button>
      </div>
    </div>
  );
}
