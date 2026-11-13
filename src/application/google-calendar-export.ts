import { z } from "zod";
import { NotionSnapshotSchema } from "./notion-snapshot";

export const GoogleCalendarExportSchema = z
  .object({
    notebookId: z.uuid(),
    planId: z.string().min(1).max(300),
    snapshot: NotionSnapshotSchema,
    calendarId: z.string().min(1).max(1000),
    timeZone: z
      .string()
      .max(100)
      .refine((value) => {
        try {
          new Intl.DateTimeFormat("en", { timeZone: value });
          return true;
        } catch {
          return false;
        }
      }, "Invalid time zone"),
  })
  .strict()
  .refine(
    (value) => value.snapshot.rows.every((row) => row.taskId.startsWith(value.planId + "/")),
    "Rows must belong to this plan"
  );
export type GoogleCalendarExport = z.infer<typeof GoogleCalendarExportSchema>;
export type GoogleEventBody = {
  summary: string;
  description: string;
  start: { date?: string; dateTime?: string; timeZone?: string };
  end: { date?: string; dateTime?: string; timeZone?: string };
  transparency: "transparent" | "opaque";
  extendedProperties: { private: Record<string, string> };
};
/** Days without clock times remain all-day, transparent events: estimates do not invent a timetable. */
export function googleCalendarRows(input: GoogleCalendarExport) {
  const ordinals = new Map<string, number>();
  return input.snapshot.rows
    .filter((row) => !!row.date)
    .map((row) => {
      const ordinal = ordinals.get(row.taskId) ?? 0;
      ordinals.set(row.taskId, ordinal + 1);
      let start: GoogleEventBody["start"] = { date: row.date };
      const next = new Date(row.date + "T12:00:00Z");
      next.setUTCDate(next.getUTCDate() + 1);
      let end: GoogleEventBody["end"] = { date: next.toISOString().slice(0, 10) };
      if (row.time) {
        const match = row.time.match(/^(\d{2}:\d{2})[–-](\d{2}:\d{2})$/);
        if (
          !match ||
          !match.slice(1).every((value) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value!)) ||
          match[2]! <= match[1]!
        )
          throw new Error("Revisa los horarios de la semana antes de enviarla.");
        start = { dateTime: `${row.date}T${match[1]}:00`, timeZone: input.timeZone };
        end = { dateTime: `${row.date}T${match[2]}:00`, timeZone: input.timeZone };
      }
      const body: GoogleEventBody = {
        summary: (row.status === "Completada" ? "✓ " : "") + row.name,
        description: [
          `Conscious Tech · ${input.snapshot.title}`,
          `Estado: ${row.status}`,
          row.hours !== null ? `Horas previstas: ${row.hours} h` : "",
          row.deadline ? `Fecha límite: ${row.deadline}` : "",
          `Tipo: ${row.kind}`,
        ]
          .filter(Boolean)
          .join("\n"),
        start,
        end,
        transparency: row.time ? "opaque" : "transparent",
        extendedProperties: { private: {} },
      };
      return { key: `${row.taskId}/${ordinal}`, body };
    });
}
