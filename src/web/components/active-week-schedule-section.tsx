import type { TargetWeek } from "../../domain/week";
import { ItemPostponementControls } from "./item-postponement-controls";
import { activePostponements } from "../../domain/item-postponement";
import { ItemMovementControls } from "./item-movement-controls";
import type { MovementAction, PostponementAction } from "../../domain/item-activity-types";
import { useState } from "react";
import { partitionActiveWeekItems } from "../active-week-items";
import { formatHours } from "./weekly-session-formatters";
import { WeeklySchedule } from "../../domain/schedule";
import { StoredWeeklyPlan } from "../../domain/repositories/types";
import { buildGoogleCalendarTemplateUrl, generateIcsCalendarExport } from "../../domain/calendar";
import { getStoredReminderPreferences } from "../../domain/reminders";
import { PlanItemSummary } from "./weekly-reflective-closing-section";
import { ActiveWeekAdjustmentPanel } from "./active-week-adjustment-panel";
import { CalendarReminderSettings } from "./calendar-reminder-settings";
import { EmailSummaryCard } from "./email-summary-card";

export interface ActiveWeekScheduleSectionProps {
  onPostpone?: (itemId: string, action: PostponementAction) => Promise<void>;
  onMove?: (itemId: string, action: MovementAction) => Promise<void>;
  onActivity?: (itemId: string, reversesActionId?: string) => Promise<void>;
  activityBusy?: boolean;
  onReloadActivity?: () => Promise<void>;
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
  targetDraft?: StoredWeeklyPlan;
  onOpenDestination?: (week: TargetWeek) => void;
  setFeedbackMessage: (msg: string | null) => void;
}

