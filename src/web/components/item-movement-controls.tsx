import { useEffect, useState } from "react";
import type { WeeklySchedule } from "../../domain/schedule";
import type { MovementAction } from "../../domain/item-activity-types";

export function ItemMovementControls({
  schedule,
  itemId,
  busy,
  onMove,
}: {
  schedule: WeeklySchedule;
  itemId: string;
  busy?: boolean;
  onMove: (action: MovementAction) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [selection, setSelection] = useState("");
  const [day, setDay] = useState("");
  const [start, setStart] = useState("");
  const [hours, setHours] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setOpen(false);
    setSelection("");
    setError(null);
  }, [schedule.version]);
  const block = selection.startsWith("block-")
    ? schedule.timeBlocks[Number(selection.slice(6))]
    : undefined;
  const allocation = selection.startsWith("day-")
    ? schedule.dailyAllocations[Number(selection.slice(4))]
    : undefined;
  const hasAssignments =
    schedule.timeBlocks.some((entry) => entry.itemId === itemId) ||
    schedule.dailyAllocations.some((entry) => entry.itemId === itemId);
  if (!hasAssignments) return null;
  return (
    <details
      className="calm-details item-movement"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      data-testid={`move-item-${itemId}`}
      style={{ minWidth: 0, maxWidth: "100%" }}
    >
      <summary style={{ cursor: "pointer" }}>Mover una asignación</summary>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setError(null);
          if ((!block && !allocation) || (block ?? allocation)?.itemId !== itemId) {
            setError("Elige una asignación de este elemento.");
            return;
          }
          let action: MovementAction;
          if (block) {
            const minutes = (time: string) => {
              const [h, m] = time.split(":").map(Number);
              return h! * 60 + m!;
            };
            const end = minutes(start) + minutes(block.endTime) - minutes(block.startTime);
            if (!Number.isFinite(end) || end >= 1440 || end <= minutes(start)) {
              setError("El bloque debe empezar y terminar el mismo día.");
              return;
            }
            const endTime = `${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}`;
            action = {
              type: "reassign_time_block",
              itemId,
              currentBlock: block,
              proposedBlock: { ...block, day, startTime: start, endTime },
              rationale: "Movimiento elegido por la persona",
            };
          } else {
            if (!(Number(hours) > 0) || Number(hours) > allocation!.allocatedHours) {
              setError("Elige una cantidad mayor que cero que no supere las horas de origen.");
              return;
            }
            action = {
              type: "reallocate_day_work",
              itemId,
              sourceDay: allocation!.day,
              targetDay: day,
              hoursToMove: Number(hours),
              rationale: "Movimiento elegido por la persona",
            };
          }
          await onMove(action);
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
            Asignación que quieres mover
            <select
              required
              value={selection}
              data-testid={`move-source-${itemId}`}
              style={{ width: "100%", minWidth: 0 }}
              onChange={(event) => {
                const value = event.target.value;
                setSelection(value);
                setError(null);
                const chosen = value.startsWith("block-")
                  ? schedule.timeBlocks[Number(value.slice(6))]
                  : schedule.dailyAllocations[Number(value.slice(4))];
                setDay(chosen?.day ?? "");
                if (chosen && "startTime" in chosen) setStart(chosen.startTime);
                if (chosen && "allocatedHours" in chosen) setHours(String(chosen.allocatedHours));
              }}
            >
              <option value="">Elige una asignación</option>
              {schedule.timeBlocks.map((entry, index) =>
                entry.itemId === itemId ? (
                  <option key={`block-${index}`} value={`block-${index}`}>
                    Bloque: {entry.day} · {entry.startTime}–{entry.endTime}
                  </option>
                ) : null
              )}
              {schedule.dailyAllocations.map((entry, index) =>
                entry.itemId === itemId ? (
                  <option key={`day-${index}`} value={`day-${index}`}>
                    Horas por día: {entry.day} · {entry.allocatedHours} h
                  </option>
                ) : null
              )}
            </select>
          </label>
          {(block || allocation) && (
            <>
              <label>
                Día de destino
                <input
                  required
                  type="date"
                  min={schedule.weekRange.startDate}
                  max={schedule.weekRange.endDate}
                  value={day}
                  onChange={(event) => setDay(event.target.value)}
                  data-testid={`move-day-${itemId}`}
                />
              </label>
              {block ? (
                <label>
                  Hora de inicio
                  <input
                    required
                    type="time"
                    value={start}
                    onChange={(event) => setStart(event.target.value)}
                    data-testid={`move-time-${itemId}`}
                  />
                </label>
              ) : (
                <label>
                  Horas que quieres mover
                  <input
                    required
                    type="number"
                    min="0"
                    max={allocation!.allocatedHours}
                    step="any"
                    value={hours}
                    onChange={(event) => setHours(event.target.value)}
                    data-testid={`move-hours-${itemId}`}
                  />
                </label>
              )}
              <p className="calm-muted">
                {block
                  ? "Se conserva la duración del bloque. El reparto de horas por día no cambia."
                  : "Se conserva el total de horas. Los bloques con horario no cambian."}{" "}
                La fecha límite se mantiene.
              </p>
              <button type="submit" className="secondary small" data-testid={`save-move-${itemId}`}>
                Guardar movimiento
              </button>
            </>
          )}
          <button
            type="button"
            className="secondary small"
            onClick={() => {
              setOpen(false);
              setSelection("");
              setError(null);
            }}
          >
            Cancelar movimiento
          </button>
        </fieldset>
        {error && <p role="alert">{error}</p>}
      </form>
    </details>
  );
}
