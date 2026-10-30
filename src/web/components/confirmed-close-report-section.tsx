import { StoredCloseWeekReport } from "../../domain/repositories/types";

export interface ConfirmedCloseReportSectionProps {
  closeReport: StoredCloseWeekReport;
}

export function ConfirmedCloseReportSection({
  closeReport,
}: ConfirmedCloseReportSectionProps) {
  return (
    <section
      className="results-section calm-box"
      style={{ marginTop: "24px" }}
      aria-label="Informe confirmado de cierre de semana"
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          flexWrap: "wrap",
          gap: "8px",
        }}
      >
        <h3>Informe confirmado de cierre</h3>
        <span className="badge badge-task">
          Cerrada el {closeReport.closedAt}
        </span>
      </div>
      <div className="config-row" style={{ marginTop: "12px", flexWrap: "wrap", gap: "8px" }}>
        <span className="badge badge-muted">
          Completadas:{" "}
          {closeReport.output.itemDispositions.completed.length}
        </span>
        {closeReport.output.reflectiveSummary.consciousPostponements.length > 0 && (
          <span className="badge badge-idea">
            Postergadas conscientemente:{" "}
            {closeReport.output.reflectiveSummary.consciousPostponements.length}
          </span>
        )}
        {closeReport.output.itemDispositions.dropped.length > 0 && (
          <span className="badge badge-error">
            Descartadas: {closeReport.output.itemDispositions.dropped.length}
          </span>
        )}
        {closeReport.output.itemDispositions.unreported.length > 0 && (
          <span className="badge badge-muted">
            Sin informar: {closeReport.output.itemDispositions.unreported.length}
          </span>
        )}
      </div>
      {closeReport.output.reflectiveSummary.headline && (
        <div style={{ marginTop: "12px" }}>
          <strong>Resumen reflexivo:</strong>
          <p className="calm-text" style={{ fontStyle: "italic", marginTop: "4px" }}>
            "{closeReport.output.reflectiveSummary.headline}"
          </p>
        </div>
      )}
    </section>
  );
}
