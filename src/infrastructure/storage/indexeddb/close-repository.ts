import {
  WeeklyCloseRepository,
  StoredCloseWeekReport,
  StoredCloseWeekReportSchema,
  InvalidRecordDataError,
} from "../../../domain/repositories/types";
import { STORES, wrapRequest, waitForTransaction } from "./database";

export class IndexedDbWeeklyCloseRepository implements WeeklyCloseRepository {
  constructor(private readonly getDb: () => IDBDatabase) {}

  async save(report: StoredCloseWeekReport): Promise<void> {
    const parsed = StoredCloseWeekReportSchema.parse(report);
    const db = this.getDb();
    const tx = db.transaction(STORES.CLOSE_REPORTS, "readwrite");
    const store = tx.objectStore(STORES.CLOSE_REPORTS);
    store.put(parsed);
    await waitForTransaction(tx);
  }

  async getById(reportId: string): Promise<StoredCloseWeekReport | null> {
    const db = this.getDb();
    const tx = db.transaction(STORES.CLOSE_REPORTS, "readonly");
    const store = tx.objectStore(STORES.CLOSE_REPORTS);
    const raw = await wrapRequest(store.get(reportId));
    if (!raw) return null;

    const parseResult = StoredCloseWeekReportSchema.safeParse(raw);
    if (!parseResult.success) {
      throw new InvalidRecordDataError(STORES.CLOSE_REPORTS, reportId, parseResult.error.issues);
    }
    return parseResult.data;
  }

  async getByPlanId(planId: string): Promise<StoredCloseWeekReport | null> {
    const db = this.getDb();
    const tx = db.transaction(STORES.CLOSE_REPORTS, "readonly");
    const store = tx.objectStore(STORES.CLOSE_REPORTS);
    const index = store.index("by_plan_id");
    const raw = await wrapRequest(index.get(planId));
    if (!raw) return null;

    const parseResult = StoredCloseWeekReportSchema.safeParse(raw);
    if (!parseResult.success) {
      const id = (raw as Record<string, unknown>)?.reportId;
      throw new InvalidRecordDataError(STORES.CLOSE_REPORTS, typeof id === "string" ? id : "unknown", parseResult.error.issues);
    }
    return parseResult.data;
  }

  async getAll(): Promise<StoredCloseWeekReport[]> {
    const db = this.getDb();
    const tx = db.transaction(STORES.CLOSE_REPORTS, "readonly");
    const store = tx.objectStore(STORES.CLOSE_REPORTS);
    const rawList = await wrapRequest(store.getAll());
    const reports: StoredCloseWeekReport[] = [];
    for (const raw of rawList ?? []) {
      const parseResult = StoredCloseWeekReportSchema.safeParse(raw);
      if (!parseResult.success) {
        const id = (raw as Record<string, unknown>)?.reportId;
        throw new InvalidRecordDataError(
          STORES.CLOSE_REPORTS,
          typeof id === "string" ? id : "unknown",
          parseResult.error.issues
        );
      }
      reports.push(parseResult.data);
    }
    return reports;
  }

  async delete(reportId: string): Promise<void> {
    const db = this.getDb();
    const tx = db.transaction(STORES.CLOSE_REPORTS, "readwrite");
    const store = tx.objectStore(STORES.CLOSE_REPORTS);
    store.delete(reportId);
    await waitForTransaction(tx);
  }
}
