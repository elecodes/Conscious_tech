import { spawn, execSync, ChildProcess } from "node:child_process";
import net from "node:net";
import { createRequire } from "node:module";

// Use installed chromium via require('playwright') as requested
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

async function waitForServer(url: string, timeoutMs = 15000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status < 500) return;
    } catch {
      // Retry until server accepts connections
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Server at ${url} failed to respond within ${timeoutMs}ms`);
}

async function runSmokeTestForMode(mode: "preview" | "dev"): Promise<void> {
  console.log(`\n=== Running Smoke Test: [${mode}] ===`);

  if (mode === "preview") {
    console.log("Building app for production preview...");
    execSync("npm run build", { stdio: "inherit" });
  }

  const port = await getFreePort();
  const url = `http://localhost:${port}`;
  console.log(`Starting Vite in ${mode} mode on port ${port}...`);

  const args =
    mode === "preview"
      ? ["vite", "preview", "--port", String(port), "--strictPort"]
      : ["vite", "--port", String(port), "--strictPort"];

  let serverProc: ChildProcess | null = spawn("npx", args, {
    stdio: "pipe",
    env: { ...process.env, BROWSER: "none" },
    detached: false,
  });

  serverProc.stdout?.on("data", (data) => {
    const line = data.toString().trim();
    if (line) console.log(`[vite ${mode}] ${line}`);
  });

  serverProc.stderr?.on("data", (data) => {
    const line = data.toString().trim();
    if (line) console.error(`[vite ${mode} err] ${line}`);
  });

  const cleanup = () => {
    if (serverProc) {
      try {
        serverProc.kill("SIGTERM");
      } catch {
        // ignore
      }
      serverProc = null;
    }
  };

  try {
    await waitForServer(url);
    console.log(`Server is ready at ${url}`);

    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    const pageErrors: string[] = [];
    page.on("pageerror", (err: Error) => {
      console.error(`[PAGEERROR] ${err.message}`);
      pageErrors.push(err.message || String(err));
    });

    console.log(`Navigating to ${url}...`);
    await page.goto(url, { waitUntil: "networkidle", timeout: 10000 });

    // Assert: no pageerror events occurred
    if (pageErrors.length > 0) {
      throw new Error(
        `Assertion failed: pageerror events detected in [${mode}]:\n` +
          pageErrors.map((e) => `  - ${e}`).join("\n")
      );
    }

    // Assert: text "Tecnología Consciente" is visible
    const textLocator = page.locator("text=Tecnología Consciente").first();
    await textLocator.waitFor({ state: "visible", timeout: 5000 });
    console.log(`Assertion passed: "Tecnología Consciente" is visible.`);

    // Capture screenshot
    if (mode === "preview") {
      await page.screenshot({ path: "screenshot.png", fullPage: true });
      console.log("Saved screenshot to screenshot.png");
    }

    await browser.close();
    console.log(`=== Smoke Test [${mode}] PASSED ===\n`);
  } finally {
    cleanup();
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

main().catch((err) => {
  console.error("\n❌ Smoke test failed:", err.message);
  process.exit(1);
});
