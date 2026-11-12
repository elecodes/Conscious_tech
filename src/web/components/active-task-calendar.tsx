import { TaskDaySplitEditor } from "./task-day-split-editor";
import { taskHoursBudget } from "../task-distribution";
import type { DailyWorkAllocation } from "../../domain/schedule";
import { calendarTaskStatus } from "../calendar-task-status";
import { useCalendarDrag } from "../use-calendar-drag";
import { calendarMovement } from "../calendar-movement";
import { useEffect, useRef, useState } from "react";
import type { StoredWeeklyPlan } from "../../domain/repositories/types";
import type { WeeklySchedule } from "../../domain/schedule";
import type { PlanItemSummary } from "./weekly-reflective-closing-section";
import { buildTaskCalendar, type CalendarTask, type CalendarEntry } from "../task-calendar-model";

const dateLabel = (value: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("es-ES", { ...options, timeZone: "UTC" }).format(
    new Date(`${value}T00:00:00Z`)
  );
export function ActiveTaskCalendar({
  plan,
  schedule,
  items,
  onInspect,
  onMove,
  onDistribute,
  onSchedule,
  onComplete,
  busy = false,
}: {
  plan: StoredWeeklyPlan;
  schedule: WeeklySchedule | null;
  items: readonly PlanItemSummary[];
  onInspect: (id: string) => void;
  onMove?: (id: string, sourceDay: string, targetDay: string) => void;
  onDistribute?: (id: string, rows: DailyWorkAllocation[]) => Promise<boolean>;
  onSchedule?: (id: string, day: string, hours: number | null) => Promise<boolean>;
  onComplete?: (id: string, undoActionId?: string) => Promise<boolean>;
  busy?: boolean;
}) {
  const movedTask = useRef<{ id: string; source: string; target: string } | null>(null);
  const requestMove = (id: string, source: string, target: string) => {
    if (busy || source === target) return;
    movedTask.current = { id, source, target };
    onMove?.(id, source, target);
  };
  const [editing, setEditing] = useState<{ task: CalendarTask; day: string } | null>(null);
  const [hours, setHours] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const editor = useRef<HTMLDialogElement>(null);
  const editLock = useRef(false);
  const openEditor = (task: CalendarTask, day: string) => {
    setEditing({ task, day });
    const budget = taskHoursBudget(
      plan.proposal,
      plan.draftContext?.extractedItems,
      task.itemId,
      schedule?.dailyAllocations.filter((row) => row.itemId === task.itemId)
    );
    setHours(budget == null ? "" : String(budget));
    setEditError(null);
    editor.current?.showModal();
  };
  const recoverable = (task: CalendarTask) =>
    !!onSchedule &&
    (task.kind === "outside" || task.kind === "postponed") &&
    task.state !== "completed" &&
    task.state !== "dropped";
  const undatedPlaceable = (task: CalendarTask) =>
    !!onSchedule &&
    (task.kind === "priority" || task.kind === "optional") &&
    task.state !== "completed" &&
    task.state !== "dropped" &&
    model.undated.some((row) => row.itemId === task.itemId);
  const canPlace = (task: CalendarTask) => recoverable(task) || undatedPlaceable(task);
  const drag = useCalendarDrag((id, source, day) => {
    if (busy) return;
    if (source && day) requestMove(id, source, day);
    else if (day) {
      const task = [...model.extras, ...model.undated].find((row) => row.itemId === id);
      if (task && canPlace(task)) openEditor(task, day);
    }
  });
  useEffect(() => {
    if (busy || !movedTask.current) return;
    const { id, source, target } = movedTask.current;
    const card =
      document.getElementById(`calendar-task-${id}-${target}`) ??
      document.getElementById(`calendar-task-${id}-${source}`);
    card?.focus({ preventScroll: true });
    movedTask.current = null;
  }, [busy, schedule?.version]);
  const movable = (task: CalendarTask, day: string) =>
    !!onMove &&
    !!schedule &&
    task.state !== "completed" &&
    task.state !== "dropped" &&
    !!calendarMovement(
      schedule,
      task.itemId,
      day,
      day === plan.targetWeek.startDate ? plan.targetWeek.endDate : plan.targetWeek.startDate
    );
  const [showAll, setShowAll] = useState(true);
  const [page, setPage] = useState(0);
  useEffect(() => {
    setPage(0);
  }, [plan.planId, plan.targetWeek.startDate, plan.targetWeek.endDate]);
  const model = buildTaskCalendar(plan, schedule, items, page);
  const visible = (task: CalendarTask) =>
    showAll || (task.state !== "completed" && task.state !== "dropped");
  const inspector = useRef<HTMLDialogElement>(null);
  const [inspectedId, setInspectedId] = useState<string | null>(null);
  const [activityMessage, setActivityMessage] = useState<string | null>(null);
  const completionLock = useRef(false);
  const allTasks = [
    ...model.days.flatMap((day) => day.entries.map((entry) => entry.task)),
    ...model.undated,
    ...model.extras,
    ...model.outOfRange.map((entry) => entry.task),
  ];
  const inspected = allTasks.find((task) => task.itemId === inspectedId);
  const canComplete = (task: CalendarTask) =>
    !!onComplete &&
    !["note", "outside", "postponed"].includes(task.kind) &&
    task.state !== "completed" &&
    task.state !== "dropped";
  const undoCompletion = (task: CalendarTask) => {
    const last = schedule?.itemActivity?.history.at(-1);
    return task.state === "completed" &&
      last?.command.type === "complete" &&
      last.command.itemId === task.itemId &&
      last.appliedVersion === schedule?.version
      ? last.command.actionId
      : undefined;
  };
  const completeTask = async (task: CalendarTask, undo?: string) => {
    if (busy || completionLock.current || !onComplete) return;
    completionLock.current = true;
    setActivityMessage(null);
    setShowAll(true);
    try {
      const saved = await onComplete(task.itemId, undo);
      setActivityMessage(
        saved
          ? undo
            ? `«${task.title}» vuelve a estar pendiente.`
            : `✓ «${task.title}» completada. Se conserva en el calendario.`
          : `No se guardó el cambio de «${task.title}». Recarga e inténtalo de nuevo.`
      );
    } catch {
      setActivityMessage(`No se pudo guardar el cambio de «${task.title}». Inténtalo de nuevo.`);
    } finally {
      completionLock.current = false;
    }
  };
  const inspectTask = (task: CalendarTask) => {
    setInspectedId(task.itemId);
    setActivityMessage(null);
    inspector.current?.showModal();
  };
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const taskCard = (task: CalendarTask, slot: string, entry?: CalendarEntry) => {
    const status = calendarTaskStatus(task, !!entry);
    const canAdjust =
      !["note", "outside", "postponed"].includes(task.kind) &&
      task.state !== "completed" &&
      task.state !== "dropped";
    return (
      <li
        key={`${task.itemId}-${slot}`}
        className={`calendar-task-card calendar-tone-${status.tone}`}
        data-testid={`calendar-card-${task.itemId}-${slot}`}
      >
        <button
          type="button"
          className={`task-calendar-entry task-calendar-${task.state}`}
          draggable={!busy && (canPlace(task) || (!!entry && movable(task, entry.day)))}
          onDragStart={(event) => {
            if (entry && !busy && movable(task, entry.day))
              drag.start(event, task.itemId, entry.day);
            else if (!busy && canPlace(task)) drag.start(event, task.itemId, null);
            else event.preventDefault();
          }}
          onDragEnd={drag.end}
          onClick={() =>
            recoverable(task) ? openEditor(task, model.days[0]!.date) : inspectTask(task)
          }
          id={`calendar-task-${task.itemId}-${slot}`}
          data-testid={`calendar-task-${task.itemId}-${slot}`}
        >
          <span className="task-calendar-entry-title">{task.title}</span>
          <span className="task-calendar-tags">
            <span className="calendar-status">
              <span aria-hidden="true">{status.symbol}</span> {status.label}
            </span>
            {task.state === "in_progress" && <span>En curso</span>}
            {task.kind === "optional" && <span>Opcional</span>}
            {task.kind === "other" && <span>Otra asignación</span>}
          </span>
          {entry?.blocks.map((block) => (
            <span key={`${block.startTime}-${block.endTime}`} className="task-calendar-time">
              {block.startTime}–{block.endTime}
            </span>
          ))}
          {entry?.hours !== undefined && (
            <span className="task-calendar-time" title="Horas asignadas a este día">
              {entry.hours} h
            </span>
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
        {canComplete(task) && (
          <button
            type="button"
            className="secondary small calendar-adjust-hours"
            disabled={busy}
            aria-label={`Marcar ${task.title} como completada`}
            data-testid={`calendar-complete-${task.itemId}-${slot}`}
            onClick={() => void completeTask(task)}
          >
            ✓ Completar
          </button>
        )}
        {onComplete && undoCompletion(task) && (
          <button
            type="button"
            className="secondary small calendar-adjust-hours"
            disabled={busy}
            data-testid={`calendar-undo-${task.itemId}-${slot}`}
            onClick={() => void completeTask(task, undoCompletion(task))}
          >
            Deshacer completado
          </button>
        )}
        {canPlace(task) && (
          <button
            type="button"
            className="secondary small calendar-adjust-hours"
            disabled={busy}
            onClick={() => openEditor(task, model.days[0]!.date)}
          >
            {undatedPlaceable(task) ? "Elegir día" : "Añadir a un día"}
          </button>
        )}
        {canAdjust &&
          !!entry &&
          onSchedule &&
          (schedule?.dailyAllocations.filter((row) => row.itemId === task.itemId).length ?? 0) <=
            1 &&
          !schedule?.timeBlocks.some((row) => row.itemId === task.itemId) && (
            <button
              type="button"
              className="secondary small calendar-adjust-hours"
              disabled={busy}
              onClick={() => openEditor(task, entry?.day ?? model.days[0]!.date)}
            >
              Ajustar horas
            </button>
          )}
        {canAdjust && onDistribute && (
          <TaskDaySplitEditor
            id={task.itemId}
            title={task.title}
            week={plan.targetWeek}
            totalHours={taskHoursBudget(
              plan.proposal,
              plan.draftContext?.extractedItems,
              task.itemId,
              schedule?.dailyAllocations.filter((row) => row.itemId === task.itemId)
            )}
            rows={schedule?.dailyAllocations.filter((row) => row.itemId === task.itemId) ?? []}
            onSave={(rows) => onDistribute(task.itemId, rows)}
            disabled={busy}
            fixed={!!schedule?.timeBlocks.some((row) => row.itemId === task.itemId)}
            testKey={`active-${task.itemId}-${slot}`}
          />
        )}
        {canAdjust && !undatedPlaceable(task) && (
          <details
            className="calendar-task-actions"
            data-testid={`calendar-actions-${task.itemId}-${slot}`}
          >
            <summary aria-label={`Cambiar día de ${task.title}`}>Cambiar día</summary>
            <p className="calendar-action-scope">
              Solo esta tarea: <strong>{task.title}</strong>
            </p>
            {entry && movable(task, entry.day) ? (
              <label className="calendar-day-picker">
                Día de esta tarea
                <select
                  aria-label={`Mover ${task.title} a otro día`}
                  disabled={busy}
                  value={entry.day}
                  onChange={(event) => {
                    if (!busy && event.target.value !== entry.day)
                      requestMove(task.itemId, entry.day, event.target.value);
                  }}
                >
                  {model.days.map((day) => (
                    <option key={day.date} value={day.date}>
                      {dateLabel(day.date, { weekday: "short", day: "numeric", month: "short" })}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <>
                <p className="calendar-action-scope">
                  {entry
                    ? "Revisa el día y las asignaciones de esta tarea en sus ajustes."
                    : "Elige un día para esta tarea en sus ajustes."}
                </p>
                <button
                  type="button"
                  className="calendar-open-settings"
                  disabled={busy}
                  onClick={() => onInspect(task.itemId)}
                >
                  Abrir ajustes de esta tarea
                </button>
              </>
            )}
          </details>
        )}
      </li>
    );
  };
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
      {activityMessage && !inspected && (
        <p
          role="status"
          className="calendar-completion-feedback"
          data-testid="calendar-completion-feedback"
        >
          {activityMessage}
        </p>
      )}
      <dialog
        ref={inspector}
        onClose={() => setInspectedId(null)}
        className="calendar-task-editor"
        aria-label="Detalle de la tarea"
        data-testid="calendar-task-inspector"
      >
        {inspected && (
          <div className="calendar-inspector-content">
            <h3>{inspected.title}</h3>
            <strong
              className={`calendar-status calendar-tone-${
                calendarTaskStatus(
                  inspected,
                  model.days.some((day) =>
                    day.entries.some((entry) => entry.task.itemId === inspected.itemId)
                  )
                ).tone
              }`}
            >
              {inspected.state === "completed"
                ? "✓ Completada"
                : calendarTaskStatus(
                    inspected,
                    model.days.some((day) =>
                      day.entries.some((entry) => entry.task.itemId === inspected.itemId)
                    )
                  ).label}
            </strong>
            {model.days
              .filter((day) => day.entries.some((entry) => entry.task.itemId === inspected.itemId))
              .map((day) => (
                <p key={day.date}>
                  {dateLabel(day.date, { weekday: "long", day: "numeric", month: "short" })}
                  {day.entries.find((entry) => entry.task.itemId === inspected.itemId)?.hours !=
                  null
                    ? ` · ${day.entries.find((entry) => entry.task.itemId === inspected.itemId)!.hours} h`
                    : ""}
                </p>
              ))}
            {canComplete(inspected) && (
              <button
                type="button"
                className="primary"
                disabled={busy}
                onClick={() => void completeTask(inspected)}
              >
                ✓ Marcar como completada
              </button>
            )}
            {onComplete && undoCompletion(inspected) && (
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => void completeTask(inspected, undoCompletion(inspected))}
              >
                Deshacer completado
              </button>
            )}
            {activityMessage && <p role="status">{activityMessage}</p>}
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => {
                inspector.current?.close();
                onInspect(inspected.itemId);
              }}
            >
              Ver otros controles
            </button>
            <button type="button" className="secondary" onClick={() => inspector.current?.close()}>
              Cerrar
            </button>
          </div>
        )}
      </dialog>
      <details className="calendar-help" data-testid="calendar-help">
        <summary>Cómo usar el calendario</summary>
        <p className="calm-muted task-calendar-hint">
          Usa «Repartir horas» para distribuir una tarea entre varios días. Arrastrar una parte o
          usar «Cambiar día» mueve solo esa asignación. Una fecha límite no elige el día por ti.
        </p>
        <ul className="calendar-status-legend" aria-label="Colores y símbolos del calendario">
          <li className="calendar-tone-undated">○ Sin día</li>
          <li className="calendar-tone-scheduled">◷ Programada</li>
          <li className="calendar-tone-completed">✓ Completada</li>
          <li className="calendar-tone-postponed">↷ Aplazada</li>
        </ul>
      </details>
      <p className="calendar-save-status" role="status" aria-atomic="true">
        {busy ? "Guardando el cambio de la tarea…" : ""}
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
      {!!extras.filter(recoverable).length && (
        <section
          className="calendar-recovery-tray"
          aria-label="Tareas para traer al calendario"
          data-testid="calendar-recovery-tray"
        >
          <h4>Para traer a esta semana</h4>
          <p className="calm-muted">Arrastra a un día o pulsa «Añadir a un día».</p>
          <ul>{extras.filter(recoverable).map((task) => taskCard(task, "outside"))}</ul>
        </section>
      )}
      <dialog
        data-testid="calendar-task-editor"
        ref={editor}
        className="calendar-task-editor"
        onCancel={() => setEditing(null)}
      >
        {editing && (
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              if (busy || editLock.current) return;
              editLock.current = true;
              setEditError(null);
              try {
                const parsed = hours.trim() ? Number(hours) : null;
                if (parsed !== null && (!Number.isFinite(parsed) || parsed <= 0))
                  throw new Error("Introduce horas mayores que cero o deja el campo vacío.");
                if (await onSchedule?.(editing.task.itemId, editing.day, parsed)) {
                  editor.current?.close();
                  setEditing(null);
                  requestAnimationFrame(() =>
                    document
                      .getElementById(`calendar-task-${editing.task.itemId}-${editing.day}`)
                      ?.focus({ preventScroll: true })
                  );
                } else setEditError("No se guardó la tarea. Inténtalo de nuevo.");
              } catch (error) {
                setEditError((error as Error).message);
              } finally {
                editLock.current = false;
              }
            }}
          >
            <h3>{editing.task.title}</h3>
            <label>
              Día
              <select
                aria-label="Día de la tarea"
                value={editing.day}
                disabled={busy}
                onChange={(event) => setEditing({ ...editing, day: event.target.value })}
              >
                {model.days.map((day) => (
                  <option key={day.date} value={day.date}>
                    {dateLabel(day.date, { weekday: "long", day: "numeric", month: "short" })}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {plan.proposal.foci.some(
                (focus) =>
                  focus.contributingItemIds.length > 1 &&
                  focus.contributingItemIds.includes(editing.task.itemId)
              )
                ? "Horas para este día"
                : "Horas totales"}
              <input
                aria-label="Horas de la tarea"
                type="number"
                min="0"
                step="any"
                placeholder="Sin estimar"
                value={hours}
                disabled={busy}
                onChange={(event) => setHours(event.target.value)}
              />
            </label>
            <p className="calm-muted">
              Después puedes usar «Repartir horas» para dividirlas entre varios días.
            </p>
            {plan.proposal.foci.some(
              (focus) =>
                focus.contributingItemIds.length > 1 &&
                focus.contributingItemIds.includes(editing.task.itemId)
            ) && (
              <p className="calm-muted">
                Las horas compartidas del foco se conservan. Aquí eliges las de esta tarea para ese
                día.
              </p>
            )}
            {editing.task.kind === "postponed" && (
              <p>Guardar recupera esta tarea aplazada para esta semana.</p>
            )}
            {editError && <p role="alert">{editError}</p>}
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => {
                editor.current?.close();
                setEditing(null);
              }}
            >
              Cancelar
            </button>
            <button type="submit" className="primary" disabled={busy}>
              {busy ? "Guardando…" : "Guardar en el calendario"}
            </button>
          </form>
        )}
      </dialog>
      {!!undated.length && (
        <section
          className="task-calendar-undated calendar-recovery-tray"
          aria-label="Tareas de esta semana sin día asignado"
          data-testid="calendar-undated"
        >
          <h4>Por asignar a un día ({undated.length})</h4>
          <p className="calm-muted">
            Ya están en tu semana. Arrastra a un día o pulsa «Elegir día».
          </p>
          <ul>{undated.map((task) => taskCard(task, "undated"))}</ul>
        </section>
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
                <p className="task-calendar-empty">Sin tareas</p>
              )}
            </section>
          );
        })}
      </div>
      {!!extras.filter((task) => !recoverable(task)).length && (
        <details className="task-calendar-extras" data-testid="calendar-extras">
          <summary>
            Aplazados, fuera de esta semana y notas (
            {extras.filter((task) => !recoverable(task)).length})
          </summary>
          <ul>
            {extras.filter((task) => !recoverable(task)).map((task) => taskCard(task, "outside"))}
          </ul>
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
