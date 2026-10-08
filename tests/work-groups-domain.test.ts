import { describe, it, expect } from "vitest";
import {
  WorkGroupSchema,
  GroupedWorkSchema,
} from "../src/domain/work-groups";
import {
  cleanAndValidateGroupedWork,
  validateGroupWorkInvariants,
} from "../src/skills/group-work/deterministic";
import { ExtractedItem } from "../src/domain/items";

describe("Domain: Work Groups & Invariants Validation", () => {
  it("validates well-formed WorkGroup schema", () => {
    const validGroup = {
      id: "group-1",
      title: "Lanzamiento beta cerrada",
      itemIds: ["item-1", "item-2"],
      rationale: "Ambas tareas forman parte del hito de lanzamiento",
    };
    const result = WorkGroupSchema.safeParse(validGroup);
    expect(result.success).toBe(true);
  });

  it("rejects WorkGroup with empty title or rationale", () => {
    const emptyTitle = {
      id: "group-1",
      title: "",
      itemIds: ["item-1", "item-2"],
      rationale: "Vínculo válido",
    };
    expect(WorkGroupSchema.safeParse(emptyTitle).success).toBe(false);

    const emptyRationale = {
      id: "group-1",
      title: "Título válido",
      itemIds: ["item-1", "item-2"],
      rationale: "",
    };
    expect(WorkGroupSchema.safeParse(emptyRationale).success).toBe(false);
  });

  it("validates well-formed GroupedWork schema", () => {
    const grouped = {
      groups: [
        {
          id: "group-1",
          title: "Arquitectura ArchitectAI",
          itemIds: ["item-1", "item-2"],
          rationale: "Tareas del mismo proyecto y objetivo",
        },
      ],
      ungroupedItemIds: ["item-3"],
    };
    expect(GroupedWorkSchema.safeParse(grouped).success).toBe(true);
  });

  it("validateGroupWorkInvariants detects phantom IDs and conservation violations", () => {
    const items: ExtractedItem[] = [
      { id: "item-1", rawText: "t1", title: "T1", type: "task" },
      { id: "item-2", rawText: "t2", title: "T2", type: "task" },
    ];

    // Phantom ID inside group and missing item-2
    const invalid = {
      groups: [
        {
          id: "group-1",
          title: "Grupo",
          itemIds: ["item-1", "phantom-99"],
          rationale: "Motivo",
        },
      ],
      ungroupedItemIds: [],
    };

    const check = validateGroupWorkInvariants(invalid, items);
    expect(check.valid).toBe(false);
    expect(check.errors.some((e) => e.includes("phantom-99"))).toBe(true);
    expect(check.errors.some((e) => e.includes("Conservation violation"))).toBe(true);
  });

  it("cleanAndValidateGroupedWork guarantees no lost items, no phantoms, and disjoint groups", () => {
    const items: ExtractedItem[] = [
      { id: "item-1", rawText: "t1", title: "T1", type: "task" },
      { id: "item-2", rawText: "t2", title: "T2", type: "task" },
      { id: "item-3", rawText: "t3", title: "T3", type: "task" },
      { id: "item-4", rawText: "t4", title: "T4", type: "task" },
    ];

    // Raw LLM output with overlapping items, phantom IDs, and missing item-4
    const messyRaw = {
      groups: [
        {
          id: "g-1",
          title: "Primer grupo",
          itemIds: ["item-1", "item-2", "phantom-x"],
          rationale: "Motivo 1",
        },
        {
          id: "g-2",
          title: "Segundo grupo",
          itemIds: ["item-2", "item-3"], // item-2 is already claimed by g-1
          rationale: "Motivo 2",
        },
      ],
      ungroupedItemIds: ["item-1"], // item-1 is already in g-1
    };

    const cleaned = cleanAndValidateGroupedWork(messyRaw, items);

    // g-2 was left with only item-3 after item-2 was retained in g-1, so g-2 (< 2 items) is disbanded
    expect(cleaned.groups).toHaveLength(1);
    expect(cleaned.groups[0]?.itemIds).toEqual(["item-1", "item-2"]);

    // item-3 and missing item-4 are safely preserved in ungroupedItemIds
    expect(cleaned.ungroupedItemIds).toContain("item-3");
    expect(cleaned.ungroupedItemIds).toContain("item-4");
    expect(cleaned.ungroupedItemIds).not.toContain("item-1");
    expect(cleaned.ungroupedItemIds).not.toContain("phantom-x");

    // Check invariants on cleaned result
    const check = validateGroupWorkInvariants(cleaned, items);
    expect(check.valid).toBe(true);
  });

  it("cleanAndValidateGroupedWork short-circuits empty input and single item input", () => {
    expect(cleanAndValidateGroupedWork({ groups: [], ungroupedItemIds: [] }, [])).toEqual({
      groups: [],
      ungroupedItemIds: [],
    });

    const singleItem: ExtractedItem[] = [
      { id: "item-single", rawText: "t", title: "T", type: "task" },
    ];
    expect(
      cleanAndValidateGroupedWork({ groups: [], ungroupedItemIds: [] }, singleItem)
    ).toEqual({
      groups: [],
      ungroupedItemIds: ["item-single"],
    });
  });
});
