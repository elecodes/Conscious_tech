import { applyItemActivity, ItemActivityResult } from "../../../domain/item-activity";
import { ItemActivityCommand } from "../../../domain/item-activity-types";
import { StoredWeeklyPlanSchema } from "../../../domain/repositories/types";
import { WeeklyScheduleSchema } from "../../../domain/schedule";
import { STORES, waitForTransaction, wrapRequest } from "./database";

export type PersistItemActivityResult = ItemActivityResult | { status: "failed"; reason: string };

/** Plan status, version, history and outcome share the same serialization boundary. */
export async function persistItemActivity(
  db: IDBDatabase,
  scheduleId: string,
  command: ItemActivityCommand
): Promise<PersistItemActivityResult> {
  let tx: IDBTransaction | undefined;
  let completion: Promise<void> | undefined;
  try {
    tx = db.transaction([STORES.PLANS, STORES.SCHEDULES], "readwrite");
    completion = waitForTransaction(tx);
    // Attach immediately so an abort during a request cannot cause an unhandled rejection.
    void completion.catch(() => {});
    const schedules = tx.objectStore(STORES.SCHEDULES);
    const raw = await wrapRequest(schedules.get(scheduleId));
    if (!raw) {
      await completion;
      return { status: "rejected", reason: "schedule_not_found" };
    }
    const schedule = WeeklyScheduleSchema.parse(raw);
    const rawPlan = await wrapRequest(tx.objectStore(STORES.PLANS).get(schedule.planId));
    if (!rawPlan) {
      await completion;
      return { status: "rejected", reason: "plan_not_found" };
    }
    const result = applyItemActivity(StoredWeeklyPlanSchema.parse(rawPlan), schedule, command);
    if (result.status === "success") schedules.put(result.schedule);
    await completion;
    return result;
  } catch {
    try {
      tx?.abort();
    } catch {
      /* A completed transaction cannot be aborted. */
    }
    if (completion) await completion.catch(() => {});
    return { status: "failed", reason: "activity_storage_failed" };
  }
}
