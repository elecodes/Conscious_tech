import { WeeklySchedule } from "../../domain/schedule";
import { StoredWeeklyPlan } from "../../domain/repositories/types";
import { SuggestedAdjustmentAction } from "../../domain/adjustment";
import { getWeekDays } from "./weekly-session-formatters";
import { PlanItemSummary } from "./weekly-reflective-closing-section";

export interface ActiveWeekAdjustmentPanelProps {
  schedule: WeeklySchedule;
  plan: StoredWeeklyPlan | null;
  planItems: PlanItemSummary[];
  selectedAdjustmentItemId: string;
  setSelectedAdjustmentItemId: (val: string) => void;
  isAdjustmentOpen: boolean;
  setIsAdjustmentOpen: (val: boolean) => void;
  lastSavedAdjustment: string | null;
  setLastSavedAdjustment: (val: string | null) => void;
  targetWeekStart: string;
  setTargetWeekStart: (val: string) => void;
  targetWeekEnd: string;
  setTargetWeekEnd: (val: string) => void;
  deadlineInput: string;
  setDeadlineInput: (val: string) => void;
  taskHoursInput: string;
  setTaskHoursInput: (val: string) => void;
  taskDayInput: string;
  setTaskDayInput: (val: string) => void;
  isAdjustmentPreviewOpen: boolean;
  setIsAdjustmentPreviewOpen: (val: boolean) => void;
  handleSaveTaskAdjustment: (itemId: string, title: string) => void;
  applyAdjustment: (input: any) => Promise<any>;
  setFeedbackMessage: (msg: string | null) => void;
}

