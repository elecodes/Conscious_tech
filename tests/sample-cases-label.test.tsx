import { describe, it, expect, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { indexedDB as fakeIDB, IDBKeyRange as fakeKeyRange } from "fake-indexeddb";
import {
  createIndexedDbStorage,
  deleteDatabase,
  IndexedDbStorageContext,
} from "../src/infrastructure/storage/indexeddb";
import { WeeklySessionService } from "../src/application/weekly-session-service";
import { App } from "../src/web/App";

describe("FIX 1: 'Caso de ejemplo' label", () => {
  const TEST_DB = "conscious_tech_sample_case_label_test_db";

  if (typeof globalThis.IDBKeyRange === "undefined") {
    (globalThis as unknown as { IDBKeyRange: typeof fakeKeyRange }).IDBKeyRange = fakeKeyRange;
  }

  let storage: IndexedDbStorageContext;
  let service: WeeklySessionService;

  beforeEach(async () => {
    await deleteDatabase(TEST_DB, fakeIDB);
    storage = await createIndexedDbStorage({
      dbName: TEST_DB,
      customFactory: fakeIDB,
    });
    service = new WeeklySessionService({
      plans: storage.plans,
      schedules: storage.schedules,
      closeReports: storage.closeReports,
      memories: storage.memories,
      getDb: () => storage.db,
    });
  });

  it("renders 'Caso de ejemplo:' dropdown label instead of 'Caso real:' in capture space", () => {
    const html = renderToStaticMarkup(<App service={service} initialTab="capture" />);
    expect(html).toContain("Caso de ejemplo:");
    expect(html).not.toContain("Caso real:");
  });
});
