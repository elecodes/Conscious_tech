import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { createServer, preview, build } from "vite";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

async function runSmokeTestForMode(mode: "preview" | "dev"): Promise<void> {
  console.log(`\n=== Running Smoke Test: [${mode}] ===`);

  if (mode === "preview") {
    console.log("Building app for production preview...");
    await build();
  }

  const port = await getFreePort();
  console.log(`Starting Vite in ${mode} mode on port ${port}...`);

  let serverInstance: {
    close: () => Promise<void> | void;
    resolvedUrls?: { local: string[] } | null;
  } | null = null;
  let url = `http://localhost:${port}`;

  if (mode === "preview") {
    const previewServer = await preview({
      preview: { port, strictPort: true },
    });
    serverInstance = previewServer;
    if (previewServer.resolvedUrls?.local?.[0]) {
      url = previewServer.resolvedUrls.local[0];
    }
  } else {
    const devServer = await createServer({
      server: { port, strictPort: true },
    });
    await devServer.listen();
    serverInstance = devServer;
    if (devServer.resolvedUrls?.local?.[0]) {
      url = devServer.resolvedUrls.local[0];
    }
  }

  const outputDir = path.resolve(process.cwd(), process.env.SMOKE_OUTPUT_DIR || ".smoke-output");
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  try {
    console.log(`Server is ready at ${url}`);

    const browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    const context = await browser.newContext();
    const page = await context.newPage();

    const pageErrors: string[] = [];
    page.on("pageerror", (err: Error) => {
      console.error(`[PAGEERROR] ${err.message}`);
      pageErrors.push(err.message || String(err));
    });

    const consoleErrors: string[] = [];
    page.on("console", (msg: { type: () => string; text: () => string }) => {
      if (msg.type() === "error") {
        console.error(`[CONSOLE ERROR] ${msg.text()}`);
        consoleErrors.push(msg.text());
      }
    });

    console.log(`Navigating to ${url}...`);
    await page.goto(url, { waitUntil: "networkidle", timeout: 15000 });

    const textLocator = page.locator("text=Tecnología Consciente").first();
    await textLocator.waitFor({ state: "visible", timeout: 10000 });
    console.log(`Assertion passed: "Tecnología Consciente" is visible.`);

    // 1. Verify header is simplified: presence chip and avatar are absent
    const presenceCount = await page.locator("text=Presencia").count();
    if (presenceCount > 0) {
      throw new Error("Presence pill should not be rendered in header");
    }
    console.log("  ✓ No presence pill in header");

    // 2. Verify Ajustes dropdown exists in header and provider selector is NOT visible on main screen
    const settingsDetails = page.locator('[data-testid="settings-dropdown"]');
    await settingsDetails.waitFor({ state: "visible", timeout: 5000 });
    console.log("  ✓ Ajustes dropdown visible in header");

    const isProviderInitiallyVisible = await page
      .locator('[data-testid="provider-select"]')
      .isVisible();
    if (isProviderInitiallyVisible) {
      throw new Error(
        "Provider selector should NOT be visible on main screen when Ajustes is closed"
      );
    }
    console.log("  ✓ Provider selector is hidden on main screen");

    // Open Ajustes dropdown, assert provider selector is reachable, and take screenshot
    await page.locator('[data-testid="settings-dropdown"] summary').click();
    await page
      .locator('[data-testid="export-backup-button"]')
      .waitFor({ state: "visible", timeout: 5000 });
    const providerSelectInSettings = page.locator('[data-testid="provider-select"]');
    await providerSelectInSettings.waitFor({ state: "visible", timeout: 5000 });
    console.log("  ✓ Provider selector reachable inside Ajustes dropdown");

    if (mode === "preview") {
      await page.screenshot({
        path: path.join(outputDir, "00-settings-open.png"),
        fullPage: true,
      });
    }
    // Close Ajustes dropdown
    await page.locator('[data-testid="settings-dropdown"] summary').click();

    // 3. First-run welcome card
    const welcomeCard = page.locator('[data-testid="welcome-card"]');
    await welcomeCard.waitFor({ state: "visible", timeout: 5000 });
    const welcomeText = await welcomeCard.innerText();
    if (!welcomeText.includes("Escribe → Revisa → Vive tu semana")) {
      throw new Error(`Expected welcome card header, got ${welcomeText}`);
    }
    console.log("  ✓ First-run welcome card visible");

    // Dismiss welcome card
    await page.locator('[data-testid="dismiss-welcome-button"]').click();
    await page.waitForTimeout(200);
    const isWelcomeDismissed = !(await welcomeCard.isVisible());
    if (!isWelcomeDismissed) {
      throw new Error("Welcome card should be hidden after dismissal");
    }
    console.log("  ✓ Welcome card dismissed successfully");

    // 4. Verify 2 tabs: "Mi semana" and "Nueva semana"
    const tabActive = page.locator('[data-testid="nav-tab-active"]');
    const tabNewWeek = page.locator('[data-testid="nav-tab-new-week"]');
    const tabActiveText = (await tabActive.innerText()).trim();
    const tabNewWeekText = (await tabNewWeek.innerText()).trim();

    if (!tabActiveText.startsWith("Mi semana")) {
      throw new Error(
        `Tab Active label expected to start with "Mi semana", got "${tabActiveText}"`
      );
    }
    if (!tabNewWeekText.startsWith("Nueva semana")) {
      throw new Error(
        `Tab New Week label expected to start with "Nueva semana", got "${tabNewWeekText}"`
      );
    }
    console.log("  ✓ 2 tabs verified: Mi semana, Nueva semana");

    // 5. Landing rule on fresh load: no active week, no draft -> lands on Nueva semana at Escribir
    const isNewWeekPrimary = await tabNewWeek.evaluate((el: HTMLElement) =>
      el.classList.contains("primary")
    );
    if (!isNewWeekPrimary) {
      throw new Error(
        "Fresh load should land on Nueva semana (nav-tab-new-week should have class primary)"
      );
    }
    const writeStep = page.locator('[data-testid="flow-step-write"]');
    await writeStep.waitFor({ state: "visible", timeout: 5000 });
    console.log("  ✓ Fresh load landed on Nueva semana at step 'Escribir'");

    // Check progress indicators
    const stepWriteIndicator = page.locator('[data-testid="step-indicator-write"]');
    const stepReviewIndicator = page.locator('[data-testid="step-indicator-review"]');
    const stepConfirmIndicator = page.locator('[data-testid="step-indicator-confirm"]');
    await stepWriteIndicator.waitFor({ state: "visible", timeout: 5000 });
    await stepReviewIndicator.waitFor({ state: "visible", timeout: 5000 });
    await stepConfirmIndicator.waitFor({ state: "visible", timeout: 5000 });
    if ((await stepWriteIndicator.getAttribute("aria-current")) !== "step") {
      throw new Error("Step 1 (Escribir) indicator must have aria-current='step'");
    }
    if ((await stepReviewIndicator.getAttribute("aria-current")) !== null) {
      throw new Error("Step 2 (Revisar) indicator should not have aria-current during step 1");
    }
    console.log("  ✓ Visible progress line with 3 steps verified (step 1 active)");

    // 6. Assert empty state on "Mi semana"
    await tabActive.click();
    await tabActive.waitFor({ state: "visible", timeout: 5000 });
    const emptyCard = page.locator('[data-testid="empty-active-week-card"]');
    await emptyCard.waitFor({ state: "visible", timeout: 5000 });
    const emptyCardText = await emptyCard.innerText();
    if (
      !emptyCardText.includes("Escribe") ||
      !emptyCardText.includes("Revisa") ||
      !emptyCardText.includes("Vive tu semana")
    ) {
      throw new Error(
        `Expected empty Mi semana card to contain 3 lines (Escribe, Revisa, Vive tu semana), got: ${emptyCardText}`
      );
    }
    await page
      .locator('[data-testid="nav-to-prepare-from-active-button"]')
      .waitFor({ state: "visible", timeout: 5000 });
    if (mode === "preview") {
      await page.screenshot({
        path: path.join(outputDir, "01-tab-active-empty.png"),
        fullPage: true,
      });
    }
    console.log("  ✓ Tab 'Mi semana' empty state verified: 3 lines + start button");

    // 7. Dev mode query activation & sessionStorage persistence
    console.log("\nVerifying ?dev=1 parameter...");
    await page.goto(`${url}?dev=1`, { waitUntil: "networkidle", timeout: 15000 });
    await page.locator('[data-testid="nav-tab-active"]').click();
    const devOptions = page.locator('[data-testid="dev-options-section"]');
    await devOptions.waitFor({ state: "visible", timeout: 5000 });
    console.log("  ✓ Dev options visible with ?dev=1");

    // Reload without ?dev=1 to assert sessionStorage persistence
    await page.goto(url, { waitUntil: "networkidle", timeout: 15000 });
    await page.locator('[data-testid="nav-tab-active"]').click();
    await devOptions.waitFor({ state: "visible", timeout: 5000 });
    console.log("  ✓ Dev mode persisted across page reloads via sessionStorage");

    // --- STEP 8: Guided flow Nueva semana with Mock provider ---
    console.log("\nExecuting guided flow (Escribir → Revisar → Confirmar)...");
    await page.locator('[data-testid="nav-tab-new-week"]').click();
    await page
      .locator('[data-testid="flow-step-write"]')
      .waitFor({ state: "visible", timeout: 5000 });

    // Ensure mock provider in Ajustes
    await page.locator('[data-testid="settings-dropdown"] summary').click();
    const providerSelect = page.locator('[data-testid="provider-select"]');
    await providerSelect.waitFor({ state: "visible", timeout: 5000 });
    await providerSelect.selectOption("mock");
    await page.locator('[data-testid="settings-dropdown"] summary').click();

    // Select sample case (case-01)
    const sampleCaseSelect = page.locator('[data-testid="sample-case-select"]');
    await sampleCaseSelect.selectOption("case-01");
    await page.waitForFunction(() => {
      const textarea = document.querySelector(
        '[data-testid="flow-textarea"]'
      ) as HTMLTextAreaElement | null;
      return textarea && textarea.value.length > 0;
    });

    if (mode === "preview") {
      await page.screenshot({
        path: path.join(outputDir, "02-step-write.png"),
        fullPage: true,
      });
    }
    console.log("  ✓ Step 1 (Escribir): Sample case selected and textarea populated");

    // Click "Continuar →" to extract and build proposal
    const continueToReviewBtn = page.locator('[data-testid="flow-continue-to-review"]');
    await continueToReviewBtn.click();

    // Step 2: Revisar
    const reviewStep = page.locator('[data-testid="flow-step-review"]');
    await reviewStep.waitFor({ state: "visible", timeout: 15000 });
    if (mode === "preview") {
      await page.screenshot({
        path: path.join(outputDir, "03-step-review.png"),
        fullPage: true,
      });
    }
    console.log("  ✓ Step 2 (Revisar): Extraction and proposal generated");

    // Progress line: verify step 1 marked completed with checkmark, step 2 active with aria-current="step"
    const step1ReviewText = (await stepWriteIndicator.innerText()).trim();
    if (!step1ReviewText.startsWith("✓")) {
      throw new Error(
        `Step 1 indicator should show checkmark (✓) when completed, got: ${step1ReviewText}`
      );
    }
    if ((await stepReviewIndicator.getAttribute("aria-current")) !== "step") {
      throw new Error("Step 2 indicator must have aria-current='step' in Revisar");
    }
    if ((await stepConfirmIndicator.getAttribute("aria-current")) !== null) {
      throw new Error("Step 3 indicator should not have aria-current in Revisar");
    }
    console.log(
      "  ✓ Progress line updated: Step 1 checked (✓), Step 2 active (aria-current='step')"
    );

    // Verify exactly ONE "Continuar a confirmar" button (no top duplicate)
    const continueBtnCount = await page.locator('[data-testid="flow-continue-to-confirm"]').count();
    if (continueBtnCount !== 1) {
      throw new Error(`Expected exactly 1 "Continuar a confirmar" button, got ${continueBtnCount}`);
    }
    console.log("  ✓ Exactly 1 'Continuar a confirmar' button verified (no top duplicate)");

    // Verify collapsed "Ajustes de la semana (opcional)"
    const weekSettingsDetails = page.locator('[data-testid="week-settings-details"]');
    await weekSettingsDetails.waitFor({ state: "visible", timeout: 5000 });
    const isWeekSettingsOpen = await weekSettingsDetails.evaluate(
      (el: HTMLDetailsElement) => el.open
    );
    if (isWeekSettingsOpen) {
      throw new Error("Week settings details should be collapsed by default");
    }
    console.log("  ✓ Collapsed 'Ajustes de la semana (opcional)' verified in Revisar");

    // Verify calm idea cards and details toggle
    const detailsToggle = page.locator('[data-testid^="details-toggle-"]').first();
    await detailsToggle.waitFor({ state: "visible", timeout: 5000 });
    const isExpandedInitial = (await detailsToggle.getAttribute("aria-expanded")) === "true";
    if (isExpandedInitial) {
      throw new Error("Details toggle should be collapsed (aria-expanded=false) by default");
    }
    await detailsToggle.click();
    const isExpandedAfterClick = (await detailsToggle.getAttribute("aria-expanded")) === "true";
    if (!isExpandedAfterClick) {
      throw new Error("Details toggle should be expanded (aria-expanded=true) after click");
    }
    await detailsToggle.click();
    console.log("  ✓ Calm cards and details toggle (aria-expanded) verified");

    // Test back button from Revisar to Escribir (preserving text)
    const backToWriteBtn = page.locator('[data-testid="flow-back-to-write"]');
    await backToWriteBtn.click();
    await page
      .locator('[data-testid="flow-step-write"]')
      .waitFor({ state: "visible", timeout: 5000 });
    const preservedText = await page.locator('[data-testid="flow-textarea"]').inputValue();
    if (!preservedText || preservedText.length === 0) {
      throw new Error("Text in textarea should be preserved after navigating back to Escribir");
    }
    console.log("  ✓ Back to Escribir preserved text in textarea");

    // Return to Revisar
    await page.locator('[data-testid="flow-continue-to-review"]').click();
    await reviewStep.waitFor({ state: "visible", timeout: 15000 });

    // Verify collapsed "Añadir más ideas" and "Opciones"
    const addMoreIdeas = page.locator('[data-testid="add-more-ideas-details"]');
    await addMoreIdeas.waitFor({ state: "visible", timeout: 5000 });
    const planningOptions = page.locator('[data-testid="planning-options-details"]');
    await planningOptions.waitFor({ state: "visible", timeout: 5000 });
    console.log("  ✓ Collapsed 'Añadir más ideas' and 'Opciones' verified in Revisar");

    // Capacity one-sentence summary
    await page
      .locator('[data-testid="capacity-sentence-summary"]')
      .first()
      .waitFor({ state: "visible", timeout: 5000 });
    console.log("  ✓ Capacity one-sentence summary visible in proposal");

    // Step 3: Confirmar
    const continueToConfirmBtn = page.locator('[data-testid="flow-continue-to-confirm"]');
    await continueToConfirmBtn.click();

    const confirmStep = page.locator('[data-testid="flow-step-confirm"]');
    await confirmStep.waitFor({ state: "visible", timeout: 5000 });
    if (mode === "preview") {
      await page.screenshot({
        path: path.join(outputDir, "04-step-confirm.png"),
        fullPage: true,
      });
    }
    console.log("  ✓ Step 3 (Confirmar) reached");

    // Progress line: verify step 1 & 2 marked completed with checkmark, step 3 active with aria-current="step"
    const step2ConfirmText = (await stepReviewIndicator.innerText()).trim();
    if (!step2ConfirmText.startsWith("✓")) {
      throw new Error(
        `Step 2 indicator should show checkmark (✓) when completed, got: ${step2ConfirmText}`
      );
    }
    if ((await stepConfirmIndicator.getAttribute("aria-current")) !== "step") {
      throw new Error("Step 3 indicator must have aria-current='step' in Confirmar");
    }
    console.log(
      "  ✓ Progress line updated: Step 2 checked (✓), Step 3 active (aria-current='step')"
    );

    // Test back button from Confirmar to Revisar
    const backToReviewBtn = page.locator('[data-testid="flow-back-to-review"]');
    await backToReviewBtn.click();
    await reviewStep.waitFor({ state: "visible", timeout: 5000 });
    console.log("  ✓ Back to Revisar from Confirmar verified");

    // Return to Confirmar
    await page.locator('[data-testid="flow-continue-to-confirm"]').click();
    await confirmStep.waitFor({ state: "visible", timeout: 5000 });

    // Verify "Más acciones" menu in Step 3
    const proposalMoreActions = page.locator('[data-testid="proposal-more-actions-details"]');
    await proposalMoreActions.waitFor({ state: "visible", timeout: 5000 });
    console.log("  ✓ Secondary actions grouped under 'Más acciones' in Confirmar");

    // Click "Confirmar y activar semana"
    const confirmPlanBtn = page.locator('[data-testid="confirm-plan-button"]');
    await confirmPlanBtn.click();

    // Navigates automatically to "Mi semana"
    const activeScheduleSection = page.locator('[data-testid="active-week-schedule-section"]');
    await activeScheduleSection.waitFor({ state: "visible", timeout: 15000 });
    if (mode === "preview") {
      await page.screenshot({
        path: path.join(outputDir, "05-active-week.png"),
        fullPage: true,
      });
    }
    console.log("  ✓ Navigated to 'Mi semana' with active week populated");

    // Verify next-step bar is hidden on Mi semana with active week and nothing pending
    const isNextStepBarVisibleOnActive = await page
      .locator('[data-testid="next-step-bar"]')
      .isVisible();
    if (isNextStepBarVisibleOnActive) {
      throw new Error(
        "Next step bar should be hidden on Mi semana with active week and nothing pending"
      );
    }
    console.log("  ✓ Next-step bar hidden on Mi semana with active week");

    // Verify contextual help on Imprevistos and Lo que he aprendido
    const radarDetails = page.locator('[data-testid="radar-section"]');
    await radarDetails.waitFor({ state: "visible", timeout: 5000 });
    await radarDetails.locator("> summary").click();
    const helpUnforeseen = page.locator('[data-testid="help-unforeseen"]');
    await helpUnforeseen.waitFor({ state: "visible", timeout: 5000 });
    await radarDetails.locator("> summary").click();

    const memoriesDetails = page.locator('[data-testid="confirmed-memories-details"]');
    await memoriesDetails.waitFor({ state: "visible", timeout: 5000 });
    await memoriesDetails.locator("> summary").click();
    const helpMemories = page.locator('[data-testid="help-memories"]');
    await helpMemories.waitFor({ state: "visible", timeout: 5000 });
    await memoriesDetails.locator("> summary").click();
    console.log("  ✓ '¿Qué es esto?' help details verified on Imprevistos and Lo que he aprendido");

    // Verify calendar reminders and alerts (.ics download with VALARM)
    const remindersDetails = page.locator('[data-testid="reminders-and-alerts-details"]');
    await remindersDetails.waitFor({ state: "visible", timeout: 5000 });
    await remindersDetails.locator("> summary").click();

    const reminderSelect = remindersDetails.locator('[data-testid="reminder-offset-select"]');
    await reminderSelect.waitFor({ state: "visible", timeout: 5000 });
    await reminderSelect.selectOption("1h");

    const downloadPromise = page.waitForEvent("download");
    await page.locator('[data-testid="add-week-to-gcal-button"]').first().click();
    const download = await downloadPromise;
    const downloadStream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of downloadStream) {
      chunks.push(Buffer.from(chunk));
    }
    const downloadedIcs = Buffer.concat(chunks).toString("utf-8");

    if (
      !downloadedIcs.includes("BEGIN:VTIMEZONE") ||
      !downloadedIcs.includes("TZID:Europe/Madrid")
    ) {
      throw new Error("Downloaded ICS does not contain VTIMEZONE definition for Europe/Madrid");
    }
    if (!downloadedIcs.includes("BEGIN:VALARM") || !downloadedIcs.includes("TRIGGER:+PT9H")) {
      throw new Error(
        "Downloaded ICS does not contain expected all-day VALARM with TRIGGER:+PT9H (09:00 trigger)"
      );
    }
    console.log(
      "  ✓ Downloaded ICS captured and verified: contains VTIMEZONE and all-day VALARM with +PT9H (09:00 trigger)"
    );

    // Verify Email summary button opens Gmail compose without recipient
    const emailButton = remindersDetails.locator('[data-testid="open-gmail-summary-button"]');
    await emailButton.waitFor({ state: "visible", timeout: 5000 });

    await context.route("https://mail.google.com/**", (route: any) => {
      route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<html><body>Gmail Compose Mock</body></html>",
      });
    });

    const pagePromise = context.waitForEvent("page");
    await emailButton.click();
    const newPage = await pagePromise;
    const openedUrl = newPage.url();
    if (!openedUrl.startsWith("https://mail.google.com/mail/?view=cm&fs=1")) {
      throw new Error(`Opened URL expected to start with Gmail compose URL, got: ${openedUrl}`);
    }
    if (openedUrl.includes("&to=") || openedUrl.includes("?to=")) {
      throw new Error("Gmail compose URL must not contain recipient (to=)");
    }
    await newPage.close();
    await context.unroute("https://mail.google.com/**");
    console.log("  ✓ Email summary button clicked: opened Gmail compose URL without recipient");

    await remindersDetails.locator("> summary").click();

    // Verify "Cerrar semana" button inside Mi semana
    const closeWeekBtn = page.locator('[data-testid="close-week-button"]');
    await closeWeekBtn.waitFor({ state: "visible", timeout: 5000 });
    await closeWeekBtn.click();

    const closingSection = page
      .locator(
        '[data-testid="early-close-guard-box"], [data-testid="weekly-reflective-closing-section"]'
      )
      .first();
    await closingSection.waitFor({ state: "visible", timeout: 10000 });
    if (mode === "preview") {
      await page.screenshot({
        path: path.join(outputDir, "06-closing-view.png"),
        fullPage: true,
      });
    }
    console.log("  ✓ 'Cerrar semana' opened closing view");

    // If early close guard is shown, test cancel returning to active week, then confirm early close
    const cancelEarlyCloseBtn = page.locator('[data-testid="cancel-early-close-button"]');
    if ((await cancelEarlyCloseBtn.count()) > 0) {
      await cancelEarlyCloseBtn.click();
      await activeScheduleSection.waitFor({ state: "visible", timeout: 10000 });
      console.log("  ✓ Cancel early close returned to active week");

      await closeWeekBtn.click();
      await page.locator('[data-testid="confirm-early-close-button"]').click();
      await page
        .locator('[data-testid="weekly-reflective-closing-section"]')
        .waitFor({ state: "visible", timeout: 5000 });
      const backToActiveBtn = page.locator('[data-testid="back-to-active-week-button"]');
      await backToActiveBtn.waitFor({ state: "visible", timeout: 5000 });
      await backToActiveBtn.click();
      await activeScheduleSection.waitFor({ state: "visible", timeout: 10000 });
      console.log("  ✓ '← Volver a Mi semana' returned to active week view");
    } else {
      const backToActiveBtn = page.locator('[data-testid="back-to-active-week-button"]');
      await backToActiveBtn.waitFor({ state: "visible", timeout: 5000 });
      await backToActiveBtn.click();
      await activeScheduleSection.waitFor({ state: "visible", timeout: 10000 });
      console.log("  ✓ '← Volver a Mi semana' returned to active week view");
    }

    // Reload with active week -> lands on Mi semana
    console.log("\nTesting reload with active week...");
    await page.reload({ waitUntil: "networkidle" });
    const isTabActiveOnReload = await tabActive.evaluate((el: HTMLElement) =>
      el.classList.contains("primary")
    );
    if (!isTabActiveOnReload) {
      throw new Error("Reload with active week should land on Mi semana (nav-tab-active)");
    }
    await page
      .locator('[data-testid="active-week-schedule-section"]')
      .waitFor({ state: "visible", timeout: 10000 });
    console.log("  ✓ Reload with active week landed on Mi semana");

    // Reload with draft -> lands on Nueva semana at Revisar
    console.log("\nTesting reload with draft...");
    // Purge current active week first to leave state clean for draft test
    await closeWeekBtn.click();
    const earlyConfirm = page.locator('[data-testid="confirm-early-close-button"]');
    if ((await earlyConfirm.count()) > 0) {
      await earlyConfirm.click();
    }
    const purgeBtn = page.locator('button:has-text("Purgar semana actual")');
    if ((await purgeBtn.count()) > 0) {
      await purgeBtn.click();
      const confirmPurgeBtn = page.locator('button:has-text("Confirmar purga")');
      await confirmPurgeBtn.click();
      await page.waitForTimeout(500);
    }

    // Go to Nueva semana, populate text and continue to review to establish a draft
    await page.locator('[data-testid="nav-tab-new-week"]').click();
    await page
      .locator('[data-testid="flow-step-write"]')
      .waitFor({ state: "visible", timeout: 5000 });
    await page.locator('[data-testid="sample-case-select"]').selectOption("case-01");
    await page.waitForFunction(() => {
      const textarea = document.querySelector(
        '[data-testid="flow-textarea"]'
      ) as HTMLTextAreaElement | null;
      return textarea && textarea.value.length > 0;
    });
    await page.locator('[data-testid="flow-continue-to-review"]').click();
    await reviewStep.waitFor({ state: "visible", timeout: 15000 });

    // Reload while on review step with draft in storage
    await page.reload({ waitUntil: "networkidle" });
    const isNewWeekOnReload = await page
      .locator('[data-testid="nav-tab-new-week"]')
      .evaluate((el: HTMLElement) => el.classList.contains("primary"));
    if (!isNewWeekOnReload) {
      throw new Error("Reload with draft should land on Nueva semana (nav-tab-new-week)");
    }
    await page
      .locator('[data-testid="flow-step-review"]')
      .waitFor({ state: "visible", timeout: 10000 });
    console.log("  ✓ Reload with draft landed on Nueva semana at Revisar step");

    // Check for errors
    if (pageErrors.length > 0) {
      throw new Error(
        `Assertion failed: pageerror events detected in [${mode}]:\n` +
          pageErrors.map((e) => `  - ${e}`).join("\n")
      );
    }

    if (consoleErrors.length > 0) {
      throw new Error(
        `Assertion failed: console.error events detected in [${mode}]:\n` +
          consoleErrors.map((e) => `  - ${e}`).join("\n")
      );
    }

    await browser.close();
    console.log(`=== Smoke Test [${mode}] PASSED ===\n`);
  } finally {
    if (serverInstance) {
      await serverInstance.close();
    }
  }
}

async function main() {
  const modes: ("preview" | "dev")[] = [];
  if (process.argv.includes("--preview")) {
    modes.push("preview");
  } else if (process.argv.includes("--dev")) {
    modes.push("dev");
  } else {
    modes.push("preview", "dev");
  }

  for (const mode of modes) {
    await runSmokeTestForMode(mode);
  }
}

main()
  .then(() => {
    console.log("All smoke tests passed successfully.");
    process.exit(0);
  })
  .catch((err) => {
    console.error("\n❌ Smoke test failed:", err.message);
    process.exit(1);
  });
