import type { WeeklySchedule } from "../src/domain/schedule";
import type { Browser } from "playwright";
import { createActiveWeekFixture } from "../tests/fixtures/active-week";

export async function verifyActiveWeek(browser: Browser, url: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const fixture = createActiveWeekFixture();
  fixture.schedule.timeBlocks.push({
    itemId: "c",
    day: "2026-12-10",
    startTime: "15:00",
    endTime: "16:00",
  });
  const readSchedule = () =>
    page.evaluate(async (scheduleId) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("conscious_tech_db");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        return await new Promise<WeeklySchedule>((resolve, reject) => {
          const request = db.transaction("schedules").objectStore("schedules").get(scheduleId);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      } finally {
        db.close();
      }
    }, fixture.schedule.scheduleId);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.goto(url, { waitUntil: "networkidle" });
    await page.getByTestId("flow-textarea").waitFor();
    await page.evaluate(
      async ({ plan, schedule }) => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open("conscious_tech_db");
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        try {
          await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(["plans", "schedules"], "readwrite");
            tx.objectStore("plans").put(plan);
            tx.objectStore("schedules").put(schedule);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
          });
        } finally {
          db.close();
        }
      },
      { plan: fixture.plan, schedule: fixture.schedule }
    );
    await page.reload({ waitUntil: "networkidle" });
    const priorities = page.getByTestId("active-week-priorities");
    await priorities.waitFor();
    await page.getByTestId("active-task-calendar").waitFor();
    if (!(await page.getByTestId("calendar-week-range").innerText()).includes("diciembre"))
      throw new Error("Calendar does not show the task week");
    await page.getByTestId("calendar-task-c-2026-12-10").waitFor();
    if (process.env.SMOKE_OUTPUT_DIR)
      await page
        .getByTestId("active-task-calendar")
        .screenshot({ path: `${process.env.SMOKE_OUTPUT_DIR}/07-task-calendar.png` });
    if (await page.getByTestId("calendar-task-g-2026-12-09").count())
      throw new Error("Residual deferred allocation became a calendar priority");
    if (JSON.stringify(await readSchedule()) !== JSON.stringify(fixture.schedule))
      throw new Error("Calendar viewing changed stored assignments");
    await page.getByTestId("calendar-task-a-undated").focus();
    await page.keyboard.press("Enter");
    await page.waitForFunction(
      () => document.activeElement?.getAttribute("data-testid") === "active-task-item-a"
    );
    await page.getByTestId("active-focus-items-group-focus").locator(":scope > summary").click();
    if (!(await priorities.innerText()).includes("Avanzar en el proyecto"))
      throw new Error("Focus area is missing from active priorities");
    for (const id of ["d", "e", "f", "g", "j"]) {
      if (await priorities.getByTestId(`active-task-item-${id}`).count())
        throw new Error(`Optional/deferred item ${id} is shown as an active priority`);
    }
    for (const item of fixture.items) {
      if ((await page.getByTestId(`active-task-item-${item.itemId}`).count()) !== 1)
        throw new Error(`Active item ${item.itemId} is missing or duplicated`);
    }
    if (await page.getByTestId("add-week-to-gcal-button").isVisible())
      throw new Error("Export should be secondary to active priorities");
    if (await page.getByTestId("schedule-adjustments-history").isVisible())
      throw new Error("Empty adjustment history should be inside technical details");
    await page.getByTestId("active-week-technical-details").locator(":scope > summary").click();
    await page.getByTestId("schedule-adjustments-history").waitFor();
    await page.getByTestId("active-week-technical-details").locator(":scope > summary").click();
    // Daily completion is individual, persists, and can be undone after a reload.
    await page.getByTestId("active-focus-items-group-focus").locator(":scope > summary").click();
    await page.getByTestId("complete-item-a").evaluate((button) => {
      (button as HTMLButtonElement).click();
      (button as HTMLButtonElement).click();
    });
    await page.getByTestId("item-completed-a").waitFor();
    if (await page.getByTestId("calendar-task-a-undated").count())
      throw new Error("Completed work remains in pending calendar filter");
    const afterCompletion = await readSchedule();
    await page.getByTestId("calendar-filter-all").click();
    await page.getByTestId("calendar-task-a-undated").waitFor();
    await page.getByTestId("calendar-filter-pending").click();
    if (JSON.stringify(await readSchedule()) !== JSON.stringify(afterCompletion))
      throw new Error("Calendar filtering changed stored progress");
    if (await page.getByTestId("item-completed-b").count())
      throw new Error("Completion affected another group member");
    await page.reload({ waitUntil: "networkidle" });
    await page.getByTestId("active-focus-items-group-focus").locator(":scope > summary").click();
    await page.getByTestId("undo-item-a").click();
    await page.getByTestId("complete-item-a").waitFor();
    await page.getByTestId("complete-item-a").click();
    await page.getByTestId("item-completed-a").waitFor();
    const deferred = page.getByTestId("active-week-deferred");
    await deferred.locator(":scope > summary").focus();
    await page.keyboard.press("Enter");
    await deferred.getByTestId("active-task-item-g").waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth))
      throw new Error("Active week overflows on mobile");

    // Select one daily allocation, move part of it, reload, then restore its exact scope.
    await page.getByTestId("task-more-actions-summary-g").click();
    await page.getByTestId("move-item-g").locator(":scope > summary").click();
    await page.getByTestId("move-source-g").selectOption("day-0");
    await page.getByTestId("move-day-g").fill("2026-12-10");
    await page.getByTestId("move-hours-g").fill("0.5");
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth))
      throw new Error("Movement controls overflow on mobile");
    await page.getByTestId("save-move-g").click();
    await page.getByTestId("undo-item-g").waitFor();
    let moved = await readSchedule();
    if (
      moved.dailyAllocations.reduce((sum, row) => sum + row.allocatedHours, 0) !== 1 ||
      JSON.stringify(moved.timeBlocks) !== JSON.stringify(fixture.schedule.timeBlocks)
    )
      throw new Error("Daily movement changed total hours or fixed blocks");
    await page.reload({ waitUntil: "networkidle" });
    await page.getByTestId("active-week-deferred").locator(":scope > summary").click();
    await page.getByTestId("undo-item-g").click();
    await page.getByTestId("undo-item-g").waitFor({ state: "hidden" });
    if (
      JSON.stringify((await readSchedule()).dailyAllocations) !==
      JSON.stringify(fixture.schedule.dailyAllocations)
    )
      throw new Error("Daily movement undo did not restore the original allocation");
    // A block collision leaves storage unchanged; a valid move preserves duration and daily hours.
    await page.getByTestId("task-more-actions-summary-g").click();
    await page.getByTestId("move-item-g").locator(":scope > summary").click();
    await page.getByTestId("move-source-g").selectOption("block-0");
    await page.getByTestId("move-day-g").fill("2026-12-10");
    await page.getByTestId("move-time-g").fill("15:00");
    const beforeCollision = await readSchedule();
    await page.getByTestId("save-move-g").click();
    await page.getByRole("status").filter({ hasText: "No se movió la asignación" }).waitFor();
    if (JSON.stringify(await readSchedule()) !== JSON.stringify(beforeCollision))
      throw new Error("Rejected collision changed storage");
    await page.getByTestId("move-time-g").fill("16:00");
    await page.getByTestId("save-move-g").click();
    await page.getByTestId("undo-item-g").waitFor();
    moved = await readSchedule();
    if (
      moved.timeBlocks[0]?.startTime !== "16:00" ||
      moved.timeBlocks[0]?.endTime !== "17:00" ||
      JSON.stringify(moved.dailyAllocations) !== JSON.stringify(fixture.schedule.dailyAllocations)
    )
      throw new Error("Block movement changed duration or daily hours");
    await page.getByTestId("undo-item-g").click();
    await page.getByTestId("undo-item-g").waitFor({ state: "hidden" });
    if (
      JSON.stringify((await readSchedule()).timeBlocks) !==
      JSON.stringify(fixture.schedule.timeBlocks)
    )
      throw new Error("Block undo changed another block");
    if (
      await page
        .getByTestId("task-more-actions-g")
        .evaluate((element) => (element as HTMLDetailsElement).open)
    )
      await page.getByTestId("task-more-actions-summary-g").click();

    // A conscious postponement removes a commitment from priorities without losing it.
    await page.getByTestId("task-more-actions-summary-c").click();
    await page.getByTestId("postpone-item-c").locator(":scope > summary").click();
    if (!(await page.getByTestId("save-postpone-c").isDisabled()))
      throw new Error("Postponement accepts an empty reason");
    await page.getByTestId("postpone-reason-c").fill("Esperar confirmación");
    await page.getByTestId("postpone-destination-c").check();
    await page.getByTestId("postpone-start-c").fill("2026-12-14");
    await page.getByTestId("postpone-end-c").fill("2026-12-20");
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth))
      throw new Error("Postponement controls overflow on mobile");
    const beforePostponement = await readSchedule();
    await page.getByTestId("save-postpone-c").click();
    await page.getByTestId("active-week-postponed").getByTestId("active-task-item-c").waitFor();
    if (await page.getByTestId("calendar-task-c-2026-12-10").count())
      throw new Error("Postponed work remains in a calendar day");
    if (!(await page.getByTestId("calendar-task-c-outside").textContent())?.includes("14 dic"))
      throw new Error("Calendar lost postponed destination week");
    if (await priorities.getByTestId("active-task-item-c").count())
      throw new Error("Postponed commitment remains in active priorities");
    if (await page.getByTestId("complete-item-c").count())
      throw new Error("Completion bypasses a live postponement");
    const note = await page.getByTestId("postponement-note-c").innerText();
    if (!note.includes("Esperar confirmación") || !note.includes("2026-12-14"))
      throw new Error("Postponement lost its reason or destination");
    if ((await readSchedule()).timeBlocks.some((row) => row.itemId === "c"))
      throw new Error("Postponement kept an active time block");
    await page.reload({ waitUntil: "networkidle" });
    await page.getByTestId("undo-item-c").click();
    await priorities.getByTestId("active-task-item-c").waitFor();
    const restoredAfterPostponement = await readSchedule();
    if (
      JSON.stringify(restoredAfterPostponement.timeBlocks) !==
        JSON.stringify(beforePostponement.timeBlocks) ||
      JSON.stringify(restoredAfterPostponement.dailyAllocations) !==
        JSON.stringify(beforePostponement.dailyAllocations)
    )
      throw new Error("Postponement undo did not restore its exact scope");
    await page.getByTestId("complete-item-c").click();
    await page.getByTestId("item-completed-c").waitFor();
    await page.getByTestId("undo-item-c").click();
    await page.getByTestId("complete-item-c").waitFor();

    // Existing export still receives the complete inventory, independently of its visibility.
    await page.getByTestId("reminders-and-alerts-summary").click();
    if ((await page.getByTestId("add-week-to-gcal-button").count()) !== 1)
      throw new Error("Weekly calendar download is duplicated");
    if (
      !(await page.getByTestId("add-week-to-gcal-button").innerText()).includes(
        "Descargar calendario"
      )
    )
      throw new Error("Calendar action does not describe a download");
    await page.getByRole("link", { name: /Preparar correo en Gmail/ }).waitFor();
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth))
      throw new Error("Calendar/sharing controls overflow on mobile");
    const downloadPromise = page.waitForEvent("download");
    await page.getByTestId("add-week-to-gcal-button").click();
    const download = await downloadPromise;
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    const ics = Buffer.concat(chunks).toString("utf8");
    for (const item of fixture.items) {
      if (!ics.includes(item.title)) throw new Error(`Export lost ${item.itemId}`);
    }
    await page.getByTestId("reminders-and-alerts-summary").click();

    // An explicit existing adjustment can move deferred work to optional work, never silently to priorities.
    if (
      !(await page
        .getByTestId("active-week-deferred")
        .evaluate((element) => (element as HTMLDetailsElement).open))
    )
      await page.getByTestId("active-week-deferred").locator(":scope > summary").click();
    await page.getByTestId("task-more-actions-summary-g").click();
    await page.getByTestId("adjust-task-g").click();
    await page.getByTestId("task-hours-input").fill("0.75");
    await page.getByTestId("save-task-adjustment-button").click();
    await page
      .getByTestId("active-week-flexible")
      .getByTestId("active-task-item-g")
      .waitFor({ state: "attached" });
    if (await priorities.getByTestId("active-task-item-g").count())
      throw new Error("Adjustment promoted optional work into priorities");
    await page.reload({ waitUntil: "networkidle" });
    await priorities.waitFor();
    for (const item of fixture.items) {
      if ((await page.getByTestId(`active-task-item-${item.itemId}`).count()) !== 1)
        throw new Error(`Reload lost ${item.itemId}`);
    }

    // Closing continues to review every item, including those hidden in secondary sections.
    await page.getByTestId("close-week-button").click();
    if (await page.getByTestId("confirm-early-close-button").isVisible())
      await page.getByTestId("confirm-early-close-button").click();
    if (
      (await page.getByTestId("item-disposition-a").getByRole("combobox").inputValue()) !==
      "completed"
    )
      throw new Error("Closing lost saved completion");
    for (const item of fixture.items) {
      await page
        .getByTestId(`item-disposition-${item.itemId}`)
        .getByRole("combobox")
        .selectOption("not_started");
    }
    await page.getByTestId("go-to-reflection-step-button").click();
    // Another tab changes the version while this review is open.
    await page.evaluate(async (scheduleId) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("conscious_tech_db");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction("schedules", "readwrite");
          const store = tx.objectStore("schedules");
          const request = store.get(scheduleId);
          request.onsuccess = () =>
            store.put({ ...request.result, version: request.result.version + 1 });
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
      } finally {
        db.close();
      }
    }, fixture.schedule.scheduleId);
    await page.getByRole("button", { name: "Confirmar cierre de semana", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "La semana cambió" }).waitFor();
    await page.getByRole("button", { name: "Recargar y revisar de nuevo", exact: true }).click();
    for (const item of fixture.items)
      await page
        .getByTestId(`item-disposition-${item.itemId}`)
        .getByRole("combobox")
        .selectOption("not_started");
    await page.getByTestId("go-to-reflection-step-button").click();
    await page.getByRole("button", { name: "Confirmar cierre de semana", exact: true }).click();
    await page.getByText("Semana cerrada exitosamente.", { exact: false }).waitFor();
    await page.getByTestId("reopen-closed-week-button").click();
    await priorities.waitFor();
    await page.getByTestId("active-focus-items-group-focus").locator(":scope > summary").click();
    await page.getByTestId("complete-item-a").click();
    await page.getByTestId("undo-item-a").click();
    await page.getByTestId("complete-item-a").waitFor();
    await page.reload({ waitUntil: "networkidle" });
    await priorities.waitFor();
    if (await page.getByTestId("item-completed-a").count())
      throw new Error("Reopening/undo lost the reviewed correction");
    if (errors.length) throw new Error(errors.join("\n"));
    console.log(
      "  ✓ Active week: calendar/filter/navigation, completion, movement, postponement, mobile and weekly lifecycle verified"
    );
  } finally {
    await context.close();
  }
}