export function ActiveWeekScheduleSection({
  schedule,
  onActivity,
  onMove,
  onPostpone,
  activityBusy,
  onReloadActivity,
  plan,
  planItems,
  selectedAdjustmentItemId,
  setSelectedAdjustmentItemId,
  isAdjustmentOpen,
  setIsAdjustmentOpen,
  lastSavedAdjustment,
  setLastSavedAdjustment,
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
  targetDraft,
  onOpenDestination,
}: ActiveWeekScheduleSectionProps) {
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const groups = partitionActiveWeekItems(plan, schedule, planItems);
  const postponedActions = activePostponements(schedule);

  const handleDownloadWeekIcs = () => {
    const prefs = getStoredReminderPreferences();
    const exportItems = planItems.map((item) => {
      const alloc = schedule.dailyAllocations.find((a) => a.itemId === item.itemId);
      const timeBlock = schedule.timeBlocks.find((tb) => tb.itemId === item.itemId);
      const day =
        alloc?.day ||
        timeBlock?.day ||
        plan?.draftContext?.plannedDays?.[item.itemId] ||
        item.dueDate ||
        plan?.targetWeek.startDate ||
        "2026-10-19";
      const isObligation =
        item.source === "Obligación" || item.source?.toLowerCase().includes("obligaci");
      return {
        id: item.itemId,
        title: item.title,
        day,
        startTime: timeBlock?.startTime,
        durationHours: item.estimatedHours || 1,
        description: `Categoría: ${item.source}${item.rationale ? `\nMotivo: ${item.rationale}` : ""}`,
        isCommitment: isObligation,
        hasDeadline: Boolean(item.dueDate),
        allDay: !timeBlock,
      };
    });
    const icsContent = generateIcsCalendarExport(exportItems, {
      calendarName: "Conscious Tech — Semana Activa",
      reminderOffset: prefs.offset,
      includeTasksInAlarms: prefs.includeTasks,
      timeZone: "Europe/Madrid",
    });
    const blob = new Blob([icsContent], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `conscious-tech-semana-${plan?.targetWeek.startDate || "activa"}.ics`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setExportNotice(
      "Archivo .ics descargado con recordatorios. Para importarlo en Google Calendar: entra en Ajustes → Importar y exportar → Selecciona el archivo descargado."
    );
  };

  const renderItem = (item: PlanItemSummary) => {
    const alloc = schedule.dailyAllocations.find((a) => a.itemId === item.itemId);
    const isSelected = (selectedAdjustmentItemId || planItems[0]?.itemId) === item.itemId;
    const isObligation =
      item.source === "Obligación" || item.source?.toLowerCase().includes("obligaci");

    const original = plan?.draftContext?.extractedItems?.find(
      (source) => source.id === item.itemId
    );
    const isThought = original?.type === "idea" || original?.type === "concern";
    const inProposal =
      !!plan &&
      (plan.proposal.foci.some((focus) => focus.contributingItemIds.includes(item.itemId)) ||
        plan.proposal.obligations.some((entry) => entry.itemId === item.itemId) ||
        plan.proposal.flexibleOptions.some((entry) => entry.itemId === item.itemId) ||
        plan.proposal.deferredItems.some((entry) => entry.itemId === item.itemId));
    const outcome = schedule.itemActivity?.outcomes.find(
      (outcome) => outcome.itemId === item.itemId
    );
    const last = schedule.itemActivity?.history.at(-1);
    const undo =
      last?.command.type !== "undo" &&
      !!last &&
      last.command.itemId === item.itemId &&
      last.appliedVersion === schedule.version
        ? last.command.actionId
        : undefined;
    const postponement = postponedActions.get(item.itemId);
    const postponed = !!postponement;
    const category = plan?.proposal.obligations.some((entry) => entry.itemId === item.itemId)
      ? "obligations"
      : plan?.proposal.foci.some((focus) => focus.contributingItemIds.includes(item.itemId))
        ? "foci"
        : plan?.proposal.flexibleOptions.some((entry) => entry.itemId === item.itemId)
          ? "flexible_options"
          : plan?.proposal.deferredItems.some((entry) => entry.itemId === item.itemId)
            ? "deferred_items"
            : undefined;
    return (
      <div
        key={item.itemId}
        className="item-card"
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "10px",
          padding: "10px 14px",
          borderLeft: isObligation
            ? "4px solid #c53030"
            : isSelected
              ? "3px solid var(--accent-color, #2b6cb0)"
              : undefined,
          background: isSelected ? "#f8fafc" : undefined,
        }}
        data-testid={`active-task-item-${item.itemId}`}
        id={`active-week-item-${item.itemId}`}
        tabIndex={-1}
      >
        <div style={{ flex: "1 1 240px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
            <strong>{item.title}</strong>
            <span className="badge badge-idea" style={{ fontSize: "0.75rem" }}>
              {item.source}
            </span>
          </div>
          {postponement && (
            <p className="calm-muted" data-testid={`postponement-note-${item.itemId}`}>
              {postponement.rationale} ·{" "}
              {postponement.targetWeek
                ? `${postponement.targetWeek.startDate} al ${postponement.targetWeek.endDate}`
                : "Sin semana concreta"}
            </p>
          )}
          {item.dueDate && (
            <div className="calm-muted" style={{ fontSize: "0.8rem", marginTop: "2px" }}>
              📅 Fecha límite: <strong>{item.dueDate}</strong>
            </div>
          )}
        </div>

        {outcome?.status === "completed" && (
          <span className="badge" data-testid={`item-completed-${item.itemId}`}>
            Completado
          </span>
        )}
        {onActivity && plan?.status === "active" && (
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            {outcome?.status !== "completed" && !postponed && !isThought && inProposal && (
              <button
                type="button"
                className="secondary small"
                disabled={activityBusy}
                data-testid={`complete-item-${item.itemId}`}
                onClick={() => void onActivity(item.itemId)}
              >
                Marcar como completado
              </button>
            )}
            {undo && (
              <button
                type="button"
                className="secondary small"
                disabled={activityBusy}
                data-testid={`undo-item-${item.itemId}`}
                onClick={() => void onActivity(item.itemId, undo)}
              >
                Deshacer
              </button>
            )}
            {postponed && (
              <span className="calm-muted">
                Postergación vigente · revisa esa decisión antes de completar.
              </span>
            )}
          </div>
        )}
        <details
          className="calm-details item-more-actions"
          data-testid={`task-more-actions-${item.itemId}`}
        >
          <summary
            style={{
              cursor: "pointer",
              fontSize: "0.8rem",
              padding: "4px 8px",
              borderRadius: "4px",
              background: "#f3f4f6",
              border: "1px solid #d1d5db",
              color: "#4b5563",
              userSelect: "none",
              display: "inline-flex",
              alignItems: "center",
              gap: "4px",
            }}
            data-testid={`task-more-actions-summary-${item.itemId}`}
          >
            ••• Más
          </summary>
          <div
            style={{
              marginTop: "6px",
              display: "flex",
              gap: "8px",
              alignItems: "center",
              flexWrap: "wrap",
              padding: "6px 8px",
              background: "#f8fafc",
              border: "1px solid #e2e8f0",
              borderRadius: "4px",
            }}
          >
            <span className="badge badge-muted" style={{ fontSize: "0.8rem" }}>
              ⏱️ {item.estimatedHours ? `${item.estimatedHours}h` : "Sin estimar"}
            </span>
            <span
              className={alloc ? "badge badge-task" : "badge badge-muted"}
              style={{ fontSize: "0.8rem" }}
            >
              📅 {alloc ? alloc.day : "En la semana"}
            </span>
            {onPostpone &&
              category &&
              plan?.status === "active" &&
              !isThought &&
              !postponed &&
              outcome?.status !== "completed" &&
              outcome?.status !== "dropped" && (
                <ItemPostponementControls
                  schedule={schedule}
                  itemId={item.itemId}
                  category={category}
                  busy={activityBusy}
                  onPostpone={(action) => onPostpone(item.itemId, action)}
                />
              )}
            {onMove &&
              inProposal &&
              plan?.status === "active" &&
              !isThought &&
              !postponed &&
              outcome?.status !== "completed" &&
              outcome?.status !== "dropped" && (
                <ItemMovementControls
                  schedule={schedule}
                  itemId={item.itemId}
                  busy={activityBusy}
                  onMove={(action) => onMove(item.itemId, action)}
                />
              )}
            <button
              type="button"
              className="secondary small"
              style={{ fontSize: "0.8rem", padding: "4px 10px" }}
              data-testid={`adjust-task-${item.itemId}`}
              onClick={() => {
                setSelectedAdjustmentItemId(item.itemId);
                setIsAdjustmentOpen(true);
                setLastSavedAdjustment(null);
                const box = document.getElementById("adjustment-proposal-box");
                if (box) box.scrollIntoView({ behavior: "smooth" });
              }}
            >
              Ajustar
            </button>
            <button
              type="button"
              className="secondary small"
              data-testid={`add-to-gcal-${item.itemId}`}
              style={{
                fontSize: "0.8rem",
                padding: "4px 8px",
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
              }}
              title="Abre un evento preparado en Google Calendar; revísalo y guárdalo allí"
              onClick={() => {
                const day = alloc
                  ? alloc.day
                  : item.dueDate || plan?.targetWeek.startDate || "2026-10-19";
                const gcalUrl = buildGoogleCalendarTemplateUrl({
                  title: item.title,
                  day,
                  durationHours: item.estimatedHours || 1,
                  description: `Categoría: ${item.source}${item.rationale ? `\n${item.rationale}` : ""}`,
                });
                window.open(gcalUrl, "_blank", "noopener,noreferrer");
              }}
            >
              <span>📅</span>
              <span>Preparar evento en Google Calendar</span>
            </button>
          </div>
        </details>
      </div>
    );
  };

  return (
    <section
      className="results-section"
      style={{ marginTop: "24px" }}
      aria-label="Agenda y bloques"
      data-testid="active-week-schedule-section"
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
        <div>
          <h3 style={{ margin: 0 }}>Focos y compromisos de esta semana</h3>
          <span className="calm-muted" style={{ fontSize: "0.82rem" }}>
            Lo que has elegido cuidar esta semana
          </span>
        </div>
      </div>

      {onReloadActivity && (
        <p role="alert">
          El cambio no se ha guardado.{" "}
          <button type="button" className="secondary small" onClick={() => void onReloadActivity()}>
            Recargar semana
          </button>
        </p>
      )}
      {exportNotice && (
        <div
          className="status-message status-success"
          style={{
            marginBottom: "14px",
            fontSize: "0.84rem",
            padding: "12px 14px",
            background: "#f0fdf4",
            border: "1px solid #bbf7d0",
            borderRadius: "6px",
          }}
          role="status"
          data-testid="gcal-import-note"
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
              gap: "10px",
            }}
          >
            <div>
              <div style={{ fontWeight: 600, color: "#166534", marginBottom: "4px" }}>
                ✓ Archivo .ics descargado en tu equipo
              </div>
              <p style={{ margin: "2px 0 8px 0", fontSize: "0.8rem", color: "#1e3a5f" }}>
                El archivo no se añade automáticamente a tu calendario. Para añadirlo, impórtalo en
                la web de Google Calendar:
              </p>
              <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                <a
                  href="https://calendar.google.com/calendar/u/0/r/settings/export"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="button primary small"
                  style={{
                    fontSize: "0.8rem",
                    textDecoration: "none",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "5px",
                    padding: "4px 10px",
                  }}
                  data-testid="open-gcal-import-web-button"
                >
                  <span>📅</span>
                  <span>Abrir importador de Google Calendar</span>
                </a>
                <span className="calm-muted" style={{ fontSize: "0.76rem" }}>
                  (En Ajustes → Importar y exportar, selecciona el archivo descargado)
                </span>
              </div>
            </div>
            <button
              type="button"
              className="secondary small"
              onClick={() => setExportNotice(null)}
              style={{ padding: "2px 6px", fontSize: "0.75rem", minWidth: "auto" }}
              aria-label="Cerrar aviso"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      <div className="active-week-priorities" data-testid="active-week-priorities">
        {groups.focuses.length + groups.obligations.length === 0 && (
          <p className="calm-muted" data-testid="empty-active-priorities">
            No hay focos ni compromisos en esta semana. El espacio puede quedarse sin ocupar.
          </p>
        )}
        {groups.focuses.map(({ focus, items, postponedCount }) => (
          <article
            key={focus.id}
            className="calm-box active-focus-card"
            data-testid={`active-focus-${focus.id}`}
          >
            <h4>{focus.title}</h4>
            <p className="calm-text">{focus.desiredOutcome}</p>
            <p className="calm-muted">
              Estimación original del foco: {formatHours(focus.estimatedHours, "sin estimar")}
            </p>
            {postponedCount > 0 && (
              <p className="calm-muted">
                {postponedCount} elemento(s) aplazado(s). La estimación original no se reparte
                automáticamente.
              </p>
            )}
            {items.length > 0 ? (
              <details data-testid={`active-focus-items-${focus.id}`}>
                <summary>Ver y ajustar sus elementos ({items.length})</summary>
                {items.length > 1 && (
                  <p className="calm-muted">
                    La estimación pertenece al foco completo; no está repartida entre sus elementos.
                  </p>
                )}
                <div className="items-list">{items.map(renderItem)}</div>
              </details>
            ) : (
              <p className="calm-muted">Este foco no tiene elementos individuales identificados.</p>
            )}
          </article>
        ))}
        {groups.obligations.length > 0 && (
          <section aria-label="Compromisos de esta semana" data-testid="active-week-commitments">
            <h4>Compromisos ({groups.obligations.length})</h4>
            <div className="items-list">{groups.obligations.map(renderItem)}</div>
          </section>
        )}
      </div>

      {groups.postponed.length > 0 && (
        <details
          className="calm-details active-week-secondary"
          data-testid="active-week-postponed"
          open={schedule.itemActivity?.history.at(-1)?.command.type === "postpone"}
        >
          <summary>Aplazados durante la semana ({groups.postponed.length})</summary>
          <p className="calm-muted">
            Se conservan en el plan y en el cierre. La propuesta original no redistribuye sus
            estimaciones automáticamente.
          </p>
          <div className="items-list">{groups.postponed.map(renderItem)}</div>
        </details>
      )}
      {groups.flexible.length > 0 && (
        <details className="calm-details active-week-secondary" data-testid="active-week-flexible">
          <summary>Si queda espacio ({groups.flexible.length})</summary>
          <p className="calm-muted">Son opciones, no compromisos adicionales.</p>
          <div className="items-list">{groups.flexible.map(renderItem)}</div>
        </details>
      )}
      {groups.deferred.length > 0 && (
        <details className="calm-details active-week-secondary" data-testid="active-week-deferred">
          <summary>Fuera de esta semana ({groups.deferred.length})</summary>
          <p className="calm-muted">
            Se conservan en el plan para consulta y cierre; no figuran como prioridades de esta
            semana.
          </p>
          <div className="items-list">{groups.deferred.map(renderItem)}</div>
        </details>
      )}
      {groups.agenda.length > 0 && (
        <details
          className="calm-details active-week-secondary"
          data-testid="active-week-agenda-items"
        >
          <summary>Otros elementos de la agenda ({groups.agenda.length})</summary>
          <p className="calm-muted">
            Tienen una asignación en la agenda, sin estar clasificados como foco o compromiso en la
            propuesta.
          </p>
          <div className="items-list">{groups.agenda.map(renderItem)}</div>
        </details>
      )}
      {groups.unclassified.length > 0 && (
        <details
          className="calm-details active-week-secondary"
          data-testid="active-week-other-items"
        >
          <summary>Otros elementos guardados ({groups.unclassified.length})</summary>
          <div className="items-list">{groups.unclassified.map(renderItem)}</div>
        </details>
      )}
      {schedule.timeBlocks.length > 0 && (
        <details
          className="calm-details active-week-secondary"
          data-testid="active-week-time-blocks"
        >
          <summary>Ver bloques de horario ({schedule.timeBlocks.length})</summary>
          <div className="items-list">
            {schedule.timeBlocks.map((block, idx) => (
              <div key={idx} className="item-card active-time-block">
                <strong>
                  {planItems.find((item) => item.itemId === block.itemId)?.title ||
                    "Bloque de tiempo"}
                </strong>
                <span className="calm-muted">
                  {block.day} · {block.startTime} - {block.endTime}
                </span>
                <code>{block.itemId}</code>
              </div>
            ))}
          </div>
        </details>
      )}

      {planItems.length > 0 && (
        <details
          className="calm-details"
          data-testid="reminders-and-alerts-details"
          open={isExportOpen}
          onToggle={(e) => setIsExportOpen((e.target as HTMLDetailsElement).open)}
          style={{
            marginTop: "16px",
            background: "var(--surface-warm, #fcfbf8)",
            border: "1px solid var(--border-color, #e6ded1)",
            borderRadius: "8px",
            padding: "10px 14px",
          }}
        >
          <summary
            style={{
              cursor: "pointer",
              fontWeight: 500,
              fontSize: "0.88rem",
              userSelect: "none",
            }}
            data-testid="reminders-and-alerts-summary"
          >
            Calendario y compartir
          </summary>
          <div
            style={{
              marginTop: "12px",
              display: "flex",
              flexDirection: "column",
              gap: "16px",
            }}
          >
            <p className="calm-muted" data-testid="active-week-export-scope">
              La exportación y el resumen incluyen el plan completo ({planItems.length} elementos),
              también las opciones flexibles y los elementos aplazados o fuera de esta semana.
            </p>

            <div
              style={{
                background: "#ffffff",
                padding: "12px",
                border: "1px solid var(--border-color, #e6ded1)",
                borderRadius: "6px",
              }}
            >
              <h4 style={{ margin: "0 0 6px 0", fontSize: "0.9rem" }}>
                Calendario y recordatorios
              </h4>
              <p className="calm-muted" style={{ margin: "0 0 8px 0", fontSize: "0.78rem" }}>
                Descarga un archivo para importarlo en Google Calendar, Apple Calendar u otro
                calendario compatible. No conecta tu cuenta ni mantiene los cambios sincronizados.
                Elige los recordatorios antes de descargarlo.
              </p>
              <CalendarReminderSettings compact />
              <div
                style={{
                  marginTop: "10px",
                  display: "flex",
                  gap: "8px",
                  alignItems: "center",
                  flexWrap: "wrap",
                }}
              >
                <button
                  type="button"
                  className="secondary small"
                  data-testid="add-week-to-gcal-button"
                  style={{
                    fontSize: "0.8rem",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "5px",
                  }}
                  onClick={handleDownloadWeekIcs}
                >
                  <span>📅</span>
                  <span>Descargar calendario (.ics)</span>
                </button>
                <a
                  href="https://calendar.google.com/calendar/u/0/r/settings/export"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="button secondary small"
                  style={{
                    fontSize: "0.8rem",
                    textDecoration: "none",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "5px",
                  }}
                  data-testid="link-gcal-settings-export"
                >
                  <span>↗</span>
                  <span>Importar en Google Calendar Web</span>
                </a>
              </div>
            </div>
            <div id="email-summary-card-wrapper">
              <EmailSummaryCard
                targetWeek={plan?.targetWeek || { startDate: "2026-10-19", endDate: "2026-10-25" }}
                items={planItems.map((item) => {
                  const alloc = schedule.dailyAllocations.find((a) => a.itemId === item.itemId);
                  return {
                    title: item.title,
                    day:
                      alloc?.day ||
                      schedule.timeBlocks.find((row) => row.itemId === item.itemId)?.day ||
                      plan?.draftContext?.plannedDays?.[item.itemId] ||
                      item.dueDate,
                    source: item.source,
                  };
                })}
              />
            </div>
          </div>
        </details>
      )}

      {!!schedule.itemActivity?.history.length && (
        <details className="calm-details" data-testid="daily-activity-history">
          <summary>Actividad registrada ({schedule.itemActivity.history.length})</summary>
          <ul>
            {schedule.itemActivity.history.map((record) => (
              <li key={record.command.actionId}>
                {planItems.find((item) => item.itemId === record.command.itemId)?.title ??
                  "Elemento guardado"}{" "}
                ·{" "}
                {record.command.type === "complete"
                  ? "Marcado como completado"
                  : record.command.type === "move"
                    ? "Asignación movida"
                    : record.command.type === "postpone"
                      ? "Elemento aplazado"
                      : "Se deshizo la última acción"}{" "}
                · {record.command.decidedAt}
              </li>
            ))}
          </ul>
          {schedule.itemActivity.reviewCheckpoint && (
            <p>Resultados actualizados al reabrir el último cierre.</p>
          )}
          <p className="calm-muted">
            Deshacer está disponible en el elemento de la última acción si la semana no ha cambiado
            después.
          </p>
        </details>
      )}
      <ActiveWeekAdjustmentPanel
        schedule={schedule}
        plan={plan}
        planItems={planItems}
        selectedAdjustmentItemId={selectedAdjustmentItemId}
        setSelectedAdjustmentItemId={setSelectedAdjustmentItemId}
        isAdjustmentOpen={isAdjustmentOpen}
        setIsAdjustmentOpen={setIsAdjustmentOpen}
        lastSavedAdjustment={lastSavedAdjustment}
        setLastSavedAdjustment={setLastSavedAdjustment}
        targetWeekStart={targetWeekStart}
        setTargetWeekStart={setTargetWeekStart}
        targetWeekEnd={targetWeekEnd}
        setTargetWeekEnd={setTargetWeekEnd}
        deadlineInput={deadlineInput}
        setDeadlineInput={setDeadlineInput}
        taskHoursInput={taskHoursInput}
        setTaskHoursInput={setTaskHoursInput}
        taskDayInput={taskDayInput}
        setTaskDayInput={setTaskDayInput}
        isAdjustmentPreviewOpen={isAdjustmentPreviewOpen}
        setIsAdjustmentPreviewOpen={setIsAdjustmentPreviewOpen}
        handleSaveTaskAdjustment={handleSaveTaskAdjustment}
        applyAdjustment={applyAdjustment}
        setFeedbackMessage={setFeedbackMessage}
        targetDraft={targetDraft}
        onOpenDestination={onOpenDestination}
      />
    </section>
  );
}
