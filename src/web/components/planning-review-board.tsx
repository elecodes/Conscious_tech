import {
  PlanningProposedItemsSection,
  PlanningProposedItemsSectionProps,
} from "./planning-proposed-items-section";
import {
  PlanningDeferredItemsSection,
  PlanningDeferredItemsSectionProps,
} from "./planning-deferred-items-section";
import { CalmIdeaCard } from "./calm-idea-card";

export interface PlanningReviewBoardProps
  extends
    Omit<PlanningProposedItemsSectionProps, "section" | "renderItemDetails">,
    Pick<
      PlanningDeferredItemsSectionProps,
      "deferredDecisions" | "handleDeferredDecisionChange" | "handleApplyOverdueDecision"
    > {
  acceptedItemIds: Set<string>;
  handleToggleItem: (id: string) => void;
  handleUpdateItemEffort: (id: string, hours: number | null) => void;
  handleUpdateItemDeadline: (id: string, date: string | null) => void;
}

/** One primary proposal view, with source corrections attached to each entry. */
export function PlanningReviewBoard(props: PlanningReviewBoardProps) {
  const { proposedWeek: proposal, acceptedItemIds } = props;
  const sources = props.extractedItems ?? [];
  const sourceById = new Map(sources.map((item) => [item.id, item]));
  const coveredIds = new Set([
    ...proposal.foci.flatMap((focus) =>
      focus.contributingItemIds.length ? focus.contributingItemIds : [focus.id]
    ),
    ...proposal.obligations.map((item) => item.itemId),
    ...proposal.flexibleOptions.map((item) => item.itemId),
    ...proposal.deferredItems.map((item) => item.itemId),
  ]);
  const unmatched = sources.filter((item) => !coveredIds.has(item.id));
  const pending = unmatched.filter((item) => acceptedItemIds.has(item.id));
  const excluded = unmatched.filter((item) => !acceptedItemIds.has(item.id));
  const isThought = (id: string) => ["idea", "concern"].includes(sourceById.get(id)?.type ?? "");
  const thoughts = proposal.deferredItems.filter((item) => isThought(item.itemId));
  const deferredWork = proposal.deferredItems.filter((item) => !isThought(item.itemId));
  const overdue = sources.filter(
    (item) =>
      acceptedItemIds.has(item.id) &&
      item.deadline?.resolved &&
      item.deadline.resolved < proposal.weekSummary.targetWeek.startDate
  );

  const sourceCard = (item: (typeof sources)[number], detailsOnly = false) => (
    <CalmIdeaCard
      key={item.id}
      item={item}
      isAccepted={acceptedItemIds.has(item.id)}
      onToggle={() => props.handleToggleItem(item.id)}
      onUpdateEffort={props.handleUpdateItemEffort}
      onUpdateDeadline={props.handleUpdateItemDeadline}
      detailsOnly={detailsOnly}
      selectionLabel="Tener en cuenta al actualizar"
    />
  );
  const renderItemDetails = (ids: string[], rationale?: string) => {
    const items = [...new Set(ids)].flatMap((id) =>
      sourceById.has(id) ? [sourceById.get(id)!] : []
    );
    const excludedCount = items.filter((item) => !acceptedItemIds.has(item.id)).length;
    if (!items.length && !rationale) return null;
    return (
      <>
        {excludedCount > 0 && (
          <p className="calm-muted review-pending-change">
            {excludedCount} elemento(s) excluido(s) al actualizar. La posición actual cambiará al
            regenerar la propuesta.
          </p>
        )}
        <details className="review-source-details" data-testid={`review-details-${ids[0]}`}>
          <summary
            aria-label={`Detalles y correcciones de ${items.map((item) => item.title).join(", ") || "este elemento"}`}
          >
            Detalles y correcciones
          </summary>
          {rationale && <p className="calm-muted">{rationale}</p>}
          {items.length > 0 && (
            <>
              <p className="calm-muted">
                Marcar permite considerar el elemento al actualizar; su posición en la semana se
                decide en la propuesta.
              </p>
              <ul className="review-source-list">{items.map((item) => sourceCard(item, true))}</ul>
            </>
          )}
        </details>
      </>
    );
  };

  return (
    <section
      aria-label="Decisiones de la propuesta"
      data-testid="planning-review-board"
      className="planning-review-board"
    >
      <h3>Decide qué entra en tu semana</h3>
      <p className="calm-muted">
        Revisa la posición de cada elemento. En Detalles y correcciones puedes consultar tus
        palabras y ajustar fechas o estimaciones.
      </p>
      <section aria-label="Esta semana" data-testid="review-this-week">
        <h4>Esta semana</h4>
        {proposal.foci.length + proposal.obligations.length === 0 && (
          <p className="calm-muted">
            Sin focos ni compromisos. Puedes mantener este espacio sin ocupar.
          </p>
        )}
        <PlanningProposedItemsSection
          {...props}
          section="scheduled"
          renderItemDetails={renderItemDetails}
        />
      </section>
      <section aria-label="Si queda espacio" data-testid="review-if-space">
        <h4>Si queda espacio ({proposal.flexibleOptions.length})</h4>
        {proposal.flexibleOptions.length === 0 && (
          <p className="calm-muted">Sin opciones flexibles en esta propuesta.</p>
        )}
        <PlanningProposedItemsSection
          {...props}
          section="flexible"
          renderItemDetails={renderItemDetails}
        />
      </section>
      <PlanningDeferredItemsSection
        {...props}
        proposedWeek={{ ...proposal, deferredItems: deferredWork }}
        title="Fuera de esta semana"
        showOverdueDecisions={false}
        renderItemDetails={renderItemDetails}
      />
      {thoughts.length > 0 && (
        <section aria-label="Ideas y preocupaciones" data-testid="review-thoughts">
          <p className="calm-muted">
            Estas ideas y preocupaciones pueden seguir siendo notas. No necesitan convertirse en
            tareas.
          </p>
          <PlanningDeferredItemsSection
            {...props}
            proposedWeek={{ ...proposal, deferredItems: thoughts }}
            title="Ideas y preocupaciones"
            description="Puedes conservar estas notas sin planificarlas ni convertirlas en tareas."
            includeLabel="Dedicarle atención esta semana"
            sectionPrefix="review-thought-items"
            showOverdueDecisions={false}
            renderItemDetails={renderItemDetails}
          />
        </section>
      )}
      {pending.length > 0 && (
        <section data-testid="review-pending-sources">
          <h4>Pendientes de actualizar ({pending.length})</h4>
          <p className="calm-muted">
            Estos elementos aún no tienen posición en la propuesta. Actualízala para tenerlos en
            cuenta.
          </p>
          <ul className="review-source-list">{pending.map((item) => sourceCard(item))}</ul>
        </section>
      )}
      {excluded.length > 0 && (
        <section data-testid="review-excluded-sources">
          <h4>Excluidos de esta propuesta ({excluded.length})</h4>
          <p className="calm-muted">Puedes volver a marcarlos mientras revisas estas notas.</p>
          <ul className="review-source-list">{excluded.map((item) => sourceCard(item))}</ul>
        </section>
      )}
      {overdue.length > 0 && (
        <details className="review-overdue-decisions" data-testid="review-overdue-decisions">
          <summary>Revisar fechas vencidas ({overdue.length})</summary>
          <PlanningDeferredItemsSection
            {...props}
            proposedWeek={{ ...proposal, deferredItems: [] }}
            extractedItems={overdue}
          />
        </details>
      )}
    </section>
  );
}
