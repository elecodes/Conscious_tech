import type { Browser, Page } from "playwright";
import type { StoredWeeklyPlan } from "../src/domain/repositories/types";
import type { WeeklySchedule } from "../src/domain/schedule";
import { createReviewFixture } from "../tests/fixtures/review-proposal";
async function readStored(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open("conscious_tech_db");
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    try {
      const plans = await new Promise<StoredWeeklyPlan[]>((resolve, reject) => {
        const r = db.transaction("plans").objectStore("plans").getAll();
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
      const schedules = await new Promise<WeeklySchedule[]>((resolve, reject) => {
        const r = db.transaction("schedules").objectStore("schedules").getAll();
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
      return { plans, schedules };
    } finally {
      db.close();
    }
  });
}
export async function verifyTaskSplit(browser: Browser, url: string, output?: string) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
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
    await page.getByTestId("draft-include-g").click();
    await page.getByTestId("draft-hours-g").fill("5");
    await page.getByTestId("draft-saving").waitFor({ state: "hidden" });
    await page.getByTestId("draft-day-c").fill("2026-12-10");
    await page.getByTestId("draft-saving").waitFor({ state: "hidden" });
    await page.getByTestId("task-split-draft-g").locator(":scope > summary").click();
    await page.getByTestId("split-hours-draft-g-2026-12-07").fill("2");
    await page.getByTestId("save-split-draft-g").click();
    await page.getByTestId("draft-saving").waitFor({ state: "hidden" });
    const partial = page.getByTestId("task-split-draft-g");
    if (!(await partial.evaluate((element) => (element as HTMLDetailsElement).open)))
      await partial.locator(":scope > summary").click();
    if (!(await partial.innerText()).includes("3 h por repartir"))
      throw new Error("Partial allocation did not show remaining effort");
    await page.getByTestId("split-hours-draft-g-2026-12-09").fill("4");
    if (!(await page.getByTestId("save-split-draft-g").isDisabled()))
      throw new Error("Six hours can be allocated to a five-hour task");
    // Reproduce adding days while the original day's hours remain, then correct explicitly.
    await partial.getByRole("button", { name: "Repartir 5 h por igual" }).click();
    if (await page.getByTestId("save-split-draft-g").isDisabled())
      throw new Error("Equal distribution did not resolve excess hours");
    if ((await page.getByTestId("split-hours-draft-g-2026-12-07").inputValue()) !== "2.5")
      throw new Error("Equal distribution retained the original day's full hours");
    const editorBox = await partial.boundingBox();
    if (!editorBox || editorBox.width < 400)
      throw new Error("Split editor is still constrained to the narrow calendar column");
    await page.setViewportSize({ width: 390, height: 844 });
    const mobileEditor = await partial.boundingBox();
    if (!mobileEditor || mobileEditor.x < 0 || mobileEditor.x + mobileEditor.width > 390)
      throw new Error("Split editor overflows mobile viewport");
    if (output) await page.screenshot({ path: `${output}/split-editor-mobile.png` });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByTestId("split-hours-draft-g-2026-12-07").fill("2");
    await page.getByTestId("split-hours-draft-g-2026-12-09").fill("2");
    await page.getByTestId("split-hours-draft-g-2026-12-11").fill("1");
    await page.getByTestId("save-split-draft-g").click();
    await page.getByTestId("draft-saving").waitFor({ state: "hidden" });
    for (const day of ["2026-12-07", "2026-12-09", "2026-12-11"])
      await page
        .getByTestId(`draft-calendar-day-${day}`)
        .getByTestId(`draft-task-g-${day}`)
        .waitFor();
    const draft = (await readStored(page)).plans.find((plan) => plan.status === "draft")!;
    if (
      draft.draftContext?.plannedAllocations
        ?.filter((row) => row.itemId === "g")
        .reduce((sum, row) => sum + row.allocatedHours, 0) !== 5
    )
      throw new Error("Draft lost total task effort");
    await page.reload({ waitUntil: "networkidle" });
    await page.getByTestId("draft-task-g-2026-12-07").waitFor();
    if (output)
      await page
        .getByTestId("draft-task-calendar")
        .screenshot({ path: `${output}/draft-task-split.png` });
    await page.getByTestId("confirm-plan-button").click();
    await page.getByTestId("active-task-calendar").waitFor();
    for (const day of ["2026-12-07", "2026-12-09", "2026-12-11"])
      await page.getByTestId(`calendar-task-g-${day}`).waitFor();
    if (!(await page.getByTestId("calendar-counts").innerText()).includes("4 pendientes"))
      throw new Error("Multiple days multiplied the pending task count");
    const before = await readStored(page);
    const active = before.plans.find((plan) => plan.status === "active")!;
    const schedule = before.schedules.find((row) => row.planId === active.planId)!;
    if (
      schedule.dailyAllocations
        .filter((row) => row.itemId === "g")
        .reduce((sum, row) => sum + row.allocatedHours, 0) !== 5
    )
      throw new Error("Activation did not keep all portions");
    const splitSummary = page
      .getByTestId("task-split-active-g-2026-12-07")
      .locator(":scope > summary");
    if ((await splitSummary.innerText()).trim() !== "Repartir horas")
      throw new Error("Calendar card repeats the distribution total");
    const main = page.locator(".weeks-main");
    const beforeCollapse = (await main.boundingBox())!.width;
    const sidebarToggle = page.getByTestId("weeks-sidebar").locator(":scope > details > summary");
    await sidebarToggle.click();
    const afterCollapse = (await main.boundingBox())!.width;
    if (afterCollapse <= beforeCollapse + 200)
      throw new Error("Collapsing weeks does not release calendar width");
    await sidebarToggle.click();
    if (Math.abs((await main.boundingBox())!.width - beforeCollapse) > 1)
      throw new Error("Expanding weeks does not restore the sidebar layout");
    await page.getByTestId("task-split-active-g-2026-12-07").locator(":scope > summary").click();
    await page.getByTestId("split-hours-active-g-2026-12-07-2026-12-07").fill("1");
    await page.getByTestId("split-hours-active-g-2026-12-07-2026-12-08").fill("1");
    await page.getByTestId("save-split-active-g-2026-12-07").click();
    await page.getByTestId("calendar-task-g-2026-12-08").waitFor();
    const after = await readStored(page);
    const newSchedule = after.schedules.find((row) => row.planId === active.planId)!;
    if (
      JSON.stringify(newSchedule.dailyAllocations.filter((row) => row.itemId !== "g")) !==
      JSON.stringify(schedule.dailyAllocations.filter((row) => row.itemId !== "g"))
    )
      throw new Error("Splitting changed another task's schedule");
    if (
      JSON.stringify(after.plans.find((row) => row.planId === active.planId)?.proposal) !==
      JSON.stringify(active.proposal)
    )
      throw new Error("Splitting changed weekly estimates or task membership");
    // A day drag moves only that day's portion, not the rest of the task.
    await page
      .getByTestId("calendar-task-g-2026-12-08")
      .evaluate((element) => element.scrollIntoView({ block: "center" }));
    await page
      .getByTestId("calendar-task-g-2026-12-08")
      .dragTo(page.getByTestId("calendar-day-2026-12-09"), { targetPosition: { x: 30, y: 100 } });
    await page
      .getByTestId("calendar-task-g-2026-12-08")
      .waitFor({ state: "hidden" })
      .catch(async () => {
        throw new Error(
          `Portion did not move: ${JSON.stringify((await readStored(page)).schedules)}; ${await page.getByRole("status").allInnerTexts()}`
        );
      });
    const moved = (await readStored(page)).schedules.find((row) => row.planId === active.planId)!;
    if (
      moved.dailyAllocations.find((row) => row.itemId === "g" && row.day === "2026-12-09")
        ?.allocatedHours !== 3 ||
      moved.dailyAllocations.find((row) => row.itemId === "g" && row.day === "2026-12-07")
        ?.allocatedHours !== 1
    )
      throw new Error("Dragging one portion moved other days or lost hours");
    await page.reload({ waitUntil: "networkidle" });
    await page.getByTestId("calendar-task-g-2026-12-09").waitFor();
    // The existing total-effort editor must not collapse a distribution onto its first day.
    await page.getByTestId("adjustment-proposal-box").locator(":scope > summary").click();
    await page.getByTestId("adjustment-item-select").selectOption("g");
    await page.getByTestId("task-hours-input").fill("6");
    await page.getByTestId("save-task-adjustment-button").click();
    await page
      .getByTestId("task-split-active-g-2026-12-07")
      .locator("p")
      .filter({ hasText: "6 h para repartir" })
      .waitFor({ state: "attached" });
    const extended = (await readStored(page)).schedules.find(
      (row) => row.planId === active.planId
    )!;
    if (JSON.stringify(extended.dailyAllocations) !== JSON.stringify(moved.dailyAllocations))
      throw new Error("Changing the total collapsed the daily portions");
    await page.getByTestId("adjustment-proposal-box").locator(":scope > summary").click();
    await page.getByTestId("adjustment-item-select").selectOption("g");
    await page.getByTestId("task-hours-input").fill("5");
    await page.getByTestId("save-task-adjustment-button").click();
    await page
      .getByTestId("task-split-active-g-2026-12-07")
      .locator("p")
      .filter({ hasText: "5 h para repartir" })
      .waitFor({ state: "attached" });
    await page.getByTestId("reminders-and-alerts-details").locator(":scope > summary").click();
    const downloadPromise = page.waitForEvent("download");
    await page.getByTestId("add-week-to-gcal-button").click();
    const download = await downloadPromise;
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    const ics = Buffer.concat(chunks).toString("utf-8");
    const exported = ics
      .split("BEGIN:VEVENT")
      .filter((event) => event.includes("SUMMARY:Revisar una tarea pendiente"));
    if (
      exported.length !== 3 ||
      !exported.some((event) => event.includes("20261209") && event.includes("3 h"))
    )
      throw new Error("Export lost the per-day portions");
    if (!(await page.getByTestId("email-summary-preview").innerText()).includes("3 h"))
      throw new Error("Email omitted the per-day effort");
    await page.getByTestId("reminders-and-alerts-details").locator(":scope > summary").click();
    await page.setViewportSize({ width: 390, height: 844 });
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1))
      throw new Error("Split task controls overflow on mobile");
    if (output)
      await page
        .getByTestId("active-task-calendar")
        .screenshot({ path: `${output}/active-task-split-mobile.png` });
    if (errors.length) throw new Error(errors.join("\n"));
    console.log(
      "  ✓ Five-hour task: partial split, 2/2/1 days, reload, activation, per-day dragging and independent task preservation verified"
    );
  } finally {
    await context.close();
  }
}
