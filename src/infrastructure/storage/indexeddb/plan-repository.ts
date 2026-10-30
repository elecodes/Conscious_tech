import {
  WeeklyPlanRepository,
  StoredWeeklyPlan,
  StoredWeeklyPlanSchema,
  WeeklyPlanStatus,
  InvalidRecordDataError,
  AmbiguousActivePlanError,
  AmbiguousDraftPlanError,
} from "../../../domain/repositories/types";
import { TargetWeek } from "../../../domain/week";
import { STORES, wrapRequest, waitForTransaction } from "./database";
import { logger } from "../../../utils/logger";

export class IndexedDbWeeklyPlanRepository implements WeeklyPlanRepository {
  constructor(private readonly getDb: () => IDBDatabase) {}

  async save(plan: StoredWeeklyPlan): Promise<void> {
    const parsed = StoredWeeklyPlanSchema.parse(plan);
    const db = this.getDb();
    const tx = db.transaction(STORES.PLANS, "readwrite");
    const store = tx.objectStore(STORES.PLANS);
    store.put(parsed);
    await waitForTransaction(tx);
  }

  async getById(planId: string): Promise<StoredWeeklyPlan | null> {
    const db = this.getDb();
    const tx = db.transaction(STORES.PLANS, "readonly");
    const store = tx.objectStore(STORES.PLANS);
    const raw = await wrapRequest(store.get(planId));
    if (!raw) return null;

    const parseResult = StoredWeeklyPlanSchema.safeParse(raw);
    if (!parseResult.success) {
      throw new InvalidRecordDataError(STORES.PLANS, planId, parseResult.error.issues);
    }
    return parseResult.data;
  }

  async getActivePlans(): Promise<StoredWeeklyPlan[]> {
    const db = this.getDb();
    const tx = db.transaction(STORES.PLANS, "readonly");
    const store = tx.objectStore(STORES.PLANS);
    const index = store.index("by_status");
    const request = index.openCursor(IDBKeyRange.only("active"));

    const plans: StoredWeeklyPlan[] = [];

    await new Promise<void>((resolve, reject) => {
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return resolve();

        const raw = cursor.value;
        const parseResult = StoredWeeklyPlanSchema.safeParse(raw);
        if (!parseResult.success) {
          const id = (raw as Record<string, unknown>)?.planId;
          return reject(
            new InvalidRecordDataError(
              STORES.PLANS,
              typeof id === "string" ? id : "unknown",
              parseResult.error.issues
            )
          );
        }

        plans.push(parseResult.data);
        cursor.continue();
      };
      request.onerror = () =>
        reject(request.error || new Error("Failed to query active plans cursor"));
    });

    return plans;
  }

  async getActivePlan(): Promise<StoredWeeklyPlan | null> {
    const activePlans = await this.getActivePlans();
    if (activePlans.length === 0) return null;
    if (activePlans.length > 1) {
      throw new AmbiguousActivePlanError(activePlans.map((p) => p.planId));
    }
    return activePlans[0]!;
  }

  async getDraftPlans(): Promise<StoredWeeklyPlan[]> {
    const db = this.getDb();
    const tx = db.transaction(STORES.PLANS, "readonly");
    const store = tx.objectStore(STORES.PLANS);
    const index = store.index("by_status");
    const request = index.openCursor(IDBKeyRange.only("draft"));

    const plans: StoredWeeklyPlan[] = [];

    await new Promise<void>((resolve, reject) => {
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return resolve();

        const raw = cursor.value;
        const parseResult = StoredWeeklyPlanSchema.safeParse(raw);
        if (!parseResult.success) {
          const id = (raw as Record<string, unknown>)?.planId;
          return reject(
            new InvalidRecordDataError(
              STORES.PLANS,
              typeof id === "string" ? id : "unknown",
              parseResult.error.issues
            )
          );
        }

        plans.push(parseResult.data);
        cursor.continue();
      };
      request.onerror = () =>
        reject(request.error || new Error("Failed to query draft plans cursor"));
    });

    return plans;
  }

  async getDraftPlan(targetWeek?: TargetWeek): Promise<StoredWeeklyPlan | null> {
    const drafts = await this.getDraftPlans();
    if (drafts.length === 0) return null;

    if (targetWeek) {
      const matching = drafts.filter(
        (d) =>
          d.targetWeek.startDate === targetWeek.startDate &&
          d.targetWeek.endDate === targetWeek.endDate
      );
      if (matching.length === 0) return null;
      if (matching.length > 1) {
        throw new AmbiguousDraftPlanError(
          matching.map((p) => p.planId),
          targetWeek
        );
      }
      return matching[0]!;
    }

    if (drafts.length === 1) {
      return drafts[0]!;
    }

    throw new AmbiguousDraftPlanError(drafts.map((p) => p.planId));
  }

  async getByWeekRange(week: TargetWeek): Promise<StoredWeeklyPlan | null> {
    const db = this.getDb();
    const tx = db.transaction(STORES.PLANS, "readonly");
    const store = tx.objectStore(STORES.PLANS);
    const index = store.index("by_target_week_start");
    const request = index.openCursor(IDBKeyRange.only(week.startDate));

    return new Promise((resolve, reject) => {
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return resolve(null);

        const raw = cursor.value;
        const parseResult = StoredWeeklyPlanSchema.safeParse(raw);
        if (!parseResult.success) {
          const id = (raw as Record<string, unknown>)?.planId;
          return reject(
            new InvalidRecordDataError(
              STORES.PLANS,
              typeof id === "string" ? id : "unknown",
              parseResult.error.issues
            )
          );
        }

        if (parseResult.data.targetWeek.endDate === week.endDate) {
          return resolve(parseResult.data);
        }
        cursor.continue();
      };
      request.onerror = () => reject(request.error || new Error("Failed to query plan cursor"));
    });
  }

  async updateStatus(planId: string, status: WeeklyPlanStatus): Promise<boolean> {
    const db = this.getDb();
    const tx = db.transaction(STORES.PLANS, "readwrite");
    const store = tx.objectStore(STORES.PLANS);
    const raw = await wrapRequest(store.get(planId));
    if (!raw) {
      tx.abort();
      return false;
    }

    const parseResult = StoredWeeklyPlanSchema.safeParse(raw);
    if (!parseResult.success) {
      tx.abort();
      throw new InvalidRecordDataError(STORES.PLANS, planId, parseResult.error.issues);
    }

    const updated: StoredWeeklyPlan = {
      ...parseResult.data,
      status,
      updatedAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    };

    store.put(updated);
    await waitForTransaction(tx);
    return true;
  }

  async getAll(): Promise<StoredWeeklyPlan[]> {
    const db = this.getDb();
    const tx = db.transaction(STORES.PLANS, "readonly");
    const store = tx.objectStore(STORES.PLANS);
    const rawList = await wrapRequest(store.getAll());
    const plans: StoredWeeklyPlan[] = [];
    for (const raw of rawList ?? []) {
      const parseResult = StoredWeeklyPlanSchema.safeParse(raw);
      if (parseResult.success) {
        plans.push(parseResult.data);
      } else {
        const id = (raw as Record<string, unknown>)?.planId;
        logger.warn(
          `[IndexedDbWeeklyPlanRepository] Skipping corrupted plan record ID "${id}":`,
          parseResult.error.issues
        );
      }
    }
    return plans;
  }

  async delete(planId: string): Promise<void> {
    const db = this.getDb();
    const tx = db.transaction(STORES.PLANS, "readwrite");
    const store = tx.objectStore(STORES.PLANS);
    store.delete(planId);
    await waitForTransaction(tx);
  }
}
