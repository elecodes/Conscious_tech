import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import {
  createIndexedDbStorage,
  type IndexedDbStorageContext,
} from "../src/infrastructure/storage/indexeddb";
import { WeeklySessionService } from "../src/application/weekly-session-service";
import { createActiveWeekFixture } from "./fixtures/active-week";

function fixture(id: string, start: string, end: string) {
  const f = createActiveWeekFixture();
  f.plan.planId = id;
  f.plan.targetWeek = { startDate: start, endDate: end };
  f.plan.proposal.weekSummary.targetWeek = f.plan.targetWeek;
  f.schedule.scheduleId = `schedule-${id}`;
  f.schedule.planId = id;
  f.schedule.weekRange = f.plan.targetWeek;
  f.schedule.dailyAllocations = [{ itemId: "a", day: start, allocatedHours: 2 }];
  f.schedule.timeBlocks = [];
  return f;
}
describe("Local persistence and closed-week archive", () => {
  let storage: IndexedDbStorageContext;
  let service: WeeklySessionService;
  let factory: IDBFactory;
  beforeEach(async () => {
    globalThis.IDBKeyRange = IDBKeyRange;
    factory = new IDBFactory();
    storage = await createIndexedDbStorage({ dbName: "history-test", customFactory: factory });
    service = new WeeklySessionService({ ...storage, getDb: () => storage.db });
  });
  afterEach(() => storage.close());
  async function close(id: string, start: string, end: string) {
    const f = fixture(id, start, end);
    await storage.plans.save(f.plan);
    await storage.schedules.save(f.schedule);
    const result = await service.closeCurrentWeek({
      planId: id,
      closedAt: `${end}T18:00:00Z`,
      expectedScheduleVersion: 1,
      itemOutcomes: [{ itemId: "a", status: "completed" }],
    });
    expect(result.status).toBe("success");
    return f;
  }
  it("keeps all closed weeks with their schedules/reports and consults them without changing the active week", async () => {
    await close("old", "2026-10-12", "2026-10-18");
    await close("recent", "2026-10-19", "2026-10-25");
    const active = fixture("active", "2026-10-26", "2026-11-01");
    await storage.plans.save(active.plan);
    await storage.schedules.save(active.schedule);
    const before = await service.exportBackup();
    const history = await service.getClosedWeekHistory();
    expect(history.issues).toEqual([]);
    expect(history.weeks.map((week) => week.plan.planId)).toEqual(["recent", "old"]);
    expect(
      history.weeks.every((week) =>
        week.closeReport.output.itemDispositions.completed.includes("a")
      )
    ).toBe(true);
    expect(history.weeks[1]!.schedule!.dailyAllocations[0]!.day).toBe("2026-10-12");
    expect((await service.exportBackup()).data).toEqual(before.data);
    storage.close();
    storage = await createIndexedDbStorage({ dbName: "history-test", customFactory: factory });
    service = new WeeklySessionService({ ...storage, getDb: () => storage.db });
    const resumed = await service.resumeSession();
    expect(resumed.status).toBe("session_resumed");
    if (resumed.status !== "session_resumed") throw new Error(resumed.status);
    expect(resumed.state.activePlan!.planId).toBe("active");
    expect(resumed.state.activeSchedule!.dailyAllocations).toEqual(
      active.schedule.dailyAllocations
    );
    expect((await service.getClosedWeekHistory()).weeks).toHaveLength(2);
  });
  it("reports incomplete closed weeks without losing access to valid history", async () => {
    await close("valid", "2026-10-12", "2026-10-18");
    const broken = fixture("broken", "2026-10-19", "2026-10-25");
    await storage.plans.save({ ...broken.plan, status: "closed" });
    const history = await service.getClosedWeekHistory();
    expect(history.weeks.map((week) => week.plan.planId)).toEqual(["valid"]);
    expect(history.issues[0]!.planId).toBe("broken");
    expect((await storage.plans.getById("broken"))!.status).toBe("closed");
  });
  it("rejects missing archive schedules and excludes reopened weeks", async () => {
    const f = await close("closed", "2026-10-12", "2026-10-18");
    await storage.schedules.delete(f.schedule.scheduleId);
    const broken = await service.getClosedWeekHistory();
    expect(broken.weeks).toEqual([]);
    expect(broken.issues).toHaveLength(1);
    await storage.schedules.save(f.schedule);
    expect((await service.reopenWeek(f.plan.planId)).status).toBe("success");
    expect((await service.getClosedWeekHistory()).weeks).toEqual([]);
  });
  it("does not show a close report for a different week as a valid historical record", async () => {
    await close("closed", "2026-10-12", "2026-10-18");
    const report = (await storage.closeReports.getAll())[0]!;
    await storage.closeReports.save({
      ...report,
      output: { ...report.output, weekRange: { startDate: "2026-09-07", endDate: "2026-09-13" } },
    });
    const result = await service.getClosedWeekHistory();
    expect(result.weeks).toEqual([]);
    expect(result.issues).toHaveLength(1);
    expect((await storage.closeReports.getAll())[0]!.output.weekRange.startDate).toBe("2026-09-07");
  });
});
