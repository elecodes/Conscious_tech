import { it, expect } from "vitest";
import { createReviewFixture } from "./fixtures/review-proposal";
import { renameDraftTask } from "../src/web/draft-calendar-edits";
it("renames a task consistently while preserving source evidence, group meaning, hours and other decisions", () => {
  const f = createReviewFixture();
  const before = structuredClone(f);
  const next = renameDraftTask(f.proposal, f.items, "g", "  Estudiar lógica  ");
  expect(next.items.find((item) => item.id === "g")!.title).toBe("Estudiar lógica");
  expect(next.items.find((item) => item.id === "g")!.rawText).toBe(
    f.items.find((item) => item.id === "g")!.rawText
  );
  expect(next.proposal.deferredItems.find((item) => item.itemId === "g")!.title).toBe(
    "Estudiar lógica"
  );
  expect(next.proposal.weekSummary).toEqual(f.proposal.weekSummary);
  expect(next.proposal.foci).toEqual(f.proposal.foci);
  expect(f).toEqual(before);
  expect(() => renameDraftTask(f.proposal, f.items, "g", " ")).toThrow();
  const group = renameDraftTask(f.proposal, f.items, "a", "Paso corregido");
  expect(group.proposal.foci).toEqual(f.proposal.foci);
});
