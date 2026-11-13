import type { Browser, Page } from "playwright";
import { createActiveWeekFixture } from "../tests/fixtures/active-week";
import type { NotionSnapshot } from "../src/application/notion-snapshot";
async function notebook(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open("conscious_tech_db");
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    try {
      return await Promise.all(
        ["plans", "schedules"].map(
          (name) =>
            new Promise((resolve) => {
              const r = db.transaction(name).objectStore(name).getAll();
              r.onsuccess = () => resolve(r.result);
            })
        )
      );
    } finally {
      db.close();
    }
  });
}
/** UI boundary simulation; real HTTP/OAuth/PKCE and vault behavior have separate integration tests. */
export async function verifyNotionConnection(
  browser: Browser,
  url: string,
  output?: string,
  detached = false
) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let connected = false;
  let sendCount = 0;
  let delivered: NotionSnapshot | undefined;
  await context.route("**/api/notion/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.endsWith("/callback")) {
      connected = true;
      await route.fulfill({
        contentType: "text/html",
        body: `<!doctype html><title>Autorización simulada</title><script>${detached ? "" : `window.opener.postMessage({type:"conscious-notion-connected"},${JSON.stringify(new URL(url).origin)});`}window.close();</script>`,
      });
      return;
    }

    if (pathname.endsWith("/status")) {
      await route.fulfill({
        json: { available: true, connected, workspace: connected ? "Prueba simulada" : undefined },
      });
      return;
    }
    if (pathname.endsWith("/connect")) {
      await route.fulfill({
        json: { authorizationUrl: "https://mcp.notion.com/authorize?simulation=1" },
      });
      return;
    }
    if (pathname.endsWith("/disconnect")) {
      connected = false;
      await route.fulfill({ json: { connected: false } });
      return;
    }
    if (pathname.endsWith("/send")) {
      sendCount++;
      delivered = route.request().postDataJSON();
      if (sendCount === 1) {
        await route.fulfill({
          status: 502,
          json: { message: "Notion no responde. Puedes intentarlo de nuevo." },
        });
        return;
      }
      await route.fulfill({
        json: {
          status: "complete",
          sent: delivered!.rows.length,
          url: "https://www.notion.so/a1111111111141118111111111111111",
          message: "Calendario enviado a Notion.",
        },
      });
      return;
    }
    throw new Error("Unexpected Notion app endpoint");
  });
  await context.route("https://mcp.notion.com/authorize**", async (route) => {
    await route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><script>location.href=${JSON.stringify(new URL("/api/notion/callback", url).href)}</script>`,
    });
  });
  try {
    await page.goto(url, { waitUntil: "networkidle" });
    await page.getByTestId("flow-textarea").waitFor();
    const fixture = createActiveWeekFixture();
    fixture.plan.proposal.obligations[0]!.estimatedHours = 5;
    fixture.schedule.timeBlocks = [];
    fixture.schedule.dailyAllocations = [
      { itemId: "c", day: "2026-12-07", allocatedHours: 2 },
      { itemId: "c", day: "2026-12-09", allocatedHours: 2 },
      { itemId: "c", day: "2026-12-11", allocatedHours: 1 },
    ];
    await page.evaluate(async (f) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const r = indexedDB.open("conscious_tech_db");
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(["plans", "schedules"], "readwrite");
          tx.objectStore("plans").put(f.plan);
          tx.objectStore("schedules").put(f.schedule);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
      } finally {
        db.close();
      }
    }, fixture);
    await page.reload({ waitUntil: "networkidle" });
    await page.getByTestId("calendar-task-c-2026-12-07").waitFor();
    const before = JSON.stringify(await notebook(page));
    await page.getByTestId("reminders-and-alerts-summary").click();
    const section = page.getByTestId("notion-connection");
    await section.getByRole("button", { name: "Conectar Notion", exact: true }).click();
    await section.getByTestId("notion-connected").waitFor();
    await section.getByTestId("notion-send-preview").waitFor();
    if (sendCount !== 0) throw new Error("Authorization alone wrote to Notion");
    await section.getByRole("button", { name: "Enviar calendario a Notion", exact: true }).click();
    await section.getByTestId("notion-send-preview").waitFor();
    await section.getByRole("button", { name: "Cancelar", exact: true }).click();
    if (sendCount !== 0) throw new Error("Cancel sent data to Notion");
    await section.getByRole("button", { name: "Enviar calendario a Notion", exact: true }).click();
    await section.getByRole("button", { name: "Confirmar y enviar", exact: true }).click();
    await section.getByRole("alert").getByText("Notion no responde.", { exact: false }).waitFor();
    await section.getByRole("button", { name: "Confirmar y enviar", exact: true }).click();
    await section.getByRole("link", { name: "Abrir calendario en Notion" }).waitFor();
    const portions = delivered!.rows.filter((row) => row.taskId.endsWith("/c"));
    if (
      JSON.stringify(portions.map((row) => [row.date, row.hours])) !==
      JSON.stringify([
        ["2026-12-07", 2],
        ["2026-12-09", 2],
        ["2026-12-11", 1],
      ])
    )
      throw new Error("Notion delivery lost split dates or hours");
    if ("plan" in delivered! || "draftContext" in delivered!)
      throw new Error("Notion delivery contains the complete notebook");
    if (JSON.stringify(await notebook(page)) !== before)
      throw new Error("Notion export changed the notebook");
    await page.setViewportSize({ width: 390, height: 844 });
    if (await section.evaluate((element) => element.scrollWidth > element.clientWidth + 1))
      throw new Error("Notion connection overflows mobile");
    if (output) await page.screenshot({ path: `${output}/notion-connection-mobile.png` });
    await section.getByRole("button", { name: "Desconectar", exact: true }).click();
    await section.getByRole("button", { name: "Conectar Notion", exact: true }).waitFor();
    await page.evaluate(() => {
      window.open = () => null;
    });
    await section.getByRole("button", { name: "Conectar Notion", exact: true }).click();
    await section
      .getByRole("alert")
      .getByText("Permite abrir la ventana", { exact: false })
      .waitFor();
    if (errors.length) throw new Error(errors.join("\n"));
    console.log(
      "  ✓ Notion UI simulation: connect popup, preview, cancel, errors, split delivery, local data conservation, disconnect, blocked popup and mobile verified (no live account)"
    );
  } finally {
    await context.close();
  }
}
