import net from "node:net";
import { createRequire } from "node:module";
import { createServer } from "vite";

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

async function capture(filename: string) {
  const port = await getFreePort();
  const server = await createServer({
    server: { port, strictPort: true },
  });
  await server.listen();
  const url = server.resolvedUrls?.local?.[0] || `http://localhost:${port}`;

  try {
    const browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    await page.goto(url, { waitUntil: "networkidle", timeout: 15000 });

    // Navigate to capture space
    const captureTab = page.locator('button:has-text("1. Capturar ideas")').first();
    if (await captureTab.isVisible()) {
      await captureTab.click();
    }

    // Select case-01 from dropdown
    const select = page.locator("select").nth(1); // second select is sample cases
    await select.selectOption("case-01");

    // Click "Extraer"
    const extractBtn = page.locator('button:has-text("Extraer")').first();
    await extractBtn.click();

    // Wait for results section
    const results = page.locator(".results-section").first();
    await results.waitFor({ state: "visible", timeout: 10000 });

    // Screenshot the results section
    await results.screenshot({ path: filename });
    console.log(`Saved screenshot to ${filename}`);

    await browser.close();
  } finally {
    await server.close();
  }
}

async function main() {
  const filename = process.argv[2] || "screenshot-extracted-items-after.png";
  await capture(filename);
}

main().catch((err) => {
  console.error("Capture failed:", err);
  process.exit(1);
});
