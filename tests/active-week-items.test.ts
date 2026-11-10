import { describe, expect, it } from "vitest";
import { partitionActiveWeekItems } from "../src/web/active-week-items";
import { extractPlanItems } from "../src/web/components/weekly-session-formatters";
import { createActiveWeekFixture } from "./fixtures/active-week";

function ids(items: { itemId: string }[]) {
  return items.map((item) => item.itemId);
}

describe("Active week presentation without changing the inventory", () => {
  it("separates commitments, grouped focus members, optional and deferred items by proposal membership", () => {
    const { plan, schedule, items } = createActiveWeekFixture();
    const groups = partitionActiveWeekItems(plan, schedule, items);
    expect(ids(groups.obligations)).toEqual(["c"]);
    expect(ids(groups.focuses[0]!.items)).toEqual(["a", "b"]);
    expect(ids(groups.flexible)).toEqual(["d"]);
    expect(ids(groups.deferred)).toEqual(["e", "f", "g", "j"]);
    expect(groups.focuses[0]!.focus.estimatedHours).toBe(4);
  });

  it("does not promote a deferred item merely because an allocation or time block remains", () => {
    const { plan, schedule, items } = createActiveWeekFixture();
    const groups = partitionActiveWeekItems(plan, schedule, items);
    expect(ids(groups.deferred)).toContain("g");
    expect(ids(groups.agenda)).not.toContain("g");
    expect(groups.focuses.flatMap((group) => ids(group.items))).not.toContain("g");
  });

  it("retains schedule-only and unclassified legacy items without guessing from translated labels", () => {
    const fixture = createActiveWeekFixture();
    fixture.schedule.dailyAllocations.push({
      itemId: "legacy-agenda",
      day: "2026-12-10",
      allocatedHours: 1,
    });
    const items = extractPlanItems(fixture.plan, fixture.schedule).map((item) => ({
      ...item,
      source: "Etiqueta diferente",
    }));
    items.push({ itemId: "unclassified", title: "Otro elemento", source: "Obligación" });
    const groups = partitionActiveWeekItems(fixture.plan, fixture.schedule, items);
    expect(ids(groups.obligations)).toEqual(["c"]);
    expect(ids(groups.agenda)).toEqual(["legacy-agenda"]);
    expect(ids(groups.unclassified)).toEqual(["unclassified"]);
  });

  it("accounts for every item once and leaves plan, schedule and descriptors unchanged", () => {
    const { plan, schedule, items } = createActiveWeekFixture();
    const before = JSON.stringify({ plan, schedule, items });
    const groups = partitionActiveWeekItems(plan, schedule, items);
    const all = [
      ...groups.focuses.flatMap((group) => group.items),
      ...groups.obligations,
      ...groups.flexible,
      ...groups.deferred,
      ...groups.agenda,
      ...groups.unclassified,
    ];
    expect(ids(all).sort()).toEqual(ids(items).sort());
    expect(new Set(ids(all)).size).toBe(items.length);
    expect(JSON.stringify({ plan, schedule, items })).toBe(before);
  });

  it("supports an empty week or missing plan without inventing a focus or dropping stored items", () => {
    const { schedule } = createActiveWeekFixture();
    const empty = partitionActiveWeekItems(null, schedule, []);
    expect(empty.focuses).toEqual([]);
    expect(empty.obligations).toEqual([]);
    const legacy = partitionActiveWeekItems(null, schedule, [
      { itemId: "saved", title: "Nota", source: "Foco" },
    ]);
    expect(ids(legacy.unclassified)).toEqual(["saved"]);
    expect(legacy.focuses).toEqual([]);
  });
});
