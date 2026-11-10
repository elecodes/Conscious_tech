import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  PlanningReviewBoard,
  PlanningReviewBoardProps,
} from "../src/web/components/planning-review-board";
import { CalmIdeaCard } from "../src/web/components/calm-idea-card";
import { createReviewFixture } from "./fixtures/review-proposal";

function props(): PlanningReviewBoardProps {
  const fixture = createReviewFixture(true);
  return {
    proposedWeek: fixture.proposal,
    activeTargetWeek: fixture.plan.targetWeek,
    extractedItems: fixture.items,
    acceptedItemIds: new Set(fixture.selectedIds),
    editingProposalItemId: null,
    proposalItemHoursInput: "",
    deferredDecisions: {},
    setEditingProposalItemId: vi.fn(),
    setProposalItemHoursInput: vi.fn(),
    handleDemoteFocusToFlexible: vi.fn(),
    handlePromoteFlexibleToFocus: vi.fn(),
    handleSaveProposalItemHours: vi.fn(),
    handleDeferredDecisionChange: vi.fn(),
    handleApplyOverdueDecision: vi.fn(),
    handleToggleItem: vi.fn(),
    handleUpdateItemEffort: vi.fn(),
    handleUpdateItemDeadline: vi.fn(),
  };
}

describe("One proposal decision surface", () => {
  it("accounts for every source once across groups, commitments, options, thoughts, pending and excluded items", () => {
    const input = props();
    const html = renderToStaticMarkup(<PlanningReviewBoard {...input} />);
    for (const item of input.extractedItems!) {
      expect(html.split(`data-testid="idea-card-${item.id}"`)).toHaveLength(2);
    }
    expect(html).toContain('data-testid="review-this-week"');
    expect(html).toContain('data-testid="review-if-space"');
    expect(html).toContain('data-testid="review-pending-sources"');
    expect(html).toContain('data-testid="review-excluded-sources"');
    expect(html).toContain('data-testid="review-thoughts"');
  });

  it("keeps provenance, classification and corrections next to the matching entry", () => {
    const input = props();
    const html = renderToStaticMarkup(<PlanningReviewBoard {...input} />);
    expect(html).toContain('data-testid="review-details-a"');
    expect(html).toContain("Dos pasos del mismo proyecto");
    expect(html).toContain(input.extractedItems![1]!.rawText);
    expect(html).toContain("Preocupación");
    expect(html).toContain("Tener en cuenta al actualizar");
    expect(html).toContain("su posición en la semana se decide en la propuesta");
  });

  it("preserves ideas and concerns without assigning them work or mutating their types", () => {
    const input = props();
    const snapshot = JSON.stringify(input.extractedItems);
    const html = renderToStaticMarkup(<PlanningReviewBoard {...input} />);
    expect(html).toContain("No necesitan convertirse en tareas");
    expect(html).toContain("Dedicarle atención esta semana");
    expect(JSON.stringify(input.extractedItems)).toBe(snapshot);
    expect(input.proposedWeek.foci.flatMap((focus) => focus.contributingItemIds)).not.toContain(
      "f"
    );
  });

  it("protects multi-item focus moves and overdue decisions that would discard group members", () => {
    const html = renderToStaticMarkup(<PlanningReviewBoard {...props()} />);
    expect(html).toMatch(/data-testid="demote-focus-to-flexible-group-focus"[^>]*disabled/);
    expect(html).toMatch(/data-testid="decision-postpone-a"[^>]*disabled/);
    expect(html).toContain("Conservamos su información");
  });

  it.each([
    { value: 30, unit: "minutes" as const, hours: "0.5" },
    { value: 1, unit: "days" as const, hours: "8" },
  ])(
    "shows $unit as planning hours without altering the original estimate",
    ({ value, unit, hours }) => {
      const item = {
        ...createReviewFixture().items[0]!,
        estimatedEffort: { value, unit, source: "user" as const },
      };
      const html = renderToStaticMarkup(
        <CalmIdeaCard
          item={item}
          isAccepted
          onToggle={vi.fn()}
          onUpdateEffort={vi.fn()}
          onUpdateDeadline={vi.fn()}
          detailsOnly
        />
      );
      expect(html).toContain(`aria-label="Horas estimadas para ${item.title}"`);
      expect(html).toContain(`value="${hours}"`);
      expect(item.estimatedEffort).toEqual({ value, unit, source: "user" });
    }
  );

  it("renders empty and legacy proposals without inventing source items", () => {
    const input = props();
    input.extractedItems = null;
    const legacy = renderToStaticMarkup(<PlanningReviewBoard {...input} />);
    expect(legacy).toContain("Avanzar en el proyecto");
    expect(legacy).not.toContain('data-testid="idea-card-');
    input.proposedWeek = {
      ...input.proposedWeek,
      foci: [],
      obligations: [],
      flexibleOptions: [],
      deferredItems: [],
    };
    const empty = renderToStaticMarkup(<PlanningReviewBoard {...input} />);
    expect(empty).toContain("Puedes mantener este espacio sin ocupar");
    expect(empty).not.toContain('data-testid="idea-card-');
  });
});
