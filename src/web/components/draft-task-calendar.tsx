import { useState } from "react";
import type { ProposedWeek } from "../../domain/week";
import type { ExtractedItem } from "../../domain/items";
import { draftItemHours, includedDraftItemIds } from "../draft-calendar-edits";

export function DraftTaskCalendar({
  proposal,
  items,
  plannedDays,
  onHours,
  onDay,
  onInclude,
  onDefer,
}: {
  proposal: ProposedWeek;
  items: ExtractedItem[];
  plannedDays: Record<string, string>;
  onHours: (id: string, hours: number | null) => void;
  onDay: (id: string, day: string | null) => void;
  onInclude: (id: string) => void;
  onDefer: (id: string) => void;
}) {
  const included = includedDraftItemIds(proposal);
  const start = proposal.weekSummary.targetWeek.startDate;
  const end = proposal.weekSummary.targetWeek.endDate;
  const [page, setPage] = useState(0);
  const totalDays = Math.round((Date.parse(end) - Date.parse(start)) / 86400000) + 1;
  const pages = Math.max(1, Math.ceil(totalDays / 7));
  const currentPage = Math.min(page, pages - 1);
  const days: string[] = [];
  for (
    let current = new Date(Date.parse(`${start}T00:00:00Z`) + currentPage * 7 * 86400000);
    current.toISOString().slice(0, 10) <= end && days.length < 7;
    current.setUTCDate(current.getUTCDate() + 1)
  )
    days.push(current.toISOString().slice(0, 10));
  const format = (date: string, options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat("es-ES", { ...options, timeZone: "UTC" }).format(
      new Date(`${date}T00:00:00Z`)
    );
  const card = (item: ExtractedItem) => {
    const inside = included.has(item.id);
    const thought = item.type === "idea" || item.type === "concern";
    const focus = proposal.foci.find((focus) => focus.contributingItemIds.includes(item.id));
    const grouped = !!focus && focus.contributingItemIds.length > 1;
    const obligation = proposal.obligations.some((entry) => entry.itemId === item.id);
    const flexible = proposal.flexibleOptions.some((entry) => entry.itemId === item.id);
    return (
      <li
        key={item.id}
        className="draft-calendar-card"
        id={`draft-calendar-source-${item.id}`}
        tabIndex={-1}
        data-testid={`draft-task-${item.id}`}
      >
        <strong>{item.title}</strong>
        <span
          className="draft-calendar-placement"
          role="status"
          data-testid={`draft-placement-${item.id}`}
        >
          {inside
            ? flexible
              ? "En esta semana · opcional"
              : "En esta semana"
            : thought
              ? "Nota sin programar"
              : "Fuera de esta semana"}
        </span>
        {(!thought || inside) && (
          <>
            <label>
              Horas
              <input
                type="number"
                min="0"
                step="any"
                placeholder="Sin estimar"
                disabled={grouped}
                value={grouped ? "" : (draftItemHours(proposal, item) ?? "")}
                onChange={(event) =>
                  onHours(item.id, event.target.value === "" ? null : Number(event.target.value))
                }
                data-testid={`draft-hours-${item.id}`}
              />
            </label>
            {grouped && (
              <span className="calm-muted">
                Estimación compartida del foco: {focus.estimatedHours ?? "sin estimar"} h. Ajustable
                en opciones avanzadas.
              </span>
            )}
            {inside && (
              <label>
                Día elegido
                <input
                  type="date"
                  min={start}
                  max={end}
                  value={plannedDays[item.id] ?? ""}
                  onChange={(event) => {
                    const day = event.target.value || null;
                    if (day && day >= start && day <= end)
                      setPage(Math.floor((Date.parse(day) - Date.parse(start)) / (7 * 86400000)));
                    onDay(item.id, day);
                  }}
                  data-testid={`draft-day-${item.id}`}
                />
              </label>
            )}
            {item.deadline?.resolved && (
              <span className="calm-muted">Fecha límite: {item.deadline.resolved}</span>
            )}
          </>
        )}
        {!inside ? (
          <button
            type="button"
            className="secondary small"
            onClick={() => onInclude(item.id)}
            data-testid={`draft-include-${item.id}`}
          >
            {thought ? "Dedicarle atención" : "Añadir a esta semana"}
          </button>
        ) : !grouped && !obligation ? (
          <button
            type="button"
            className="secondary small"
            onClick={() => onDefer(item.id)}
            data-testid={`draft-defer-${item.id}`}
          >
            Dejar para después
          </button>
        ) : (
          <span className="calm-muted">
            {obligation ? "Compromiso" : "Parte de un foco agrupado"}
          </span>
        )}
      </li>
    );
  };
  const inside = items.filter((item) => included.has(item.id));
  const outside = items.filter((item) => !included.has(item.id));
  const undated = inside.filter(
    (item) => !plannedDays[item.id] || plannedDays[item.id]! < start || plannedDays[item.id]! > end
  );
  return (
    <section
      className="task-calendar draft-task-calendar"
      data-testid="draft-task-calendar"
      aria-label="Calendario de preparación de la semana"
    >
      <p className="task-calendar-eyebrow">Tu calendario · borrador</p>
      <h3>Organiza tus tareas aquí</h3>
      <p className="task-calendar-range">
        Semana del {format(start, { day: "numeric", month: "long" })} al{" "}
        {format(end, { day: "numeric", month: "long", year: "numeric" })}
      </p>
      <p className="calm-muted">
        Añade tareas a esta semana, elige sus horas y su día. Los cambios se guardan en el borrador;
        la semana se activa cuando tú decidas.
      </p>
      <p className="calm-muted" data-testid="draft-calendar-capacity">
        {proposal.weekSummary.capacity.knownEstimatedHours ?? 0} h estimadas
        {proposal.weekSummary.capacity.totalAvailableHours != null
          ? ` · ${proposal.weekSummary.capacity.totalAvailableHours} h disponibles`
          : " · Disponibilidad por definir"}
        {proposal.weekSummary.capacity.estimationCompleteness !== "complete"
          ? " · Hay tareas sin estimar"
          : ""}
      </p>
      <p className="task-calendar-counts">
        <strong>{inside.length} en esta semana</strong>
        <span>{outside.length} para decidir</span>
      </p>
      {pages > 1 && (
        <nav aria-label="Días del calendario">
          <button
            type="button"
            disabled={currentPage === 0}
            onClick={() => setPage(currentPage - 1)}
          >
            Días anteriores
          </button>
          <span>
            {currentPage + 1} / {pages}
          </span>
          <button
            type="button"
            disabled={currentPage === pages - 1}
            onClick={() => setPage(currentPage + 1)}
          >
            Días siguientes
          </button>
        </nav>
      )}
      {included.size > inside.length && (
        <p role="status">
          Este borrador antiguo tiene tareas sin su nota original. Puedes revisarlas en las opciones
          avanzadas.
        </p>
      )}
      <div className="task-calendar-grid">
        {days.map((day) => (
          <section
            key={day}
            className="task-calendar-day"
            data-testid={`draft-calendar-day-${day}`}
          >
            <header>
              <span>{format(day, { weekday: "short" })}</span>
              <strong>{format(day, { day: "numeric", month: "short" })}</strong>
            </header>
            <ul>{inside.filter((item) => plannedDays[item.id] === day).map(card)}</ul>
          </section>
        ))}
      </div>
      <section className="task-calendar-undated" data-testid="draft-calendar-undated">
        <h4>Esta semana, sin día elegido ({undated.length})</h4>
        <ul>{undated.map(card)}</ul>
      </section>
      {!!outside.length && (
        <section className="task-calendar-undated" data-testid="draft-calendar-outside">
          <h4>Para decidir · fuera de esta semana ({outside.length})</h4>
          <ul>{outside.map(card)}</ul>
        </section>
      )}
    </section>
  );
}
