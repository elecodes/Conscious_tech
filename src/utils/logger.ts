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
  "received",
  "input",
]);

const MAX_LOG_STRING_LENGTH = 200;

function isZodIssue(data: Record<string, unknown>): boolean {
  return typeof data.code === "string" && Array.isArray(data.path);
}

export function sanitizeForLogging(data: unknown): unknown {
  if (data === null || data === undefined) return data;
  if (typeof data === "string") {
    return data.length > MAX_LOG_STRING_LENGTH ? "[REDACTED_LONG_STRING]" : data;
  }
  if (typeof data !== "object") return data;

  if (data instanceof Error) {
    if (
      data.name === "ZodError" ||
      ("issues" in data && Array.isArray((data as unknown as { issues: unknown }).issues))
    ) {
      return {
        name: data.name,
        message: "Validation failed",
        issues: (data as unknown as { issues: unknown[] }).issues.map(sanitizeForLogging),
      };
    }
    return {
      name: data.name,
      message:
        data.message.length > MAX_LOG_STRING_LENGTH ? "[REDACTED_LONG_STRING]" : data.message,
    };
  }

  if (Array.isArray(data)) {
    return data.map(sanitizeForLogging);
  }

  const record = data as Record<string, unknown>;

  if (isZodIssue(record)) {
    return {
      code: record.code,
      path: record.path,
    };
  }

  const sanitized: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(record)) {
    if (USER_TEXT_KEYS.has(k)) {
      sanitized[k] = "[REDACTED_USER_TEXT]";
    } else if (typeof v === "string" && v.length > MAX_LOG_STRING_LENGTH) {
      sanitized[k] = "[REDACTED_LONG_STRING]";
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
