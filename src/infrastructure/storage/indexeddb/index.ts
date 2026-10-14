import {
  WeeklyPlanRepository,
  WeeklyScheduleRepository,
  WeeklyCloseRepository,
  MemoryRepository,
  WeeklySessionState,
} from "../../../domain/repositories/types";
import {
  openDatabase,
  closeDatabase,
  deleteDatabase,
  DEFAULT_DB_NAME,
  DB_VERSION,
} from "./database";
import { IndexedDbWeeklyPlanRepository } from "./plan-repository";
import { IndexedDbWeeklyScheduleRepository } from "./schedule-repository";
import { IndexedDbWeeklyCloseRepository } from "./close-repository";
import { IndexedDbMemoryRepository } from "./memory-repository";

export * from "./database";
export * from "./plan-repository";
export * from "./schedule-repository";
export * from "./close-repository";
export * from "./memory-repository";

export interface IndexedDbStorageContext {
  db: IDBDatabase;
  plans: WeeklyPlanRepository;
  schedules: WeeklyScheduleRepository;
  closeReports: WeeklyCloseRepository;
  memories: MemoryRepository;
  resumeSession(): Promise<WeeklySessionState>;
  close(): void;
  clearAll(): Promise<void>;
}

export interface StorageOptions {
  dbName?: string;
  version?: number;
  customFactory?: IDBFactory;
}

/**
 * Initializes and connects to the IndexedDB storage engine.
 */
export async function createIndexedDbStorage(
  options: StorageOptions = {}
): Promise<IndexedDbStorageContext> {
  const dbName = options.dbName ?? DEFAULT_DB_NAME;
  const version = options.version ?? DB_VERSION;
  const customFactory = options.customFactory;

  const db = await openDatabase(dbName, version, customFactory);

  const getDb = () => db;

  const plans = new IndexedDbWeeklyPlanRepository(getDb);
  const schedules = new IndexedDbWeeklyScheduleRepository(getDb);
  const closeReports = new IndexedDbWeeklyCloseRepository(getDb);
  const memories = new IndexedDbMemoryRepository(getDb);

  const resumeSession = async (): Promise<WeeklySessionState> => {
    const activePlan = await plans.getActivePlan();
    let activeSchedule = null;
    let latestCloseReport = null;

    if (activePlan) {
      activeSchedule = await schedules.getByPlanId(activePlan.planId);
      latestCloseReport = await closeReports.getByPlanId(activePlan.planId);
    }

    const allMemories = await memories.getAll({ temporalStatuses: ["active"] });

    return {
      activePlan,
      activeSchedule,
      latestCloseReport,
      memories: allMemories,
    };
  };

  const close = () => {
    closeDatabase(db);
  };

  const clearAll = async () => {
    closeDatabase(db);
    await deleteDatabase(dbName, customFactory);
  };

  return {
    db,
    plans,
    schedules,
    closeReports,
    memories,
    resumeSession,
    close,
    clearAll,
  };
}
