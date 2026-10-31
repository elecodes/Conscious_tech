import { ProposedWeek, TargetWeek } from "../../domain/week";
import { ExtractedItem } from "../../domain/items";
import { buildGoogleCalendarTemplateUrl } from "../../domain/calendar";
import { formatCommitmentType } from "../labels";

export interface PlanningProposedItemsSectionProps {
  proposedWeek: ProposedWeek;
  activeTargetWeek: TargetWeek;
  extractedItems: ExtractedItem[] | null;
  editingProposalItemId: string | null;
  proposalItemHoursInput: string;
  setEditingProposalItemId: (id: string | null) => void;
  setProposalItemHoursInput: (val: string) => void;
  handleDemoteFocusToFlexible: (focusId: string) => void;
  handlePromoteFlexibleToFocus: (itemId: string) => void;
  handleSaveProposalItemHours: (itemId: string, hours: number | null) => void;
}

export function PlanningProposedItemsSection({
  proposedWeek,
  activeTargetWeek,
  extractedItems,
  editingProposalItemId,
  proposalItemHoursInput,
  setEditingProposalItemId,
  setProposalItemHoursInput,
  handleDemoteFocusToFlexible,
  handlePromoteFlexibleToFocus,
  handleSaveProposalItemHours,
}: PlanningProposedItemsSectionProps) {
  return (
    <>
      {/* Weekly Foci */}
      {proposedWeek.foci.length > 0 && (
        <div style={{ marginTop: "24px" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              flexWrap: "wrap",
              gap: "8px",
              marginBottom: "4px",
            }}
          >
            <h4
              style={{
                margin: 0,
                display: "flex",
                alignItems: "center",
                gap: "8px",
                fontSize: "1.25rem",
              }}
            >
              <span>🔖</span> Tus {proposedWeek.foci.length} Focos de Atención
            </h4>
            <span
              style={{
                fontFamily: "var(--font-serif)",
                fontStyle: "italic",
                fontSize: "0.85rem",
                color: "var(--text-muted)",
              }}
            >
              donde reside mi mente
            </span>
          </div>
          <span
            className="calm-muted"
            style={{ fontSize: "0.82rem", display: "block", marginBottom: "14px" }}
          >
            Focos principales ({proposedWeek.foci.length})
          </span>

          <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
            {proposedWeek.foci.map((focus, idx) => {
              const isRecoveryFocus = focus.id.startsWith("focus-recovery-");
              const focusItem = isRecoveryFocus
                ? extractedItems?.find((i) => focus.contributingItemIds.includes(i.id))
                : undefined;
              const originalDueDate = focusItem?.deadline?.resolved;
              const romanNumerals = ["I", "II", "III", "IV", "V", "VI", "VII"];
              const romanLabel = romanNumerals[idx] || String(idx + 1);

              return (
                <div
                  key={focus.id}
                  className="item-card"
                  style={{
                    padding: "18px 20px",
                    background: isRecoveryFocus ? "#fffdf5" : "var(--surface-color, #ffffff)",
                    borderColor: isRecoveryFocus ? "#fef08a" : "var(--border-color, #e6ded1)",
                  }}
                  data-testid={`proposed-focus-${focus.id}`}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: "10px",
                      flexWrap: "wrap",
                      gap: "6px",
                    }}
                  >
                    <span
                      className="badge"
                      style={{
                        background: "#edf3ee",
                        color: "#2d4233",
                        border: "1px solid #c8d9cc",
                        fontWeight: 600,
                      }}
                    >
                      FOCO {romanLabel}
                      {focus.estimatedHours !== null ? ` · ${focus.estimatedHours}H` : ""}
                    </span>
                    <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                      <button
                        type="button"
                        className="secondary small"
                        data-testid={`focus-add-to-gcal-${focus.id}`}
                        style={{
                          fontSize: "0.78rem",
                          padding: "2px 8px",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "4px",
                        }}
                        title="Abrir y guardar en Google Calendar con 1 clic"
                        onClick={() => {
                          const gcalUrl = buildGoogleCalendarTemplateUrl({
                            title: focus.title,
                            day: activeTargetWeek.startDate,
                            durationHours: focus.estimatedHours || 2,
                            description: `Foco semanal\nResultado deseado: ${focus.desiredOutcome}\nFundamentación: ${focus.rationale}`,
                          });
                          window.open(gcalUrl, "_blank", "noopener,noreferrer");
                        }}
                      >
                        <span>📅</span>
                        <span>Google Cal</span>
                      </button>
                      {isRecoveryFocus && (
                        <span className="badge badge-warning" data-testid="recovery-focus-badge">
                          Prioridad de recuperación
                        </span>
                      )}
                      {focus.estimatedHours !== null && (
                        <span className="badge badge-muted">{focus.estimatedHours}h</span>
                      )}
                    </div>
                  </div>

                  <h4 style={{ margin: "2px 0 8px", fontSize: "1.2rem", lineHeight: 1.35 }}>
                    {focus.title}
                  </h4>

                  {isRecoveryFocus && originalDueDate && (
                    <div
                      className="calm-muted"
                      style={{ fontSize: "0.8rem", marginTop: "2px", color: "#b45309" }}
                      data-testid={`focus-original-deadline-${focus.id}`}
                    >
                      📅 Fecha límite original: <strong>{originalDueDate}</strong> (vencida antes
                      del inicio de la semana)
                    </div>
                  )}

                  <div className="inner-note-box">
                    <div className="inner-note-label">
                      <span>✏️</span> PASO INMEDIATO:
                    </div>
                    <div style={{ fontSize: "0.95rem" }}>
                      <strong>Resultado deseado:</strong> {focus.desiredOutcome}
                    </div>
                  </div>

                  <div
                    className="calm-muted"
                    style={{ fontSize: "0.82rem", marginTop: "10px", fontStyle: "italic" }}
                  >
                    <em>Fundamentación:</em> {focus.rationale}
                  </div>

                  {/* Actions on Focus */}
                  <div
                    style={{
                      display: "flex",
                      gap: "8px",
                      marginTop: "12px",
                      flexWrap: "wrap",
                      alignItems: "center",
                    }}
                  >
                    <button
                      type="button"
                      className="secondary small"
                      onClick={() => handleDemoteFocusToFlexible(focus.id)}
                      data-testid={`demote-focus-to-flexible-${focus.id}`}
                    >
                      ↩ Mover a opción flexible
                    </button>
                    <button
                      type="button"
                      className="secondary small"
                      onClick={() => {
                        setEditingProposalItemId(focus.id);
                        setProposalItemHoursInput(
                          focus.estimatedHours !== null ? String(focus.estimatedHours) : ""
                        );
                      }}
                      data-testid={`adjust-focus-hours-${focus.id}`}
                    >
                      ⏱️ Ajustar horas
                    </button>
                  </div>

                  {/* Inline Hours Editor */}
                  {editingProposalItemId === focus.id && (
                    <div
                      style={{
                        display: "flex",
                        gap: "8px",
                        alignItems: "center",
                        marginTop: "10px",
                        background: "#f0f4f8",
                        padding: "8px 12px",
                        borderRadius: "4px",
                        flexWrap: "wrap",
                      }}
                    >
                      <label style={{ fontSize: "0.82rem", fontWeight: 500, color: "#374151" }}>
                        Horas estimadas:
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="0.5"
                        value={proposalItemHoursInput}
                        onChange={(e) => setProposalItemHoursInput(e.target.value)}
                        placeholder="Ej: 4"
                        style={{ width: "80px", padding: "4px 8px", fontSize: "0.85rem" }}
                        data-testid={`input-hours-${focus.id}`}
                      />
                      <button
                        type="button"
                        className="primary small"
                        onClick={() => {
                          const val =
                            proposalItemHoursInput.trim() !== ""
                              ? Number(proposalItemHoursInput)
                              : null;
                          handleSaveProposalItemHours(focus.id, val);
                        }}
                        data-testid={`save-hours-${focus.id}`}
                      >
                        Guardar
                      </button>
                      <button
                        type="button"
                        className="secondary small"
                        onClick={() => {
                          setEditingProposalItemId(null);
                          setProposalItemHoursInput("");
                        }}
                      >
                        Cancelar
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Weekly Obligations */}
      {proposedWeek.obligations.length > 0 && (
        <div style={{ marginTop: "16px" }}>
          <h5 style={{ margin: "0 0 8px 0" }}>
            Obligaciones y compromisos ({proposedWeek.obligations.length})
          </h5>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {proposedWeek.obligations.map((ob) => (
              <div
                key={ob.itemId}
                className="item-card"
                style={{ padding: "8px 12px", background: "#fbfbfb" }}
                data-testid={`proposed-obligation-${ob.itemId}`}
              >
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <strong>{ob.title}</strong>
                  <span className="badge badge-commitment">
                    {formatCommitmentType(ob.commitmentType)}
                  </span>
                </div>
                {ob.dueDate && (
                  <div className="calm-text" style={{ fontSize: "0.85rem", marginTop: "2px" }}>
                    📅 Fecha límite: {ob.dueDate}
                  </div>
                )}
                {ob.estimatedHours !== null && (
                  <div className="calm-muted" style={{ fontSize: "0.8rem" }}>
                    Estimado: {ob.estimatedHours}h
                  </div>
                )}

                {/* Actions on Obligation */}
                <div
                  style={{
                    display: "flex",
                    gap: "8px",
                    marginTop: "8px",
                    flexWrap: "wrap",
                    alignItems: "center",
                  }}
                >
                  <button
                    type="button"
                    className="secondary small"
                    onClick={() => {
                      setEditingProposalItemId(ob.itemId);
                      setProposalItemHoursInput(
                        ob.estimatedHours !== null ? String(ob.estimatedHours) : ""
                      );
                    }}
                    data-testid={`adjust-obligation-hours-${ob.itemId}`}
                  >
                    ⏱️ Ajustar horas
                  </button>
                  <button
                    type="button"
                    className="secondary small"
                    data-testid={`obligation-add-to-gcal-${ob.itemId}`}
                    style={{
                      fontSize: "0.8rem",
                      padding: "3px 8px",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "4px",
                    }}
                    title="Abrir y guardar en Google Calendar con 1 clic"
                    onClick={() => {
                      const gcalUrl = buildGoogleCalendarTemplateUrl({
                        title: ob.title,
                        day: ob.dueDate || activeTargetWeek.startDate,
                        durationHours: ob.estimatedHours || 1,
                        description: `Compromiso semanal (${formatCommitmentType(ob.commitmentType)})\nFundamentación: ${ob.rationale}`,
                      });
                      window.open(gcalUrl, "_blank", "noopener,noreferrer");
                    }}
                  >
                    <span>📅</span>
                    <span>Google Cal</span>
                  </button>
                </div>

                {/* Inline Hours Editor */}
                {editingProposalItemId === ob.itemId && (
                  <div
                    style={{
                      display: "flex",
                      gap: "8px",
                      alignItems: "center",
                      marginTop: "8px",
                      background: "#f0f4f8",
                      padding: "8px 12px",
                      borderRadius: "4px",
                      flexWrap: "wrap",
                    }}
                  >
                    <label style={{ fontSize: "0.82rem", fontWeight: 500, color: "#374151" }}>
                      Horas estimadas:
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="0.5"
                      value={proposalItemHoursInput}
                      onChange={(e) => setProposalItemHoursInput(e.target.value)}
                      placeholder="Ej: 2"
                      style={{ width: "80px", padding: "4px 8px", fontSize: "0.85rem" }}
                      data-testid={`input-hours-${ob.itemId}`}
                    />
                    <button
                      type="button"
                      className="primary small"
                      onClick={() => {
                        const val =
                          proposalItemHoursInput.trim() !== ""
                            ? Number(proposalItemHoursInput)
                            : null;
                        handleSaveProposalItemHours(ob.itemId, val);
                      }}
                      data-testid={`save-hours-${ob.itemId}`}
                    >
                      Guardar
                    </button>
                    <button
                      type="button"
                      className="secondary small"
                      onClick={() => {
                        setEditingProposalItemId(null);
                        setProposalItemHoursInput("");
                      }}
                    >
                      Cancelar
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Weekly Flexible Options */}
      {proposedWeek.flexibleOptions.length > 0 && (
        <div style={{ marginTop: "16px" }} data-testid="proposed-flexible-options-section">
          <h5 style={{ margin: "0 0 8px 0" }}>
            Opciones flexibles ({proposedWeek.flexibleOptions.length})
          </h5>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {proposedWeek.flexibleOptions.map((opt) => (
              <div
                key={opt.itemId}
                className="item-card"
                style={{ padding: "8px 12px", background: "#fbfbfb" }}
                data-testid={`proposed-flexible-item-${opt.itemId}`}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "baseline",
                    flexWrap: "wrap",
                    gap: "6px",
                  }}
                >
                  <strong>{opt.title}</strong>
                  <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                    <span className="badge badge-idea">Flexible</span>
                    {opt.estimatedHours !== null && (
                      <span className="badge badge-muted">{opt.estimatedHours}h</span>
                    )}
                  </div>
                </div>
                {opt.condition && (
                  <div className="calm-muted" style={{ fontSize: "0.8rem", marginTop: "2px" }}>
                    <em>Condición:</em> {opt.condition}
                  </div>
                )}

                {/* Actions on Flexible Option */}
                <div
                  style={{
                    display: "flex",
                    gap: "8px",
                    marginTop: "10px",
                    flexWrap: "wrap",
                    alignItems: "center",
                  }}
                >
                  <button
                    type="button"
                    className="primary small"
                    onClick={() => handlePromoteFlexibleToFocus(opt.itemId)}
                    data-testid={`promote-flexible-to-focus-${opt.itemId}`}
                    disabled={proposedWeek.foci.length >= 3}
                    title={
                      proposedWeek.foci.length >= 3
                        ? "Límite máximo de 3 focos alcanzado"
                        : "Elegir como foco principal de la semana"
                    }
                  >
                    ⭐ Elegir como foco
                  </button>
                  <button
                    type="button"
                    className="secondary small"
                    onClick={() => {
                      setEditingProposalItemId(opt.itemId);
                      setProposalItemHoursInput(
                        opt.estimatedHours !== null ? String(opt.estimatedHours) : ""
                      );
                    }}
                    data-testid={`adjust-flexible-hours-${opt.itemId}`}
                  >
                    ⏱️ Ajustar horas
                  </button>
                  <button
                    type="button"
                    className="secondary small"
                    data-testid={`flexible-add-to-gcal-${opt.itemId}`}
                    style={{
                      fontSize: "0.8rem",
                      padding: "3px 8px",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "4px",
                    }}
                    title="Abrir y guardar en Google Calendar con 1 clic"
                    onClick={() => {
                      const gcalUrl = buildGoogleCalendarTemplateUrl({
                        title: opt.title,
                        day: activeTargetWeek.startDate,
                        durationHours: opt.estimatedHours || 1,
                        description: `Opción flexible${opt.condition ? `\nCondición: ${opt.condition}` : ""}`,
                      });
                      window.open(gcalUrl, "_blank", "noopener,noreferrer");
                    }}
                  >
                    <span>📅</span>
                    <span>Google Cal</span>
                  </button>
                </div>

                {/* Inline Hours Editor */}
                {editingProposalItemId === opt.itemId && (
                  <div
                    style={{
                      display: "flex",
                      gap: "8px",
                      alignItems: "center",
                      marginTop: "8px",
                      background: "#f0f4f8",
                      padding: "8px 12px",
                      borderRadius: "4px",
                      flexWrap: "wrap",
                    }}
                  >
                    <label style={{ fontSize: "0.82rem", fontWeight: 500, color: "#374151" }}>
                      Horas estimadas:
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="0.5"
                      value={proposalItemHoursInput}
                      onChange={(e) => setProposalItemHoursInput(e.target.value)}
                      placeholder="Ej: 2"
                      style={{ width: "80px", padding: "4px 8px", fontSize: "0.85rem" }}
                      data-testid={`input-hours-${opt.itemId}`}
                    />
                    <button
                      type="button"
                      className="primary small"
                      onClick={() => {
                        const val =
                          proposalItemHoursInput.trim() !== ""
                            ? Number(proposalItemHoursInput)
                            : null;
                        handleSaveProposalItemHours(opt.itemId, val);
                      }}
                      data-testid={`save-hours-${opt.itemId}`}
                    >
                      Guardar
                    </button>
                    <button
                      type="button"
                      className="secondary small"
                      onClick={() => {
                        setEditingProposalItemId(null);
                        setProposalItemHoursInput("");
                      }}
                    >
                      Cancelar
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
