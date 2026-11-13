import { useState } from "react";
import type { StoredWeeklyPlan, StoredCloseWeekReport } from "../../domain/repositories/types";
import type { WeeklySchedule } from "../../domain/schedule";
import { extractPlanItems } from "./weekly-session-formatters";
import { notionExportRows, notionExportCsv } from "../notion-export";

export function NotionExportButton({
  plan,
  schedule,
  report,
}: {
  plan: StoredWeeklyPlan;
  schedule: WeeklySchedule | null;
  report?: StoredCloseWeekReport;
}) {
  const [downloaded, setDownloaded] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <section className="notion-export" aria-label="Exportar una copia para Notion">
      <button
        type="button"
        className="secondary small"
        data-testid="export-notion-button"
        onClick={() => {
          setError(null);
          try {
            const rows = notionExportRows(plan, schedule, extractPlanItems(plan, schedule), report);
            const csv = notionExportCsv(rows);
            const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
            const link = document.createElement("a");
            link.href = url;
            link.download = `conscious-tech-notion-${plan.targetWeek.startDate}-${plan.targetWeek.endDate}.csv`;
            document.body.appendChild(link);
            link.click();
            link.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            setDownloaded(true);
            setShowHelp(true);
          } catch {
            setError(
              "No se pudo preparar la copia para Notion. Tus datos se conservan; revisa las asignaciones e inténtalo de nuevo."
            );
          }
        }}
      >
        Exportar para Notion (.csv)
      </button>
      <p className="calm-muted">
        Copia para importar en Notion. Los cambios posteriores no se sincronizan.
      </p>
      {error && <p role="alert">{error}</p>}
      {downloaded && (
        <p role="status">Archivo descargado. Impórtalo en Notion para crear tu copia.</p>
      )}
      <details
        open={showHelp}
        onToggle={(event) => setShowHelp(event.currentTarget.open)}
        data-testid="notion-export-help"
      >
        <summary>Cómo verlo como calendario en Notion</summary>
        <ol>
          <li>En Notion web o escritorio: Ajustes → Importar → CSV. Selecciona el archivo.</li>
          <li>
            Comprueba que «Fecha» sea una propiedad de tipo Fecha. El archivo usa el formato de
            importación de Notion: mes/día/año.
          </li>
          <li>Añade una vista «Calendario» y elige «Fecha», no «Fecha límite».</li>
        </ol>
        <p>
          Las tareas sin día siguen en la tabla. Cada reparto o bloque conserva sus horas; los
          horarios fijos van en «Horario».
        </p>
        <p>
          Es una copia puntual: volver a importar puede crear duplicados. No sustituye la copia de
          seguridad JSON de la app.
        </p>
        <a
          href="https://www.notion.com/help/import-data-into-notion"
          target="_blank"
          rel="noopener noreferrer"
        >
          Guía de importación de Notion
        </a>
      </details>
    </section>
  );
}
