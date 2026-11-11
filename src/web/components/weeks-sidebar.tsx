import { useState } from "react";
import type { StoredWeeklyPlan } from "../../domain/repositories/types";
import type { WeeklySchedule } from "../../domain/schedule";
import type { TargetWeek } from "../../domain/week";
import { weeksOverview } from "../weeks-overview";

export function WeeksSidebar({
  active,
  schedule,
  drafts,
  onOpen,
  previous,
  disabled = false,
}: {
  disabled?: boolean;
  active: StoredWeeklyPlan | null;
  schedule: WeeklySchedule | null;
  drafts: StoredWeeklyPlan[];
  previous?: { plan: StoredWeeklyPlan; schedule: WeeklySchedule | null } | null;
  onOpen: (week: TargetWeek, active: boolean) => void;
}) {
  const [open, setOpen] = useState(
    () => typeof window !== "undefined" && window.innerWidth >= 1100
  );
  const weeks = weeksOverview(active, schedule, drafts, previous);
  if (!weeks.length) return null;
  return (
    <aside
      className="weeks-sidebar"
      aria-label="Semana activa y próximas semanas"
      data-testid="weeks-sidebar"
    >
      <details open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
        <summary>
          Mis semanas <span>{weeks.length}</span>
        </summary>
        <p className="calm-muted">
          La activa y lo que estás preparando. Las reprogramadas se conservan en su destino.
        </p>
        {weeks.length ? (
          weeks.map((week) => (
            <section
              key={week.key}
              className="sidebar-week"
              data-testid={`sidebar-week-${week.week.startDate}`}
            >
              <span className={`badge ${week.active ? "badge-task" : "badge-muted"}`}>
                {week.active
                  ? "Semana activa"
                  : week.draft
                    ? "Borrador de semana"
                    : "Semana por preparar"}
              </span>
              <strong>
                {week.week.startDate} – {week.week.endDate}
              </strong>
              <small>
                {week.hours == null
                  ? "Horas disponibles por definir"
                  : `${week.hours} h disponibles`}{" "}
                · {week.items.length} {week.items.length === 1 ? "pendiente" : "pendientes"}
              </small>
              <ul>
                {week.items.map((item) => (
                  <li key={item.id} data-testid={`sidebar-task-${week.week.startDate}-${item.id}`}>
                    <strong>{item.title}</strong>
                    <small>
                      {item.carried
                        ? "↷ Reprogramada · por incluir"
                        : item.day
                          ? `◷ ${item.day}`
                          : "○ Sin día elegido"}
                      {item.hours == null ? " · Sin estimar" : ` · ${item.hours} h`}
                    </small>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                className="secondary small"
                disabled={disabled}
                onClick={() => onOpen(week.week, week.active)}
                data-testid={`sidebar-open-${week.week.startDate}`}
              >
                {week.active ? "Ver semana activa" : "Organizar esta semana"}
              </button>
            </section>
          ))
        ) : (
          <p className="calm-muted">
            Aquí verás las semanas que guardes y las tareas que reprogrames.
          </p>
        )}
      </details>
    </aside>
  );
}
