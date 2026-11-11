import type { Browser, Page } from "playwright";
import type { StoredWeeklyPlan } from "../src/domain/repositories/types";
import type { WeeklySchedule } from "../src/domain/schedule";
import { createActiveWeekFixture } from "../tests/fixtures/active-week";

async function readData(page: Page) {
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

export async function verifyWeekAvailability(browser: Browser, url: string, output?: string) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const { plan, schedule } = createActiveWeekFixture();
  plan.proposal.weekSummary.capacity = {
    ...plan.proposal.weekSummary.capacity,
    totalAvailableHours: null,
    plannableHours: null,
    protectedSpaceHours: null,
    capacityStatus: "unknown",
    protectedSpaceStatus: "unknown",
  };
  schedule.timeBlocks = [];
  schedule.dailyAllocations = [{ itemId: "d", day: "2026-12-08", allocatedHours: 1 }];
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
    await page.getByTestId("week-available-hours").fill("20");
    await page.getByTestId("save-week-availability").click();
    await page.getByTestId("capacity-compact-bar").filter({ hasText: "20h disponibles" }).waitFor();
    const after = await readData(page);
    const active = after.plans.find((row) => row.status === "active")!;
    if (active.proposal.weekSummary.capacity.totalAvailableHours !== 20)
      throw new Error("Later availability was not saved");
    if (
      JSON.stringify(active.proposal.foci) !== JSON.stringify(plan.proposal.foci) ||
      JSON.stringify(after.schedules[0]?.dailyAllocations) !==
        JSON.stringify(schedule.dailyAllocations)
    )
      throw new Error("Availability edit changed tasks or days");
    await page.reload({ waitUntil: "networkidle" });
    await page.getByTestId("capacity-compact-bar").filter({ hasText: "20h disponibles" }).waitFor();
    // Reproduce the user's legacy reschedule route, with configured source and unknown destination.
    await page.getByTestId("adjustment-proposal-box").locator(":scope > summary").click();
    await page.getByTestId("adjustment-item-select").selectOption("d");
    await page
      .getByText("🗓️ ¿Prefieres mover la tarea a una fecha posterior? (Opcional)", { exact: true })
      .click();
    await page.getByTestId("target-week-start-input").fill("2026-12-14");
    await page.getByTestId("target-week-end-input").fill("2026-12-20");
    await page.getByTestId("generate-proposal-button").click();
    await page.getByTestId("capacity-warning").filter({ hasText: "semana destino" }).waitFor();
    await page.getByTestId("accept-proposal-button").click();
    await page.getByTestId("sidebar-task-2026-12-14-d").waitFor();
    if (!(await page.getByTestId("sidebar-task-2026-12-14-d").innerText()).includes("Reprogramada"))
      throw new Error("Destination did not keep postponed task visible");
    if (output)
      await page.getByTestId("weeks-sidebar").screenshot({ path: `${output}/weeks-sidebar.png` });
    await page.getByTestId("sidebar-open-2026-12-14").click();
    await page.getByTestId("carryover-item-d").waitFor();
    await page.locator("#carryover-check-d").check();
    await page.getByTestId("generate-proposal-from-carryover-button").click();
    await page.getByTestId("draft-task-d").waitFor();
    if ((await page.getByTestId("draft-hours-d").inputValue()) !== "1")
      throw new Error("Carryover lost the task's effort");
    await page.getByTestId("week-available-hours").fill("12");
    await page.getByTestId("save-week-availability").click();
    await page.getByTestId("draft-saving").waitFor({ state: "hidden" });
    const final = await readData(page);
    const draft = final.plans.find(
      (row) => row.status === "draft" && row.targetWeek.startDate === "2026-12-14"
    );
    if (draft?.proposal.weekSummary.capacity.totalAvailableHours !== 12)
      throw new Error("Future availability not saved");
    if (!draft.draftContext?.extractedItems?.some((item) => item.id === "d"))
      throw new Error("Carried source was not retained in the calendar draft");
    if (
      final.plans.find((row) => row.status === "active")?.proposal.weekSummary.capacity
        .totalAvailableHours !== 20
    )
      throw new Error("Future availability changed active week capacity");
    await page.reload({ waitUntil: "networkidle" });
    await page.getByTestId("sidebar-task-2026-12-14-d").waitFor();
    await page.getByTestId("sidebar-open-2026-12-14").click();
    await page.getByTestId("draft-task-d").waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1))
      throw new Error("Week sidebar overflows on mobile");
    if (
      !(await page
        .getByTestId("weeks-sidebar")
        .locator(":scope > details")
        .evaluate((element) => (element as HTMLDetailsElement).open))
    )
      await page.getByTestId("weeks-sidebar").locator(":scope > details > summary").click();
    await page.getByTestId("sidebar-open-2026-12-07").click();
    await page.getByTestId("active-task-calendar").waitFor();
    if (errors.length) throw new Error(errors.join("\n"));
    console.log(
      "  ✓ Later availability, destination warnings, visible rescheduling, sidebar navigation and future draft recovery verified"
    );
  } finally {
    await context.close();
  }
}
