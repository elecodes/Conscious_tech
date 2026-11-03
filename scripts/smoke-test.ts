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

  const baselineDir = path.resolve(process.cwd(), "docs/ui-baseline");
  if (!fs.existsSync(baselineDir)) {
    fs.mkdirSync(baselineDir, { recursive: true });
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

    // --- STEP 1: Assert empty states on all 4 tabs & capture baseline screenshots ---
    console.log("\nVerifying 4 main tabs navigation and empty states...");

    // 1. Tab 1: Capturar ideas
    await page.locator('[data-testid="nav-tab-capture"]').click();
    await page
      .locator('[data-testid="extract-dump-button"]')
      .waitFor({ state: "visible", timeout: 5000 });
    if (mode === "preview") {
      await page.screenshot({
        path: path.join(baselineDir, "01-tab-capture-empty.png"),
        fullPage: true,
      });
    }
    console.log("  ✓ Tab 1 (Capturar ideas) rendered without errors");

    // 2. Tab 2: Preparar semana
    await page.locator('[data-testid="nav-tab-prepare"]').click();
    await page
      .locator('[data-testid="nav-tab-prepare"]')
      .waitFor({ state: "visible", timeout: 5000 });
    if (mode === "preview") {
      await page.screenshot({
        path: path.join(baselineDir, "02-tab-prepare-empty.png"),
        fullPage: true,
      });
    }
    console.log("  ✓ Tab 2 (Preparar semana) rendered without errors");

    // 3. Tab 3: Mi semana
    await page.locator('[data-testid="nav-tab-active"]').click();
    await page
      .locator('[data-testid="nav-tab-active"]')
      .waitFor({ state: "visible", timeout: 5000 });
    if (mode === "preview") {
      await page.screenshot({
        path: path.join(baselineDir, "03-tab-active-empty.png"),
        fullPage: true,
      });
    }
    console.log("  ✓ Tab 3 (Mi semana) rendered without errors");

    // 4. Tab 4: Revisar y aprender
    await page.locator('[data-testid="nav-tab-review"]').click();
    await page
      .locator('[data-testid="nav-tab-review"]')
      .waitFor({ state: "visible", timeout: 5000 });
    if (mode === "preview") {
      await page.screenshot({
        path: path.join(baselineDir, "04-tab-review-empty.png"),
        fullPage: true,
      });
    }
    console.log("  ✓ Tab 4 (Revisar y aprender) rendered without errors");

    // --- STEP 2: Full flow with Mock provider ---
    console.log("\nExecuting full Mock provider planning flow...");

    // Go to Tab 1 (Capturar ideas)
    await page.locator('[data-testid="nav-tab-capture"]').click();

    // Ensure Mock provider is selected
    const providerSelect = page.locator('[data-testid="provider-select"]');
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
        path: path.join(baselineDir, "05-capture-sample-selected.png"),
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
        path: path.join(baselineDir, "06-capture-extracted.png"),
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
        path: path.join(baselineDir, "07-prepare-transferred-items.png"),
        fullPage: true,
      });
    }
    console.log("  ✓ Transferred to Preparar semana");

    // Click "Analizar" / "Generar propuesta semanal"
    await generateProposalBtn.click();

    // Wait for proposal to be reached
    const confirmPlanBtn = page.locator('[data-testid="confirm-plan-button"]');
    await confirmPlanBtn.waitFor({ state: "visible", timeout: 15000 });
    const proposalScreen = page.locator('[data-testid="weekly-proposal-screen"]');
    await proposalScreen.waitFor({ state: "visible", timeout: 15000 });

    if (mode === "preview") {
      await page.screenshot({
        path: path.join(baselineDir, "08-proposal-screen.png"),
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

    if (mode === "preview") {
      await page.screenshot({
        path: path.join(baselineDir, "09-active-week-populated.png"),
        fullPage: true,
      });
      await page.screenshot({ path: "screenshot.png", fullPage: true });
    }
    console.log("  ✓ Active week confirmed and populated in Mi semana");

    // Open Tab 4: Revisar y aprender with active week
    await page.locator('[data-testid="nav-tab-review"]').click();
    const closingSection = page
      .locator(
        '[data-testid="early-close-guard-box"], [data-testid="weekly-reflective-closing-section"]'
      )
      .first();
    await closingSection.waitFor({ state: "visible", timeout: 10000 });

    if (mode === "preview") {
      await page.screenshot({
        path: path.join(baselineDir, "10-review-with-active-week.png"),
        fullPage: true,
      });
    }
    console.log("  ✓ Revisar y aprender opened with active week");

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
