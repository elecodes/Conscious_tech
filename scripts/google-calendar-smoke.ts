import type { Browser } from "playwright";
import { createActiveWeekFixture } from "../tests/fixtures/active-week";
import type { GoogleCalendarExport } from "../src/application/google-calendar-export";
export async function verifyGoogleCalendar(browser: Browser, url: string, output?: string) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let configured = false,
    connected = false,
    sends = 0,
    conflict = false;
  let payload: GoogleCalendarExport | undefined;
  await context.route("**/api/google-calendar/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.endsWith("/status")) {
      await route.fulfill({ json: { configured, connected } });
      return;
    }
    if (pathname.endsWith("/connect")) {
      await route.fulfill({
        json: { authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth?simulation=1" },
      });
      return;
    }
    if (pathname.endsWith("/callback")) {
      connected = true;
      await route.fulfill({
        contentType: "text/html",
        body: `<script>window.opener.postMessage({type:"conscious-google-connected"},${JSON.stringify(new URL(url).origin)});window.close();</script>`,
      });
      return;
    }
    if (pathname.endsWith("/calendars")) {
      await route.fulfill({ json: { calendars: [{ id: "owner", summary: "Personal" }] } });
      return;
    }
    if (pathname.endsWith("/preview")) {
      payload = route.request().postDataJSON();
      await route.fulfill({
        json: {
          nonce: "PREVIEW",
          create: sends ? 2 : 3,
          update: 0,
          remove: 0,
          unchanged: sends ? 1 : 0,
          undated: payload!.snapshot.rows.filter((row) => !row.date).length,
          conflicts: conflict ? 1 : 0,
        },
      });
      return;
    }
    if (pathname.endsWith("/send")) {
      sends++;
      const body = route.request().postDataJSON();
      if (body.nonce !== "PREVIEW") throw new Error("Missing Google preview consent");
      if (sends === 1) {
        await route.fulfill({
          status: 502,
          json: { message: "No se pudo confirmar el envío. Revisa de nuevo." },
        });
        return;
      }
      await route.fulfill({ json: { verified: 3, url: "https://calendar.google.com/" } });
      return;
    }
    if (pathname.endsWith("/disconnect")) {
      connected = false;
      await route.fulfill({ json: { connected: false } });
      return;
    }
    throw new Error("Unexpected Google endpoint");
  });
  await context.route("https://accounts.google.com/o/oauth2/v2/auth**", async (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<script>location.href=${JSON.stringify(new URL("/api/google-calendar/callback", url).href)}</script>`,
    })
  );
  try {
    await page.goto(url, { waitUntil: "networkidle" });
    await page.getByTestId("flow-textarea").waitFor();
    const f = createActiveWeekFixture();
    f.plan.proposal.obligations[0]!.estimatedHours = 5;
    f.schedule.timeBlocks = [];
    f.schedule.dailyAllocations = [
      { itemId: "c", day: "2026-12-07", allocatedHours: 2 },
      { itemId: "c", day: "2026-12-09", allocatedHours: 2 },
      { itemId: "c", day: "2026-12-11", allocatedHours: 1 },
    ];
    await page.evaluate(async (fixture) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const r = indexedDB.open("conscious_tech_db");
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(["plans", "schedules"], "readwrite");
          tx.objectStore("plans").put(fixture.plan);
          tx.objectStore("schedules").put(fixture.schedule);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
      } finally {
        db.close();
      }
    }, f);
    await page.reload({ waitUntil: "networkidle" });
    await page.getByTestId("calendar-task-c-2026-12-07").waitFor();
    await page.getByTestId("reminders-and-alerts-summary").click();
    const section = page.getByTestId("google-calendar-connection");
    await section.getByRole("button", { name: "Conectar Google Calendar", exact: true }).waitFor();
    if (
      !(await section
        .getByRole("button", { name: "Conectar Google Calendar", exact: true })
        .isDisabled())
    )
      throw new Error("Unconfigured Google connection is enabled");
    await section.locator("summary").click();
    await section.getByRole("link", { name: "Abrir credenciales de Google Cloud" }).waitFor();
    configured = true;
    await page.reload({ waitUntil: "networkidle" });
    await page.getByTestId("reminders-and-alerts-summary").click();
    await section.getByRole("button", { name: "Conectar Google Calendar", exact: true }).click();
    await section.getByLabel("Calendario de destino").waitFor();
    await section.getByLabel("Calendario de destino").selectOption("owner");
    await section
      .getByRole("button", { name: "Revisar envío a Google Calendar", exact: true })
      .click();
    await section.getByTestId("google-calendar-preview").waitFor();
    await section
      .getByRole("button", { name: "Cancelar envío a Google Calendar", exact: true })
      .click();
    if (sends) throw new Error("Cancellation sent Google events");
    await section
      .getByRole("button", { name: "Revisar envío a Google Calendar", exact: true })
      .click();
    await section
      .getByRole("button", { name: "Confirmar cambios en Google Calendar", exact: true })
      .click();
    await section.getByRole("alert").getByText("No se pudo confirmar", { exact: false }).waitFor();
    await section
      .getByRole("button", { name: "Revisar envío a Google Calendar", exact: true })
      .click();
    await section
      .getByRole("button", { name: "Confirmar cambios en Google Calendar", exact: true })
      .click();
    await section.getByRole("link", { name: "Abrir Google Calendar", exact: true }).waitFor();
    if (
      JSON.stringify(
        payload!.snapshot.rows
          .filter((row) => row.taskId.endsWith("/c"))
          .map((row) => [row.date, row.hours])
      ) !==
      JSON.stringify([
        ["2026-12-07", 2],
        ["2026-12-09", 2],
        ["2026-12-11", 1],
      ])
    )
      throw new Error("Google preview lost split allocations");
    conflict = true;
    await section
      .getByRole("button", { name: "Revisar envío a Google Calendar", exact: true })
      .click();
    if (
      !(await section
        .getByRole("button", { name: "Confirmar cambios en Google Calendar", exact: true })
        .isDisabled())
    )
      throw new Error("Manual Google changes can be overwritten");
    await section
      .getByRole("button", { name: "Cancelar envío a Google Calendar", exact: true })
      .click();
    await page.setViewportSize({ width: 390, height: 844 });
    if (await section.evaluate((element) => element.scrollWidth > element.clientWidth + 1))
      throw new Error("Google controls overflow mobile");
    if (output)
      await page.screenshot({
        path: `${output}/google-calendar-mobile.png`,
      });
    await section.getByRole("button", { name: "Desconectar Google Calendar", exact: true }).click();
    await section.getByRole("button", { name: "Conectar Google Calendar", exact: true }).waitFor();
    if (errors.length) throw new Error(errors.join("\n"));
    console.log(
      "  ✓ Google Calendar UI simulation: missing configuration, OAuth, owned-calendar selection, preview/cancel, errors, split hours, explicit retry, conflicts, disconnect and mobile (no real account writes)"
    );
  } finally {
    await context.close();
  }
}
