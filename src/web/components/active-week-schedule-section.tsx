import { useState } from "react";
import { WeeklySchedule } from "../../domain/schedule";
import { StoredWeeklyPlan } from "../../domain/repositories/types";
import { buildGoogleCalendarTemplateUrl, generateIcsCalendarExport } from "../../domain/calendar";
import { getStoredReminderPreferences } from "../../domain/reminders";
import { PlanItemSummary } from "./weekly-reflective-closing-section";
import { ActiveWeekAdjustmentPanel } from "./active-week-adjustment-panel";
import { CalendarReminderSettings } from "./calendar-reminder-settings";
import { EmailSummaryCard } from "./email-summary-card";

export interface ActiveWeekScheduleSectionProps {
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

export function ActiveWeekScheduleSection({
  schedule,
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
}: ActiveWeekScheduleSectionProps) {
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  const [isExportOpen, setIsExportOpen] = useState(false);

  const handleDownloadWeekIcs = () => {
    const prefs = getStoredReminderPreferences();
    const exportItems = planItems.map((item) => {
      const alloc = schedule.dailyAllocations.find((a) => a.itemId === item.itemId);
      const timeBlock = schedule.timeBlocks.find((tb) => tb.itemId === item.itemId);
      const day = alloc ? alloc.day : item.dueDate || plan?.targetWeek.startDate || "2026-10-19";
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
          <h3 style={{ margin: 0 }}>Agenda y tareas de la semana ({planItems.length})</h3>
          <span className="calm-muted" style={{ fontSize: "0.82rem" }}>
            Tus prioridades activas en este cuaderno
          </span>
        </div>
        {planItems.length > 0 && (
          <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
            <button
              type="button"
              className="primary small"
              data-testid="add-week-to-gcal-button"
              style={{
                fontSize: "0.8rem",
                padding: "4px 10px",
                display: "inline-flex",
                alignItems: "center",
                gap: "5px",
              }}
              title="Descarga el archivo .ics con tus tareas y recordatorios para importar en Google Calendar"
              onClick={handleDownloadWeekIcs}
            >
              <span>📅</span>
              <span>Añadir semana a Google Calendar (.ics)</span>
            </button>
            <button
              type="button"
              className="secondary small"
              data-testid="open-email-summary-top-button"
              style={{
                fontSize: "0.8rem",
                padding: "4px 10px",
                display: "inline-flex",
                alignItems: "center",
                gap: "5px",
              }}
              onClick={() => {
                setIsExportOpen(true);
                setTimeout(() => {
                  const el = document.getElementById("email-summary-card-wrapper");
                  if (el) el.scrollIntoView({ behavior: "smooth" });
                }, 50);
              }}
            >
              <span>✉️</span>
              <span>Enviar a Gmail / Correo</span>
            </button>
            <button
              type="button"
              className="secondary small"
              data-testid="export-week-to-gcal"
              style={{
                fontSize: "0.8rem",
                padding: "4px 10px",
                display: "inline-flex",
                alignItems: "center",
                gap: "5px",
              }}
              onClick={handleDownloadWeekIcs}
            >
              <span>Exportar (.ics)</span>
            </button>
          </div>
        )}
      </div>

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
                Para que aparezca en tu Google Calendar y sincronice con tu móvil, impórtalo en la
                web de Google Calendar:
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

      <div className="items-list" style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {planItems.length === 0 ? (
          <p className="calm-muted">No hay tareas identificadas en el plan.</p>
        ) : (
          planItems.map((item) => {
            const alloc = schedule.dailyAllocations.find((a) => a.itemId === item.itemId);
            const isSelected = (selectedAdjustmentItemId || planItems[0]?.itemId) === item.itemId;
            const isObligation =
              item.source === "Obligación" || item.source?.toLowerCase().includes("obligaci");

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
              >
                <div style={{ flex: "1 1 240px" }}>
                  <div
                    style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}
                  >
                    <strong>{item.title}</strong>
                    <span className="badge badge-idea" style={{ fontSize: "0.75rem" }}>
                      {item.source}
                    </span>
                  </div>
                  {item.dueDate && (
                    <div className="calm-muted" style={{ fontSize: "0.8rem", marginTop: "2px" }}>
                      📅 Fecha límite: <strong>{item.dueDate}</strong>
                    </div>
                  )}
                </div>

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
                      title="Abrir y guardar en Google Calendar en 1 clic (sincroniza directo con tu móvil)"
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
                      <span>Google Cal (1 clic)</span>
                    </button>
                  </div>
                </details>
              </div>
            );
          })
        )}

        {schedule.timeBlocks && schedule.timeBlocks.length > 0 && (
          <div style={{ marginTop: "16px" }}>
            <h4 style={{ margin: "0 0 8px 0" }}>Bloques de horario específico</h4>
            {schedule.timeBlocks.map((block, idx) => (
              <div key={idx} className="item-card" style={{ padding: "8px 12px" }}>
                <div className="item-title">{block.itemId}</div>
                <div className="item-tags">
                  <span className="badge badge-muted">📅 {block.day}</span>
                  <span className="badge badge-muted">
                    ⏰ {block.startTime} - {block.endTime}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

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
            📤 Exportar y compartir semana (Google Calendar, Gmail y recordatorios y avisos)
          </summary>
          <div
            style={{
              marginTop: "12px",
              display: "flex",
              flexDirection: "column",
              gap: "16px",
            }}
          >
            <div id="email-summary-card-wrapper">
              <EmailSummaryCard
                targetWeek={plan?.targetWeek || { startDate: "2026-10-19", endDate: "2026-10-25" }}
                items={planItems.map((item) => {
                  const alloc = schedule.dailyAllocations.find((a) => a.itemId === item.itemId);
                  return {
                    title: item.title,
                    day: alloc ? alloc.day : item.dueDate,
                    source: item.source,
                  };
                })}
              />
            </div>

            <div
              style={{
                background: "#ffffff",
                padding: "12px",
                border: "1px solid var(--border-color, #e6ded1)",
                borderRadius: "6px",
              }}
            >
              <h4 style={{ margin: "0 0 6px 0", fontSize: "0.9rem" }}>
                Recordatorios y avisos de calendario
              </h4>
              <p className="calm-muted" style={{ margin: "0 0 8px 0", fontSize: "0.78rem" }}>
                Configura los avisos para eventos con fecha y hora al exportar a Google Calendar o Apple Calendar.
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
                  data-testid="download-ics-from-reminders-button"
                  style={{
                    fontSize: "0.8rem",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "5px",
                  }}
                  onClick={handleDownloadWeekIcs}
                >
                  <span>📅</span>
                  <span>Añadir semana a Google Calendar (.ics)</span>
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
          </div>
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
      />
    </section>
  );
}