export function ActiveWeekAdjustmentPanel({
  schedule,
  plan,
  planItems,
  selectedAdjustmentItemId,
  setSelectedAdjustmentItemId,
  isAdjustmentOpen,
  setIsAdjustmentOpen,
  lastSavedAdjustment,
  targetWeekStart,
  setTargetWeekStart,
  targetWeekEnd,
  setTargetWeekEnd,
  deadlineInput,
  setDeadlineInput,
  taskHoursInput,
  setTaskHoursInput,
  taskDayInput,
  setTaskDayInput,
  isAdjustmentPreviewOpen,
  setIsAdjustmentPreviewOpen,
  handleSaveTaskAdjustment,
  applyAdjustment,
  setFeedbackMessage,
}: ActiveWeekAdjustmentPanelProps) {
  return (
    <>
      {lastSavedAdjustment && !isAdjustmentOpen && (
        <div
          className="calm-box"
          style={{
            marginTop: "16px",
            padding: "12px 16px",
            background: "#f0f7f2",
            border: "1px solid #cce3d4",
            borderRadius: "8px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: "8px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ color: "#2d6a4f", fontWeight: 600, fontSize: "1.1rem" }}>✓</span>
            <span style={{ fontSize: "0.88rem", color: "#1e4620" }}>{lastSavedAdjustment}</span>
          </div>
          <button
            type="button"
            className="secondary small"
            style={{ fontSize: "0.8rem", padding: "4px 10px" }}
            onClick={() => setIsAdjustmentOpen(true)}
          >
            Ajustar otra tarea
          </button>
        </div>
      )}

      {/* Adjustments simulation / Human Decision */}
      <details
        className="calm-box calm-details"
        style={{ marginTop: "16px" }}
        data-testid="adjustment-proposal-box"
        id="adjustment-proposal-box"
        open={isAdjustmentOpen}
        onToggle={(e) => setIsAdjustmentOpen(e.currentTarget.open)}
      >
        <summary
          style={{
            cursor: "pointer",
            padding: "4px 0",
            fontWeight: 600,
            fontSize: "0.95rem",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            userSelect: "none",
          }}
        >
          <span>⚙️ Ajustar tarea u horas</span>
          <span style={{ fontSize: "0.82rem", color: "var(--accent-color, #2b6cb0)" }}>
            {isAdjustmentOpen ? "Ocultar panel" : "Abrir ajustes"}
          </span>
        </summary>

        <div style={{ marginTop: "12px" }}>
          <p className="calm-muted" style={{ fontSize: "0.84rem", marginBottom: "14px" }}>
            Elige una tarea para definir sus horas o programarla en un día específico.
          </p>

          {planItems.length === 0 ? (
            <p className="calm-muted">No hay tareas identificadas en el plan para ajustar.</p>
          ) : (
            (() => {
              const effectiveItemId = selectedAdjustmentItemId || planItems[0]?.itemId || "";
              const selectedItem =
                planItems.find((i) => i.itemId === effectiveItemId) || planItems[0];

              const effectiveDeadline =
                deadlineInput.trim() ||
                selectedItem?.dueDate ||
                (selectedItem?.title.toLowerCase().includes("informe") ? "2026-10-15" : "");

              const isDeadlineOverdue = Boolean(
                effectiveDeadline && effectiveDeadline < targetWeekStart
              );

              const isCapacityUnconfigured =
                plan?.proposal.weekSummary.capacity.totalAvailableHours === null;

              const hoursToFree =
                selectedItem?.estimatedHours ??
                (selectedItem?.title.toLowerCase().includes("informe") ? 6 : null);

              return (
                <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                  {/* 1. Selector de tarea principal */}
                  <div>
                    <label
                      htmlFor="adjustment-item-select"
                      style={{
                        display: "block",
                        fontSize: "0.85rem",
                        fontWeight: 600,
                        marginBottom: "4px",
                      }}
                    >
                      Tarea a ajustar:
                    </label>
                    <select
                      id="adjustment-item-select"
                      data-testid="adjustment-item-select"
                      aria-label="Seleccionar tarea a ajustar"
                      value={effectiveItemId}
                      onChange={(e) => {
                        setSelectedAdjustmentItemId(e.target.value);
                        setIsAdjustmentPreviewOpen(false);
                      }}
                      style={{ width: "100%", padding: "7px 8px" }}
                    >
                      {planItems.map((item) => {
                        const alloc = schedule?.dailyAllocations.find(
                          (a) => a.itemId === item.itemId
                        );
                        return (
                          <option key={item.itemId} value={item.itemId}>
                            {item.title} ({item.source})
                            {item.estimatedHours ? ` · ${item.estimatedHours}h` : " · Sin estimar"}
                            {alloc ? ` · 📅 ${alloc.day}` : ""}
                          </option>
                        );
                      })}
                    </select>
                  </div>

                  {/* 2. Asignar horas y día en esta semana */}
                  <div
                    style={{
                      padding: "14px 16px",
                      background: "var(--bg-card, #fcfbf9)",
                      border: "1px solid var(--border-color, #e8e3d9)",
                      borderRadius: "8px",
                      display: "flex",
                      flexDirection: "column",
                      gap: "12px",
                    }}
                  >
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                        gap: "14px",
                        alignItems: "end",
                      }}
                    >
                      <div>
                        <label
                          htmlFor="task-hours-input"
                          style={{
                            display: "block",
                            fontSize: "0.85rem",
                            fontWeight: 600,
                            marginBottom: "4px",
                          }}
                        >
                          ⏱️ Horas estimadas:
                        </label>
                        <input
                          id="task-hours-input"
                          data-testid="task-hours-input"
                          type="number"
                          min="0.25"
                          max="40"
                          step="0.5"
                          placeholder={
                            selectedItem?.estimatedHours
                              ? `${selectedItem.estimatedHours}`
                              : "Ej: 2"
                          }
                          value={taskHoursInput}
                          onChange={(e) => setTaskHoursInput(e.target.value)}
                          style={{ width: "100%", padding: "8px 10px", borderRadius: "6px" }}
                        />
                      </div>

                      <div>
                        <label
                          htmlFor="task-day-select"
                          style={{
                            display: "block",
                            fontSize: "0.85rem",
                            fontWeight: 600,
                            marginBottom: "4px",
                          }}
                        >
                          📅 Día asignado:
                        </label>
                        <select
                          id="task-day-select"
                          data-testid="task-day-select"
                          value={taskDayInput}
                          onChange={(e) => setTaskDayInput(e.target.value)}
                          style={{ width: "100%", padding: "8px 10px", borderRadius: "6px" }}
                        >
                          <option value="">Sin día fijo (repartida en la semana)</option>
                          {getWeekDays(plan?.targetWeek.startDate).map((d) => (
                            <option key={d.date} value={d.date}>
                              {d.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        flexWrap: "wrap",
                        gap: "10px",
                        marginTop: "4px",
                      }}
                    >
                      <p className="calm-muted" style={{ fontSize: "0.8rem", margin: 0 }}>
                        💡 Si no eliges día, las horas quedan computadas en la semana sin día fijo.
                      </p>
                      <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                        <button
                          type="button"
                          className="secondary"
                          style={{ padding: "8px 14px", fontSize: "0.85rem" }}
                          onClick={() => setIsAdjustmentOpen(false)}
                        >
                          Cerrar
                        </button>
                        <button
                          type="button"
                          className="primary"
                          data-testid="save-task-adjustment-button"
                          aria-label="Guardar cambios de la tarea"
                          onClick={() =>
                            handleSaveTaskAdjustment(selectedItem.itemId, selectedItem.title)
                          }
                          style={{ padding: "8px 18px", fontWeight: 600 }}
                        >
                          Guardar cambios
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* 3. Mover a otra semana (reprogramar) */}
                  <details
                    className="calm-details"
                    open={isAdjustmentPreviewOpen || undefined}
                    style={{
                      padding: "10px 14px",
                      background: "#faf9f6",
                      border: "1px dashed var(--border-color, #d6d0c4)",
                      borderRadius: "6px",
                    }}
                  >
                    <summary
                      style={{
                        fontWeight: 600,
                        fontSize: "0.88rem",
                        color: "#4b5563",
                        cursor: "pointer",
                        userSelect: "none",
                      }}
                    >
                      🗓️ ¿Prefieres mover la tarea a una fecha posterior? (Opcional)
                    </summary>
                    <div
                      style={{
                        marginTop: "10px",
                        display: "flex",
                        flexDirection: "column",
                        gap: "10px",
                      }}
                    >
                      <p className="calm-muted" style={{ fontSize: "0.82rem", margin: 0 }}>
                        Usa esta opción solo si decides{" "}
                        <strong>no hacer esta tarea esta semana</strong> y quieres postergarla a
                        otra fecha.
                      </p>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                          gap: "12px",
                        }}
                      >
                        <div>
                          <label
                            htmlFor="target-week-start-input"
                            style={{
                              display: "block",
                              fontSize: "0.82rem",
                              fontWeight: 500,
                              marginBottom: "4px",
                            }}
                          >
                            Semana destino (Inicio):
                          </label>
                          <input
                            id="target-week-start-input"
                            data-testid="target-week-start-input"
                            type="text"
                            value={targetWeekStart}
                            onChange={(e) => {
                              setTargetWeekStart(e.target.value);
                              setIsAdjustmentPreviewOpen(false);
                            }}
                            style={{ width: "100%", padding: "6px 8px" }}
                          />
                        </div>

                        <div>
                          <label
                            htmlFor="target-week-end-input"
                            style={{
                              display: "block",
                              fontSize: "0.82rem",
                              fontWeight: 500,
                              marginBottom: "4px",
                            }}
                          >
                            Semana destino (Fin):
                          </label>
                          <input
                            id="target-week-end-input"
                            data-testid="target-week-end-input"
                            type="text"
                            value={targetWeekEnd}
                            onChange={(e) => {
                              setTargetWeekEnd(e.target.value);
                              setIsAdjustmentPreviewOpen(false);
                            }}
                            style={{ width: "100%", padding: "6px 8px" }}
                          />
                        </div>

                        <div>
                          <label
                            htmlFor="deadline-input"
                            style={{
                              display: "block",
                              fontSize: "0.82rem",
                              fontWeight: 500,
                              marginBottom: "4px",
                            }}
                          >
                            Deadline original (para verificar):
                          </label>
                          <input
                            id="deadline-input"
                            data-testid="deadline-input"
                            type="text"
                            placeholder={effectiveDeadline || "YYYY-MM-DD"}
                            value={deadlineInput}
                            onChange={(e) => {
                              setDeadlineInput(e.target.value);
                              setIsAdjustmentPreviewOpen(false);
                            }}
                            style={{ width: "100%", padding: "6px 8px" }}
                          />
                        </div>
                      </div>

                      {!isAdjustmentPreviewOpen && selectedItem && (
                        <div>
                          <button
                            type="button"
                            className="secondary"
                            data-testid="generate-proposal-button"
                            aria-label="Generar propuesta de reprogramación"
                            onClick={() => setIsAdjustmentPreviewOpen(true)}
                          >
                            Generar propuesta de reprogramación
                          </button>
                        </div>
                      )}
                    </div>
                  </details>

                  {isAdjustmentPreviewOpen && selectedItem && (
                    <div
                      className="item-card"
                      data-testid="proposal-preview-card"
                      style={{
                        flexDirection: "column",
                        gap: "10px",
                        marginTop: "8px",
                        border: "1px solid var(--accent-color, #708090)",
                      }}
                    >
                      <div style={{ fontWeight: 600, fontSize: "1rem" }}>
                        Reprogramar «{selectedItem.title}»
                      </div>

                      {/* Origen y Destino */}
                      <div
                        style={{
                          fontSize: "0.88rem",
                          display: "flex",
                          flexDirection: "column",
                          gap: "4px",
                        }}
                      >
                        <div>
                          <strong>Origen:</strong> {selectedItem.title} ({selectedItem.source})
                          {hoursToFree ? ` · ${hoursToFree}h estimadas` : " · Sin estimación"}
                          {effectiveDeadline && (
                            <span>
                              {" "}
                              · Fecha límite original: <code>{effectiveDeadline}</code>
                            </span>
                          )}
                        </div>
                        <div>
                          <strong>Mover a:</strong> Semana del {targetWeekStart} al {targetWeekEnd}.
                        </div>
                      </div>

                      {/* Consecuencias y advertencias evaluadas */}
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: "6px",
                          marginTop: "4px",
                        }}
                      >
                        {isDeadlineOverdue && (
                          <div
                            className="status-message status-warning"
                            data-testid="deadline-warning"
                            style={{
                              margin: 0,
                              padding: "6px 10px",
                              fontSize: "0.82rem",
                              background: "#fffbeb",
                              border: "1px solid #fef3c7",
                              color: "#92400e",
                            }}
                          >
                            ⚠️ <strong>Fecha límite vencida:</strong> La fecha original (
                            {effectiveDeadline}) vencerá antes de la semana destino (
                            {targetWeekStart} al {targetWeekEnd}).
                          </div>
                        )}

                        {isCapacityUnconfigured && (
                          <div
                            className="status-message status-warning"
                            data-testid="capacity-warning"
                            style={{
                              margin: 0,
                              padding: "6px 10px",
                              fontSize: "0.82rem",
                              background: "#fffbeb",
                              border: "1px solid #fef3c7",
                              color: "#92400e",
                            }}
                          >
                            ⚠️ <strong>Sin capacidad configurada:</strong> No hay horas disponibles
                            confirmadas para esta semana.
                          </div>
                        )}

                        <div
                          className="calm-muted"
                          data-testid="schedule-effect"
                          style={{ fontSize: "0.82rem", lineHeight: 1.4 }}
                        >
                          ℹ️ La tarea se retirará de tu semana actual y pasará a la semana del{" "}
                          {targetWeekStart} al {targetWeekEnd} para que la organices cuando la
                          abras.
                        </div>
                        <span data-testid="domain-boundary-note" style={{ display: "none" }} />
                      </div>

                      {/* Acciones de decisión humana */}
                      <div
                        className="actions"
                        style={{ marginTop: "12px", display: "flex", gap: "8px", flexWrap: "wrap" }}
                      >
                        <button
                          className="secondary"
                          data-testid="reject-proposal-button"
                          aria-label="Rechazar propuesta de ajuste"
                          onClick={async () => {
                            const action: SuggestedAdjustmentAction = {
                              type: "postpone_item",
                              itemId: selectedItem.itemId,
                              currentCategory: plan?.proposal.obligations.some(
                                (o) => o.itemId === selectedItem.itemId
                              )
                                ? "obligations"
                                : plan?.proposal.foci.some((f) =>
                                      f.contributingItemIds.includes(selectedItem.itemId)
                                    )
                                  ? "foci"
                                  : plan?.proposal.flexibleOptions.some(
                                        (opt) => opt.itemId === selectedItem.itemId
                                      )
                                    ? "flexible_options"
                                    : "deferred_items",
                              targetReason: "intentional_postponement",
                              hoursFreed: hoursToFree,
                              rationale: `Reprogramación intencional de '${selectedItem.title}' hacia la semana ${targetWeekStart} al ${targetWeekEnd}.`,
                              targetWeek: {
                                startDate: targetWeekStart,
                                endDate: targetWeekEnd,
                              },
                            };

                            const res = await applyAdjustment({
                              scheduleId: schedule.scheduleId,
                              proposalId: `prop-reschedule-${selectedItem.itemId}`,
                              adjustmentId: `adj-${Date.now()}`,
                              action,
                              expectedScheduleVersion: schedule.version,
                              humanDecision: "rejected",
                            });

                            if (res.status === "rejected") {
                              setFeedbackMessage(
                                "Rechazaste la propuesta. La agenda permanece sin cambios."
                              );
                              setIsAdjustmentPreviewOpen(false);
                            }
                          }}
                        >
                          Rechazar propuesta
                        </button>

                        <button
                          className="primary"
                          data-testid="accept-proposal-button"
                          aria-label="Aceptar propuesta de ajuste"
                          onClick={async () => {
                            const action: SuggestedAdjustmentAction = {
                              type: "postpone_item",
                              itemId: selectedItem.itemId,
                              currentCategory: plan?.proposal.obligations.some(
                                (o) => o.itemId === selectedItem.itemId
                              )
                                ? "obligations"
                                : plan?.proposal.foci.some((f) =>
                                      f.contributingItemIds.includes(selectedItem.itemId)
                                    )
                                  ? "foci"
                                  : plan?.proposal.flexibleOptions.some(
                                        (opt) => opt.itemId === selectedItem.itemId
                                      )
                                    ? "flexible_options"
                                    : "deferred_items",
                              targetReason: "intentional_postponement",
                              hoursFreed: hoursToFree,
                              rationale: `Reprogramación intencional de '${selectedItem.title}' hacia la semana ${targetWeekStart} al ${targetWeekEnd}.`,
                              targetWeek: {
                                startDate: targetWeekStart,
                                endDate: targetWeekEnd,
                              },
                            };

                            const res = await applyAdjustment({
                              scheduleId: schedule.scheduleId,
                              proposalId: `prop-reschedule-${selectedItem.itemId}`,
                              adjustmentId: `adj-${Date.now()}`,
                              action,
                              expectedScheduleVersion: schedule.version,
                              humanDecision: "accepted",
                            });

                            if (res.status === "success") {
                              setFeedbackMessage(
                                `Ajuste aplicado con éxito. Tarea reprogramada para ${targetWeekStart} al ${targetWeekEnd}. Nueva versión: v${res.schedule.version}`
                              );
                              setIsAdjustmentPreviewOpen(false);
                            } else if (res.status === "concurrency_conflict") {
                              setFeedbackMessage(
                                `Conflicto de concurrencia: la versión esperada era ${res.expectedVersion}, pero la agenda está en v${res.currentVersion}.`
                              );
                            } else if (res.status === "failed") {
                              setFeedbackMessage(
                                `No se pudo aplicar el ajuste: ${res.failureReason}`
                              );
                            }
                          }}
                        >
                          Aceptar propuesta
                        </button>

                        <button
                          type="button"
                          className="secondary"
                          data-testid="cancel-proposal-button"
                          aria-label="Cancelar propuesta"
                          onClick={() => setIsAdjustmentPreviewOpen(false)}
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })()
          )}
        </div>
      </details>
    </>
  );
}
