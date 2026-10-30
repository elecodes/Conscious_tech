import { WeeklySchedule } from "../../domain/schedule";
import { StoredWeeklyPlan } from "../../domain/repositories/types";
import { buildGoogleCalendarTemplateUrl, generateIcsCalendarExport } from "../../domain/calendar";
import { PlanItemSummary } from "./weekly-reflective-closing-section";
import { ActiveWeekAdjustmentPanel } from "./active-week-adjustment-panel";

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
  return (
    <section
      className="results-section"
      style={{ marginTop: "24px" }}
      aria-label="Agenda y bloques"
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
            onClick={() => {
              const exportItems = planItems.map((item) => {
                const alloc = schedule.dailyAllocations.find((a) => a.itemId === item.itemId);
                const day = alloc
                  ? alloc.day
                  : item.dueDate || plan?.targetWeek.startDate || "2026-10-19";
                return {
                  title: item.title,
                  day,
                  durationHours: item.estimatedHours || 1,
                  description: `Categoría: ${item.source}${item.rationale ? `\nMotivo: ${item.rationale}` : ""}`,
                };
              });
              const icsContent = generateIcsCalendarExport(
                exportItems,
                "Conscious Tech — Semana Activa"
              );
              const blob = new Blob([icsContent], { type: "text/calendar;charset=utf-8" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `conscious-tech-semana-${plan?.targetWeek.startDate || "activa"}.ics`;
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              URL.revokeObjectURL(url);
            }}
          >
            <span>📅</span>
            <span>Exportar semana (.ics / Google Cal)</span>
          </button>
        )}
      </div>

      <div className="items-list" style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {planItems.length === 0 ? (
          <p className="calm-muted">No hay tareas identificadas en el plan.</p>
        ) : (
          planItems.map((item) => {
            const alloc = schedule.dailyAllocations.find((a) => a.itemId === item.itemId);
            const isSelected = (selectedAdjustmentItemId || planItems[0]?.itemId) === item.itemId;

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
                  borderLeft: isSelected ? "3px solid var(--accent-color, #2b6cb0)" : undefined,
                  background: isSelected ? "#f8fafc" : undefined,
                }}
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

                <div
                  style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}
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
                    title="Abrir y guardar en Google Calendar con 1 clic"
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
                    <span>Google Cal</span>
                  </button>
                </div>
              </div>
            );
          })
        )}

        {schedule.timeBlocks.length > 0 && (
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
