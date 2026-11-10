import type { Browser } from "playwright";

/** Isolated synthetic flows: never contact a real AI service. */
export async function verifyPlanningContext(browser: Browser, url: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let remoteCalls = 0;
  await page.route("**/api/ai", async (route) => {
    remoteCalls++;
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "Synthetic provider unavailable" }),
    });
  });
  try {
    await page.goto(url, { waitUntil: "networkidle" });
    await page
      .getByTestId("flow-textarea")
      .fill("Preparar un informe personal (2 horas). Leer un artículo (1 hora).");
    await page.getByTestId("capture-available-hours").fill("8");
    await page.getByText("Cambiar fechas o espacio protegido", { exact: true }).click();
    await page.getByTestId("capture-week-start").fill("2026-12-07");
    await page.getByTestId("capture-week-end").fill("2026-12-13");
    await page.waitForFunction(
      () =>
        JSON.parse(localStorage.getItem("conscious_tech_transient_planning_context") || "{}")
          .targetWeekEnd === "2026-12-13"
    );
    await page.reload({ waitUntil: "networkidle" });
    if ((await page.getByTestId("capture-available-hours").inputValue()) !== "8")
      throw new Error("Pre-proposal hours were not restored");
    await page.getByText("Cambiar fechas o espacio protegido", { exact: true }).click();
    if ((await page.getByTestId("capture-week-end").inputValue()) !== "2026-12-13")
      throw new Error("Pre-proposal dates were not restored");

    // Invalid input is rejected before an AI request, preserving notes and the write step.
    await page.getByTestId("settings-dropdown").locator("summary").click();
    await page.getByTestId("provider-select").selectOption("groq");
    await page.getByTestId("settings-dropdown").locator("summary").click();
    await page.getByTestId("capture-available-hours").fill("-1");
    await page.getByTestId("flow-continue-to-review").click();
    await page.getByTestId("flow-error").waitFor();
    if (remoteCalls !== 0) throw new Error("Invalid capacity contacted an AI service");
    if (!(await page.getByTestId("flow-step-write").isVisible()))
      throw new Error("Invalid capacity left capture");

    await page.getByTestId("settings-dropdown").locator("summary").click();
    await page.getByTestId("provider-select").selectOption("mock");
    await page.getByTestId("settings-dropdown").locator("summary").click();
    await page.getByTestId("capture-available-hours").fill("8");
    await page.getByTestId("capture-week-end").fill("2026-12-06");
    await page.getByTestId("flow-continue-to-review").click();
    await page.getByTestId("flow-error").filter({ hasText: "Elige fechas válidas" }).waitFor();
    await page.getByTestId("capture-week-end").fill("2026-12-13");
    await page.getByTestId("capture-protected-space").fill("101");
    await page.getByTestId("flow-continue-to-review").click();
    await page.getByTestId("flow-error").filter({ hasText: "Indica horas válidas" }).waitFor();
    await page.getByTestId("capture-protected-space").fill("25");
    await page.getByTestId("flow-continue-to-review").click();
    await page.getByTestId("flow-step-review").waitFor();
    if (!(await page.getByTestId("capacity-sentence-summary").innerText()).includes("8"))
      throw new Error("Proposal lost provided capacity");

    // Older persisted drafts without context must remain editable and retain their capacity.
    await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("conscious_tech_db");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction("plans", "readwrite");
          const store = tx.objectStore("plans");
          const request = store.get("draft-2026-12-07");
          request.onsuccess = () => {
            const draft = request.result;
            delete draft.draftContext;
            store.put(draft);
          };
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
      } finally {
        db.close();
      }
    });
    await page.reload({ waitUntil: "networkidle" });
    await page.getByTestId("flow-step-review").waitFor();
    await page.getByTestId("week-settings-summary").click();
    if ((await page.getByTestId("planning-available-hours-input").inputValue()) !== "8")
      throw new Error("Legacy draft lost capacity");
    await page.getByTestId("week-settings-summary").click();

    // Importing the same calendar twice must not subtract commitments from net free hours.
    await page.getByTestId("planning-options-details").locator(":scope > summary").click();
    await page.getByRole("button", { name: "Conectar / Sincronizar", exact: true }).click();
    const calendarFile = {
      name: "synthetic-calendar.ics",
      mimeType: "text/calendar",
      buffer: Buffer.from(
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:synthetic-meeting\r\nDTSTART:20261208T100000\r\nDTEND:20261208T120000\r\nSUMMARY:Synthetic meeting\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n"
      ),
    };
    await page.getByTestId("ical-file-input").setInputFiles(calendarFile);
    await page.getByText("2h comprometidas en reuniones", { exact: true }).waitFor();
    await page.getByTestId("ical-file-input").setInputFiles(calendarFile);
    await page.getByTestId("week-settings-summary").click();
    if ((await page.getByTestId("planning-available-hours-input").inputValue()) !== "8")
      throw new Error("Calendar import changed net free hours");
    await page.getByTestId("week-settings-summary").click();
    await page.getByTestId("planning-options-details").locator(":scope > summary").click();

    // Failed regeneration through the progress indicator must not expose activation.
    await page.getByTestId("week-settings-summary").click();
    await page.getByTestId("planning-available-hours-input").fill("10");
    await page.getByTestId("settings-dropdown").locator("summary").click();
    await page.getByTestId("provider-select").selectOption("groq");
    await page.getByTestId("settings-dropdown").locator("summary").click();
    await page.getByTestId("step-indicator-confirm").click();
    await page.getByRole("alert").filter({ hasText: "Error de planificación:" }).waitFor();
    if (!(await page.getByTestId("flow-step-review").isVisible()))
      throw new Error("Failed regeneration advanced to confirmation");
    if (await page.getByTestId("flow-step-confirm").isVisible())
      throw new Error("Stale proposal can be confirmed");
    if (remoteCalls === 0) throw new Error("Synthetic provider failure was not exercised");

    // Retry with the deterministic provider and verify estimates also invalidate the proposal.
    await page.getByTestId("settings-dropdown").locator("summary").click();
    await page.getByTestId("provider-select").selectOption("mock");
    await page.getByTestId("settings-dropdown").locator("summary").click();
    await page.getByTestId("flow-continue-to-confirm").click();
    await page.getByTestId("flow-step-confirm").waitFor();
    await page.getByTestId("flow-back-to-review").click();
    const firstDetails = page.locator('[data-testid^="details-toggle-"]').first();
    await firstDetails.click();
    await page
      .getByRole("spinbutton", { name: /^Horas estimadas para/ })
      .first()
      .fill("3");
    await page.getByTestId("proposal-dirty-banner").waitFor();
    await page.getByTestId("update-proposal-button").click();
    await page.getByTestId("proposal-dirty-banner").waitFor({ state: "hidden" });
    await page
      .getByLabel(/^Fecha límite para/)
      .first()
      .fill("2026-12-10");
    await page.getByTestId("proposal-dirty-banner").waitFor();

    // An explicit unknown choice must remain provisional, including after reload.
    await page.getByTestId("flow-back-to-write").click();
    await page.getByText("Cambiar fechas o espacio protegido", { exact: true }).click();
    await page.getByTestId("capture-week-start").fill("2026-12-08");
    await page.getByRole("button", { name: "No lo sé todavía", exact: true }).click();
    await page.getByTestId("flow-continue-to-review").click();
    await page.getByTestId("flow-step-review").waitFor();
    await page.locator('[data-testid^="details-toggle-"]').first().click();
    if (
      (await page
        .getByRole("spinbutton", { name: /^Horas estimadas para/ })
        .first()
        .inputValue()) !== "3"
    )
      throw new Error("Changing capacity discarded a corrected estimate");
    if (
      !(await page.getByTestId("capacity-sentence-summary").innerText()).includes(
        "Propuesta provisional"
      )
    )
      throw new Error("Unknown capacity was presented as verified");
    await page.reload({ waitUntil: "networkidle" });
    await page.getByTestId("flow-step-review").waitFor();
    if (
      !(await page.getByTestId("capacity-sentence-summary").innerText()).includes(
        "Propuesta provisional"
      )
    )
      throw new Error("Unknown capacity changed on reload");
    await page.getByTestId("flow-back-to-write").click();
    await page.getByTestId("capture-available-hours").fill("0");
    await page.getByTestId("flow-continue-to-review").click();
    await page.getByTestId("flow-step-review").waitFor();
    if (
      !(await page.getByTestId("capacity-sentence-summary").innerText()).includes(
        "Tienes 0 h libres"
      )
    )
      throw new Error("Zero capacity was treated as unknown");
    await page.getByTestId("flow-continue-to-confirm").click();
    await page.getByRole("button", { name: "Confirmar y activar semana", exact: true }).click();
    await page.getByRole("heading", { name: "Mi semana", exact: true }).waitFor();
    if (!(await page.getByTestId("capacity-compact-bar").innerText()).includes("Tienes 0 h libres"))
      throw new Error("Active week lost zero capacity");
    if (
      (await page.evaluate(() =>
        localStorage.getItem("conscious_tech_transient_planning_context")
      )) !== null
    )
      throw new Error("Activated week left stale transient context");
    if (errors.length) throw new Error(errors.join("\n"));
    console.log(
      "  ✓ Planning context: validation, restoration, unknown/zero capacity and failed regeneration verified"
    );
  } finally {
    await context.close();
  }
}
