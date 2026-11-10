import { ProposedWeek } from "../../domain/week";
import { formatDeferredReason, formatHours } from "./weekly-session-formatters";

function countLabel(count: number, singular: string, plural: string) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("es-ES", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}

/** Read the exact proposal being activated; do not recalculate planning rules here. */
export function PlanningConfirmationSummary({ proposal }: { proposal: ProposedWeek }) {
  const { capacity, targetWeek, intent } = proposal.weekSummary;
  const plannedTime =
    capacity.plannedHours != null
      ? formatHours(capacity.plannedHours)
      : capacity.knownEstimatedHours != null
        ? `${formatHours(capacity.knownEstimatedHours)} conocidas; estimación parcial`
        : proposal.foci.length + proposal.obligations.length === 0
          ? "Sin focos ni compromisos"
          : "Sin estimar";
  const capacityNote =
    capacity.totalAvailableHours == null
      ? "Propuesta provisional: no has indicado tus horas libres. Aún no se puede comprobar si cabe."
      : capacity.capacityStatus === "over_capacity" ||
          capacity.protectedSpaceStatus === "compromised"
        ? "El plan supera el tiempo planificable o compromete el espacio protegido. Puedes volver a revisarlo antes de activar."
        : proposal.foci.length + proposal.obligations.length === 0
          ? "Esta propuesta no incluye focos ni compromisos."
          : capacity.estimationCompleteness !== "complete"
            ? "Faltan estimaciones: la viabilidad de esta semana todavía no está confirmada."
            : capacity.capacityStatus === "within_capacity" &&
                capacity.protectedSpaceStatus === "respected"
              ? "Con las estimaciones actuales, el tiempo previsto cabe y respeta el espacio protegido."
              : "La viabilidad de esta semana todavía no está confirmada.";
  const visibleCommitments = proposal.obligations.slice(0, 3);
  const otherCommitments = proposal.obligations.slice(3);
  const hasOtherItems =
    otherCommitments.length + proposal.flexibleOptions.length + proposal.deferredItems.length > 0;

  return (
    <section
      className="calm-box confirmation-summary"
      aria-label="Resumen de la semana que vas a activar"
      data-testid="confirmation-summary"
    >
      <h3>Tu semana, antes de activarla</h3>
      <p className="calm-muted">
        <time dateTime={targetWeek.startDate}>{formatDate(targetWeek.startDate)}</time>
        {" al "}
        <time dateTime={targetWeek.endDate}>{formatDate(targetWeek.endDate)}</time>
      </p>
      <p className="confirmation-intent" data-testid="confirmation-intent">
        {intent?.trim() || "Sin intención definida"}
      </p>
      <p className="calm-muted" data-testid="confirmation-counts">
        {countLabel(proposal.foci.length, "foco", "focos")}
        {" · "}
        {countLabel(proposal.obligations.length, "compromiso", "compromisos")}
        {" · "}
        {countLabel(proposal.flexibleOptions.length, "opción flexible", "opciones flexibles")}
        {" · "}
        {countLabel(
          proposal.deferredItems.length,
          "elemento fuera de esta semana",
          "elementos fuera de esta semana"
        )}
      </p>
      {proposal.foci.length > 0 && (
        <ul className="confirmation-focus-list" aria-label="Focos de esta semana">
          {proposal.foci.map((focus) => (
            <li key={focus.id}>{focus.title}</li>
          ))}
        </ul>
      )}
      {visibleCommitments.length > 0 && (
        <div>
          <h4>Compromisos</h4>
          <ul className="confirmation-focus-list" aria-label="Compromisos de esta semana">
            {visibleCommitments.map((item) => (
              <li key={item.itemId}>
                {item.title}
                {item.dueDate ? ` — ${item.dueDate}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
      <dl className="confirmation-time-grid">
        <div>
          <dt>Horas libres de partida</dt>
          <dd data-testid="confirmation-available-hours">
            {formatHours(capacity.totalAvailableHours, "Por definir")}
          </dd>
        </div>
        <div>
          <dt>Tiempo de focos y compromisos</dt>
          <dd data-testid="confirmation-planned-hours">{plannedTime}</dd>
        </div>
        <div>
          <dt>Espacio protegido</dt>
          <dd data-testid="confirmation-protected-hours">
            {formatHours(capacity.protectedSpaceHours, "Por definir")}
          </dd>
        </div>
      </dl>
      <p className="calm-text confirmation-capacity-note" data-testid="confirmation-capacity-note">
        {capacityNote}
      </p>
      {proposal.flexibleOptions.length > 0 && (
        <p className="calm-muted">
          Las opciones flexibles quedan para si hay espacio; sus horas no están incluidas en el
          tiempo de focos y compromisos.
        </p>
      )}
      {hasOtherItems && (
        <details className="confirmation-item-details">
          <summary>Ver el resto de la propuesta</summary>
          {otherCommitments.length > 0 && (
            <>
              <h4>Otros compromisos ({otherCommitments.length})</h4>
              <ul>
                {otherCommitments.map((item) => (
                  <li key={item.itemId}>
                    {item.title}
                    {item.dueDate ? ` — ${item.dueDate}` : ""}
                  </li>
                ))}
              </ul>
            </>
          )}
          {proposal.flexibleOptions.length > 0 && (
            <>
              <h4>Si queda espacio</h4>
              <ul>
                {proposal.flexibleOptions.map((item) => (
                  <li key={item.itemId}>{item.title}</li>
                ))}
              </ul>
            </>
          )}
          {proposal.deferredItems.length > 0 && (
            <>
              <h4>Fuera de esta semana</h4>
              <ul>
                {proposal.deferredItems.map((item) => (
                  <li key={item.itemId}>
                    {item.title} — {formatDeferredReason(item.reason)}
                  </li>
                ))}
              </ul>
            </>
          )}
        </details>
      )}
    </section>
  );
}
