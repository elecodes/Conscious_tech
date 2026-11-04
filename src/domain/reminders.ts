export type ReminderOffset = "none" | "15m" | "1h" | "1d";

export interface ReminderPreferences {
  offset: ReminderOffset;
  includeTasks: boolean;
}

export const REMINDER_STORAGE_KEY_OFFSET = "conscious_tech_reminder_offset";
export const REMINDER_STORAGE_KEY_INCLUDE_TASKS = "conscious_tech_reminder_include_tasks";

export const DEFAULT_REMINDER_PREFERENCES: ReminderPreferences = {
  offset: "none",
  includeTasks: false,
};

export const REMINDER_OPTIONS: Array<{ value: ReminderOffset; label: string }> = [
  { value: "none", label: "Sin recordatorio" },
  { value: "15m", label: "15 minutos antes" },
  { value: "1h", label: "1 hora antes" },
  { value: "1d", label: "1 día antes" },
];

/**
 * Loads reminder preferences from browser localStorage safely.
 * Returns default (off, no tasks) if unavailable.
 */
export function getStoredReminderPreferences(): ReminderPreferences {
  if (typeof localStorage === "undefined") {
    return { ...DEFAULT_REMINDER_PREFERENCES };
  }
  try {
    const rawOffset = localStorage.getItem(REMINDER_STORAGE_KEY_OFFSET);
    const rawIncludeTasks = localStorage.getItem(REMINDER_STORAGE_KEY_INCLUDE_TASKS);

    const validOffsets: ReminderOffset[] = ["none", "15m", "1h", "1d"];
    const offset: ReminderOffset =
      rawOffset && validOffsets.includes(rawOffset as ReminderOffset)
        ? (rawOffset as ReminderOffset)
        : "none";

    const includeTasks = rawIncludeTasks === "true";

    return { offset, includeTasks };
  } catch {
    return { ...DEFAULT_REMINDER_PREFERENCES };
  }
}

/**
 * Persists reminder preferences locally in localStorage.
 */
export function saveStoredReminderPreferences(prefs: ReminderPreferences): void {
  if (typeof localStorage === "undefined") {
    return;
  }
  try {
    localStorage.setItem(REMINDER_STORAGE_KEY_OFFSET, prefs.offset);
    localStorage.setItem(REMINDER_STORAGE_KEY_INCLUDE_TASKS, String(prefs.includeTasks));
  } catch {
    // Ignore storage quota or access errors in sandbox/private mode
  }
}
