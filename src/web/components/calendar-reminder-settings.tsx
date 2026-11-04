import { useState, useEffect } from "react";
import {
  ReminderPreferences,
  REMINDER_OPTIONS,
  getStoredReminderPreferences,
  saveStoredReminderPreferences,
  ReminderOffset,
} from "../../domain/reminders";

export interface CalendarReminderSettingsProps {
  preferences?: ReminderPreferences;
  onPreferencesChange?: (prefs: ReminderPreferences) => void;
  compact?: boolean;
}

export function CalendarReminderSettings({
  preferences: controlledPrefs,
  onPreferencesChange,
  compact = false,
}: CalendarReminderSettingsProps) {
  const [internalPrefs, setInternalPrefs] = useState<ReminderPreferences>(
    controlledPrefs ?? getStoredReminderPreferences()
  );

  useEffect(() => {
    if (controlledPrefs) {
      setInternalPrefs(controlledPrefs);
    }
  }, [controlledPrefs]);

  const currentPrefs = controlledPrefs ?? internalPrefs;

  const handleOffsetChange = (offset: ReminderOffset) => {
    const updated: ReminderPreferences = { ...currentPrefs, offset };
    if (!controlledPrefs) {
      setInternalPrefs(updated);
    }
    saveStoredReminderPreferences(updated);
    if (onPreferencesChange) {
      onPreferencesChange(updated);
    }
  };

  const handleIncludeTasksChange = (includeTasks: boolean) => {
    const updated: ReminderPreferences = { ...currentPrefs, includeTasks };
    if (!controlledPrefs) {
      setInternalPrefs(updated);
    }
    saveStoredReminderPreferences(updated);
    if (onPreferencesChange) {
      onPreferencesChange(updated);
    }
  };

  return (
    <div
      className="calendar-reminder-settings"
      data-testid="calendar-reminder-settings"
      style={{ fontSize: compact ? "0.82rem" : "0.88rem" }}
    >
      <label
        htmlFor="reminder-offset-select"
        style={{
          display: "block",
          fontWeight: 600,
          marginBottom: "4px",
          color: "var(--text-main)",
        }}
      >
        Recordatorios:
      </label>
      <select
        id="reminder-offset-select"
        data-testid="reminder-offset-select"
        value={currentPrefs.offset}
        onChange={(e) => handleOffsetChange(e.target.value as ReminderOffset)}
        style={{
          width: "100%",
          padding: "6px 8px",
          fontSize: compact ? "0.82rem" : "0.88rem",
          background: "#ffffff",
          border: "1px solid var(--border-color)",
          borderRadius: "6px",
          marginBottom: "8px",
        }}
      >
        {REMINDER_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>

      {currentPrefs.offset !== "none" && (
        <div style={{ marginTop: "6px" }}>
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              cursor: "pointer",
              fontSize: compact ? "0.8rem" : "0.85rem",
              marginBottom: "6px",
            }}
          >
            <input
              type="checkbox"
              data-testid="reminder-include-tasks-checkbox"
              checked={currentPrefs.includeTasks}
              onChange={(e) => handleIncludeTasksChange(e.target.checked)}
            />
            <span>Incluir también tareas</span>
          </label>
          <p
            className="calm-text"
            style={{
              margin: "4px 0 2px 0",
              fontWeight: 500,
              fontSize: compact ? "0.78rem" : "0.82rem",
              color: "var(--accent-color, #2b6cb0)",
            }}
          >
            🔔 Tu calendario te avisará
          </p>
          <p
            className="calm-muted"
            style={{
              margin: 0,
              fontSize: compact ? "0.74rem" : "0.78rem",
              lineHeight: 1.35,
            }}
          >
            Google Calendar te avisará con una notificación; puedes activar el aviso por correo en
            sus ajustes. Para tareas de todo el día te avisamos a las 9:00.
          </p>
        </div>
      )}
    </div>
  );
}
