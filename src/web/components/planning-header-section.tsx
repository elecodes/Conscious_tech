import React from "react";
import { ProposedWeek, TargetWeek } from "../../domain/week";
import { ExtractedItem } from "../../domain/items";
import { StoredWeeklyPlan } from "../../domain/repositories/types";
import { CalendarWeekSummary } from "../../domain/calendar";
import { CalendarSyncCard } from "./calendar-sync-card";
import { CarryOverTasksSection } from "./carry-over-tasks-section";

export interface PendingCarryOverTask {
  itemId: string;
  title: string;
  originCategory: string;
  postponementReason: string;
  targetWeek?: TargetWeek;
  dueDate?: string;
  estimatedHours?: number | null;
}

export interface PlanningHeaderSectionProps {
  hasActivePlan: boolean;
  initialItems?: ExtractedItem[];
  successMessage: string | null;
  targetWeekStart: string;
  setTargetWeekStart: (val: string) => void;
  targetWeekEnd: string;
  setTargetWeekEnd: (val: string) => void;
  handleStartFreshWeek: () => void;
  draftPlans?: StoredWeeklyPlan[];
  proposedWeek: ProposedWeek | null;
  isReviewingSelection: boolean;
  handleReturnToProposal: () => void;
  handleCancelProposal: () => void;
  carryOverTasks: PendingCarryOverTask[];
  selectedCarryOverItemIds: Set<string>;
  handleToggleCarryOverItem: (itemId: string) => void;
  setSelectedCarryOverItemIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  isPlanning: boolean;
  handleGenerateProposal: () => void;
  extractedItems: ExtractedItem[] | null;
  activeTargetWeek: TargetWeek;
  handleCalendarApplied: (summary: CalendarWeekSummary) => void;
}

