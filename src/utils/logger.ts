/**
 * Privacy-preserving application logger.
 * Never logs user-provided text, brain dump notes, or personal task descriptions.
 */

const USER_TEXT_KEYS = new Set([
  "rawText",
  "text",
  "note",
  "notes",
  "brainDump",
  "dump",
  "content",
  "userText",
  "title",
  "description",
  "query",
  "prompt",
]);

export function sanitizeForLogging(data: unknown): unknown {
  if (data === null || data === undefined) return data;
  if (typeof data !== "object") return data;

  if (data instanceof Error) {
    return {
      name: data.name,
      message: data.message,
    };
  }

  if (Array.isArray(data)) {
    return data.map(sanitizeForLogging);
  }

  const sanitized: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
    if (USER_TEXT_KEYS.has(k)) {
      sanitized[k] = "[REDACTED_USER_TEXT]";
    } else if (typeof v === "object" && v !== null) {
      sanitized[k] = sanitizeForLogging(v);
    } else {
      sanitized[k] = v;
    }
  }
  return sanitized;
}

export function isTestEnv(): boolean {
  if (typeof process !== "undefined") {
    if (process.env?.NODE_ENV === "test" || process.env?.VITEST) {
      return true;
    }
  }
  if (typeof import.meta !== "undefined") {
    const metaEnv = (import.meta as { env?: Record<string, string> }).env;
    if (metaEnv?.MODE === "test") {
      return true;
    }
  }
  return false;
}

export interface LoggerOptions {
  forceLog?: boolean;
}

export const logger = {
  warn(message: string, meta?: unknown, options: LoggerOptions = {}): void {
    if (isTestEnv() && !options.forceLog) return;
    if (meta !== undefined) {
      console.warn(message, sanitizeForLogging(meta));
    } else {
      console.warn(message);
    }
  },

  error(message: string, meta?: unknown, options: LoggerOptions = {}): void {
    if (isTestEnv() && !options.forceLog) return;
    if (meta !== undefined) {
      console.error(message, sanitizeForLogging(meta));
    } else {
      console.error(message);
    }
  },

  info(message: string, meta?: unknown, options: LoggerOptions = {}): void {
    if (isTestEnv() && !options.forceLog) return;
    if (meta !== undefined) {
      console.info(message, sanitizeForLogging(meta));
    } else {
      console.info(message);
    }
  },

  debug(message: string, meta?: unknown, options: LoggerOptions = {}): void {
    if (isTestEnv() && !options.forceLog) return;
    if (meta !== undefined) {
      console.debug(message, sanitizeForLogging(meta));
    } else {
      console.debug(message);
    }
  },
};
