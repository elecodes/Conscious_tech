export interface RateLimiterOptions {
  windowMs: number;
  maxRequests: number;
}

interface ClientRecord {
  timestamps: number[];
}

export class SimpleRateLimiter {
  private records = new Map<string, ClientRecord>();
  private windowMs: number;
  private maxRequests: number;

  constructor(options: RateLimiterOptions) {
    this.windowMs = options.windowMs;
    this.maxRequests = options.maxRequests;
  }

  public size(): number {
    return this.records.size;
  }

  public prune(now: number = Date.now()): number {
    const windowStart = now - this.windowMs;
    let pruned = 0;
    for (const [key, record] of this.records.entries()) {
      record.timestamps = record.timestamps.filter((ts) => ts > windowStart);
      if (record.timestamps.length === 0) {
        this.records.delete(key);
        pruned++;
      }
    }
    return pruned;
  }

  public check(key: string, currentTime?: number): { allowed: boolean; remaining: number; resetMs: number } {
    const now = currentTime ?? Date.now();
    const windowStart = now - this.windowMs;

    // Prune stale records so the map does not grow without bound
    this.prune(now);

    let record = this.records.get(key);
    if (!record) {
      record = { timestamps: [] };
      this.records.set(key, record);
    }

    record.timestamps = record.timestamps.filter((ts) => ts > windowStart);

    if (record.timestamps.length >= this.maxRequests) {
      const oldest = record.timestamps[0] ?? now;
      const resetMs = Math.max(0, oldest + this.windowMs - now);
      return { allowed: false, remaining: 0, resetMs };
    }

    record.timestamps.push(now);
    return {
      allowed: true,
      remaining: this.maxRequests - record.timestamps.length,
      resetMs: this.windowMs,
    };
  }

  public reset(): void {
    this.records.clear();
  }
}
