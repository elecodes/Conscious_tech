import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory, IDBKeyRange, IDBObjectStore as FakeObjectStore } from "fake-indexeddb";
import {
  createIndexedDbStorage,
  IndexedDbStorageContext,
  exportUserData,
  importUserData,
} from "../src/infrastructure/storage/indexeddb";
import { WeeklySessionService } from "../src/application/weekly-session-service";
import { ItemActivityCommand } from "../src/domain/item-activity-types";
import { createActiveWeekFixture } from "./fixtures/active-week";

const command: ItemActivityCommand = {
  type: "complete",
  itemId: "a",
  actionId: "complete-a",
  expectedVersion: 1,
  decidedAt: "2026-12-08T10:00:00Z",
};
const undo: ItemActivityCommand = {
  type: "undo",
  itemId: "a",
  actionId: "undo-a",
  reversesActionId: "complete-a",
  expectedVersion: 2,
  decidedAt: "2026-12-08T11:00:00Z",
};

describe("Atomic daily activity storage", () => {
  let factory: IDBFactory;
  let storage: IndexedDbStorageContext;
  let service: WeeklySessionService;
  const { plan, schedule } = createActiveWeekFixture();
  beforeEach(async () => {
    globalThis.IDBKeyRange = IDBKeyRange;
    factory = new IDBFactory();
    storage = await createIndexedDbStorage({ dbName: "activity-test", customFactory: factory });
    await storage.plans.save(plan);
    await storage.schedules.save(schedule);
    service = new WeeklySessionService({ ...storage, getDb: () => storage.db });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    storage.close();
  });

  it("survives a new connection and restores the exact previous result on undo", async () => {
    expect((await service.recordItemActivity(schedule.scheduleId, command)).status).toBe("success");
    const reloaded = await createIndexedDbStorage({
      dbName: "activity-test",
      customFactory: factory,
    });
    try {
      const other = new WeeklySessionService({ ...reloaded, getDb: () => reloaded.db });
      expect(
        (await reloaded.schedules.getById(schedule.scheduleId))?.itemActivity?.outcomes
      ).toEqual([{ itemId: "a", status: "completed" }]);
      expect((await other.recordItemActivity(schedule.scheduleId, undo)).status).toBe("success");
      const stored = await storage.schedules.getById(schedule.scheduleId);
      expect(stored?.version).toBe(3);
      expect(stored?.itemActivity?.outcomes).toEqual([]);
      expect(stored?.itemActivity?.history).toHaveLength(2);
    } finally {
      reloaded.close();
    }
  });
  it("serializes competing writes across two connections", async () => {
    const second = await createIndexedDbStorage({
      dbName: "activity-test",
      customFactory: factory,
    });
    try {
      const other = new WeeklySessionService({ ...second, getDb: () => second.db });
      const results = await Promise.all([
        service.recordItemActivity(schedule.scheduleId, command),
        other.recordItemActivity(schedule.scheduleId, {
          ...command,
          actionId: "complete-b",
          itemId: "b",
        }),
      ]);
      expect(results.filter((result) => result.status === "success")).toHaveLength(1);
      expect(results).toContainEqual({ status: "rejected", reason: "stale_version" });
      expect(
        (await storage.schedules.getById(schedule.scheduleId))?.itemActivity?.history
      ).toHaveLength(1);
    } finally {
      second.close();
    }
  });
  it("deduplicates concurrent retries without incrementing the version twice", async () => {
    const results = await Promise.all([
      service.recordItemActivity(schedule.scheduleId, command),
      service.recordItemActivity(schedule.scheduleId, command),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual(["already_applied", "success"]);
    expect((await storage.schedules.getById(schedule.scheduleId))?.version).toBe(2);
  });
  it("checks a concurrent plan closure inside the transaction", async () => {
    const tx = storage.db.transaction("plans", "readwrite");
    tx.objectStore("plans").put({ ...plan, status: "closed" });
    expect(await service.recordItemActivity(schedule.scheduleId, command)).toEqual({
      status: "rejected",
      reason: "week_not_active",
    });
    expect(await storage.schedules.getById(schedule.scheduleId)).toEqual(schedule);
  });
  it("rolls back a failed write, including history and version", async () => {
    const put = FakeObjectStore.prototype.put;
    vi.spyOn(FakeObjectStore.prototype, "put").mockImplementation(function (
      this: IDBObjectStore,
      ...args: Parameters<IDBObjectStore["put"]>
    ) {
      const request = put.apply(this, args);
      this.transaction.abort();
      return request;
    });
    expect(await service.recordItemActivity(schedule.scheduleId, command)).toEqual({
      status: "failed",
      reason: "activity_storage_failed",
    });
    expect(await storage.schedules.getById(schedule.scheduleId)).toEqual(schedule);
  });
  it("rejects missing, mismatched and inactive records without writes", async () => {
    expect(await service.recordItemActivity("missing", command)).toEqual({
      status: "rejected",
      reason: "schedule_not_found",
    });
    await storage.plans.delete(plan.planId);
    expect(await service.recordItemActivity(schedule.scheduleId, command)).toEqual({
      status: "rejected",
      reason: "plan_not_found",
    });
    expect(await storage.schedules.getById(schedule.scheduleId)).toEqual(schedule);
  });
  it("refuses unsafe repository-only persistence", async () => {
    const withoutTransaction = new WeeklySessionService(storage);
    expect(await withoutTransaction.recordItemActivity(schedule.scheduleId, command)).toEqual({
      status: "failed",
      reason: "atomic_storage_required",
    });
    expect(await storage.schedules.getById(schedule.scheduleId)).toEqual(schedule);
  });
  it("preserves activity through legacy agenda writers and blocks stale undo", async () => {
    await service.recordItemActivity(schedule.scheduleId, command);
    await storage.schedules.save({ ...schedule, version: 3 }, 2);
    const saved = await storage.schedules.getById(schedule.scheduleId);
    expect(saved?.itemActivity?.outcomes).toEqual([{ itemId: "a", status: "completed" }]);
    expect(
      await service.recordItemActivity(schedule.scheduleId, { ...undo, expectedVersion: 3 })
    ).toEqual({ status: "rejected", reason: "undo_not_available" });
  });
  it("preserves activity through existing deterministic adjustments", async () => {
    await service.recordItemActivity(schedule.scheduleId, command);
    const before = await storage.schedules.getById(schedule.scheduleId);
    const result = await service.applyAdjustment({
      scheduleId: schedule.scheduleId,
      proposalId: "manual",
      adjustmentId: "move-g",
      action: {
        type: "reallocate_day_work",
        itemId: "g",
        sourceDay: "2026-12-09",
        targetDay: "2026-12-10",
        hoursToMove: 0.5,
        rationale: "Otro día",
      },
      expectedScheduleVersion: 2,
      humanDecision: "accepted",
      decidedAt: undo.decidedAt,
    });
    expect(result.status).toBe("success");
    expect((await storage.schedules.getById(schedule.scheduleId))?.itemActivity).toEqual(
      before?.itemActivity
    );
  });
  it("round-trips new backups and restores old backups with no invented activity", async () => {
    const oldBackup = await exportUserData(storage);
    await service.recordItemActivity(schedule.scheduleId, command);
    const newBackup = await exportUserData(storage);
    await storage.clearAll();
    storage = await createIndexedDbStorage({ dbName: "activity-test", customFactory: factory });
    await importUserData(JSON.stringify(newBackup), storage);
    expect((await storage.schedules.getById(schedule.scheduleId))?.itemActivity).toEqual(
      newBackup.data.schedules[0]!.itemActivity
    );
    await storage.clearAll();
    storage = await createIndexedDbStorage({ dbName: "activity-test", customFactory: factory });
    await importUserData(JSON.stringify(oldBackup), storage);
    expect((await storage.schedules.getById(schedule.scheduleId))?.itemActivity).toBeUndefined();
  });
  it("rejects malformed backup activity before writing any data", async () => {
    await service.recordItemActivity(schedule.scheduleId, command);
    const backup = await exportUserData(storage);
    backup.data.schedules[0]!.itemActivity!.outcomes = [];
    const before = await storage.schedules.getById(schedule.scheduleId);
    await expect(importUserData(JSON.stringify(backup), storage)).rejects.toThrow();
    expect(await storage.schedules.getById(schedule.scheduleId)).toEqual(before);
  });
});
