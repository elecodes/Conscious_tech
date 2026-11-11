import { useCalendarDrag } from "../use-calendar-drag";
import { calendarMovement } from "../calendar-movement";
import { useEffect, useState } from "react";
import type { StoredWeeklyPlan } from "../../domain/repositories/types";
import type { WeeklySchedule } from "../../domain/schedule";
import type { PlanItemSummary } from "./weekly-reflective-closing-section";
import { buildTaskCalendar, type CalendarTask, type CalendarEntry } from "../task-calendar-model";

const dateLabel = (value: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("es-ES", { ...options, timeZone: "UTC" }).format(
    new Date(`${value}T00:00:00Z`)
  );
const statusLabel: Record<CalendarTask["state"], string> = {
  pending: "Pendiente",
  in_progress: "En curso",
  completed: "Completado",
  dropped: "Descartado",
  consciously_postponed: "Aplazado",
};
export function ActiveTaskCalendar({
  plan,
  schedule,
  items,
  onInspect,
  onMove,
  busy = false,
}: {
  plan: StoredWeeklyPlan;
  schedule: WeeklySchedule | null;
  items: readonly PlanItemSummary[];
  onInspect: (id: string) => void;
  onMove?: (id: string, sourceDay: string, targetDay: string) => void;
  busy?: boolean;
}) {
  const drag = useCalendarDrag((id, source, day) => {
    if (source && day && !busy) onMove?.(id, source, day);
  });
  const movable = (task: CalendarTask, day: string) =>
    !!onMove &&
    !!schedule &&
    !busy &&
    task.state !== "completed" &&
    task.state !== "dropped" &&
    !!calendarMovement(
      schedule,
      task.itemId,
      day,
      day === plan.targetWeek.startDate ? plan.targetWeek.endDate : plan.targetWeek.startDate
    );
  const [showAll, setShowAll] = useState(false);
  const [page, setPage] = useState(0);
  useEffect(() => {
    setPage(0);
  }, [plan.planId, plan.targetWeek.startDate, plan.targetWeek.endDate]);
  const model = buildTaskCalendar(plan, schedule, items, page);
  const visible = (task: CalendarTask) =>
    showAll || (task.state !== "completed" && task.state !== "dropped");
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const taskCard = (task: CalendarTask, slot: string, entry?: CalendarEntry) => (
    <li key={`${task.itemId}-${slot}`}>
      <button
        type="button"
        className={`task-calendar-entry task-calendar-${task.state}`}
        draggable={!!entry && movable(task, entry.day)}
        onDragStart={(event) => {
          if (entry && movable(task, entry.day)) drag.start(event, task.itemId, entry.day);
          else event.preventDefault();
        }}
        onDragEnd={drag.end}
        onClick={() => onInspect(task.itemId)}
        data-testid={`calendar-task-${task.itemId}-${slot}`}
      >
        <span className="task-calendar-entry-title">{task.title}</span>
        <span className="task-calendar-tags">
          <span>
            {task.kind === "note" && task.state === "pending"
              ? "Nota"
              : task.kind === "outside" && task.state === "pending"
                ? "Fuera de esta semana"
                : statusLabel[task.state]}
          </span>
          {task.kind === "optional" && <span>Opcional</span>}
          {task.kind === "other" && <span>Otra asignación</span>}
        </span>
        {entry?.blocks.map((block) => (
          <span key={`${block.startTime}-${block.endTime}`} className="task-calendar-time">
            {block.startTime}–{block.endTime}
          </span>
        ))}
        {entry?.hours !== undefined && (
          <span className="task-calendar-time">{entry.hours} h asignadas al día</span>
        )}
        {task.dueDate && (
          <span className="task-calendar-meta">
            Límite: {dateLabel(task.dueDate, { day: "numeric", month: "short" })}
          </span>
        )}
        {task.kind === "postponed" && (
          <span className="task-calendar-meta">
            {task.destination
              ? `Destino: ${dateLabel(task.destination.startDate, { day: "numeric", month: "short" })}–${dateLabel(task.destination.endDate, { day: "numeric", month: "short", year: "numeric" })}`
              : "Sin semana de destino"}
          </span>
        )}
      </button>
      {entry && movable(task, entry.day) && (
        <label className="calendar-move-select">
          Mover a
          <select
            aria-label={`Mover ${task.title} a otro día`}
            value={entry.day}
            onChange={(event) => onMove?.(task.itemId, entry.day, event.target.value)}
          >
            {model.days.map((day) => (
              <option key={day.date} value={day.date}>
                {dateLabel(day.date, { weekday: "short", day: "numeric", month: "short" })}
              </option>
            ))}
          </select>
        </label>
      )}
    </li>
  );
  const undated = model.undated.filter(visible);
  const extras = model.extras.filter(visible);
  return (
    <section
      className="task-calendar"
      aria-label="Calendario de tareas de Mi semana"
      data-testid="active-task-calendar"
    >
      <div className="task-calendar-heading">
        <div>
          <p className="task-calendar-eyebrow">Vista rápida · Mi semana</p>
          <h3>Calendario de tareas</h3>
          <p className="task-calendar-range" data-testid="calendar-week-range">
            Semana del {dateLabel(model.range.startDate, { day: "numeric", month: "long" })} al{" "}
            {dateLabel(model.range.endDate, { day: "numeric", month: "long", year: "numeric" })}
          </p>
        </div>
        <div className="task-calendar-filter" role="group" aria-label="Filtrar tareas">
          <button
            type="button"
            className={!showAll ? "primary small" : "secondary small"}
            aria-pressed={!showAll}
            onClick={() => setShowAll(false)}
            data-testid="calendar-filter-pending"
          >
            Pendientes
          </button>
          <button
            type="button"
            className={showAll ? "primary small" : "secondary small"}
            aria-pressed={showAll}
            onClick={() => setShowAll(true)}
            data-testid="calendar-filter-all"
          >
            Todas
          </button>
        </div>
      </div>
      <p className="task-calendar-counts" data-testid="calendar-counts">
        <strong>
          {model.pending} {model.pending === 1 ? "pendiente" : "pendientes"}
        </strong>
        <span>
          {model.optional} {model.optional === 1 ? "opcional" : "opcionales"}
        </span>
        <span>
          {model.completed} {model.completed === 1 ? "completada" : "completadas"}
        </span>
        <span>
          {model.postponed} {model.postponed === 1 ? "aplazada" : "aplazadas"}
        </span>
      </p>
      <p className="calm-muted task-calendar-hint">
        Arrastra una tarea con asignación simple a otro día o usa Mover a. Pulsa la tarea para ver
        todos sus controles. Solo las asignaciones guardadas aparecen en un día; una fecha límite no
        asigna la tarea a ese día.
      </p>
      {model.pages > 1 && (
        <nav className="task-calendar-pagination" aria-label="Días de esta planificación">
          <button
            type="button"
            className="secondary small"
            disabled={model.currentPage === 0}
            onClick={() => setPage(model.currentPage - 1)}
          >
            Días anteriores
          </button>
          <span>
            Vista {model.currentPage + 1} de {model.pages}
          </span>
          <button
            type="button"
            className="secondary small"
            disabled={model.currentPage === model.pages - 1}
            onClick={() => setPage(model.currentPage + 1)}
          >
            Días siguientes
          </button>
        </nav>
      )}
      <div className="task-calendar-grid">
        {model.days.map((day) => {
          const entries = day.entries.filter((entry) => visible(entry.task));
          return (
            <section
              key={day.date}
              className={`task-calendar-day${day.date === today ? " task-calendar-today" : ""}${drag.over === day.date ? " calendar-drop-over" : ""}`}
              {...drag.target(day.date)}
              aria-label={dateLabel(day.date, { weekday: "long", day: "numeric", month: "long" })}
              data-testid={`calendar-day-${day.date}`}
            >
              <header>
                <span>{dateLabel(day.date, { weekday: "short" })}</span>
                <strong>{dateLabel(day.date, { day: "numeric", month: "short" })}</strong>
                {day.date === today && <span className="badge">Hoy</span>}
              </header>
              {entries.length ? (
                <ul>{entries.map((entry) => taskCard(entry.task, day.date, entry))}</ul>
              ) : (
                <p className="task-calendar-empty">Sin tareas asignadas</p>
              )}
            </section>
          );
        })}
      </div>
      <section
        className="task-calendar-undated"
        aria-label="Tareas de esta semana sin día asignado"
        data-testid="calendar-undated"
      >
        <h4>
          En esta semana · sin día asignado <span>({undated.length})</span>
        </h4>
        <p className="calm-muted">
          Estas tareas están incluidas en la semana mostrada, pero aún no tienen día ni horario
          guardado.
        </p>
        {undated.length ? (
          <ul>{undated.map((task) => taskCard(task, "undated"))}</ul>
        ) : (
          <p className="calm-muted">No hay tareas por asignar a un día en esta vista.</p>
        )}
      </section>
      {!!extras.length && (
        <details className="task-calendar-extras" data-testid="calendar-extras">
          <summary>Aplazados, fuera de esta semana y notas ({extras.length})</summary>
          <ul>{extras.map((task) => taskCard(task, "outside"))}</ul>
        </details>
      )}
      {!!model.outOfRange.length && (
        <details className="task-calendar-extras">
          <summary>Revisar asignaciones fuera del rango ({model.outOfRange.length})</summary>
          <ul>
            {model.outOfRange
              .filter((entry) => visible(entry.task))
              .map((entry) => taskCard(entry.task, `outside-${entry.day}`, entry))}
          </ul>
        </details>
      )}
    </section>
  );
}
