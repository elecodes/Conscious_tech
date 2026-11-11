import { useState } from "react";
import type { StoredWeeklyPlan } from "../../domain/repositories/types";
import type { WeeklySchedule } from "../../domain/schedule";
import type { TargetWeek } from "../../domain/week";
import { monthCalendar, weekContaining } from "../month-calendar-model";

export function MonthTaskCalendar({
  initialMonth,
  plans,
  schedule,
  onOpenWeek,
  disabled = false,
}: {
  initialMonth: string;
  plans: StoredWeeklyPlan[];
  schedule: WeeklySchedule | null;
  onOpenWeek: (week: TargetWeek) => void;
  disabled?: boolean;
}) {
  const [month, setMonth] = useState(initialMonth);
  const model = monthCalendar(month, plans, schedule);
  const shift = (delta: number) => {
    const date = new Date(`${month}-01T00:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() + delta);
    setMonth(date.toISOString().slice(0, 7));
  };
  const label = (day: string) =>
    new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short", timeZone: "UTC" }).format(
      new Date(`${day}T00:00:00Z`)
    );
  return (
    <section
      className="task-calendar month-task-calendar"
      data-testid="month-task-calendar"
      aria-label="Planificación mensual"
    >
      <h3>Tu mes, de un vistazo</h3>
      <p className="calm-muted">
        Elige un día para planificar su semana. Puedes preparar varios borradores; la semana activa
        se conserva. Las fechas límite no asignan días.
      </p>
      <nav className="month-calendar-navigation" aria-label="Cambiar mes">
        <button
          type="button"
          className="secondary small"
          onClick={() => shift(-1)}
          aria-label="Mes anterior"
        >
          ←
        </button>
        <label>
          Mes{" "}
          <input
            type="month"
            value={month}
            onChange={(event) => {
              if (/^\d{4}-(0[1-9]|1[0-2])$/.test(event.target.value)) setMonth(event.target.value);
            }}
            data-testid="calendar-month-input"
          />
        </label>
        <button
          type="button"
          className="secondary small"
          onClick={() => shift(1)}
          aria-label="Mes siguiente"
        >
          →
        </button>
      </nav>
      <div className="month-calendar-grid">
        {["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"].map((day) => (
          <span key={day} className="calm-muted">
            {day}
          </span>
        ))}
        {Array.from({ length: model.offset }, (_, i) => (
          <span key={`empty-${i}`} />
        ))}
        {model.cells.map((day) => {
          const entries = model.entries.filter((entry) => entry.day === day);
          return (
            <button
              type="button"
              className="month-calendar-day secondary"
              key={day}
              disabled={disabled}
              data-testid={`month-day-${day}`}
              aria-label={`${label(day)}${entries.length ? `, ${entries.length} {entries.length === 1 ? "tarea" : "tareas"}` : ""}. Abrir semana`}
              onClick={() => {
                const savedWeeks = model.undated.filter(
                  ({ plan }) => plan.targetWeek.startDate <= day && plan.targetWeek.endDate >= day
                );
                onOpenWeek(
                  savedWeeks.length === 1 ? savedWeeks[0]!.plan.targetWeek : weekContaining(day)
                );
              }}
            >
              <strong>{Number(day.slice(-2))}</strong>
              {!!entries.length && (
                <span className="month-calendar-count">
                  {entries.length} {entries.length === 1 ? "tarea" : "tareas"}
                </span>
              )}
              {entries.slice(0, 2).map((entry) => (
                <span
                  className="month-calendar-task"
                  key={`${entry.plan.planId}-${entry.itemId}`}
                  title={entry.title}
                >
                  {entry.title}
                  <small>{entry.plan.status === "active" ? "Activa" : "Borrador"}</small>
                </span>
              ))}
              {entries.length > 2 && <small>+{entries.length - 2}</small>}
            </button>
          );
        })}
      </div>
      <h4>Semanas del mes</h4>
      {model.undated.length ? (
        <ul className="month-calendar-weeks">
          {model.undated.map(({ plan, count }) => (
            <li key={plan.planId}>
              <button
                type="button"
                className="secondary"
                disabled={disabled}
                onClick={() => onOpenWeek(plan.targetWeek)}
                data-testid={`month-week-${plan.planId}`}
              >
                <strong>
                  {label(plan.targetWeek.startDate)} – {label(plan.targetWeek.endDate)}
                </strong>
                <span>
                  {plan.status === "active" ? "Semana activa" : "Borrador"} · {count} sin día
                  elegido
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="calm-muted">
          Aún no hay semanas preparadas en este mes. Elige un día para empezar.
        </p>
      )}
    </section>
  );
}
