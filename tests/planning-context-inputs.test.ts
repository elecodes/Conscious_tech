import { afterEach, describe, expect, it, vi } from "vitest";
import { parsePlanningContext, readPlanningContext } from "../src/web/planning-context-inputs";

const context = {
  targetWeekStart: "2026-11-16",
  targetWeekEnd: "2026-11-22",
  availableHoursInput: "12",
  protectedSpacePercentInput: "25",
};

afterEach(() => vi.unstubAllGlobals());

describe("Planning context before proposal generation", () => {
  it("distinguishes unknown hours from an explicitly empty week", () => {
    expect(
      parsePlanningContext({ ...context, availableHoursInput: "" }).capacity.totalAvailableHours
    ).toBeUndefined();
    expect(
      parsePlanningContext({ ...context, availableHoursInput: "0" }).capacity.totalAvailableHours
    ).toBe(0);
  });

  it("uses the existing protected-space default and preserves fractional hours", () => {
    const result = parsePlanningContext({
      ...context,
      availableHoursInput: "7.5",
      protectedSpacePercentInput: "",
    });
    expect(result.capacity).toEqual({ totalAvailableHours: 7.5, minProtectedSpaceRatio: 0.25 });
    expect(result.targetWeek).toEqual({ startDate: "2026-11-16", endDate: "2026-11-22" });
  });

  it.each(["-1", "Infinity", "NaN", "not a number"])("rejects invalid hours: %s", (hours) => {
    expect(() => parsePlanningContext({ ...context, availableHoursInput: hours })).toThrow(
      "horas válidas"
    );
  });

  it.each(["-5", "101", "Infinity"])("rejects invalid protected space: %s", (percent) => {
    expect(() => parsePlanningContext({ ...context, protectedSpacePercentInput: percent })).toThrow(
      "espacio protegido"
    );
  });

  it("rejects impossible or reversed dates using the existing week schema", () => {
    expect(() => parsePlanningContext({ ...context, targetWeekStart: "2026-02-30" })).toThrow(
      "fechas válidas"
    );
    expect(() => parsePlanningContext({ ...context, targetWeekEnd: "2026-11-15" })).toThrow(
      "fechas válidas"
    );
  });

  it("restores explicitly unknown capacity without inventing hours", () => {
    const saved = { ...context, availableHoursInput: "" };
    vi.stubGlobal("localStorage", { getItem: () => JSON.stringify(saved) });
    expect(readPlanningContext()).toEqual(saved);
  });

  it.each([
    "{invalid",
    JSON.stringify({ ...context, availableHoursInput: -1 }),
    JSON.stringify({ ...context, targetWeekEnd: "invalid" }),
  ])("ignores corrupt transient context", (raw) => {
    vi.stubGlobal("localStorage", { getItem: () => raw });
    expect(readPlanningContext()).toBeNull();
  });

  it("allows writing when browser storage is unavailable", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("storage blocked");
      },
    });
    expect(readPlanningContext()).toBeNull();
  });
});
