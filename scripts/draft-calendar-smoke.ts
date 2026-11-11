import type { Browser, Page } from "playwright";
import { createReviewFixture } from "../tests/fixtures/review-proposal";
import type { StoredWeeklyPlan } from "../src/domain/repositories/types";
import type { WeeklySchedule } from "../src/domain/schedule";

async function readStored(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("conscious_tech_db");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const plans = await new Promise<StoredWeeklyPlan[]>((resolve, reject) => {
        const request = db.transaction("plans").objectStore("plans").getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const schedules = await new Promise<WeeklySchedule[]>((resolve, reject) => {
        const request = db.transaction("schedules").objectStore("schedules").getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      return { plans, schedules };
    } finally {
      db.close();
    }
  });
}

export async function verifyDraftCalendar(browser: Browser, url: string, screenshot?: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const fixture = createReviewFixture();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.goto(url, { waitUntil: "networkidle" });
    await page.getByTestId("flow-textarea").waitFor();
    await page.evaluate(async ({ plan, items }) => {
      localStorage.setItem(
        "conscious_tech_transient_planning_context",
        JSON.stringify({
          targetWeekStart: plan.targetWeek.startDate,
          targetWeekEnd: plan.targetWeek.endDate,
          availableHoursInput: "16",
          protectedSpacePercentInput: "25",
        })
      );
      localStorage.setItem("conscious_tech_transient_dump_text", plan.draftContext!.noteText!);
      localStorage.setItem("conscious_tech_transient_dump_result", JSON.stringify({ items }));
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const r = indexedDB.open("conscious_tech_db");
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction("plans", "readwrite");
          tx.objectStore("plans").put(plan);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
      } finally {
        db.close();
      }
    }, fixture);
    await page.reload({ waitUntil: "networkidle" });
    await page.getByTestId("draft-task-calendar").waitFor();
    if (
      await page
        .getByTestId("draft-advanced-details")
        .evaluate((el) => (el as HTMLDetailsElement).open)
    )
      throw new Error("Advanced controls opened by default");
    // A failed autosave must stay visible and block activation until explicitly retried.
    await page.evaluate(() => {
      const originalPut = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (value, key) {
        IDBObjectStore.prototype.put = originalPut;
        if (this.name === "plans")
          throw new DOMException("Synthetic storage full", "QuotaExceededError");
        return originalPut.call(this, value, key);
      };
    });
    await page.getByTestId("draft-hours-c").fill("2.5");
    await page.getByRole("button", { name: "Reintentar guardado", exact: true }).waitFor();
    if (!(await page.getByTestId("confirm-plan-button").isDisabled()))
      throw new Error("Unsaved draft can activate");
    await page.getByRole("button", { name: "Reintentar guardado", exact: true }).click();
    await page
      .getByRole("button", { name: "Reintentar guardado", exact: true })
      .waitFor({ state: "hidden" });
    await page.getByTestId("draft-include-g").click();
    await page.getByTestId("draft-hours-g").fill("3.5");
    await page.getByTestId("draft-day-g").fill("2026-12-08");
    await page.getByTestId("draft-hours-d").fill("");
    await page.getByTestId("draft-day-d").fill("2026-12-09");
    await page.getByTestId("draft-saving").waitFor({ state: "hidden" });
    const draft = (await readStored(page)).plans.find((plan) => plan.status === "draft");
    if (draft?.draftContext?.plannedDays?.g !== "2026-12-08")
      throw new Error("Chosen day not saved");
    if (draft?.proposal.flexibleOptions.find((row) => row.itemId === "d")?.estimatedHours !== null)
      throw new Error("Unknown hours were invented");
    await page.reload({ waitUntil: "networkidle" });
    await page.getByTestId("draft-calendar-day-2026-12-08").getByTestId("draft-task-g").waitFor();
    if ((await page.getByTestId("draft-hours-g").inputValue()) !== "3.5")
      throw new Error("Hours lost on reload");
    await page.setViewportSize({ width: 390, height: 844 });
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1))
      throw new Error("Draft calendar overflows mobile screen");
    if (screenshot) await page.screenshot({ path: screenshot, fullPage: true });
    if (await page.getByTestId("flow-step-confirm").isVisible())
      throw new Error("Optional summary required");
    await page.getByTestId("confirm-plan-button").click();
    await page.getByTestId("active-task-calendar").waitFor();
    await page.getByTestId("calendar-task-g-2026-12-08").waitFor();
    await page.getByTestId("calendar-task-d-2026-12-09").waitFor();
    const stored = await readStored(page);
    const active = stored.plans.find((plan) => plan.status === "active");
    const schedule = stored.schedules.find((row) => row.planId === active?.planId);
    if (
      !schedule?.dailyAllocations.some(
        (row) => row.itemId === "g" && row.allocatedHours === 3.5 && row.day === "2026-12-08"
      )
    )
      throw new Error("Activation lost hours/day");
    if (schedule.dailyAllocations.some((row) => row.itemId === "d"))
      throw new Error("Activation invented unknown hours");
    if (
      JSON.stringify(active?.proposal.foci.find((row) => row.id === "group-focus")) !==
      JSON.stringify(fixture.proposal.foci[0])
    )
      throw new Error("Group was changed");
    if (errors.length) throw new Error(errors.join("\n"));
    console.log(
      "  ✓ Direct calendar: inclusion, hours/day edits, reload, mobile and one-click activation verified"
    );
  } finally {
    await context.close();
  }
}
