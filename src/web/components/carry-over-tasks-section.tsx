import { TargetWeek } from "../../domain/week";
import { formatPlanCategoryOrigin } from "../labels";

export interface PendingCarryOverTask {
  itemId: string;
  title: string;
  originCategory: string;
  postponementReason: string;
  targetWeek?: TargetWeek;
  dueDate?: string;
  estimatedHours?: number | null;
}

export interface CarryOverTasksSectionProps {
  carryOverTasks: PendingCarryOverTask[];
  selectedCarryOverItemIds: Set<string>;
  onToggleCarryOverItem: (itemId: string) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  isPlanning: boolean;
  onGenerateProposal?: () => void;
  hasExtractedItems: boolean;
}

export function CarryOverTasksSection({
  carryOverTasks,
  selectedCarryOverItemIds,
  onToggleCarryOverItem,
  onSelectAll,
  onDeselectAll,
  isPlanning,
  onGenerateProposal,
  hasExtractedItems,
}: CarryOverTasksSectionProps) {
  if (carryOverTasks.length === 0) return null;

  return (
    <div
      className="calm-box"
      style={{
        background: "#f8f9fa",
        border: "1px solid #dcdfe6",
        borderRadius: "8px",
        padding: "16px",
        marginTop: "16px",
        marginBottom: "16px",
      }}
      data-testid="carryover-tasks-section"
      aria-label="Tareas postergadas de semanas anteriores"
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
        <h4 style={{ margin: 0 }}>Tareas postergadas de semanas anteriores</h4>
        <span className="badge badge-muted">
          {selectedCarryOverItemIds.size} de {carryOverTasks.length} seleccionadas
        </span>
      </div>

      <p className="calm-muted" style={{ fontSize: "0.88rem", marginTop: "4px" }}>
        Tareas reprogramadas para esta semana o pendientes de ciclos previos.
        <strong>
          {" "}
          Ninguna se incorpora automáticamente; tú decides cuáles incluir en el borrador.
        </strong>
      </p>

      <ul
        className="items-list"
        style={{ marginTop: "12px", listStyle: "none", padding: 0 }}
        aria-label="Lista de tareas postergadas recuperables"
      >
        {carryOverTasks.map((task) => {
          const isSelected = selectedCarryOverItemIds.has(task.itemId);
          const hasExplicitDestination = Boolean(task.targetWeek);
          return (
            <li
              key={task.itemId}
              className="item-card"
              data-testid={`carryover-item-${task.itemId}`}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: "12px",
                padding: "10px 12px",
                marginBottom: "8px",
                background: isSelected ? "#ffffff" : "#fdfdfd",
                border: isSelected ? "1px solid var(--accent-color, #4a6da7)" : "1px solid #e0e0e0",
                borderRadius: "6px",
              }}
            >
              <input
                type="checkbox"
                id={`carryover-check-${task.itemId}`}
                checked={isSelected}
                onChange={() => onToggleCarryOverItem(task.itemId)}
                aria-label={`Incorporar tarea postergada ${task.title}`}
                style={{ marginTop: "4px", cursor: "pointer" }}
              />
              <div style={{ flex: 1 }}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "baseline",
                    gap: "8px",
                    flexWrap: "wrap",
                  }}
                >
                  <strong style={{ fontSize: "0.95rem" }}>{task.title}</strong>
                  <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                    <span className="badge badge-task">
                      Origen: {formatPlanCategoryOrigin(task.originCategory)}
                    </span>
                    {task.estimatedHours != null && (
                      <span className="badge badge-muted">⏱ {task.estimatedHours}h</span>
                    )}
                    {task.dueDate && (
                      <span
                        className="badge badge-error"
                        data-testid={`carryover-deadline-${task.itemId}`}
                      >
                        📅 Deadline original: {task.dueDate}
                      </span>
                    )}
                    {!hasExplicitDestination && (
                      <span
                        className="badge badge-muted"
                        data-testid={`carryover-unconfirmed-${task.itemId}`}
                      >
                        Sin destino confirmado
                      </span>
                    )}
                  </div>
                </div>

                {hasExplicitDestination && task.targetWeek && (
                  <div
                    style={{
                      fontSize: "0.85rem",
                      color: "#4a6da7",
                      marginTop: "4px",
                    }}
                    data-testid={`carryover-target-week-${task.itemId}`}
                  >
                    🎯 <strong>Semana destino confirmada:</strong> {task.targetWeek.startDate} al{" "}
                    {task.targetWeek.endDate}
                  </div>
                )}

                <div
                  className="calm-muted"
                  style={{
                    fontSize: "0.85rem",
                    marginTop: "4px",
                    fontStyle: "italic",
                  }}
                  data-testid={`carryover-reason-${task.itemId}`}
                >
                  <em>Motivo de postergación:</em> {task.postponementReason}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {/* Quick action buttons for carryover selection */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginTop: "8px",
          flexWrap: "wrap",
          gap: "8px",
        }}
      >
        <div style={{ display: "flex", gap: "8px" }}>
          <button
            type="button"
            className="secondary"
            style={{ fontSize: "0.82rem", padding: "4px 8px" }}
            onClick={onSelectAll}
          >
            Seleccionar todas las postergadas
          </button>
          <button
            type="button"
            className="secondary"
            style={{ fontSize: "0.82rem", padding: "4px 8px" }}
            onClick={onDeselectAll}
          >
            Deseleccionar todas
          </button>
        </div>

        {/* Direct proposal generation if only planning carryover tasks without extra notes */}
        {!hasExtractedItems && selectedCarryOverItemIds.size > 0 && onGenerateProposal && (
          <button
            type="button"
            className="primary"
            style={{ fontSize: "0.88rem", padding: "6px 12px" }}
            data-testid="generate-proposal-from-carryover-button"
            disabled={isPlanning}
            onClick={onGenerateProposal}
          >
            {isPlanning
              ? "Estructurando propuesta semanal..."
              : `Planificar con ${selectedCarryOverItemIds.size} tarea(s) postergada(s)`}
          </button>
        )}
      </div>
    </div>
  );
}
