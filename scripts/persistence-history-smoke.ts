import type { Browser, BrowserContext, Page } from "playwright";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createActiveWeekFixture } from "../tests/fixtures/active-week";
import { executeCloseWeekDeterministic } from "../src/skills/close-week/deterministic";

function fixture(id: string, start: string, end: string, closed: boolean) {
  const f = createActiveWeekFixture();
  f.plan.planId = id;
  f.plan.targetWeek = { startDate: start, endDate: end };
  f.plan.proposal.weekSummary.targetWeek = f.plan.targetWeek;
  f.plan.proposal.weekSummary.intent = `Cuaderno ${id}`;
  f.schedule.planId = id;
  f.schedule.scheduleId = `schedule-${id}`;
  f.schedule.weekRange = f.plan.targetWeek;
  f.schedule.timeBlocks = [];
  f.schedule.dailyAllocations = [{ itemId: "a", day: start, allocatedHours: 2 }];
  const closedAt = `${end}T18:00:00Z`;
  const output = executeCloseWeekDeterministic({
    planId: id,
    activePlan: f.plan.proposal,
    schedule: f.schedule,
    closedAt,
    itemOutcomes: [{ itemId: "a", status: "completed" }],
  });
  if (output.status === "invalid_request") throw new Error(output.status);
  return {
    plan: { ...f.plan, status: closed ? ("closed" as const) : ("active" as const) },
    schedule: f.schedule,
    report: {
      reportId: `close-${id}`,
      planId: id,
      scheduleId: f.schedule.scheduleId,
      closedAt,
      output,
    },
  };
}
async function readNotebook(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open("conscious_tech_db");
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    try {
      return await Promise.all(
        ["plans", "schedules", "close_reports"].map(
          (store) =>
            new Promise<unknown[]>((resolve, reject) => {
              const r = db.transaction(store).objectStore(store).getAll();
              r.onsuccess = () => resolve(r.result);
              r.onerror = () => reject(r.error);
            })
        )
      );
    } finally {
      db.close();
    }
  });
}
export async function verifyPersistenceHistory(browser: Browser, url: string, output?: string) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "conscious-history-"));
  let context: BrowserContext | null = null;
  const isolatedServer = http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end("<!doctype html><title>Origin isolation test</title>");
  });
  try {
    context = await browser.browserType().launchPersistentContext(profile, {
      headless: true,
      args: ["--no-sandbox"],
      viewport: { width: 1440, height: 1000 },
    });
    let page = await context.newPage();
    await page.goto(url, { waitUntil: "networkidle" });
    await page.getByTestId("flow-textarea").waitFor();
    await page.getByTestId("settings-dropdown").locator("summary").click();
    await page.getByTestId("settings-open-week-history").click();
    await page
      .getByTestId("week-history")
      .getByText("No hay semanas cerradas todavía.", { exact: false })
      .waitFor();
    await page
      .getByTestId("week-history")
      .getByRole("button", { name: "Cerrar historial", exact: true })
      .click();
    await page.getByTestId("settings-dropdown").locator("summary").click();

    const old = fixture("history-old", "2026-10-12", "2026-10-18", true);
    const recent = fixture("history-recent", "2026-10-19", "2026-10-25", true);
    const active = fixture("persisted-active", "2026-10-26", "2026-11-01", false);
    await page.evaluate(
      async ({ old, recent, active }) => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const r = indexedDB.open("conscious_tech_db");
          r.onsuccess = () => resolve(r.result);
          r.onerror = () => reject(r.error);
        });
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(["plans", "schedules", "close_reports"], "readwrite");
          for (const f of [old, recent, active]) {
            tx.objectStore("plans").put(f.plan);
            tx.objectStore("schedules").put(f.schedule);
          }
          for (const f of [old, recent]) tx.objectStore("close_reports").put(f.report);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
        db.close();
      },
      { old, recent, active }
    );
    await page.reload({ waitUntil: "networkidle" });
    await page.getByTestId("calendar-task-a-2026-10-26").waitFor();
    await page.getByTestId("reminders-and-alerts-summary").click();
    const activeDownloadPromise = page.waitForEvent("download");
    await page.getByTestId("export-notion-button").click();
    const activeDownload = await activeDownloadPromise;
    if (!activeDownload.suggestedFilename().includes("2026-10-26"))
      throw new Error("Notion export selected the wrong active week");
    await page.getByTestId("reminders-and-alerts-summary").click();
    const before = await readNotebook(page);
    await page.getByTestId("open-week-history").click();
    const history = page.getByTestId("week-history");
    await history.getByTestId("history-open-history-old").waitFor();
    await history.getByTestId("history-open-history-recent").waitFor();
    await history.getByTestId("history-open-history-old").click();
    await history.getByText("Semana consultada", { exact: true }).waitFor();
    if (!(await history.innerText()).includes("Cuaderno history-old"))
      throw new Error("Wrong archived week opened");
    if (await history.getByTestId("reopen-closed-week-button").count())
      throw new Error("Reading history offers implicit reactivation");
    const notionDownload = page.waitForEvent("download");
    await history.getByTestId("export-notion-button").click();
    const notionFile = await notionDownload;
    const notionStream = await notionFile.createReadStream();
    const notionChunks: Buffer[] = [];
    for await (const chunk of notionStream!) notionChunks.push(Buffer.from(chunk));
    const notionCsv = Buffer.concat(notionChunks).toString("utf8");
    if (!notionCsv.includes('"10/12/2026"') || !notionCsv.includes('"Completada"'))
      throw new Error("Notion snapshot lost assigned dates or historical completion");
    await history
      .getByTestId("notion-export-help")
      .getByText("Añade una vista", { exact: false })
      .waitFor();
    await history.getByRole("button", { name: "Cerrar historial", exact: true }).click();
    if (JSON.stringify(await readNotebook(page)) !== JSON.stringify(before))
      throw new Error("Reading history modified persisted data");
    await context.close();
    context = null;
    context = await browser.browserType().launchPersistentContext(profile, {
      headless: true,
      args: ["--no-sandbox"],
      viewport: { width: 1440, height: 1000 },
    });
    page = await context.newPage();
    await page.goto(url, { waitUntil: "networkidle" });
    await page.getByTestId("calendar-task-a-2026-10-26").waitFor();
    if (JSON.stringify(await readNotebook(page)) !== JSON.stringify(before))
      throw new Error("Browser restart lost active or historical weeks");
    await page.getByTestId("settings-dropdown").locator("summary").click();
    const origin = await page.getByTestId("storage-origin").innerText();
    if (!origin.includes(new URL(url).origin))
      throw new Error("Storage origin is not explained correctly");
    const downloadPromise = page.waitForEvent("download");
    await page.getByTestId("export-backup-button").click();
    const download = await downloadPromise;
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
    const backup = JSON.parse(Buffer.concat(chunks).toString());
    if (backup.data.plans.length !== 3 || backup.data.closeReports.length !== 2)
      throw new Error("Backup omits history");
    page.once("dialog", (dialog) => dialog.dismiss());
    await page.getByTestId("import-backup-input").setInputFiles({
      name: "test-backup.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(backup)),
    });
    await page.waitForFunction(
      () =>
        !(document.querySelector('[data-testid="import-backup-input"]') as HTMLInputElement)?.value
    );
    if (JSON.stringify(await readNotebook(page)) !== JSON.stringify(before))
      throw new Error("Cancelling restore altered the notebook");
    await page.getByTestId("settings-dropdown").locator("summary").click();
    await new Promise<void>((resolve) => isolatedServer.listen(0, "127.0.0.1", resolve));
    const isolatedPort = (isolatedServer.address() as { port: number }).port;
    const other = await context.newPage();
    await other.goto(`http://127.0.0.1:${isolatedPort}`);
    if (
      await other.evaluate(async () =>
        (await indexedDB.databases()).some((db) => db.name === "conscious_tech_db")
      )
    )
      throw new Error("Different ports unexpectedly share IndexedDB");
    await other.close();
    await page.setViewportSize({ width: 390, height: 844 });
    const sidebarDetails = page.getByTestId("weeks-sidebar").locator(":scope > details");
    if (!(await sidebarDetails.evaluate((element) => (element as HTMLDetailsElement).open)))
      await sidebarDetails.locator("summary").click();
    await page.getByTestId("open-week-history").click();
    const mobileHistory = page.getByTestId("week-history");
    await mobileHistory.getByTestId("history-open-history-old").click();
    const box = await mobileHistory.boundingBox();
    if (!box || box.x < 0 || box.x + box.width > 390)
      throw new Error("History dialog overflows mobile");
    if (await mobileHistory.evaluate((element) => element.scrollWidth > element.clientWidth + 1))
      throw new Error("Archived details overflow the dialog");
    if (output) await page.screenshot({ path: `${output}/week-history-mobile.png` });
    console.log(
      "  ✓ Persistence: full browser restart, past-dated active week, all closed weeks, read-only inspection, backup contents, restore cancellation, port isolation and mobile verified"
    );
  } finally {
    await context?.close();
    if (isolatedServer.listening)
      await new Promise<void>((resolve) => isolatedServer.close(() => resolve()));
    fs.rmSync(profile, { recursive: true, force: true });
  }
}
