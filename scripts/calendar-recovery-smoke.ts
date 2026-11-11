import type { Browser } from "playwright";
import { createActiveWeekFixture } from "../tests/fixtures/active-week";
import { applyItemActivity } from "../src/domain/item-activity";
export async function verifyCalendarRecovery(browser: Browser, url: string, output?: string) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  try {
    const f = createActiveWeekFixture();
    f.schedule.timeBlocks = [];
    f.schedule.dailyAllocations = [{ itemId: "c", day: "2026-12-10", allocatedHours: 2 }];
    const postponed = applyItemActivity(f.plan, f.schedule, {
      type: "postpone",
      itemId: "d",
      actionId: "postpone-d",
      expectedVersion: 1,
      decidedAt: "2026-12-07T10:00:00.000Z",
      action: {
        type: "postpone_item",
        itemId: "d",
        currentCategory: "flexible_options",
        targetReason: "intentional_postponement",
        hoursFreed: null,
        rationale: "Otra semana",
        targetWeek: { startDate: "2026-12-14", endDate: "2026-12-20" },
      },
    });
    if (postponed.status === "rejected") throw new Error(postponed.reason);
    await page.goto(url, { waitUntil: "networkidle" });
    await page.getByTestId("flow-textarea").waitFor();
    await page.evaluate(
      async ({ plan, schedule }) => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const r = indexedDB.open("conscious_tech_db");
          r.onsuccess = () => resolve(r.result);
          r.onerror = () => reject(r.error);
        });
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(["plans", "schedules"], "readwrite");
          tx.objectStore("plans").put(plan);
          tx.objectStore("schedules").put(schedule);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
        db.close();
      },
      { plan: f.plan, schedule: postponed.schedule }
    );
    await page.reload({ waitUntil: "networkidle" });
    const tray = page.getByTestId("calendar-recovery-tray");
    await tray.getByTestId("calendar-task-g-outside").waitFor();
    await tray.scrollIntoViewIfNeeded();
    await tray
      .getByTestId("calendar-task-g-outside")
      .dragTo(page.getByTestId("calendar-day-2026-12-08"), { targetPosition: { x: 25, y: 100 } });
    const editor = page.getByTestId("calendar-task-editor");
    await editor.waitFor();
    await editor.getByRole("button", { name: "Cancelar", exact: true }).click();
    await tray.getByTestId("calendar-task-g-outside").waitFor();
    await tray
      .getByTestId("calendar-card-g-outside")
      .getByRole("button", { name: "Añadir a un día" })
      .click();
    await editor.getByLabel("Día de la tarea").selectOption("2026-12-08");
    await editor.getByLabel("Horas de la tarea").fill("3");
    await editor.getByRole("button", { name: "Guardar en el calendario" }).click();
    await editor.waitFor({ state: "hidden" });
    await page.getByTestId("calendar-task-g-2026-12-08").waitFor();
    if (
      (await page.getByTestId("calendar-task-g-2026-12-08").innerText()).includes("3 h") === false
    )
      throw new Error("Hours not visible after recovery");
    if (await tray.getByTestId("calendar-task-g-outside").count())
      throw new Error("Recovered task remains in tray");
    await tray
      .getByTestId("calendar-card-d-outside")
      .getByRole("button", { name: "Añadir a un día" })
      .click();
    await editor.getByLabel("Día de la tarea").selectOption("2026-12-11");
    await editor.getByLabel("Horas de la tarea").fill("2");
    await editor.getByRole("button", { name: "Guardar en el calendario" }).click();
    await page.getByTestId("calendar-task-d-2026-12-11").waitFor();
    await page
      .getByTestId("calendar-card-g-2026-12-08")
      .getByRole("button", { name: "Ajustar horas", exact: true })
      .click();
    await editor.getByLabel("Horas de la tarea").fill("");
    await editor.getByRole("button", { name: "Guardar en el calendario" }).click();
    await editor.waitFor({ state: "hidden" });
    await page.reload({ waitUntil: "networkidle" });
    await page.getByTestId("calendar-task-g-2026-12-08").waitFor();
    await page.getByTestId("calendar-task-d-2026-12-11").waitFor();
    await page.getByTestId("calendar-task-c-2026-12-10").waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    await page
      .getByTestId("calendar-card-g-2026-12-08")
      .getByRole("button", { name: "Ajustar horas", exact: true })
      .click();
    const box = await editor.boundingBox();
    if (!box || box.x < 0 || box.x + box.width > 390)
      throw new Error("Recovery editor overflows mobile");
    if (output) await page.screenshot({ path: `${output}/calendar-recovery-mobile.png` });
    console.log(
      "  ✓ Calendar tray: drag, cancellation, day/hours editing, postponed recovery, unknown effort, reload and mobile verified"
    );
  } finally {
    await context.close();
  }
}
