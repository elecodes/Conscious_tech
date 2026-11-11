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
    await page
      .getByRole("button", {
        name: `Arrastrar ${fixture.items.find((item) => item.id === "g")!.title}`,
        exact: true,
      })
      .evaluate((el) => el.scrollIntoView({ block: "center" }));
    await page
      .getByRole("button", {
        name: `Arrastrar ${fixture.items.find((item) => item.id === "g")!.title}`,
        exact: true,
      })
      .dragTo(page.getByTestId("draft-calendar-day-2026-12-10"), {
        targetPosition: { x: 30, y: 100 },
      });
    await page.getByTestId("draft-calendar-day-2026-12-10").getByTestId("draft-task-g").waitFor();
    await page.getByTestId("draft-saving").waitFor({ state: "hidden" });
    await page.getByTestId("draft-day-g").fill("2026-12-08");
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
    // Dirty notes cannot be silently attached to a different week.
    await page.getByTestId("step-indicator-write").click();
    const originalNotes = await page.getByTestId("flow-textarea").inputValue();
    await page.getByTestId("flow-textarea").fill(`${originalNotes} Otra nota sin listar.`);
    await page.getByTestId("calendar-view-month").click();
    await page.getByTestId("month-day-2026-12-15").click();
    await page.getByRole("alert").filter({ hasText: "Conserva tus cambios" }).waitFor();
    await page.getByTestId("calendar-view-week").click();
    if (!(await page.getByTestId("flow-textarea").inputValue()).includes("Otra nota sin listar"))
      throw new Error("Week navigation discarded dirty notes");
    await page.getByTestId("flow-textarea").fill(originalNotes);
    await page.getByTestId("step-indicator-review").click();
    // The month preserves the current week, opens a separate future draft, and returns intact.
    await page.getByTestId("calendar-view-month").click();
    await page.getByTestId("month-task-calendar").waitFor();
    await page.getByRole("button", { name: "Mes siguiente", exact: true }).click();
    if ((await page.getByTestId("calendar-month-input").inputValue()) !== "2027-01")
      throw new Error("Month navigation lost year boundary");
    await page.getByRole("button", { name: "Mes anterior", exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1))
      throw new Error("Month overflows mobile screen");
    if (screenshot)
      await page.screenshot({ path: screenshot.replace(".png", "-month.png"), fullPage: true });
    await page.getByTestId("month-day-2026-12-15").click();
    await page.getByTestId("flow-textarea").waitFor();
    if (await page.getByTestId("flow-textarea").inputValue())
      throw new Error("Previous week notes leaked into future week");
    await page.getByTestId("flow-textarea").fill("Preparar una lectura futura (1 hora).");
    await page.getByTestId("flow-continue-to-review").click();
    await page.getByTestId("draft-task-calendar").waitFor();
    await page.getByTestId("draft-saving").waitFor({ state: "hidden" });
    await page.getByTestId("calendar-view-month").click();
    await page.getByTestId("month-week-draft-2026-12-14").waitFor();
    await page.getByTestId("month-week-draft-2026-12-07").click();
    await page.getByTestId("draft-hours-g").waitFor();
    if ((await page.getByTestId("draft-hours-g").inputValue()) !== "3.5")
      throw new Error("Week switch lost source edits");
    if ((await readStored(page)).plans.filter((plan) => plan.status === "draft").length !== 2)
      throw new Error("Week navigation lost or activated a draft");
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
    await page.setViewportSize({ width: 1280, height: 900 });
    await page
      .getByTestId("calendar-task-g-2026-12-08")
      .dragTo(page.getByTestId("calendar-day-2026-12-10"));
    await page.getByTestId("calendar-task-g-2026-12-10").waitFor();
    await page
      .getByRole("combobox", {
        name: `Mover ${fixture.items.find((item) => item.id === "g")!.title} a otro día`,
        exact: true,
      })
      .selectOption("2026-12-08");
    await page.getByTestId("calendar-task-g-2026-12-08").waitFor();
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
    await page.getByTestId("calendar-task-g-2026-12-08").click();
    await page.getByTestId("undo-item-g").click();
    await page.getByTestId("calendar-task-g-2026-12-10").waitFor();
    const afterUndo = await readStored(page);
    if (
      !afterUndo.schedules
        .find((row) => row.planId === active?.planId)
        ?.dailyAllocations.some(
          (row) => row.itemId === "g" && row.day === "2026-12-10" && row.allocatedHours === 3.5
        )
    )
      throw new Error("Calendar movement undo lost hours or date");
    if (errors.length) throw new Error(errors.join("\n"));
    console.log(
      "  ✓ Direct calendar: drag/drop, keyboard movement, monthly draft navigation, reload, mobile and activation verified"
    );
  } finally {
    await context.close();
  }
}

export async function verifyCustomMonthRange(browser: Browser, url: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const { plan } = createReviewFixture();
  plan.targetWeek = { startDate: "2026-12-07", endDate: "2026-12-10" };
  plan.proposal.weekSummary.targetWeek = plan.targetWeek;
  try {
    await page.goto(url, { waitUntil: "networkidle" });
    await page.getByTestId("flow-textarea").waitFor();
    await page.evaluate(async (plan) => {
      localStorage.setItem(
        "conscious_tech_transient_planning_context",
        JSON.stringify({
          targetWeekStart: plan.targetWeek.startDate,
          targetWeekEnd: plan.targetWeek.endDate,
          availableHoursInput: "16",
          protectedSpacePercentInput: "25",
        })
      );
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
    }, plan);
    await page.reload({ waitUntil: "networkidle" });
    await page.getByTestId("draft-task-calendar").waitFor();
    await page.getByTestId("calendar-view-month").click();
    await page.getByTestId("month-day-2026-12-12").click();
    await page.getByRole("alert").filter({ hasText: "conservar su rango" }).waitFor();
    const saved = (await readStored(page)).plans.find((row) => row.planId === plan.planId);
    if (JSON.stringify(saved?.proposal) !== JSON.stringify(plan.proposal))
      throw new Error("Month selection overwrote a custom-range draft");
    await page.getByTestId(`month-week-${plan.planId}`).click();
    await page.getByTestId("draft-task-calendar").waitFor();
    console.log("  ✓ Month navigation preserves custom-range drafts with the same start date");
  } finally {
    await context.close();
  }
}
