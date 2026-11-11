import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createReviewFixture } from "./fixtures/review-proposal";
import { createActiveWeekFixture } from "./fixtures/active-week";
import {
  retainDraftDays,
  draftItemHours,
  editDraftCalendarHours,
} from "../src/web/draft-calendar-edits";
import { DraftTaskCalendar } from "../src/web/components/draft-task-calendar";
import { buildTaskCalendar } from "../src/web/task-calendar-model";
import { WeeklyPlanDraftContextSchema } from "../src/domain/repositories/types";

describe("Editable draft calendar", () => {
  it("updates source, proposal and capacity together without losing other sources", () => {
    const { proposal, items } = createReviewFixture();
    const before = structuredClone({ proposal, items });
    const edited = editDraftCalendarHours(proposal, items, "c", 5);
    expect(edited.items.find((item) => item.id === "c")?.estimatedEffort?.value).toBe(5);
    expect(edited.proposal.obligations[0]?.estimatedHours).toBe(5);
    expect(edited.proposal.weekSummary.capacity.knownEstimatedHours).toBe(9);
    expect(edited.proposal.foci).toEqual(proposal.foci);
    expect(edited.items.map((item) => item.id)).toEqual(items.map((item) => item.id));
    expect({ proposal, items }).toEqual(before);
  });
  it("preserves unknown estimates and rejects invalid values and grouped splits", () => {
    const { proposal, items } = createReviewFixture();
    for (const hours of [null, 0]) {
      const edited = editDraftCalendarHours(proposal, items, "c", hours);
      expect(edited.items.find((item) => item.id === "c")?.estimatedEffort).toBeUndefined();
      expect(edited.proposal.obligations[0]?.estimatedHours).toBeNull();
      expect(edited.proposal.weekSummary.capacity.estimationCompleteness).toBe("partial");
    }
    for (const hours of [-1, NaN, Infinity])
      expect(() => editDraftCalendarHours(proposal, items, "c", hours)).toThrow();
    expect(() => editDraftCalendarHours(proposal, items, "a", 3)).toThrow("comparte");
  });
  it("does not reuse chosen days for a different source with a recycled provider ID", () => {
    const { items } = createReviewFixture();
    expect(retainDraftDays(items, items, { c: "2026-12-08" })).toEqual({ c: "2026-12-08" });
    expect(
      retainDraftDays(
        items,
        items.map((item) => (item.id === "c" ? { ...item, title: "Otro compromiso" } : item)),
        { c: "2026-12-08" }
      )
    ).toEqual({});
  });
  it("shows advanced proposal corrections including unknown estimates", () => {
    const { proposal, items } = createReviewFixture();
    proposal.obligations[0]!.estimatedHours = null;
    expect(
      draftItemHours(
        proposal,
        items.find((item) => item.id === "c")!
      )
    ).toBeNull();
  });
  it("offers hours, inclusion and chosen days in the primary calendar, keeping deadlines distinct", () => {
    const { proposal, items } = createReviewFixture();
    const html = renderToStaticMarkup(
      <DraftTaskCalendar
        proposal={proposal}
        items={items}
        plannedDays={{ c: "2026-12-08" }}
        onHours={vi.fn()}
        onDay={vi.fn()}
        onInclude={vi.fn()}
        onDefer={vi.fn()}
      />
    );
    expect(html).toContain("draft-hours-c");
    expect(html).toContain("draft-include-g");
    expect(html).toContain("draft-day-c");
    expect(html).toContain("Fecha límite: 2026-12-10");
    expect(html.indexOf('data-testid="draft-task-c"')).toBeLessThan(
      html.indexOf('data-testid="draft-calendar-day-2026-12-09"')
    );
  });
  it("reads optional chosen days in old-compatible draft context, without fabricating hours", () => {
    expect(WeeklyPlanDraftContextSchema.safeParse({}).success).toBe(true);
    expect(
      WeeklyPlanDraftContextSchema.safeParse({ plannedDays: { c: "2026-02-30" } }).success
    ).toBe(false);
    const { plan, schedule, items } = createActiveWeekFixture();
    plan.draftContext = { ...plan.draftContext, plannedDays: { c: "2026-12-08" } };
    const entry = buildTaskCalendar(plan, schedule, items).days[1]?.entries[0];
    expect(entry?.task.itemId).toBe("c");
    expect(entry?.hours).toBeUndefined();
    schedule.dailyAllocations.push({ itemId: "c", day: "2026-12-09", allocatedHours: 2 });
    const model = buildTaskCalendar(plan, schedule, items);
    expect(model.days[1]?.entries).toEqual([]);
    expect(model.days[2]?.entries[0]?.hours).toBe(2);
  });
});
