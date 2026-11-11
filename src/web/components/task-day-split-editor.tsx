import { useEffect, useRef, useState } from "react";
import type { DailyWorkAllocation } from "../../domain/schedule";
import type { TargetWeek } from "../../domain/week";
import { distributionHours, validateDistribution } from "../task-distribution";

export function TaskDaySplitEditor({
  id,
  title,
  week,
  totalHours,
  rows,
  onSave,
  disabled = false,
  fixed = false,
  testKey = id,
}: {
  id: string;
  title: string;
  week: TargetWeek;
  totalHours: number | null;
  rows: DailyWorkAllocation[];
  onSave: (rows: DailyWorkAllocation[]) => Promise<boolean>;
  disabled?: boolean;
  fixed?: boolean;
  testKey?: string;
}) {
  const signature = JSON.stringify(rows.map((row) => [row.day, row.allocatedHours]).sort());
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(rows.map((row) => [row.day, String(row.allocatedHours)]))
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lock = useRef(false);
  const panel = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    setValues(Object.fromEntries(rows.map((row) => [row.day, String(row.allocatedHours)])));
    setError(null);
  }, [signature, id]);
  const days: string[] = [];
  for (
    let date = new Date(`${week.startDate}T00:00:00Z`);
    date.toISOString().slice(0, 10) <= week.endDate;
    date.setUTCDate(date.getUTCDate() + 1)
  )
    days.push(date.toISOString().slice(0, 10));
  const requested = Object.entries(values)
    .filter(([, hours]) => hours !== "" && Number(hours) !== 0)
    .map(([day, hours]) => ({ itemId: id, day, allocatedHours: Number(hours) }));
  const total = distributionHours(requested);
  let validation: string | null = null;
  try {
    validateDistribution(week, id, requested, totalHours);
  } catch (error) {
    validation = (error as Error).message;
  }
  return (
    <details
      ref={panel}
      className="task-day-split-editor"
      data-testid={`task-split-${testKey}`}
      onKeyDown={(event) => {
        if (event.key === "Escape" && panel.current) {
          panel.current.open = false;
          panel.current.querySelector("summary")?.focus();
        }
      }}
    >
      <summary>
        Repartir horas
        {totalHours != null && (
          <small>
            {" "}
            · {distributionHours(rows)} / {totalHours} h
          </small>
        )}
      </summary>
      <button
        type="button"
        className="secondary small task-split-close"
        onClick={() => {
          if (panel.current) panel.current.open = false;
        }}
      >
        Cerrar
      </button>
      <p>
        Solo «{title}»
        {totalHours != null ? ` · ${totalHours} h para repartir` : " · Horas totales por definir"}
      </p>
      {fixed ? (
        <p>Esta tarea tiene horarios fijos. Ajusta sus bloques desde los controles de la tarea.</p>
      ) : totalHours == null ? (
        <p>Añade las horas totales de esta tarea para repartirlas entre días.</p>
      ) : (
        <>
          <p>
            Las horas que ya tenía cada día siguen aquí. Cámbialas o borra el reparto antes de
            distribuir el total. El calendario cambia al guardar.
          </p>
          <button
            type="button"
            className="secondary small"
            disabled={disabled || saving}
            onClick={() => {
              setValues({});
              setError(null);
            }}
          >
            Dejar sin días
          </button>
          {requested.length > 1 && requested.every((row) => row.allocatedHours > 0) && (
            <button
              type="button"
              className="secondary small"
              disabled={disabled || saving}
              onClick={() => {
                const portion = Math.floor((totalHours / requested.length) * 1000000) / 1000000;
                setValues(
                  Object.fromEntries(
                    requested.map((row, index) => [
                      row.day,
                      String(
                        index === requested.length - 1
                          ? Number((totalHours - portion * (requested.length - 1)).toFixed(6))
                          : portion
                      ),
                    ])
                  )
                );
                setError(null);
              }}
            >
              Repartir {totalHours} h por igual entre los {requested.length} días elegidos
            </button>
          )}
          <div className="task-split-days">
            {days.map((day) => (
              <label key={day}>
                {new Intl.DateTimeFormat("es-ES", {
                  weekday: "short",
                  day: "numeric",
                  month: "short",
                  timeZone: "UTC",
                }).format(new Date(`${day}T00:00:00Z`))}
                <input
                  aria-label={`Horas de ${title} el ${day}`}
                  type="number"
                  min="0"
                  step="any"
                  value={values[day] ?? ""}
                  onChange={(event) =>
                    setValues((previous) => ({ ...previous, [day]: event.target.value }))
                  }
                  placeholder="—"
                  disabled={disabled || saving}
                  data-testid={`split-hours-${testKey}-${day}`}
                />
              </label>
            ))}
          </div>
          <p role="status" data-testid={`split-balance-${testKey}`}>
            {validation
              ? `Has escrito ${total} h para una tarea de ${totalHours} h. Ajusta las horas para poder guardar.`
              : `${total} h repartidas de ${totalHours} h · ${Number((totalHours - total).toFixed(6))} h por repartir`}
          </p>
          {(error || validation) && <p role="alert">{error || validation}</p>}
          <button
            type="button"
            className="secondary small"
            data-testid={`save-split-${testKey}`}
            disabled={disabled || saving || !!validation}
            onClick={async () => {
              if (lock.current) return;
              lock.current = true;
              setSaving(true);
              setError(null);
              try {
                if (!(await onSave(requested))) {
                  setError("No se ha guardado el reparto. Revisa el aviso e inténtalo de nuevo.");
                } else if (panel.current) {
                  panel.current.open = false;
                }
              } catch (error) {
                setError((error as Error).message);
              } finally {
                lock.current = false;
                setSaving(false);
              }
            }}
          >
            {saving ? "Guardando…" : "Guardar reparto"}
          </button>
        </>
      )}
    </details>
  );
}
