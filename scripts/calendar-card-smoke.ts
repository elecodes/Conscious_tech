import type { Browser, Page } from "playwright";
import type { WeeklySchedule } from "../src/domain/schedule";
import { createActiveWeekFixture } from "../tests/fixtures/active-week";

async function readSchedule(page: Page, id: string): Promise<WeeklySchedule> {
  return page.evaluate(async (id) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open("conscious_tech_db");
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    try {
      return await new Promise<WeeklySchedule>((resolve, reject) => {
        const r = db.transaction("schedules").objectStore("schedules").get(id);
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
    } finally {
      db.close();
    }
  }, id);
}

export async function verifyCalendarCards(browser: Browser, url: string, output?: string) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const { plan, schedule, items } = createActiveWeekFixture();
  schedule.timeBlocks = [];
  schedule.dailyAllocations = [
    { itemId: "a", day: "2026-12-08", allocatedHours: 2 },
    { itemId: "b", day: "2026-12-08", allocatedHours: 3 },
    { itemId: "d", day: "2026-12-11", allocatedHours: 1 },
  ];
  plan.draftContext = { ...plan.draftContext, plannedDays: { c: "2026-12-11" } };
  plan.proposal.flexibleOptions.push({
    itemId: "h",
    title: "Lectura sin día",
    estimatedHours: 1,
    condition: "Si queda espacio",
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.goto(url, { waitUntil: "networkidle" });
    await page.getByTestId("flow-textarea").waitFor();
    await page.evaluate(
      async ({ plan, schedule }) => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const r = indexedDB.open("conscious_tech_db");
          r.onsuccess = () => resolve(r.result);
          r.onerror = () => reject(r.error);
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
      { plan, schedule }
    );
    await page.reload({ waitUntil: "networkidle" });
    await page.getByTestId("calendar-task-a-2026-12-08").waitFor();
    // Observe DOM membership during the entire save: unrelated controls must not disappear.
    const initialMenus = await page.locator(".calendar-task-actions").count();
    await page.evaluate(() => {
      (window as unknown as { calendarMenuCounts: number[] }).calendarMenuCounts = [];
      new MutationObserver(() => {
        (window as unknown as { calendarMenuCounts: number[] }).calendarMenuCounts.push(
          document.querySelectorAll(".calendar-task-actions").length
        );
      }).observe(document.getElementById("root")!, { subtree: true, childList: true });
    });
    const disclosure = page.getByTestId("calendar-actions-a-2026-12-08");
    await disclosure.locator(":scope > summary").click();
    await page
      .getByRole("combobox", {
        name: `Mover ${items.find((item) => item.itemId === "a")!.title} a otro día`,
        exact: true,
      })
      .selectOption("2026-12-09");
    await page.getByTestId("calendar-task-a-2026-12-09").waitFor();
    const stored = await readSchedule(page, schedule.scheduleId);
    if (
      !stored.dailyAllocations.some(
        (row) => row.itemId === "a" && row.day === "2026-12-09" && row.allocatedHours === 2
      )
    )
      throw new Error("Selected task did not move");
    if (
      JSON.stringify(stored.dailyAllocations.filter((row) => row.itemId !== "a")) !==
      JSON.stringify(schedule.dailyAllocations.filter((row) => row.itemId !== "a"))
    )
      throw new Error("Moving one task also changed another task");
    await page.getByTestId("calendar-task-b-2026-12-08").waitFor();
    const counts = await page.evaluate(
      () => (window as unknown as { calendarMenuCounts: number[] }).calendarMenuCounts
    );
    if (counts.some((count) => count < initialMenus))
      throw new Error(
        `Unrelated movement controls disappeared during saving: ${JSON.stringify(counts)}`
      );
    await page.waitForFunction(
      () => document.activeElement?.getAttribute("data-testid") === "calendar-task-a-2026-12-09"
    );
    await page.getByTestId("calendar-actions-c-2026-12-11").locator(":scope > summary").click();
    await page
      .getByTestId("calendar-actions-c-2026-12-11")
      .getByRole("button", { name: "Abrir ajustes de esta tarea", exact: true })
      .waitFor();
    await page.getByTestId("calendar-actions-c-2026-12-11").locator(":scope > summary").click();
    const tones = await page.evaluate(() => [
      getComputedStyle(document.querySelector('[data-testid="calendar-card-a-2026-12-09"]')!)
        .backgroundColor,
      getComputedStyle(document.querySelector('[data-testid="calendar-card-h-undated"]')!)
        .backgroundColor,
    ]);
    if (tones[0] === tones[1]) throw new Error("Scheduled and undated tasks have the same colour");
    if (output)
      await page
        .getByTestId("active-task-calendar")
        .screenshot({ path: `${output}/calendar-cards-desktop.png` });
    await page.getByTestId("calendar-task-a-2026-12-09").click();
    await page.getByTestId("undo-item-a").click();
    await page.getByTestId("calendar-task-a-2026-12-08").waitFor();
    if (
      JSON.stringify((await readSchedule(page, schedule.scheduleId)).dailyAllocations) !==
      JSON.stringify(schedule.dailyAllocations)
    )
      throw new Error("Undo changed a neighbouring task");
    await page.setViewportSize({ width: 390, height: 844 });
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1))
      throw new Error("Calendar card controls overflow on mobile");
    if (output)
      await page
        .getByTestId("active-task-calendar")
        .screenshot({ path: `${output}/calendar-cards-mobile.png` });
    if (errors.length) throw new Error(errors.join("\n"));
    console.log(
      "  ✓ Task-specific day changes and undo preserve neighbouring/grouped tasks and control layout"
    );
  } finally {
    await context.close();
  }
}
