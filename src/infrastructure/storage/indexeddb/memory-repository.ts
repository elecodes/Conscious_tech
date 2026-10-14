import {
  MemoryRepository,
  MemoryFilter,
  InvalidRecordDataError,
} from "../../../domain/repositories/types";
import { MemoryItem, MemoryItemSchema } from "../../../domain/memory";
import { STORES, wrapRequest, waitForTransaction } from "./database";

export class IndexedDbMemoryRepository implements MemoryRepository {
  constructor(private readonly getDb: () => IDBDatabase) {}

  async getById(id: string): Promise<MemoryItem | null> {
    const db = this.getDb();
    const tx = db.transaction(STORES.MEMORIES, "readonly");
    const store = tx.objectStore(STORES.MEMORIES);
    const raw = await wrapRequest(store.get(id));
    if (!raw) return null;

    const parseResult = MemoryItemSchema.safeParse(raw);
    if (!parseResult.success) {
      throw new InvalidRecordDataError(STORES.MEMORIES, id, parseResult.error.issues);
    }
    return parseResult.data;
  }

  async getAll(filter?: MemoryFilter): Promise<MemoryItem[]> {
    const db = this.getDb();
    const tx = db.transaction(STORES.MEMORIES, "readonly");
    const store = tx.objectStore(STORES.MEMORIES);
    const request = store.openCursor();

    const items: MemoryItem[] = [];

    await new Promise<void>((resolve, reject) => {
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return resolve();

        const raw = cursor.value;
        const parseResult = MemoryItemSchema.safeParse(raw);

        // Defensive reading: A corrupted record does NOT block reading other independent records.
        if (!parseResult.success) {
          const rawId = (raw as Record<string, unknown>)?.id;
          console.warn(
            `[IndexedDbMemoryRepository] Skipping corrupted memory record ID "${rawId}":`,
            parseResult.error.issues
          );
          cursor.continue();
          return;
        }

        const item = parseResult.data;

        // Apply filters
        let matches = true;
        if (filter?.categories && filter.categories.length > 0) {
          if (!filter.categories.includes(item.category)) matches = false;
        }
        if (matches && filter?.confirmationStatuses && filter.confirmationStatuses.length > 0) {
          if (!filter.confirmationStatuses.includes(item.confirmationStatus)) matches = false;
        }
        if (matches && filter?.temporalStatuses && filter.temporalStatuses.length > 0) {
          if (!filter.temporalStatuses.includes(item.temporalStatus)) matches = false;
        }
        if (matches && filter?.referenceDate) {
          // If a memory has a validUntil date, check if it has expired relative to referenceDate
          if (item.validUntil && filter.referenceDate > item.validUntil) {
            matches = false;
          }
        }

        if (matches) {
          items.push(item);
        }

        cursor.continue();
      };

      request.onerror = () => reject(request.error || new Error("Failed to scan memories cursor"));
    });

    return items;
  }

  async save(memory: MemoryItem): Promise<void> {
    const parsed = MemoryItemSchema.parse(memory);
    const db = this.getDb();
    const tx = db.transaction(STORES.MEMORIES, "readwrite");
    const store = tx.objectStore(STORES.MEMORIES);
    store.put(parsed);
    await waitForTransaction(tx);
  }

  async saveBatch(memories: MemoryItem[]): Promise<void> {
    const parsedBatch = memories.map((m) => MemoryItemSchema.parse(m));
    const db = this.getDb();
    const tx = db.transaction(STORES.MEMORIES, "readwrite");
    const store = tx.objectStore(STORES.MEMORIES);
    for (const item of parsedBatch) {
      store.put(item);
    }
    await waitForTransaction(tx);
  }

  async archive(id: string): Promise<void> {
    const db = this.getDb();
    const tx = db.transaction(STORES.MEMORIES, "readwrite");
    const store = tx.objectStore(STORES.MEMORIES);
    const raw = await wrapRequest(store.get(id));
    if (!raw) {
      tx.abort();
      return;
    }

    const parseResult = MemoryItemSchema.safeParse(raw);
    if (!parseResult.success) {
      tx.abort();
      throw new InvalidRecordDataError(STORES.MEMORIES, id, parseResult.error.issues);
    }

    const todayDate = new Date().toISOString().split("T")[0]!;
    const archived: MemoryItem = {
      ...parseResult.data,
      temporalStatus: "outdated",
      updatedAt: todayDate,
    };

    store.put(archived);
    await waitForTransaction(tx);
  }

  async delete(id: string): Promise<void> {
    const db = this.getDb();
    const tx = db.transaction(STORES.MEMORIES, "readwrite");
    const store = tx.objectStore(STORES.MEMORIES);
    store.delete(id);
    await waitForTransaction(tx);
  }
}
