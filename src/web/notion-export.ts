import type { StoredWeeklyPlan, StoredCloseWeekReport } from "../domain/repositories/types";
import type { WeeklySchedule } from "../domain/schedule";
import type { PlanItemSummary } from "./components/weekly-reflective-closing-section";
import { buildTaskCalendar } from "./task-calendar-model";
import { taskHoursBudget } from "./task-distribution";

export const NOTION_COLUMNS = [
  "Nombre",
  "Fecha",
  "Estado",
  "Horas asignadas",
  "Horas estimadas sin asignar",
  "Tipo",
  "Semana",
  "Fecha límite",
  "Horario",
  "ID de tarea",
] as const;
export type NotionExportRow = {
  name: string;
  date: string;
  status: string;
  hours: number | null;
  remaining: number | null;
  kind: string;
  week: string;
  deadline: string;
  time: string;
  taskId: string;
};
const round = (value: number) => Number(value.toFixed(9));
/** Notion's CSV importer documents MM/DD/YYYY dates, independent of the UI locale. */
export function notionDate(iso: string | undefined) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "";
  return `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}`;
}
const statusLabels: Record<string, string> = {
  pending: "Pendiente",
  not_started: "Pendiente",
  in_progress: "En curso",
  completed: "Completada",
  dropped: "Descartada",
  consciously_postponed: "Aplazada",
  unreported: "Sin reportar",
  not_scheduled: "Sin programar",
};

/** Snapshot only. Each saved portion is exported once; no writes or API calls. */
export function notionExportRows(
  plan: StoredWeeklyPlan,
  schedule: WeeklySchedule | null,
  items: readonly PlanItemSummary[],
  report?: StoredCloseWeekReport
): NotionExportRow[] {
  const model = buildTaskCalendar(plan, schedule, items);
  const finals = new Map(
    report?.output.classifiedItems.map((item) => [item.itemId, item.finalDisposition]) ?? []
  );
  const result: NotionExportRow[] = [];
  for (const task of model.tasks) {
    const source = plan.draftContext?.extractedItems?.find((item) => item.id === task.itemId);
    const allocations =
      schedule?.dailyAllocations.filter((row) => row.itemId === task.itemId) ?? [];
    const budget = taskHoursBudget(
      plan.proposal,
      plan.draftContext?.extractedItems,
      task.itemId,
      allocations
    );
    const base: NotionExportRow = {
      name: task.title,
      date: "",
      status: statusLabels[finals.get(task.itemId) ?? task.state] ?? "Sin reportar",
      hours: null,
      remaining: null,
      kind: "Sin día",
      week: `${plan.targetWeek.startDate} – ${plan.targetWeek.endDate}`,
      deadline: notionDate(task.dueDate ?? source?.deadline?.resolved ?? undefined),
      time: "",
      taskId: `${plan.planId}/${task.itemId}`,
    };
    if (["outside", "postponed", "note"].includes(task.kind)) {
      result.push({
        ...base,
        remaining: budget,
        kind:
          task.kind === "postponed"
            ? "Aplazada"
            : task.kind === "note"
              ? "Nota"
              : "Fuera de esta semana",
      });
      continue;
    }
    const rows: NotionExportRow[] = [];
    for (const row of allocations)
      rows.push({
        ...base,
        date: notionDate(row.day),
        hours: row.allocatedHours,
        kind: "Reparto diario",
      });
    for (const block of schedule?.timeBlocks.filter((row) => row.itemId === task.itemId) ?? []) {
      const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
      const duration = minutes(block.endTime) - minutes(block.startTime);
      if (duration <= 0) throw new Error("Revisa los horarios de la semana antes de exportar.");
      rows.push({
        ...base,
        date: notionDate(block.day),
        hours: round(duration / 60),
        time: `${block.startTime}–${block.endTime}`,
        kind: "Bloque con horario",
      });
    }
    if (!rows.length) {
      const day = plan.draftContext?.plannedDays?.[task.itemId];
      rows.push({
        ...base,
        date: notionDate(day),
        remaining: budget,
        kind: day ? "Día elegido, sin reparto de horas" : "Sin día",
      });
    } else {
      const assigned = round(rows.reduce((sum, row) => sum + (row.hours ?? 0), 0));
      if (budget != null && budget - assigned > 0.000001)
        rows.push({ ...base, remaining: round(budget - assigned) });
    }
    result.push(...rows);
  }
  return result;
}
function csvCell(value: string | number | null) {
  let text = value == null ? "" : String(value);
  // Keep user text inert if the downloaded CSV is opened in a spreadsheet.
  if (typeof value === "string" && /^[\s]*[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
export function notionExportCsv(rows: readonly NotionExportRow[]) {
  return (
    [
      NOTION_COLUMNS,
      ...rows.map((row) => [
        row.name,
        row.date,
        row.status,
        row.hours,
        row.remaining,
        row.kind,
        row.week,
        row.deadline,
        row.time,
        row.taskId,
      ]),
    ]
      .map((row) => row.map(csvCell).join(","))
      .join("\r\n") + "\r\n"
  );
}
