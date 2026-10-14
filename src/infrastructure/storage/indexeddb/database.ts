import { StorageConnectionError } from "../../../domain/repositories/types";

export const DEFAULT_DB_NAME = "conscious_tech_db";
export const DB_VERSION = 1;

export const STORES = {
  PLANS: "plans",
  SCHEDULES: "schedules",
  CLOSE_REPORTS: "close_reports",
  MEMORIES: "memories",
} as const;

export type StoreName = (typeof STORES)[keyof typeof STORES];

/**
 * Resolves the active IDBFactory.
 * Defaults to window.indexedDB in browsers, or global indexedDB if available,
 * or allows injecting a custom IDBFactory (e.g. fake-indexeddb for test isolation).
 */
export function getIDBFactory(customFactory?: IDBFactory): IDBFactory {
  if (customFactory) return customFactory;
  if (typeof window !== "undefined" && window.indexedDB) {
    return window.indexedDB;
  }
  if (typeof globalThis !== "undefined" && (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB) {
    return (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB;
  }
  throw new StorageConnectionError("IndexedDB environment not found. IDBFactory is unavailable.");
}

/**
 * Opens conscious_tech_db and initializes schema stores and indexes.
 * Handles onupgradeneeded, onblocked, onversionchange, error, and abort.
 */
export function openDatabase(
  dbName = DEFAULT_DB_NAME,
  version = DB_VERSION,
  customFactory?: IDBFactory
): Promise<IDBDatabase> {
  const factory = getIDBFactory(customFactory);

  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      request = factory.open(dbName, version);
    } catch (err) {
      return reject(new StorageConnectionError(`Failed to initiate opening of database "${dbName}"`, err));
    }

    request.onblocked = (event) => {
      // Emitted when an upgrade is blocked because an older version is still open in another tab/connection
      console.warn(`[IndexedDB] Database "${dbName}" upgrade is blocked by another open connection.`, event);
    };

    request.onupgradeneeded = (event) => {
      const db = request.result;
      const oldVersion = event.oldVersion;

      // Version 1: Initial schema creation
      if (oldVersion < 1) {
        // 1. Store: plans (StoredWeeklyPlan)
        if (!db.objectStoreNames.contains(STORES.PLANS)) {
          const plansStore = db.createObjectStore(STORES.PLANS, { keyPath: "planId" });
          plansStore.createIndex("by_target_week_start", "targetWeek.startDate", { unique: false });
          plansStore.createIndex("by_status", "status", { unique: false });
        }

        // 2. Store: schedules (WeeklySchedule)
        if (!db.objectStoreNames.contains(STORES.SCHEDULES)) {
          const schedulesStore = db.createObjectStore(STORES.SCHEDULES, { keyPath: "scheduleId" });
          schedulesStore.createIndex("by_plan_id", "planId", { unique: true });
          schedulesStore.createIndex("by_week_range_start", "weekRange.startDate", { unique: false });
        }

        // 3. Store: close_reports (StoredCloseWeekReport)
        if (!db.objectStoreNames.contains(STORES.CLOSE_REPORTS)) {
          const closeStore = db.createObjectStore(STORES.CLOSE_REPORTS, { keyPath: "reportId" });
          closeStore.createIndex("by_plan_id", "planId", { unique: true });
          closeStore.createIndex("by_closed_at", "closedAt", { unique: false });
        }

        // 4. Store: memories (MemoryItem)
        if (!db.objectStoreNames.contains(STORES.MEMORIES)) {
          const memoriesStore = db.createObjectStore(STORES.MEMORIES, { keyPath: "id" });
          memoriesStore.createIndex("by_category", "category", { unique: false });
          memoriesStore.createIndex("by_confirmation_status", "confirmationStatus", { unique: false });
          memoriesStore.createIndex("by_temporal_status", "temporalStatus", { unique: false });
          memoriesStore.createIndex("by_created_at", "createdAt", { unique: false });
        }
      }
    };

    request.onsuccess = () => {
      const db = request.result;

      // Handle version change requested by another tab/connection
      db.onversionchange = () => {
        console.warn(`[IndexedDB] Database "${dbName}" received a versionchange request. Closing connection.`);
        db.close();
      };

      db.onerror = (event) => {
        console.error(`[IndexedDB] Database "${dbName}" encountered an unhandled error:`, event);
      };

      resolve(db);
    };

    request.onerror = () => {
      const error = request.error;
      reject(new StorageConnectionError(`Failed to open database "${dbName}": ${error?.message || "Unknown error"}`, error));
    };
  });
}

/**
 * Closes an open database connection safely.
 */
export function closeDatabase(db: IDBDatabase | null | undefined): void {
  if (db) {
    try {
      db.close();
    } catch (err) {
      console.warn("[IndexedDB] Error closing database:", err);
    }
  }
}

/**
 * Deletes an entire database (for sovereign data reset / tests).
 */
export function deleteDatabase(dbName = DEFAULT_DB_NAME, customFactory?: IDBFactory): Promise<void> {
  const factory = getIDBFactory(customFactory);

  return new Promise((resolve, reject) => {
    let req: IDBOpenDBRequest;
    try {
      req = factory.deleteDatabase(dbName);
    } catch (err) {
      return reject(new StorageConnectionError(`Failed to request deletion of database "${dbName}"`, err));
    }

    req.onsuccess = () => resolve();
    req.onerror = () => {
      reject(new StorageConnectionError(`Failed to delete database "${dbName}": ${req.error?.message || "Unknown error"}`));
    };
    req.onblocked = () => {
      console.warn(`[IndexedDB] Deletion of "${dbName}" is blocked by an active open connection.`);
    };
  });
}

/**
 * Utility to execute a single-request Promise safely on IDBRequest.
 */
export function wrapRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("IDBRequest failed"));
  });
}

/**
 * Waits for a transaction to complete or abort, rejecting if an error occurred.
 */
export function waitForTransaction(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => {
      const err = tx.error || new Error("IndexedDB transaction was aborted");
      reject(err);
    };
    tx.onerror = () => {
      const err = tx.error || new Error("IndexedDB transaction failed");
      reject(err);
    };
  });
}
