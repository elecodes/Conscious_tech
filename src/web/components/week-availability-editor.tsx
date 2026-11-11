import { useEffect, useRef, useState } from "react";
import type { WeeklyCapacitySummary, TargetWeek } from "../../domain/week";
import { parsePlanningContext } from "../planning-context-inputs";

export function WeekAvailabilityEditor({
  capacity,
  week,
  onSave,
  disabled = false,
}: {
  capacity: WeeklyCapacitySummary;
  week: TargetWeek;
  onSave: (hours: string, protectedPercent: string) => Promise<boolean>;
  disabled?: boolean;
}) {
  const percent =
    capacity.totalAvailableHours && capacity.protectedSpaceHours != null
      ? String(
          Number(((capacity.protectedSpaceHours / capacity.totalAvailableHours) * 100).toFixed(2))
        )
      : "25";
  const [hours, setHours] = useState(
    capacity.totalAvailableHours == null ? "" : String(capacity.totalAvailableHours)
  );
  const [protectedPercent, setProtectedPercent] = useState(percent);
  const [open, setOpen] = useState(capacity.totalAvailableHours == null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lock = useRef(false);
  useEffect(() => {
    setHours(capacity.totalAvailableHours == null ? "" : String(capacity.totalAvailableHours));
    setProtectedPercent(percent);
  }, [capacity.totalAvailableHours, percent]);
  return (
    <details
      className="week-availability-editor"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      data-testid="week-availability-editor"
    >
      <summary>
        {capacity.totalAvailableHours == null
          ? "Añadir horas disponibles"
          : "Cambiar horas disponibles"}
      </summary>
      <p className="calm-muted">
        Para la semana del {week.startDate} al {week.endDate}. Indica tus horas libres después de
        los compromisos. Cambiarlas conserva tus tareas y sus días.
      </p>
      <div className="week-availability-fields">
        <label>
          Horas disponibles esta semana
          <input
            type="number"
            min="0"
            step="any"
            value={hours}
            onChange={(event) => setHours(event.target.value)}
            disabled={saving || disabled}
            data-testid="week-available-hours"
            placeholder="Por definir"
          />
        </label>
        <label>
          Espacio protegido (%)
          <input
            type="number"
            min="0"
            max="100"
            step="any"
            value={protectedPercent}
            onChange={(event) => setProtectedPercent(event.target.value)}
            disabled={saving || disabled}
            data-testid="week-protected-percent"
          />
        </label>
        <button
          type="button"
          className="secondary small"
          disabled={saving || disabled}
          data-testid="save-week-availability"
          onClick={async () => {
            if (lock.current || disabled) return;
            setError(null);
            try {
              parsePlanningContext({
                targetWeekStart: week.startDate,
                targetWeekEnd: week.endDate,
                availableHoursInput: hours,
                protectedSpacePercentInput: protectedPercent,
              });
            } catch (error) {
              setError((error as Error).message);
              return;
            }
            lock.current = true;
            setSaving(true);
            try {
              if (await onSave(hours, protectedPercent)) setOpen(false);
              else
                setError(
                  "No se pudo guardar la disponibilidad. Tus tareas se conservan; vuelve a intentarlo."
                );
            } catch {
              setError("No se pudo guardar la disponibilidad. Vuelve a intentarlo.");
            } finally {
              lock.current = false;
              setSaving(false);
            }
          }}
        >
          {saving ? "Guardando…" : "Guardar disponibilidad"}
        </button>
      </div>
      <p className="calm-muted">
        Deja las horas vacías si aún no las sabes. Cero significa que no tienes tiempo disponible.
      </p>
      {error && <p role="alert">{error}</p>}
    </details>
  );
}
