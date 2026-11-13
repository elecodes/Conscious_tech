import { z } from "zod";

const text = z.string().max(2000);
const date = z.union([z.iso.date(), z.literal("")]);
export const NotionSnapshotSchema = z
  .object({
    title: z.string().min(1).max(200),
    rows: z
      .array(
        z
          .object({
            name: z.string().min(1).max(2000),
            date,
            deadline: date,
            status: text,
            kind: text,
            week: text,
            taskId: text,
            time: text,
            hours: z.number().finite().nonnegative().max(10000).nullable(),
            remaining: z.number().finite().nonnegative().max(10000).nullable(),
          })
          .strict()
      )
      .min(1)
      .max(300),
  })
  .strict();
export type NotionSnapshot = z.infer<typeof NotionSnapshotSchema>;
export const NOTION_CALENDAR_SCHEMA = `CREATE TABLE ("Nombre" TITLE, "Fecha" DATE, "Estado" RICH_TEXT, "Horas asignadas" NUMBER, "Horas sin asignar" NUMBER, "Tipo" RICH_TEXT, "Semana" RICH_TEXT, "Fecha límite" DATE, "Horario" RICH_TEXT, "ID de tarea" RICH_TEXT)`;
export function notionPageProperties(row: NotionSnapshot["rows"][number]) {
  const properties: Record<string, string | number> = {
    Nombre: row.name,
    Estado: row.status,
    Tipo: row.kind,
    Semana: row.week,
    Horario: row.time,
    "ID de tarea": row.taskId,
  };
  if (row.hours !== null) properties["Horas asignadas"] = row.hours;
  if (row.remaining !== null) properties["Horas sin asignar"] = row.remaining;
  if (row.date) {
    properties["date:Fecha:start"] = row.date;
    properties["date:Fecha:is_datetime"] = 0;
  }
  if (row.deadline) {
    properties["date:Fecha límite:start"] = row.deadline;
    properties["date:Fecha límite:is_datetime"] = 0;
  }
  return properties;
}

export const NotionRecoveryRequestSchema = z
  .object({ snapshot: NotionSnapshotSchema, url: z.url() })
  .strict();
