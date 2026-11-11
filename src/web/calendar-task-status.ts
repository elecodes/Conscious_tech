import type { CalendarTask } from "./task-calendar-model";

/** Placement and progress are distinct: a scheduled task may still be pending. */
export function calendarTaskStatus(task: CalendarTask, hasDay: boolean) {
  if (task.state === "completed") return { tone: "completed", symbol: "✓", label: "Completada" };
  if (task.kind === "postponed" || task.state === "consciously_postponed")
    return { tone: "postponed", symbol: "↷", label: "Aplazada" };
  if (task.state === "dropped") return { tone: "neutral", symbol: "—", label: "Descartada" };
  if (task.kind === "note") return { tone: "neutral", symbol: "·", label: "Nota" };
  if (task.kind === "outside")
    return { tone: "neutral", symbol: "—", label: "Fuera de esta semana" };
  return hasDay
    ? { tone: "scheduled", symbol: "◷", label: "Programada" }
    : { tone: "undated", symbol: "○", label: "Sin día" };
}
