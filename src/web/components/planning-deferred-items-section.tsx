import { ProposedWeek } from "../../domain/week";
import { ExtractedItem } from "../../domain/items";
import { formatDeferredReason, formatUnscheduledCategory } from "./weekly-session-view";

export interface PlanningDeferredItemsSectionProps {
  proposedWeek: ProposedWeek;
  extractedItems: ExtractedItem[] | null;
  deferredDecisions: Record<string, "pending_decision" | "intentional_postponement" | "included">;
  handleDeferredDecisionChange: (
    itemId: string,
    decision: "postpone" | "include_flexible" | "reconsider_unscheduled"
  ) => void;
  handleApplyOverdueDecision: (
    itemId: string,
    decision: "keep_unscheduled" | "include_recovery" | "reschedule_future"
  ) => void;
}

export function PlanningDeferredItemsSection({
  proposedWeek,
  extractedItems,
  deferredDecisions,
  handleDeferredDecisionChange,
  handleApplyOverdueDecision,
}: PlanningDeferredItemsSectionProps) {
  return (
    <>
      {/* Deferred / Unscheduled Items */}
      {proposedWeek.deferredItems.length > 0 && (
        <div
          className="permiso-no-hacer-box"
          style={{ marginTop: "24px" }}
          data-testid="proposed-deferred-items-section"
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              flexWrap: "wrap",
              gap: "8px",
              marginBottom: "8px",
            }}
          >
            <h4
              style={{
                margin: 0,
                fontSize: "1.1rem",
                display: "flex",
                alignItems: "center",
                gap: "8px",
              }}
            >
              <span>☕</span> Elementos no programados o diferidos (
              {proposedWeek.deferredItems.length})
            </h4>
            <span className="calm-muted" style={{ fontSize: "0.82rem" }}>
              Dejar tareas fuera te permite enfocarte en lo prioritario
            </span>
          </div>

          {/* 1. Pendientes de decisión / Fuera de propuesta */}
          {(() => {
            const pendingItems = proposedWeek.deferredItems.filter(
              (d) => d.reason !== "intentional_postponement"
            );
            if (pendingItems.length === 0) return null;
            return (
              <div style={{ marginBottom: "12px" }} data-testid="pending-decision-items-group">
                <span
                  style={{
                    fontSize: "0.85rem",
                    fontWeight: 600,
                    color: "#4b5563",
                    display: "block",
                    marginBottom: "6px",
                  }}
                >
                  Pendientes de decisión ({pendingItems.length}):
                </span>
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  {pendingItems.map((def) => {
                    const sourceItem = extractedItems?.find((i) => i.id === def.itemId);
                    const originalDueDate = sourceItem?.deadline?.resolved;
                    const isOverdue =
                      originalDueDate &&
                      originalDueDate < proposedWeek.weekSummary.targetWeek.startDate;

                    return (
                      <div
                        key={def.itemId}
                        className="item-card"
                        style={{
                          padding: "10px 14px",
                          background: "#fffdf9",
                          borderColor: "#f0e6d6",
                          display: "flex",
                          flexDirection: "column",
                          gap: "6px",
                        }}
                        data-testid={`proposed-deferred-item-${def.itemId}`}
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
                          <strong>{def.title}</strong>
                          <div
                            style={{
                              display: "flex",
                              gap: "6px",
                              alignItems: "center",
                              flexWrap: "wrap",
                            }}
                          >
                            <span
                              className={`badge ${formatUnscheduledCategory(def.reason, deferredDecisions[def.itemId]).badgeClass}`}
                              data-testid={`unscheduled-category-badge-${def.itemId}`}
                            >
                              {
                                formatUnscheduledCategory(def.reason, deferredDecisions[def.itemId])
                                  .label
                              }
                            </span>
                            <span className="badge badge-muted">
                              {formatDeferredReason(def.reason)}
                            </span>
                          </div>
                        </div>
                        <div
                          className="calm-muted"
                          style={{ fontSize: "0.82rem" }}
                          data-testid={`proposed-deferred-rationale-${def.itemId}`}
                        >
                          {def.rationale}
                        </div>
                        {isOverdue && (
                          <div
                            className="calm-muted"
                            style={{ fontSize: "0.8rem", color: "#b45309" }}
                            data-testid={`deferred-original-deadline-${def.itemId}`}
                          >
                            📅 Fecha límite original: <strong>{originalDueDate}</strong> (vencida
                            antes de la semana)
                          </div>
                        )}
                        <div
                          style={{
                            display: "flex",
                            gap: "8px",
                            marginTop: "6px",
                            flexWrap: "wrap",
                          }}
                        >
                          <button
                            type="button"
                            className="secondary small"
                            onClick={() => handleDeferredDecisionChange(def.itemId, "postpone")}
                            data-testid={`defer-item-postpone-button-${def.itemId}`}
                          >
                            Posponer
                          </button>
                          <button
                            type="button"
                            className="secondary small"
                            onClick={() =>
                              handleDeferredDecisionChange(def.itemId, "include_flexible")
                            }
                            data-testid={`defer-item-include-button-${def.itemId}`}
                          >
                            Incluir en la semana
                          </button>
                          <button
                            type="button"
                            className="secondary small"
                            onClick={() =>
                              handleDeferredDecisionChange(def.itemId, "reconsider_unscheduled")
                            }
                            data-testid={`defer-item-review-button-${def.itemId}`}
                          >
                            Dejar fuera
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {/* 2. Postergados conscientemente para después */}
          {(() => {
            const postponedItems = proposedWeek.deferredItems.filter(
              (d) => d.reason === "intentional_postponement"
            );
            if (postponedItems.length === 0) return null;
            return (
              <div style={{ marginBottom: "12px" }} data-testid="postponed-items-group">
                <span
                  style={{
                    fontSize: "0.85rem",
                    fontWeight: 600,
                    color: "#6b7280",
                    display: "block",
                    marginBottom: "6px",
                  }}
                >
                  Postergados conscientemente ({postponedItems.length}):
                </span>
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  {postponedItems.map((def) => {
                    const sourceItem = extractedItems?.find((i) => i.id === def.itemId);
                    const originalDueDate = sourceItem?.deadline?.resolved;

                    return (
                      <div
                        key={def.itemId}
                        className="item-card"
                        style={{
                          padding: "10px 14px",
                          background: "#f8fafc",
                          borderColor: "#e2e8f0",
                          display: "flex",
                          flexDirection: "column",
                          gap: "6px",
                        }}
                        data-testid={`proposed-deferred-item-${def.itemId}`}
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
                          <strong>{def.title}</strong>
                          <div
                            style={{
                              display: "flex",
                              gap: "6px",
                              alignItems: "center",
                              flexWrap: "wrap",
                            }}
                          >
                            <span
                              className="badge badge-idea"
                              data-testid={`postponed-category-badge-${def.itemId}`}
                            >
                              {formatDeferredReason(def.reason)}
                            </span>
                          </div>
                        </div>
                        <div
                          className="calm-muted"
                          style={{ fontSize: "0.82rem" }}
                          data-testid={`proposed-deferred-rationale-${def.itemId}`}
                        >
                          {def.rationale}
                        </div>
                        {originalDueDate && (
                          <div
                            className="calm-muted"
                            style={{ fontSize: "0.8rem", color: "#64748b" }}
                            data-testid={`deferred-original-deadline-${def.itemId}`}
                          >
                            📅 Fecha límite original conservada: <strong>{originalDueDate}</strong>
                          </div>
                        )}
                        <div
                          style={{
                            display: "flex",
                            gap: "8px",
                            marginTop: "6px",
                            flexWrap: "wrap",
                          }}
                        >
                          <button
                            type="button"
                            className="secondary small"
                            onClick={() =>
                              handleDeferredDecisionChange(def.itemId, "reconsider_unscheduled")
                            }
                            data-testid={`defer-item-unschedule-button-${def.itemId}`}
                          >
                            Volver a evaluar
                          </button>
                          <button
                            type="button"
                            className="secondary small"
                            onClick={() =>
                              handleDeferredDecisionChange(def.itemId, "include_flexible")
                            }
                            data-testid={`defer-item-include-button-${def.itemId}`}
                          >
                            Incluir en la semana
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* Decisiones sobre tareas con fecha límite vencida (Requirement 3 & 4) */}
      {(() => {
        const overdueList = (extractedItems || []).filter((item) => {
          const dl = item.deadline?.resolved;
          return Boolean(dl && dl < proposedWeek.weekSummary.targetWeek.startDate);
        });
        if (overdueList.length === 0) return null;

        return (
          <div style={{ marginTop: "16px" }} data-testid="overdue-items-decision-section">
            <h5 style={{ margin: "0 0 8px 0" }}>
              Decisiones sobre tareas con fecha límite vencida
            </h5>
            {overdueList.map((item) => {
              const originalDueDate = item.deadline?.resolved;
              const isRecovery =
                proposedWeek.foci.some((f) => f.contributingItemIds.includes(item.id)) ||
                proposedWeek.flexibleOptions.some((o) => o.itemId === item.id);
              const deferredEntry = proposedWeek.deferredItems.find((d) => d.itemId === item.id);
              const isPostponed = deferredEntry?.reason === "intentional_postponement";
              const isUnscheduled = !isRecovery && !isPostponed;

              return (
                <div
                  key={item.id}
                  className="calm-box"
                  style={{
                    marginTop: "8px",
                    background: "#fffdf0",
                    borderColor: "#f59e0b",
                    borderWidth: "1px",
                    borderStyle: "solid",
                    borderRadius: "6px",
                    padding: "12px 16px",
                  }}
                  data-testid={`overdue-item-decision-card-${item.id}`}
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
                    <strong>⚠️ {item.title}</strong>
                    <span
                      className="badge badge-warning"
                      data-testid={`original-deadline-badge-${item.id}`}
                    >
                      Fecha límite original: {originalDueDate} (vencida)
                    </span>
                  </div>
                  <p
                    className="calm-text"
                    style={{ fontSize: "0.85rem", margin: "6px 0", color: "#78350f" }}
                  >
                    Esta tarea ({item.estimatedEffort?.value ?? 6}h) tenía fecha límite el{" "}
                    <strong>{originalDueDate}</strong>, anterior a la semana objetivo (
                    {proposedWeek.weekSummary.targetWeek.startDate} a{" "}
                    {proposedWeek.weekSummary.targetWeek.endDate}). La fecha límite original{" "}
                    <strong>no se altera silenciosamente</strong> ni se presenta falsamente como
                    futura.
                  </p>
                  <div style={{ marginTop: "12px" }}>
                    <span
                      id={`overdue-decision-label-${item.id}`}
                      style={{
                        fontSize: "0.85rem",
                        fontWeight: 600,
                        display: "block",
                        marginBottom: "8px",
                      }}
                    >
                      Decisión sobre esta tarea vencida:
                    </span>
                    <div
                      role="group"
                      aria-labelledby={`overdue-decision-label-${item.id}`}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                        gap: "10px",
                      }}
                    >
                      {/* Opción 1: Mantener sin programar */}
                      <button
                        type="button"
                        aria-pressed={isUnscheduled}
                        className={isUnscheduled ? "primary small" : "secondary small"}
                        data-testid={`decision-unscheduled-${item.id}`}
                        onClick={() => handleApplyOverdueDecision(item.id, "keep_unscheduled")}
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "flex-start",
                          textAlign: "left",
                          padding: "10px 12px",
                          borderRadius: "6px",
                          cursor: "pointer",
                          background: isUnscheduled ? "#eff6ff" : "#ffffff",
                          borderColor: isUnscheduled ? "#2563eb" : "#d1d5db",
                          borderWidth: isUnscheduled ? "2px" : "1px",
                          borderStyle: "solid",
                          color: isUnscheduled ? "#1d4ed8" : "inherit",
                          boxShadow: isUnscheduled ? "0 1px 3px rgba(37,99,235,0.15)" : "none",
                          width: "100%",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            width: "100%",
                            alignItems: "center",
                          }}
                        >
                          <strong style={{ fontSize: "0.85rem" }}>
                            {isUnscheduled ? "✓ Mantener sin programar" : "Mantener sin programar"}
                          </strong>
                          {isUnscheduled && (
                            <span
                              className="badge badge-primary"
                              style={{ fontSize: "0.7rem", padding: "1px 6px" }}
                            >
                              Seleccionada
                            </span>
                          )}
                        </div>
                        <span
                          style={{
                            fontSize: "0.78rem",
                            color: "#4b5563",
                            marginTop: "4px",
                            fontWeight: "normal",
                          }}
                        >
                          Permanece en pendientes sin asignar a un foco. No consume capacidad
                          planificable.
                        </span>
                      </button>

                      {/* Opción 2: Prioridad de recuperación */}
                      <button
                        type="button"
                        aria-pressed={isRecovery}
                        className={isRecovery ? "primary small" : "secondary small"}
                        data-testid={`decision-recovery-${item.id}`}
                        onClick={() => handleApplyOverdueDecision(item.id, "include_recovery")}
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "flex-start",
                          textAlign: "left",
                          padding: "10px 12px",
                          borderRadius: "6px",
                          cursor: "pointer",
                          background: isRecovery ? "#eff6ff" : "#ffffff",
                          borderColor: isRecovery ? "#2563eb" : "#d1d5db",
                          borderWidth: isRecovery ? "2px" : "1px",
                          borderStyle: "solid",
                          color: isRecovery ? "#1d4ed8" : "inherit",
                          boxShadow: isRecovery ? "0 1px 3px rgba(37,99,235,0.15)" : "none",
                          width: "100%",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            width: "100%",
                            alignItems: "center",
                          }}
                        >
                          <strong style={{ fontSize: "0.85rem" }}>
                            {isRecovery
                              ? "✓ Prioridad de recuperación"
                              : `Prioridad de recuperación (${item.estimatedEffort?.value ?? 6}h)`}
                          </strong>
                          {isRecovery && (
                            <span
                              className="badge badge-primary"
                              style={{ fontSize: "0.7rem", padding: "1px 6px" }}
                            >
                              Seleccionada
                            </span>
                          )}
                        </div>
                        <span
                          style={{
                            fontSize: "0.78rem",
                            color: "#4b5563",
                            marginTop: "4px",
                            fontWeight: "normal",
                          }}
                        >
                          Se incorpora como foco principal de la semana consumiendo{" "}
                          {item.estimatedEffort?.value ?? 6}h planificables.
                        </span>
                      </button>

                      {/* Opción 3: Reprogramar a otra semana */}
                      <button
                        type="button"
                        aria-pressed={isPostponed}
                        className={isPostponed ? "primary small" : "secondary small"}
                        data-testid={`decision-postpone-${item.id}`}
                        onClick={() => handleApplyOverdueDecision(item.id, "reschedule_future")}
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "flex-start",
                          textAlign: "left",
                          padding: "10px 12px",
                          borderRadius: "6px",
                          cursor: "pointer",
                          background: isPostponed ? "#eff6ff" : "#ffffff",
                          borderColor: isPostponed ? "#2563eb" : "#d1d5db",
                          borderWidth: isPostponed ? "2px" : "1px",
                          borderStyle: "solid",
                          color: isPostponed ? "#1d4ed8" : "inherit",
                          boxShadow: isPostponed ? "0 1px 3px rgba(37,99,235,0.15)" : "none",
                          width: "100%",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            width: "100%",
                            alignItems: "center",
                          }}
                        >
                          <strong style={{ fontSize: "0.85rem" }}>
                            {isPostponed
                              ? "✓ Reprogramar a otra semana"
                              : "Reprogramar a otra semana"}
                          </strong>
                          {isPostponed && (
                            <span
                              className="badge badge-primary"
                              style={{ fontSize: "0.7rem", padding: "1px 6px" }}
                            >
                              Seleccionada
                            </span>
                          )}
                        </div>
                        <span
                          style={{
                            fontSize: "0.78rem",
                            color: "#4b5563",
                            marginTop: "4px",
                            fontWeight: "normal",
                          }}
                        >
                          Se posterga conscientemente a una semana posterior sin consumir horas en
                          este plan.
                        </span>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        );
      })()}
    </>
  );
}
