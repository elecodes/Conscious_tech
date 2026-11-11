import { useEffect, useState } from "react";
import type { WeeklySchedule } from "../../domain/schedule";
import type { PostponementAction } from "../../domain/item-activity-types";

export function ItemPostponementControls({
  schedule,
  itemId,
  category,
  busy,
  onPostpone,
}: {
  schedule: WeeklySchedule;
  itemId: string;
  category: PostponementAction["currentCategory"];
  busy?: boolean;
  onPostpone: (action: PostponementAction) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [specific, setSpecific] = useState(false);
  const date = new Date(`${schedule.weekRange.endDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  const nextStart = date.toISOString().slice(0, 10);
  date.setUTCDate(date.getUTCDate() + 6);
  const [start, setStart] = useState(nextStart);
  const [end, setEnd] = useState(date.toISOString().slice(0, 10));
  useEffect(() => {
    setOpen(false);
    setReason("");
    setSpecific(false);
  }, [schedule.version]);
  return (
    <details
      className="calm-details"
      style={{ minWidth: 0, maxWidth: "100%" }}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      data-testid={`postpone-item-${itemId}`}
    >
      <summary style={{ cursor: "pointer" }}>Aplazar elemento</summary>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (!reason.trim()) return;
          await onPostpone({
            type: "postpone_item",
            itemId,
            currentCategory: category,
            targetReason: "intentional_postponement",
            hoursFreed: null,
            rationale: reason.trim(),
            ...(specific ? { targetWeek: { startDate: start, endDate: end } } : {}),
          });
        }}
      >
        <fieldset
          disabled={busy}
          style={{
            border: 0,
            padding: "8px 0",
            margin: 0,
            minWidth: 0,
            display: "grid",
            gap: "8px",
          }}
        >
          <label>
            Motivo del aplazamiento
            <textarea
              required
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              data-testid={`postpone-reason-${itemId}`}
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={specific}
              onChange={(event) => setSpecific(event.target.checked)}
              data-testid={`postpone-destination-${itemId}`}
            />{" "}
            Elegir una semana de destino
          </label>
          {specific ? (
            <>
              <label>
                Desde
                <input
                  required
                  type="date"
                  min={nextStart}
                  value={start}
                  onChange={(event) => setStart(event.target.value)}
                  data-testid={`postpone-start-${itemId}`}
                />
              </label>
              <label>
                Hasta
                <input
                  required
                  type="date"
                  min={start || nextStart}
                  value={end}
                  onChange={(event) => setEnd(event.target.value)}
                  data-testid={`postpone-end-${itemId}`}
                />
              </label>
            </>
          ) : (
            <p className="calm-muted">
              Sin semana concreta. Podrás elegir si lo retomas al preparar otra semana.
            </p>
          )}
          <p className="calm-muted">
            Se retiran sus asignaciones de esta semana. El elemento se conserva para consulta y
            cierre; no se añade automáticamente a otra semana.
          </p>
          <button
            type="submit"
            className="secondary small"
            disabled={!reason.trim()}
            data-testid={`save-postpone-${itemId}`}
          >
            Confirmar aplazamiento
          </button>
          <button
            type="button"
            className="secondary small"
            onClick={() => {
              setOpen(false);
              setReason("");
              setSpecific(false);
            }}
          >
            Cancelar aplazamiento
          </button>
        </fieldset>
      </form>
    </details>
  );
}
