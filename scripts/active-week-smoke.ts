import type { Browser } from "playwright";
import { createActiveWeekFixture } from "../tests/fixtures/active-week";

export async function verifyActiveWeek(browser: Browser, url: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const fixture = createActiveWeekFixture();
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
      "  ✓ Active week: membership, daily completion/undo, reload, stale closing, reopening and export verified"
    );
  } finally {
    await context.close();
  }
}