export function PlanningHeaderSection({
  hasActivePlan,
  initialItems,
  successMessage,
  targetWeekStart,
  setTargetWeekStart,
  targetWeekEnd,
  setTargetWeekEnd,
  handleStartFreshWeek,
  draftPlans,
  proposedWeek,
  isReviewingSelection,
  handleReturnToProposal,
  handleCancelProposal,
  carryOverTasks,
  selectedCarryOverItemIds,
  handleToggleCarryOverItem,
  setSelectedCarryOverItemIds,
  isPlanning,
  handleGenerateProposal,
  extractedItems,
  activeTargetWeek,
  handleCalendarApplied,
}: PlanningHeaderSectionProps) {
  return (
    <>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          flexWrap: "wrap",
          gap: "8px",
        }}
      >
        <h3>Planificar semana a partir de ideas</h3>
        <span className="badge badge-idea">IA propone · Tú decides</span>
      </div>

      {hasActivePlan && (
        <div
          className="calm-box"
          style={{
            marginTop: "12px",
            background: "#fff9e6",
            borderColor: "#ffe082",
            fontSize: "0.9rem",
          }}
        >
          ℹ️ <strong>Nota:</strong> Actualmente ya tienes una semana activa. Si generas y confirmas
          un nuevo plan, deberás haber cerrado la semana en curso previamente para evitar
          conflictos.
        </div>
      )}

      {initialItems && initialItems.length > 0 && (
        <div
          className="calm-box"
          style={{
            marginTop: "12px",
            background: "#eef6ff",
            borderColor: "#bcd7ff",
            fontSize: "0.9rem",
            color: "#1d4ed8",
          }}
          data-testid="transferred-items-notice"
        >
          📋 <strong>Elementos transferidos:</strong> Se cargaron {initialItems.length} elemento(s)
          extraídos del volcado mental. Puedes ajustar la semana objetivo y seleccionar cuáles
          incluir antes de generar la propuesta.
        </div>
      )}

      {successMessage && (
        <div className="status-message status-info" style={{ marginTop: "12px" }} role="status">
          {successMessage}
        </div>
      )}

      {/* Selector de semana objetivo a planificar */}
      <div
        className="config-box"
        style={{
          marginTop: "12px",
          padding: "10px 14px",
          background: "#fdfdfd",
          border: "1px solid var(--border-color, #e0e0e0)",
          borderRadius: "6px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "12px",
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
          <span style={{ fontSize: "0.9rem", fontWeight: 600 }}>Semana objetivo a planificar:</span>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <label htmlFor="target-week-start-input" style={{ fontSize: "0.85rem", color: "#666" }}>
              Desde:
            </label>
            <input
              id="target-week-start-input"
              data-testid="target-week-start-input"
              type="date"
              value={targetWeekStart}
              onChange={(e) => setTargetWeekStart(e.target.value)}
              style={{ padding: "4px 8px", fontSize: "0.85rem" }}
            />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <label htmlFor="target-week-end-input" style={{ fontSize: "0.85rem", color: "#666" }}>
              Hasta:
            </label>
            <input
              id="target-week-end-input"
              data-testid="target-week-end-input"
              type="date"
              value={targetWeekEnd}
              onChange={(e) => setTargetWeekEnd(e.target.value)}
              style={{ padding: "4px 8px", fontSize: "0.85rem" }}
            />
          </div>
        </div>

        <button
          type="button"
          className="secondary small"
          style={{ fontSize: "0.82rem", padding: "4px 8px" }}
          onClick={handleStartFreshWeek}
          data-testid="start-fresh-week-top-button"
          title="Despeja el cuaderno para iniciar la planificación de una nueva semana sin datos previos"
        >
          ✨ Limpiar y empezar nueva semana
        </button>
      </div>

      {/* Lista de borradores guardados si existen en el estado */}
      {draftPlans && draftPlans.length > 0 && (
        <div
          className="calm-box"
          style={{
            marginTop: "10px",
            padding: "8px 12px",
            background: "#fcfbf9",
            border: "1px dashed var(--border-color, #e0ded9)",
            borderRadius: "6px",
            fontSize: "0.85rem",
          }}
          data-testid="saved-drafts-selector"
        >
          <span style={{ fontWeight: 600, color: "var(--text-main, #333)", marginRight: "8px" }}>
            📂 Borradores guardados:
          </span>
          <div style={{ display: "inline-flex", gap: "6px", flexWrap: "wrap", marginTop: "4px" }}>
            {draftPlans.map((draft) => {
              const isSelected =
                draft.targetWeek.startDate === targetWeekStart &&
                draft.targetWeek.endDate === targetWeekEnd;
              return (
                <button
                  key={draft.planId}
                  type="button"
                  className={isSelected ? "primary small" : "secondary small"}
                  style={{ fontSize: "0.8rem", padding: "2px 8px" }}
                  onClick={() => {
                    setTargetWeekStart(draft.targetWeek.startDate);
                    setTargetWeekEnd(draft.targetWeek.endDate);
                  }}
                  data-testid={`select-draft-${draft.targetWeek.startDate}`}
                >
                  Semana {draft.targetWeek.startDate} al {draft.targetWeek.endDate}
                  {isSelected ? " (Activo)" : ""}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Aviso de propuesta previa ya disponible si el usuario está revisando o ajustando */}
      {proposedWeek && isReviewingSelection && (
        <div
          style={{
            marginTop: "12px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "12px 16px",
            background: "#f0f7ff",
            border: "1px solid #bfdbfe",
            borderRadius: "8px",
            gap: "10px",
            flexWrap: "wrap",
          }}
        >
          <div>
            <strong style={{ fontSize: "0.92rem", color: "#1e40af", display: "block" }}>
              ✓ Propuesta semanal ya preparada para esta semana
            </strong>
            <span style={{ fontSize: "0.82rem", color: "#2563eb" }}>
              Estás revisando los elementos y tu intención. La propuesta previa sigue disponible.
            </span>
          </div>
          <div style={{ display: "flex", gap: "8px" }}>
            <button
              type="button"
              className="primary small"
              data-testid="return-to-proposal-button"
              onClick={handleReturnToProposal}
            >
              → Volver a la propuesta generada
            </button>
            <button
              type="button"
              className="secondary small"
              data-testid="discard-proposal-button"
              onClick={handleCancelProposal}
            >
              Descartar propuesta
            </button>
          </div>
        </div>
      )}

      {/* -------------------------------------------------------------------- */}
      {/* 0. Carryover Tasks from Previous Weeks (Sovereign Human Selection)   */}
      {/* -------------------------------------------------------------------- */}
      {!proposedWeek && (
        <CarryOverTasksSection
          carryOverTasks={carryOverTasks}
          selectedCarryOverItemIds={selectedCarryOverItemIds}
          onToggleCarryOverItem={handleToggleCarryOverItem}
          onSelectAll={() =>
            setSelectedCarryOverItemIds(new Set(carryOverTasks.map((t) => t.itemId)))
          }
          onDeselectAll={() => setSelectedCarryOverItemIds(new Set())}
          isPlanning={isPlanning}
          onGenerateProposal={handleGenerateProposal}
          hasExtractedItems={Boolean(extractedItems && extractedItems.length > 0)}
        />
      )}

      {/* Calendar Integration (Always available in planning) */}
      <CalendarSyncCard targetWeek={activeTargetWeek} onCalendarApplied={handleCalendarApplied} />
    </>
  );
}
