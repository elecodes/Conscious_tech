import {
  WeeklyScheduleRepository,
  StaleVersionConflictError,
  InvalidRecordDataError,
} from "../../../domain/repositories/types";
import {
  WeeklySchedule,
  WeeklyScheduleSchema,
  validateWeeklyScheduleInvariants,
} from "../../../domain/schedule";
import { STORES, wrapRequest, waitForTransaction } from "./database";

export class IndexedDbWeeklyScheduleRepository implements WeeklyScheduleRepository {
  constructor(private readonly getDb: () => IDBDatabase) {}

  /**
   * Saves a weekly schedule with optimistic concurrency control.
   *
   * TRANSACTION SAFETY INVARIANT (ADR 0013 / P3):
   * Do NOT introduce any asynchronous operations (such as fetch, setTimeout, or foreign promises)
   * between reading the existing version and writing the updated schedule.
   * IndexedDB transactions automatically commit when the event loop microtask queue clears without
   * pending IDBRequests. Only purely synchronous domain validation (Zod) is permitted between IDB requests.
   */
  async save(schedule: WeeklySchedule, expectedScheduleVersion?: number): Promise<void> {
    const db = this.getDb();
    const tx = db.transaction(STORES.SCHEDULES, "readwrite");
    const store = tx.objectStore(STORES.SCHEDULES);

    // 1. Read the current version WITHIN this transaction
    const existingRaw = await wrapRequest(store.get(schedule.scheduleId));
    let existingVersion = 0;

    if (existingRaw) {
      const existingParsed = WeeklyScheduleSchema.safeParse(existingRaw);
      if (!existingParsed.success) {
        tx.abort();
        throw new InvalidRecordDataError(STORES.SCHEDULES, schedule.scheduleId, existingParsed.error.issues);
      }
      existingVersion = existingParsed.data.version;
    }

    // 2. Concurrency check if expectedScheduleVersion is provided
    if (expectedScheduleVersion !== undefined) {
      if (existingVersion !== expectedScheduleVersion) {
        tx.abort();
        throw new StaleVersionConflictError(existingVersion, expectedScheduleVersion);
      }
    } else if (existingRaw && schedule.version <= existingVersion) {
      // Guard against accidental blind overwriting without version check
      tx.abort();
      throw new StaleVersionConflictError(existingVersion, schedule.version);
    }

    // 3. Prepare updated schedule with version incremented exactly by one if updating
    const nextVersion = expectedScheduleVersion !== undefined
      ? expectedScheduleVersion + 1
      : schedule.version;

    const toWrite: WeeklySchedule = {
      ...schedule,
      version: nextVersion,
    };

    // 4. Validate schema and domain invariants
    const schemaValidation = WeeklyScheduleSchema.safeParse(toWrite);
    if (!schemaValidation.success) {
      tx.abort();
      throw new InvalidRecordDataError(STORES.SCHEDULES, schedule.scheduleId, schemaValidation.error.issues);
    }

    const invariantValidation = validateWeeklyScheduleInvariants(schemaValidation.data);
    if (!invariantValidation.valid) {
      tx.abort();
      throw new Error(`Domain invariant violation: ${invariantValidation.errors.join("; ")}`);
    }

    // 5. Write to object store
    store.put(schemaValidation.data);

    // 6. Success is confirmed ONLY when transaction emits 'complete'
    await waitForTransaction(tx);
  }

  async getById(scheduleId: string): Promise<WeeklySchedule | null> {
    const db = this.getDb();
    const tx = db.transaction(STORES.SCHEDULES, "readonly");
    const store = tx.objectStore(STORES.SCHEDULES);
    const raw = await wrapRequest(store.get(scheduleId));
    if (!raw) return null;

    const parseResult = WeeklyScheduleSchema.safeParse(raw);
    if (!parseResult.success) {
      throw new InvalidRecordDataError(STORES.SCHEDULES, scheduleId, parseResult.error.issues);
    }

    const invariantCheck = validateWeeklyScheduleInvariants(parseResult.data);
    if (!invariantCheck.valid) {
      throw new Error(`Corrupted schedule invariants in storage for "${scheduleId}": ${invariantCheck.errors.join("; ")}`);
    }

    return parseResult.data;
  }

  async getByPlanId(planId: string): Promise<WeeklySchedule | null> {
    const db = this.getDb();
    const tx = db.transaction(STORES.SCHEDULES, "readonly");
    const store = tx.objectStore(STORES.SCHEDULES);
    const index = store.index("by_plan_id");
    const raw = await wrapRequest(index.get(planId));
    if (!raw) return null;

    const parseResult = WeeklyScheduleSchema.safeParse(raw);
    if (!parseResult.success) {
      const id = (raw as Record<string, unknown>)?.scheduleId;
      throw new InvalidRecordDataError(STORES.SCHEDULES, typeof id === "string" ? id : "unknown", parseResult.error.issues);
    }

    const invariantCheck = validateWeeklyScheduleInvariants(parseResult.data);
    if (!invariantCheck.valid) {
      throw new Error(`Corrupted schedule invariants in storage for plan "${planId}": ${invariantCheck.errors.join("; ")}`);
    }

    return parseResult.data;
  }

  async delete(scheduleId: string): Promise<void> {
    const db = this.getDb();
    const tx = db.transaction(STORES.SCHEDULES, "readwrite");
    const store = tx.objectStore(STORES.SCHEDULES);
    store.delete(scheduleId);
    await waitForTransaction(tx);
  }
}
