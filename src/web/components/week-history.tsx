import { useEffect, useRef, useState } from "react";
import { useWeeklySession } from "../context/weekly-session-context";
import type { ClosedWeekSummary } from "../../domain/repositories/types";
import { ClosedWeekReviewCard } from "./closed-week-review-card";

export function WeekHistory({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { service } = useWeeklySession();
  const dialog = useRef<HTMLDialogElement>(null);
  const [weeks, setWeeks] = useState<ClosedWeekSummary[]>([]);
  const [issues, setIssues] = useState<string[]>([]);
  const [selected, setSelected] = useState<ClosedWeekSummary | null>(null);
  const [details, setDetails] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!open) {
      dialog.current?.close();
      return;
    }
    if (!dialog.current?.open) dialog.current?.showModal();
    let cancelled = false;
    setSelected(null);
    setLoading(true);
    setError(null);
    service
      .getClosedWeekHistory()
      .then((result) => {
        if (cancelled) return;
        setWeeks(result.weeks);
        setIssues(result.issues.map((issue) => `${issue.week.startDate} – ${issue.week.endDate}`));
      })
      .catch(() => {
        if (!cancelled)
          setError(
            "No se pudo leer el historial. Puedes volver a intentarlo; tus datos no se han modificado."
          );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, service, retry]);
  return (
    <dialog
      ref={dialog}
      className="calendar-task-editor week-history-dialog"
      aria-label="Semanas anteriores"
      onClose={onClose}
      data-testid="week-history"
    >
      <header className="task-calendar-heading">
        <h2>Semanas anteriores</h2>
        <button type="button" className="secondary small" onClick={onClose}>
          Cerrar historial
        </button>
      </header>
      <p className="calm-muted">
        Consultar no cambia tu semana activa. El cuaderno se guarda en este navegador y dirección.
      </p>
      {loading && <p role="status">Cargando semanas…</p>}
      {error && (
        <div role="alert">
          <p>{error}</p>
          <button type="button" onClick={() => setRetry((value) => value + 1)}>
            Reintentar
          </button>
        </div>
      )}
      {!loading && !error && (
        <>
          {!!issues.length && (
            <details>
              <summary>Hay semanas con datos incompletos ({issues.length})</summary>
              <p>No se han modificado. Las demás semanas siguen disponibles.</p>
              <ul>
                {issues.map((week, index) => (
                  <li key={`${week}-${index}`}>{week}</li>
                ))}
              </ul>
            </details>
          )}
          {selected ? (
            <section data-testid="history-week-details">
              <button
                type="button"
                className="secondary small"
                onClick={() => {
                  setSelected(null);
                  if (dialog.current) dialog.current.scrollTop = 0;
                }}
              >
                ← Volver al historial
              </button>
              <ClosedWeekReviewCard
                latestClosedWeek={selected}
                heading="Semana consultada"
                allowReopen={false}
                isClosedWeekDetailsOpen={details}
                setIsClosedWeekDetailsOpen={setDetails}
                isReopening={false}
                handleReopenWeek={() => {}}
                reopenFeedback={null}
              />
            </section>
          ) : weeks.length ? (
            <ul className="week-history-list">
              {weeks.map((week) => (
                <li key={week.plan.planId}>
                  <strong>
                    {week.plan.targetWeek.startDate} – {week.plan.targetWeek.endDate}
                  </strong>
                  <span>{week.plan.proposal.weekSummary.intent || "Semana cerrada"}</span>
                  <small>
                    {week.closeReport.output.itemDispositions.completed.length} completadas ·
                    cerrada el {week.closeReport.closedAt.slice(0, 10)}
                  </small>
                  <button
                    type="button"
                    className="secondary small"
                    data-testid={`history-open-${week.plan.planId}`}
                    onClick={() => {
                      setSelected(week);
                      setDetails(true);
                      if (dialog.current) dialog.current.scrollTop = 0;
                    }}
                  >
                    Consultar semana
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p>
              {issues.length
                ? "No hay semanas completas para mostrar. Los registros indicados arriba siguen guardados."
                : "No hay semanas cerradas todavía. Al usar «Cerrar semana», podrás consultarlas aquí."}
            </p>
          )}
        </>
      )}
    </dialog>
  );
}
