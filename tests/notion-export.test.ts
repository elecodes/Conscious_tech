import { describe, expect, it } from "vitest";
import { createActiveWeekFixture } from "./fixtures/active-week";
import { notionDate, notionExportRows, notionExportCsv } from "../src/web/notion-export";

describe("Notion snapshot portability", () => {
  it("preserves split hours, separate deadlines and individual group estimates without mutation", () => {
    const f = createActiveWeekFixture();
    f.plan.proposal.obligations[0]!.estimatedHours = 5;
    f.schedule.dailyAllocations = [
      { itemId: "c", day: "2026-12-07", allocatedHours: 2 },
      { itemId: "c", day: "2026-12-09", allocatedHours: 2 },
      { itemId: "c", day: "2026-12-11", allocatedHours: 1 },
    ];
    const before = JSON.stringify(f);
    const rows = notionExportRows(f.plan, f.schedule, f.items);
    const task = rows.filter((r) => r.taskId.endsWith("/c"));
    expect(task.map((r) => [r.date, r.hours])).toEqual([
      ["12/07/2026", 2],
      ["12/09/2026", 2],
      ["12/11/2026", 1],
    ]);
    expect(task.every((r) => r.deadline === "12/10/2026")).toBe(true);
    expect(rows.find((r) => r.taskId.endsWith("/a"))).toMatchObject({ date: "", remaining: 2 });
    expect(rows.find((r) => r.taskId.endsWith("/b"))).toMatchObject({ date: "", remaining: 2 });
    expect(rows.filter((r) => r.taskId.endsWith("/g"))).toMatchObject([{ date: "", hours: null }]);
    expect(JSON.stringify(f)).toBe(before);
  });
  it("exports partial effort as an undated remainder and preserves actual fixed times", () => {
    const f = createActiveWeekFixture();
    f.schedule.dailyAllocations = [{ itemId: "c", day: "2026-12-07", allocatedHours: 0.5 }];
    f.schedule.timeBlocks = [
      { itemId: "d", day: "2026-12-08", startTime: "14:00", endTime: "14:30" },
    ];
    const rows = notionExportRows(f.plan, f.schedule, f.items);
    expect(rows.filter((r) => r.taskId.endsWith("/c"))).toMatchObject([
      { date: "12/07/2026", hours: 0.5, remaining: null },
      { date: "", hours: null, remaining: 1.5 },
    ]);
    expect(rows.find((r) => r.taskId.endsWith("/d") && r.date)).toMatchObject({
      hours: 0.5,
      time: "14:00–14:30",
    });
  });
  it("leaves unknown estimates undated and never promotes deadlines to assignments", () => {
    const f = createActiveWeekFixture();
    f.plan.proposal.obligations[0]!.estimatedHours = null;
    f.schedule.dailyAllocations = [];
    f.schedule.timeBlocks = [];
    const row = notionExportRows(f.plan, f.schedule, f.items).find((r) => r.taskId.endsWith("/c"));
    expect(row).toMatchObject({ date: "", hours: null, remaining: null, deadline: "12/10/2026" });
  });
  it("escapes CSV text, preserves zero and keeps unknown values empty", () => {
    const f = createActiveWeekFixture();
    const row = notionExportRows(f.plan, null, f.items)[0]!;
    const csv = notionExportCsv([
      { ...row, name: '=Óscar, "hola"\nsegunda línea', hours: 0, remaining: null },
    ]);
    expect(csv).toContain('"\'=Óscar, ""hola""\nsegunda línea"');
    expect(csv).toContain(',"0","",');
    expect(notionDate("2026-12-07")).toBe("12/07/2026");
    expect(notionDate(undefined)).toBe("");
  });
});
