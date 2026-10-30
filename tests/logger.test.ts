import { describe, it, expect, vi } from "vitest";
import { logger, sanitizeForLogging } from "../src/utils/logger";

describe("Privacy-preserving Logger Utility", () => {
  it("redacts sensitive user text properties from logged objects", () => {
    const payload = {
      id: "item-123",
      rawText: "Secret personal brain dump note about meeting with CEO",
      text: "User note details",
      title: "Private task",
      note: "Do not tell anyone",
      status: "pending",
      subObject: {
        description: "Confidential roadmap",
        allowedKey: "safe_metadata",
      },
    };

    const sanitized = sanitizeForLogging(payload) as Record<string, unknown>;
    expect(sanitized.id).toBe("item-123");
    expect(sanitized.status).toBe("pending");
    expect(sanitized.rawText).toBe("[REDACTED_USER_TEXT]");
    expect(sanitized.text).toBe("[REDACTED_USER_TEXT]");
    expect(sanitized.title).toBe("[REDACTED_USER_TEXT]");
    expect(sanitized.note).toBe("[REDACTED_USER_TEXT]");

    const sub = sanitized.subObject as Record<string, unknown>;
    expect(sub.description).toBe("[REDACTED_USER_TEXT]");
    expect(sub.allowedKey).toBe("safe_metadata");
  });

  it("handles primitive values and Error objects cleanly", () => {
    expect(sanitizeForLogging(null)).toBe(null);
    expect(sanitizeForLogging("string_val")).toBe("string_val");
    expect(sanitizeForLogging(123)).toBe(123);

    const err = new Error("Database connection dropped");
    const sanitizedErr = sanitizeForLogging(err) as { name: string; message: string };
    expect(sanitizedErr.name).toBe("Error");
    expect(sanitizedErr.message).toBe("Database connection dropped");
  });

  it("routes through console.warn when forceLog is enabled", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    logger.warn("Test warning", { id: "123", rawText: "private info" }, { forceLog: true });

    expect(warnSpy).toHaveBeenCalledWith("Test warning", {
      id: "123",
      rawText: "[REDACTED_USER_TEXT]",
    });
    warnSpy.mockRestore();
  });

  it("routes through console.error when forceLog is enabled", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    logger.error("Test error", { error: "disk_full" }, { forceLog: true });

    expect(errorSpy).toHaveBeenCalledWith("Test error", { error: "disk_full" });
    errorSpy.mockRestore();
  });

  it("does not output rejected values when logging an object shaped like a zod issue with received: 'my private note'", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const zodIssue = {
      code: "invalid_type",
      expected: "string",
      received: "my private note",
      path: ["tasks", 0, "title"],
      message: "Expected string, received my private note",
    };

    logger.warn("Corrupted record detected", zodIssue, { forceLog: true });

    expect(warnSpy).toHaveBeenCalled();
    const calls = warnSpy.mock.calls;
    const outputString = JSON.stringify(calls);
    expect(outputString).not.toContain("my private note");
    warnSpy.mockRestore();
  });

  it("redacts received, input, strings longer than 200 chars, and logs only code and path for zod issues", () => {
    // 1. Zod issue logs only code and path
    const issue = {
      code: "invalid_type",
      expected: "string",
      received: "my private note",
      path: ["notes", 1],
      message: "Expected string, received my private note",
    };
    const sanitizedIssue = sanitizeForLogging(issue) as Record<string, unknown>;
    expect(sanitizedIssue).toEqual({
      code: "invalid_type",
      path: ["notes", 1],
    });

    // 2. Non-zod object with received or input gets redacted
    const nonZodObj = {
      received: "sensitive unvalidated value",
      input: "secret user input",
      safe: 42,
    };
    const sanitizedNonZod = sanitizeForLogging(nonZodObj) as Record<string, unknown>;
    expect(sanitizedNonZod.received).toBe("[REDACTED_USER_TEXT]");
    expect(sanitizedNonZod.input).toBe("[REDACTED_USER_TEXT]");
    expect(sanitizedNonZod.safe).toBe(42);

    // 3. Strings longer than 200 characters are redacted
    const longString = "x".repeat(201);
    expect(sanitizeForLogging(longString)).toBe("[REDACTED_LONG_STRING]");
    const objWithLongString = { detail: "y".repeat(250) };
    const sanitizedLong = sanitizeForLogging(objWithLongString) as Record<string, unknown>;
    expect(sanitizedLong.detail).toBe("[REDACTED_LONG_STRING]");
  });
});
