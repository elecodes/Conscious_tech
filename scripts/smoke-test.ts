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

  const outputDir = path.resolve(process.cwd(), "docs/ui-pr-b");
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

    // PR B checks:
    // 1. Verify header is simplified: presence chip and avatar are absent
    const presenceCount = await page.locator("text=Presencia").count();
    if (presenceCount > 0) {
      throw new Error("Presence pill should not be rendered in header");
    }
    console.log("  ✓ No presence pill in header");

    // 2. Verify Ajustes dropdown exists in header
    const settingsDetails = page.locator('[data-testid="settings-dropdown"]');
    await settingsDetails.waitFor({ state: "visible", timeout: 5000 });
    console.log("  ✓ Ajustes dropdown visible in header");

    // Open Ajustes dropdown and take screenshot
    await page.locator('[data-testid="settings-dropdown"] summary').click();
    await page
      .locator('[data-testid="export-backup-button"]')
      .waitFor({ state: "visible", timeout: 5000 });
    if (mode === "preview") {
      await page.screenshot({
        path: path.join(outputDir, "00-settings-open.png"),
        fullPage: true,
      });
    }
    // Close Ajustes dropdown
    await page.locator('[data-testid="settings-dropdown"] summary').click();

    // 3. Verify plain tab labels without numbers
    const tabCapture = page.locator('[data-testid="nav-tab-capture"]');
    const tabPrepare = page.locator('[data-testid="nav-tab-prepare"]');
    const tabActive = page.locator('[data-testid="nav-tab-active"]');
    const tabReview = page.locator('[data-testid="nav-tab-review"]');
    const tabCaptureText = (await tabCapture.innerText()).trim();
    const tabPrepareText = (await tabPrepare.innerText()).trim();
    const tabActiveText = (await tabActive.innerText()).trim();
    const tabReviewText = (await tabReview.innerText()).trim();

    if (tabCaptureText !== "Ideas")
      throw new Error(`Tab 1 label expected "Ideas", got "${tabCaptureText}"`);
    if (tabPrepareText !== "Planificar")
      throw new Error(`Tab 2 label expected "Planificar", got "${tabPrepareText}"`);
    if (tabActiveText !== "Mi semana")
      throw new Error(`Tab 3 label expected "Mi semana", got "${tabActiveText}"`);
    if (tabReviewText !== "Cierre")
      throw new Error(`Tab 4 label expected "Cierre", got "${tabReviewText}"`);
    console.log("  ✓ Simplified tab labels: Ideas, Planificar, Mi semana, Cierre");

    // 4. Verify provider select is NOT visible for normal user
    const normalProviderCount = await page.locator('[data-testid="provider-select"]').count();
    if (normalProviderCount > 0) {
      throw new Error("Provider selector should NOT be visible in normal mode without ?dev=1");
    }
    console.log("  ✓ Provider select hidden for normal users");

    // --- STEP 1: Assert empty states on all 4 tabs & capture screenshots ---
    console.log("\nVerifying 4 main tabs navigation and empty states...");

    // 1. Tab 1: Ideas
    await tabCapture.click();
    await page
      .locator('[data-testid="extract-dump-button"]')
      .waitFor({ state: "visible", timeout: 5000 });
    if (mode === "preview") {
      await page.screenshot({
        path: path.join(outputDir, "01-tab-capture-empty.png"),
        fullPage: true,
      });
    }
    console.log("  ✓ Tab 1 (Ideas) rendered without errors");

    // 2. Tab 2: Planificar
    await tabPrepare.click();
    await tabPrepare.waitFor({ state: "visible", timeout: 5000 });
    if (mode === "preview") {
      await page.screenshot({
        path: path.join(outputDir, "02-tab-prepare-empty.png"),
        fullPage: true,
      });
    }
    console.log("  ✓ Tab 2 (Planificar) rendered without errors");

    // 3. Tab 3: Mi semana
    await tabActive.click();
    await tabActive.waitFor({ state: "visible", timeout: 5000 });
    if (mode === "preview") {
      await page.screenshot({
        path: path.join(outputDir, "03-tab-active-empty.png"),
        fullPage: true,
      });
    }
    console.log("  ✓ Tab 3 (Mi semana) rendered without errors");

    // 4. Tab 4: Cierre
    await tabReview.click();
    await tabReview.waitFor({ state: "visible", timeout: 5000 });
    if (mode === "preview") {
      await page.screenshot({
        path: path.join(outputDir, "04-tab-review-empty.png"),
        fullPage: true,
      });
    }
    console.log("  ✓ Tab 4 (Cierre) rendered without errors");

    // --- STEP 2: Dev mode query activation & Full flow with Mock provider ---
    console.log("\nVerifying ?dev=1 parameter and executing Mock planning flow...");

    // Activate dev mode via URL parameter
    await page.goto(`${url}?dev=1`, { waitUntil: "networkidle", timeout: 15000 });
    const providerSelect = page.locator('[data-testid="provider-select"]');
    await providerSelect.waitFor({ state: "visible", timeout: 5000 });
    console.log("  ✓ Provider select visible with ?dev=1");

    // Reload without ?dev=1 to assert sessionStorage persistence
    await page.goto(url, { waitUntil: "networkidle", timeout: 15000 });
    await providerSelect.waitFor({ state: "visible", timeout: 5000 });
    console.log("  ✓ Dev mode persisted across page reloads via sessionStorage");

    // Go to Tab 1 (Ideas)
    await page.locator('[data-testid="nav-tab-capture"]').click();

    // Ensure Mock provider is selected
    await providerSelect.selectOption("mock");

    // Pick sample case (case-01)
    const sampleCaseSelect = page.locator('[data-testid="sample-case-select"]');
    await sampleCaseSelect.selectOption("case-01");
    // Wait until text area has been populated
    await page.waitForFunction(() => {
      const textarea = document.querySelector("textarea") as HTMLTextAreaElement | null;
      return textarea && textarea.value.length > 0;
    });

    if (mode === "preview") {
      await page.screenshot({
        path: path.join(outputDir, "05-capture-sample-selected.png"),
        fullPage: true,
      });
    }
    console.log("  ✓ Sample case selected");

    // Click "Extraer"
    const extractBtn = page.locator('[data-testid="extract-dump-button"]');
    await extractBtn.click();

    // Wait for extracted items and "Preparar semana con estos elementos" button
    const prepareWeekBtn = page.locator('[data-testid="prepare-week-from-extracted-button"]');
    await prepareWeekBtn.waitFor({ state: "visible", timeout: 15000 });

    if (mode === "preview") {
      await page.screenshot({
        path: path.join(outputDir, "06-capture-extracted.png"),
        fullPage: true,
      });
    }
    console.log("  ✓ Extraction completed with items");

    // Click "Preparar semana"
    await prepareWeekBtn.click();

    // Wait for Tab 2 to open and the proposal button to be visible
    const generateProposalBtn = page.locator('[data-testid="generate-proposal-button"]');
    await generateProposalBtn.waitFor({ state: "visible", timeout: 15000 });

    if (mode === "preview") {
      await page.screenshot({
        path: path.join(outputDir, "07-prepare-transferred-items.png"),
        fullPage: true,
      });
    }
    console.log("  ✓ Transferred to Planificar");

    // Click "Analizar" / "Generar propuesta semanal"
    await generateProposalBtn.click();

    // Wait for proposal to be reached
    const confirmPlanBtn = page.locator('[data-testid="confirm-plan-button"]');
    await confirmPlanBtn.waitFor({ state: "visible", timeout: 15000 });
    const proposalScreen = page.locator('[data-testid="weekly-proposal-screen"]');
    await proposalScreen.waitFor({ state: "visible", timeout: 15000 });

    if (mode === "preview") {
      await page.screenshot({
        path: path.join(outputDir, "08-proposal-screen.png"),
        fullPage: true,
      });
    }
    console.log("  ✓ Weekly proposal reached and verified");

    // Click "Confirmar y activar semana"
    await confirmPlanBtn.click();

    // Wait for "Mi semana" to show the active week
    const activeScheduleSection = page.locator('[data-testid="active-week-schedule-section"]');
    await activeScheduleSection.waitFor({ state: "visible", timeout: 15000 });

    const statusBadge = page.locator('[data-testid="process-status-badge"]');
    await statusBadge.waitFor({ state: "visible", timeout: 10000 });

    // Assert PR B renamed jargon in active week
    await page.locator("text=Lo que he aprendido").waitFor({ state: "visible", timeout: 5000 });
    await page
      .locator("text=Imprevistos: ¿Ha aparecido algo nuevo?")
      .waitFor({ state: "visible", timeout: 5000 });
    console.log("  ✓ Jargon replacements verified: 'Lo que he aprendido' and 'Imprevistos'");

    if (mode === "preview") {
      await page.screenshot({
        path: path.join(outputDir, "09-active-week-populated.png"),
        fullPage: true,
      });
      await page.screenshot({ path: "screenshot.png", fullPage: true });
    }
    console.log("  ✓ Active week confirmed and populated in Mi semana");

    // Open Tab 4: Cierre with active week
    await page.locator('[data-testid="nav-tab-review"]').click();
    const closingSection = page
      .locator(
        '[data-testid="early-close-guard-box"], [data-testid="weekly-reflective-closing-section"]'
      )
      .first();
    await closingSection.waitFor({ state: "visible", timeout: 10000 });

    if (mode === "preview") {
      await page.screenshot({
        path: path.join(outputDir, "10-review-with-active-week.png"),
        fullPage: true,
      });
    }
    console.log("  ✓ Cierre opened with active week");

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
